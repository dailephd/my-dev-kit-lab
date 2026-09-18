import type {
  PlaywrightLikeBrowser,
  PlaywrightLikeBrowserContext,
  PlaywrightLikeTutorialPage
} from "../browser/types.js";
import { executeTutorialAction } from "./tutorialActions.js";
import { executeTutorialAssertion } from "./tutorialAssertions.js";
import type {
  TutorialAssertionResultV1,
  TutorialScenarioV1,
  TutorialStepResultV1,
  TutorialStepV1
} from "./types.js";

/**
 * Persistent tutorial browser session.
 *
 * A run creates exactly one context and exactly one page and drives every step
 * against that same page, so page state (navigation, focus, form contents)
 * carries across steps the way a viewer would experience it. Nothing here
 * captures screenshots, records video, or renders overlays -- those are Prompt 3
 * behaviors and are intentionally absent.
 */

export type TutorialSession = {
  context: PlaywrightLikeBrowserContext;
  page: PlaywrightLikeTutorialPage;
};

export type OpenTutorialSessionResult =
  | { ok: true; session: TutorialSession }
  | { ok: false; error: string };

export async function openTutorialSession(
  browser: PlaywrightLikeBrowser,
  viewport: { width: number; height: number }
): Promise<OpenTutorialSessionResult> {
  if (typeof browser.newContext !== "function") {
    return {
      ok: false,
      error: "Tutorial browser runtime does not support browser contexts, which a persistent tutorial session requires."
    };
  }

  let context: PlaywrightLikeBrowserContext;
  try {
    context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  } catch (error) {
    return { ok: false, error: `Tutorial browser context could not be created: ${messageOf(error)}` };
  }

  try {
    const page = await context.newPage();
    return { ok: true, session: { context, page } };
  } catch (error) {
    // The context exists but is unusable; close it so a failed open never leaks.
    await closeQuietly(() => context.close());
    return { ok: false, error: `Tutorial page could not be created: ${messageOf(error)}` };
  }
}

/**
 * Closes page (when the runtime exposes an explicit page close) and context.
 * Returns cleanup errors rather than throwing so the caller can preserve a
 * primary failure and still record what went wrong during teardown.
 */
export async function closeTutorialSession(session: TutorialSession): Promise<string[]> {
  const errors: string[] = [];
  if (typeof session.page.close === "function") {
    const pageError = await closeQuietly(() => session.page.close!());
    if (pageError) {
      errors.push(`Tutorial page close failed: ${pageError}`);
    }
  }
  const contextError = await closeQuietly(() => session.context.close());
  if (contextError) {
    errors.push(`Tutorial browser context close failed: ${contextError}`);
  }
  return errors;
}

export type ExecuteTutorialStepsOptions = {
  page: PlaywrightLikeTutorialPage;
  scenario: TutorialScenarioV1;
  applicationUrl: string;
  targetRoot: string;
  /** Injectable for deterministic pause testing; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
};

export type ExecuteTutorialStepsResult = {
  steps: TutorialStepResultV1[];
  failedStepId?: string;
  error?: string;
};

/**
 * Runs every step in declared order against one page.
 *
 * Failure semantics, in the planner's order: an action failure skips that step's
 * assertions; assertion failures do not short-circuit each other within the same
 * step (all are collected so a reader sees the full picture); either kind of
 * failure stops later steps, which are reported as "not-run" rather than omitted
 * or reported as passed.
 */
export async function executeTutorialSteps(
  options: ExecuteTutorialStepsOptions
): Promise<ExecuteTutorialStepsResult> {
  const sleep = options.sleep ?? defaultSleep;
  const steps: TutorialStepResultV1[] = [];
  let failedStepId: string | undefined;
  let failureMessage: string | undefined;

  for (const step of options.scenario.steps) {
    if (failedStepId !== undefined) {
      steps.push(notRunStepResult(step));
      continue;
    }

    const startedAtMs = Date.now();
    const result: TutorialStepResultV1 = {
      id: step.id,
      status: "passed",
      startedAt: new Date(startedAtMs).toISOString(),
      assertions: [],
      screenshotRequested: step.screenshot !== undefined,
      highlightRequested: step.highlight !== undefined,
      calloutRequested: step.callout !== undefined
    };

    if (step.pauseBeforeMs !== undefined && step.pauseBeforeMs > 0) {
      await sleep(step.pauseBeforeMs);
    }

    let actionPhaseCompleted = true;
    if (step.action) {
      const actionResult = await executeTutorialAction(options.page, step.action, {
        applicationUrl: options.applicationUrl
      });
      result.action = actionResult;
      if (actionResult.status === "failed") {
        actionPhaseCompleted = false;
        result.status = "failed";
        result.error = `Step ${JSON.stringify(step.id)} failed because the ${step.action.type} action failed: ${actionResult.error ?? "unknown error"}`;
      }
    }

    if (actionPhaseCompleted) {
      const assertionResults = await runStepAssertions(step, options);
      result.assertions = assertionResults;
      const failedAssertions = assertionResults.filter((assertion) => assertion.status === "failed");
      if (failedAssertions.length > 0) {
        result.status = "failed";
        result.error = `Step ${JSON.stringify(step.id)} failed because ${failedAssertions.length} of ${assertionResults.length} assertions failed: ${failedAssertions
          .map((assertion) => `${assertion.type}: ${assertion.error ?? "unknown error"}`)
          .join("; ")}`;
      }

      if (step.pauseAfterMs !== undefined && step.pauseAfterMs > 0) {
        await sleep(step.pauseAfterMs);
      }
    }

    const endedAtMs = Date.now();
    result.endedAt = new Date(endedAtMs).toISOString();
    result.durationMs = endedAtMs - startedAtMs;
    steps.push(result);

    if (result.status === "failed") {
      failedStepId = step.id;
      failureMessage = result.error;
    }
  }

  return {
    steps,
    ...(failedStepId !== undefined ? { failedStepId } : {}),
    ...(failureMessage !== undefined ? { error: failureMessage } : {})
  };
}

async function runStepAssertions(
  step: TutorialStepV1,
  options: ExecuteTutorialStepsOptions
): Promise<TutorialAssertionResultV1[]> {
  const results: TutorialAssertionResultV1[] = [];
  for (const assertion of step.assertions ?? []) {
    results.push(
      await executeTutorialAssertion(options.page, assertion, {
        applicationUrl: options.applicationUrl,
        targetRoot: options.targetRoot
      })
    );
  }
  return results;
}

function notRunStepResult(step: TutorialStepV1): TutorialStepResultV1 {
  return {
    id: step.id,
    status: "not-run",
    assertions: [],
    screenshotRequested: step.screenshot !== undefined,
    highlightRequested: step.highlight !== undefined,
    calloutRequested: step.callout !== undefined
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function closeQuietly(close: () => Promise<void>): Promise<string | undefined> {
  try {
    await close();
    return undefined;
  } catch (error) {
    return messageOf(error);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
