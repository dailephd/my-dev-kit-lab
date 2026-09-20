import { existsSync } from "node:fs";
import type {
  PlaywrightLikeBrowser,
  PlaywrightLikeBrowserContext,
  PlaywrightLikeTutorialPage,
  PlaywrightLikeVideo
} from "../browser/types.js";
import { executeTutorialAction } from "./tutorialActions.js";
import { executeTutorialAssertion } from "./tutorialAssertions.js";
import { resolveTutorialLocator, describeTutorialLocator } from "./tutorialLocators.js";
import { resolveTutorialFractionPoint, type TutorialPointerPoint } from "./tutorialPointerGeometry.js";
import { buildScreenshotPath, toRunRelativePosixPath, verifyArtifactFile } from "./tutorialArtifacts.js";
import {
  CLICK_FEEDBACK_DURATION_MS,
  CURSOR_MOVE_DURATION_MS,
  centerOfBox,
  installTutorialCursor,
  moveTutorialCursor,
  removeTutorialVisuals,
  showTutorialClickFeedback,
  type TutorialBox
} from "./tutorialCursor.js";
import {
  applyTutorialCallout,
  applyTutorialHighlight,
  clearTutorialStepOverlays,
  resolveCalloutPlacement
} from "./tutorialOverlay.js";
import type {
  TutorialActionV1,
  TutorialArtifactRecordV1,
  TutorialAssertionResultV1,
  TutorialLocatorV1,
  TutorialRunPaths,
  TutorialScenarioV1,
  TutorialStepResultV1,
  TutorialStepV1
} from "./types.js";

/**
 * Persistent tutorial browser session.
 *
 * A run creates exactly one context and exactly one page and drives every step
 * against that same page. The session also owns the presentation layer: cursor
 * installation, per-step highlight/callout lifecycle, step screenshot timing,
 * and the recording-relative timeline. Presentation never affects action or
 * assertion outcomes -- those remain owned by tutorialActions/tutorialAssertions
 * and always target the real application through the canonical locator resolver.
 */

export type TutorialSession = {
  context: PlaywrightLikeBrowserContext;
  page: PlaywrightLikeTutorialPage;
  /** Recorded video handle, captured at page creation; null when not recording. */
  video: PlaywrightLikeVideo | null;
};

export type OpenTutorialSessionResult =
  | { ok: true; session: TutorialSession }
  | { ok: false; error: string };

export type OpenTutorialSessionOptions = {
  viewport: { width: number; height: number };
  /** When set, the context records WebM into this directory at viewport size. */
  recordVideoDir?: string;
};

export async function openTutorialSession(
  browser: PlaywrightLikeBrowser,
  options: OpenTutorialSessionOptions
): Promise<OpenTutorialSessionResult> {
  if (typeof browser.newContext !== "function") {
    return {
      ok: false,
      error: "Tutorial browser runtime does not support browser contexts, which a persistent tutorial session requires."
    };
  }

  const viewport = { width: options.viewport.width, height: options.viewport.height };
  let context: PlaywrightLikeBrowserContext;
  try {
    context = await browser.newContext({
      viewport,
      // Recording size matches the scenario viewport: no invented dimensions.
      ...(options.recordVideoDir !== undefined
        ? { recordVideo: { dir: options.recordVideoDir, size: { ...viewport } } }
        : {})
    });
  } catch (error) {
    return { ok: false, error: `Tutorial browser context could not be created: ${messageOf(error)}` };
  }

  try {
    const page = await context.newPage();
    let video: PlaywrightLikeVideo | null = null;
    if (typeof page.video === "function") {
      try {
        video = page.video();
      } catch (error) {
        // A runtime without video must not prevent the tutorial from running;
        // the missing recording is reported later as an artifact outcome.
        video = null;
        void error;
      }
    }
    return { ok: true, session: { context, page, video } };
  } catch (error) {
    await closeQuietly(() => context.close());
    return { ok: false, error: `Tutorial page could not be created: ${messageOf(error)}` };
  }
}

/**
 * Closes the page and context. Playwright only finalizes a recording when the
 * page closes, so the caller finalizes video after this returns.
 *
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
  /** Monotonic clock for the recording-relative timeline; defaults to Date.now. */
  now?: () => number;
  /**
   * Enables cursor, click feedback, highlight and callout rendering. Off by
   * default so a caller that only needs step outcomes pays nothing for it.
   */
  visuals?: boolean;
  /** Required to capture requested step screenshots. */
  paths?: TutorialRunPaths;
};

export type ExecuteTutorialStepsResult = {
  steps: TutorialStepResultV1[];
  screenshots: TutorialArtifactRecordV1[];
  visualWarnings: string[];
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
 *
 * Per-step ordering with visuals enabled:
 *   clear previous overlays -> pauseBefore -> cursor move -> real action ->
 *   click feedback -> assertions -> highlight + callout -> pauseAfter ->
 *   screenshot
 * so a screenshot always shows the final intended state of its step.
 */
export async function executeTutorialSteps(
  options: ExecuteTutorialStepsOptions
): Promise<ExecuteTutorialStepsResult> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const timelineOrigin = now();

  const steps: TutorialStepResultV1[] = [];
  const screenshots: TutorialArtifactRecordV1[] = [];
  const visualWarnings: string[] = [];
  let failedStepId: string | undefined;
  let failureMessage: string | undefined;

  /**
   * Installing is idempotent, and a navigation replaces the whole document, so
   * the tutorial-owned visual root has to be re-established rather than assumed
   * to survive. Calling this at the start of every step and again after a
   * successful goto keeps the cursor present without tracking navigations.
   */
  const ensureVisuals = async (stepId: string): Promise<void> => {
    if (!options.visuals) {
      return;
    }
    await runVisual(visualWarnings, stepId, "install cursor", () => installTutorialCursor(options.page));
  };

  await ensureVisuals("<session>");

  for (const step of options.scenario.steps) {
    if (failedStepId !== undefined) {
      steps.push(notRunStepResult(step));
      continue;
    }

    const startedAtMs = Date.now();
    const timelineStartMs = Math.max(0, now() - timelineOrigin);
    const result: TutorialStepResultV1 = {
      id: step.id,
      status: "passed",
      startedAt: new Date(startedAtMs).toISOString(),
      timelineStartMs,
      assertions: [],
      screenshotRequested: step.screenshot !== undefined,
      highlightRequested: step.highlight !== undefined,
      calloutRequested: step.callout !== undefined
    };

    if (options.visuals) {
      // Each step starts from a clean visual slate, on a guaranteed-present root.
      await ensureVisuals(step.id);
      await runVisual(visualWarnings, step.id, "clear overlays", () =>
        clearTutorialStepOverlays(options.page)
      );
    }

    if (step.pauseBeforeMs !== undefined && step.pauseBeforeMs > 0) {
      await sleep(step.pauseBeforeMs);
    }

    let actionPhaseCompleted = true;
    if (step.action) {
      const cursorTarget = options.visuals
        ? await moveCursorForAction(options, step.action, visualWarnings, step.id, sleep)
        : undefined;

      const actionResult = await executeTutorialAction(options.page, step.action, {
        applicationUrl: options.applicationUrl
      });
      result.action = actionResult;

      if (actionResult.status === "failed") {
        actionPhaseCompleted = false;
        result.status = "failed";
        result.error = `Step ${JSON.stringify(step.id)} failed because the ${step.action.type} action failed: ${actionResult.error ?? "unknown error"}`;
      } else if (options.visuals) {
        if (step.action.type === "goto") {
          // The new document has none of the tutorial's DOM.
          await ensureVisuals(step.id);
        }
        await applyPostActionVisuals(options, step, cursorTarget, visualWarnings, sleep);
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

      if (options.visuals) {
        await applyStepOverlays(options, step, visualWarnings);
      }

      if (step.pauseAfterMs !== undefined && step.pauseAfterMs > 0) {
        await sleep(step.pauseAfterMs);
      }
    }

    if (step.screenshot) {
      screenshots.push(
        await captureStepScreenshot(options, step, actionPhaseCompleted)
      );
    }

    const endedAtMs = Date.now();
    result.endedAt = new Date(endedAtMs).toISOString();
    result.durationMs = endedAtMs - startedAtMs;
    result.timelineEndMs = Math.max(timelineStartMs, now() - timelineOrigin);
    steps.push(result);

    if (result.status === "failed") {
      failedStepId = step.id;
      failureMessage = result.error;
    }
  }

  if (options.visuals) {
    await runVisual(visualWarnings, "<cleanup>", "remove tutorial visuals", () =>
      removeTutorialVisuals(options.page)
    );
  }

  return {
    steps,
    screenshots,
    visualWarnings,
    ...(failedStepId !== undefined ? { failedStepId } : {}),
    ...(failureMessage !== undefined ? { error: failureMessage } : {})
  };
}

/**
 * Moves the synthetic cursor onto the action's target before the real action.
 *
 * `goto` and `wait-for` have no pointer target, so the cursor is left alone. A
 * missing bounding box is recorded as a visual warning and the real action still
 * runs -- presentation never gates correctness.
 */
async function moveCursorForAction(
  options: ExecuteTutorialStepsOptions,
  action: TutorialActionV1,
  warnings: string[],
  stepId: string,
  sleep: (ms: number) => Promise<void>
): Promise<TutorialActionVisualPlan | undefined> {
  const locator = cursorLocatorForAction(action);
  if (!locator) {
    return undefined;
  }
  const box = await readBoundingBox(options.page, locator, warnings, stepId);
  if (!box) {
    return undefined;
  }
  let point: TutorialPointerPoint;
  let pointerDragEnd: TutorialPointerPoint | undefined;
  try {
    if (action.type === "pointer-click") {
      point = resolveTutorialFractionPoint(box, action.position);
    } else if (action.type === "pointer-drag") {
      point = resolveTutorialFractionPoint(box, action.from);
      pointerDragEnd = resolveTutorialFractionPoint(box, action.to);
    } else {
      point = centerOfBox(box);
    }
  } catch (error) {
    warnings.push(
      `Step ${JSON.stringify(stepId)}: pointer visual for ${describeTutorialLocator(locator)} could not be planned: ${messageOf(error)}`
    );
    return undefined;
  }
  await runVisual(warnings, stepId, "move cursor", () => moveTutorialCursor(options.page, point));
  await sleep(CURSOR_MOVE_DURATION_MS);
  return { point, ...(pointerDragEnd ? { pointerDragEnd } : {}) };
}

type TutorialActionVisualPlan = {
  point: TutorialPointerPoint;
  pointerDragEnd?: TutorialPointerPoint;
};

/** The locator whose center the cursor points at before each action type. */
export function cursorLocatorForAction(action: TutorialActionV1): TutorialLocatorV1 | undefined {
  switch (action.type) {
    case "click":
    case "fill":
    case "press":
    case "hover":
    // The cursor rests on the select itself; the native popup is OS-drawn and
    // is deliberately not animated through.
    case "select-option":
    case "pointer-click":
    case "pointer-drag":
      return action.locator;
    case "drag":
      return action.source;
    // goto has no element target; wait-for deliberately does not move the cursor.
    case "goto":
    case "wait-for":
      return undefined;
  }
}

async function applyPostActionVisuals(
  options: ExecuteTutorialStepsOptions,
  step: TutorialStepV1,
  cursorTarget: TutorialActionVisualPlan | undefined,
  warnings: string[],
  sleep: (ms: number) => Promise<void>
): Promise<void> {
  const action = step.action;
  if (!action) {
    return;
  }

  if ((action.type === "click" || action.type === "pointer-click") && cursorTarget) {
    await runVisual(warnings, step.id, "click feedback", () =>
      showTutorialClickFeedback(options.page, cursorTarget.point)
    );
    // Held only long enough for the ripple to be visible in the recording.
    await sleep(CLICK_FEEDBACK_DURATION_MS);
    return;
  }

  if (action.type === "drag") {
    // The cursor follows to the drop target after the real drag completed.
    const box = await readBoundingBox(options.page, action.target, warnings, step.id);
    if (box) {
      await runVisual(warnings, step.id, "move cursor to drag target", () =>
        moveTutorialCursor(options.page, centerOfBox(box))
      );
      await sleep(CURSOR_MOVE_DURATION_MS);
    }
    return;
  }

  if (action.type === "pointer-drag" && cursorTarget?.pointerDragEnd) {
    await runVisual(warnings, step.id, "move cursor to pointer-drag endpoint", () =>
      moveTutorialCursor(options.page, cursorTarget.pointerDragEnd!)
    );
    await sleep(CURSOR_MOVE_DURATION_MS);
  }
}

async function applyStepOverlays(
  options: ExecuteTutorialStepsOptions,
  step: TutorialStepV1,
  warnings: string[]
): Promise<void> {
  if (step.highlight) {
    const box = await readBoundingBox(options.page, step.highlight, warnings, step.id);
    if (box) {
      await runVisual(warnings, step.id, "apply highlight", () =>
        applyTutorialHighlight(options.page, box)
      );
    }
  }

  if (step.callout) {
    const box = step.callout.locator
      ? await readBoundingBox(options.page, step.callout.locator, warnings, step.id)
      : undefined;
    const viewport = options.scenario.browser.viewport;
    const placement = resolveCalloutPlacement(step.callout.placement, box, viewport);
    await runVisual(warnings, step.id, "apply callout", () =>
      applyTutorialCallout(options.page, {
        text: step.callout!.text,
        placement,
        box: box ?? null,
        viewport
      })
    );
  }
}

/**
 * Captures a requested screenshot from the already-open tutorial page.
 *
 * Never launches a browser and never re-navigates: the point of the capture is
 * the live state this session just produced.
 */
async function captureStepScreenshot(
  options: ExecuteTutorialStepsOptions,
  step: TutorialStepV1,
  actionPhaseCompleted: boolean
): Promise<TutorialArtifactRecordV1> {
  const screenshot = step.screenshot!;
  if (!options.paths) {
    return {
      kind: "screenshot",
      id: screenshot.id,
      status: "failed",
      error: `Screenshot ${JSON.stringify(screenshot.id)} was requested but the tutorial run has no screenshot output directory.`
    };
  }

  const absolutePath = buildScreenshotPath(options.paths, screenshot.id);
  const relativePath = toRunRelativePosixPath(options.paths.runRoot, absolutePath);

  if (!actionPhaseCompleted) {
    // The step never reached a usable state; fabricating an image would misrepresent it.
    return {
      kind: "screenshot",
      id: screenshot.id,
      status: "skipped",
      path: relativePath,
      error: `Screenshot ${JSON.stringify(screenshot.id)} was not captured because step ${JSON.stringify(step.id)} failed before reaching a usable state.`
    };
  }

  if (existsSync(absolutePath)) {
    // Canonical screenshot identity is stable; silently overwriting or adding a
    // suffix would both hide a real problem.
    return {
      kind: "screenshot",
      id: screenshot.id,
      status: "failed",
      path: relativePath,
      error: `Screenshot ${JSON.stringify(screenshot.id)} already exists at ${relativePath}; refusing to overwrite a canonical tutorial artifact.`
    };
  }

  try {
    await options.page.screenshot({ path: absolutePath, fullPage: screenshot.fullPage ?? false });
  } catch (error) {
    return {
      kind: "screenshot",
      id: screenshot.id,
      status: "failed",
      path: relativePath,
      error: `Screenshot ${JSON.stringify(screenshot.id)} could not be captured: ${messageOf(error)}`
    };
  }

  const check = await verifyArtifactFile(absolutePath);
  if (!check.ok) {
    return { kind: "screenshot", id: screenshot.id, status: "failed", path: relativePath, error: check.error };
  }
  return {
    kind: "screenshot",
    id: screenshot.id,
    status: "written",
    path: relativePath,
    sizeBytes: check.sizeBytes
  };
}

async function readBoundingBox(
  page: PlaywrightLikeTutorialPage,
  locator: TutorialLocatorV1,
  warnings: string[],
  stepId: string
): Promise<TutorialBox | undefined> {
  try {
    const box = await resolveTutorialLocator(page, locator).boundingBox();
    if (!box) {
      warnings.push(
        `Step ${JSON.stringify(stepId)}: ${describeTutorialLocator(locator)} has no bounding box, so its tutorial visual was skipped.`
      );
      return undefined;
    }
    return box;
  } catch (error) {
    warnings.push(
      `Step ${JSON.stringify(stepId)}: bounding box for ${describeTutorialLocator(locator)} could not be read: ${messageOf(error)}`
    );
    return undefined;
  }
}

/**
 * Runs one presentation operation. A failure here is recorded as a visual
 * warning, never swallowed and never promoted into an action/assertion outcome.
 */
async function runVisual(
  warnings: string[],
  stepId: string,
  description: string,
  operation: () => Promise<unknown>
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    warnings.push(`Step ${JSON.stringify(stepId)}: tutorial visual "${description}" failed: ${messageOf(error)}`);
  }
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
