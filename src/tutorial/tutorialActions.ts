import type { PlaywrightLikeMouse, PlaywrightLikeTutorialPage } from "../browser/types.js";
import { describeTutorialLocator, resolveTutorialLocator } from "./tutorialLocators.js";
import { resolveTutorialFractionPoint } from "./tutorialPointerGeometry.js";
import {
  DEFAULT_TUTORIAL_ACTION_TIMEOUT_MS,
  type TutorialActionResultV1,
  type TutorialActionV1
} from "./types.js";

export type TutorialActionContext = {
  /** Validated loopback origin the scenario is allowed to drive. */
  applicationUrl: string;
};

export const POINTER_DRAG_MOVE_STEPS = 8;

/**
 * Resolves a scenario `goto` path against the target application's URL and
 * proves the result never leaves that origin.
 *
 * Validation already rejects absolute and protocol-relative paths, so this is
 * the second, authoritative gate: whatever the string is, the resolved URL must
 * match the application's protocol, hostname and port exactly or navigation is
 * refused.
 */
export function resolveTutorialNavigationUrl(applicationUrl: string, suppliedPath: string): string {
  if (typeof suppliedPath !== "string" || !suppliedPath.startsWith("/") || suppliedPath.startsWith("//")) {
    throw new Error(
      `Tutorial goto path must be a root-relative path beginning with "/" and must not be protocol-relative; received ${JSON.stringify(suppliedPath)}.`
    );
  }

  const base = new URL(applicationUrl);
  const resolved = new URL(suppliedPath, base);

  if (resolved.protocol !== base.protocol || resolved.hostname !== base.hostname || resolved.port !== base.port) {
    throw new Error(
      `Tutorial goto path ${JSON.stringify(suppliedPath)} resolves to ${resolved.origin}, which leaves the application origin ${base.origin}.`
    );
  }
  return resolved.href;
}

/**
 * Executes one declarative action and always returns a structured result.
 *
 * There is intentionally no retry loop here: Playwright's own per-call timeout
 * is the single waiting mechanism, so a step's duration stays predictable and a
 * flaky scenario cannot be masked by silent repetition.
 */
export async function executeTutorialAction(
  page: PlaywrightLikeTutorialPage,
  action: TutorialActionV1,
  context: TutorialActionContext
): Promise<TutorialActionResultV1> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  try {
    await performAction(page, action, context);
    return finish(action.type, "passed", startedAt, startedAtMs);
  } catch (error) {
    return {
      ...finish(action.type, "failed", startedAt, startedAtMs),
      error: describeActionError(action, error)
    };
  }
}

async function performAction(
  page: PlaywrightLikeTutorialPage,
  action: TutorialActionV1,
  context: TutorialActionContext
): Promise<void> {
  switch (action.type) {
    case "goto": {
      const url = resolveTutorialNavigationUrl(context.applicationUrl, action.path);
      await page.goto(url, action.waitUntil !== undefined ? { waitUntil: action.waitUntil } : undefined);
      return;
    }
    case "click":
      await resolveTutorialLocator(page, action.locator).click({ timeout: timeoutFor(action.timeoutMs) });
      return;
    case "fill":
      await resolveTutorialLocator(page, action.locator).fill(action.value, {
        timeout: timeoutFor(action.timeoutMs)
      });
      return;
    case "press":
      await resolveTutorialLocator(page, action.locator).press(action.key, {
        timeout: timeoutFor(action.timeoutMs)
      });
      return;
    case "hover":
      await resolveTutorialLocator(page, action.locator).hover({ timeout: timeoutFor(action.timeoutMs) });
      return;
    case "drag": {
      // Both ends go through the canonical resolver so a drag cannot develop its
      // own locator semantics.
      const source = resolveTutorialLocator(page, action.source);
      const target = resolveTutorialLocator(page, action.target);
      await source.dragTo(target, { timeout: timeoutFor(action.timeoutMs) });
      return;
    }
    case "pointer-click": {
      const locator = resolveTutorialLocator(page, action.locator);
      await locator.waitFor({ state: "visible", timeout: timeoutFor(action.timeoutMs) });
      const box = await locator.boundingBox();
      if (!box) {
        throw new Error("locator has no bounding box");
      }
      const point = resolveTutorialFractionPoint(box, action.position);
      await page.mouse.move(point.x, point.y);
      await runWithMouseDown(page.mouse, async () => {});
      return;
    }
    case "pointer-drag": {
      const locator = resolveTutorialLocator(page, action.locator);
      await locator.waitFor({ state: "visible", timeout: timeoutFor(action.timeoutMs) });
      const box = await locator.boundingBox();
      if (!box) {
        throw new Error("locator has no bounding box");
      }
      const start = resolveTutorialFractionPoint(box, action.from);
      const end = resolveTutorialFractionPoint(box, action.to);
      await page.mouse.move(start.x, start.y);
      await runWithMouseDown(page.mouse, () =>
        page.mouse.move(end.x, end.y, { steps: POINTER_DRAG_MOVE_STEPS })
      );
      return;
    }
    case "wait-for":
      await resolveTutorialLocator(page, action.locator).waitFor({
        ...(action.state !== undefined ? { state: action.state } : {}),
        timeout: timeoutFor(action.timeoutMs)
      });
      return;
  }
}

async function runWithMouseDown(mouse: PlaywrightLikeMouse, operation: () => Promise<void>): Promise<void> {
  await mouse.down();
  let primaryError: unknown;
  let primaryFailed = false;
  try {
    await operation();
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
  }

  try {
    await mouse.up();
  } catch (cleanupError) {
    if (primaryFailed) {
      const primaryMessage = messageOf(primaryError);
      const cleanupMessage = messageOf(cleanupError);
      throw new Error(`${primaryMessage} (mouse.up cleanup also failed: ${cleanupMessage})`, {
        cause: primaryError
      });
    }
    throw cleanupError;
  }

  if (primaryFailed) {
    throw primaryError;
  }
}

export function timeoutFor(timeoutMs: number | undefined): number {
  return timeoutMs ?? DEFAULT_TUTORIAL_ACTION_TIMEOUT_MS;
}

function finish(
  type: TutorialActionV1["type"],
  status: "passed" | "failed",
  startedAt: string,
  startedAtMs: number
): TutorialActionResultV1 {
  const endedAtMs = Date.now();
  return {
    type,
    status,
    startedAt,
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: endedAtMs - startedAtMs
  };
}

function describeActionError(action: TutorialActionV1, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  switch (action.type) {
    case "goto":
      return `goto ${JSON.stringify(action.path)} failed: ${message}`;
    case "drag":
      return `drag from ${describeTutorialLocator(action.source)} to ${describeTutorialLocator(action.target)} failed: ${message}`;
    case "pointer-click":
      return `pointer-click on ${describeTutorialLocator(action.locator)} at fraction ${describeFractionPoint(action.position)} failed: ${message}`;
    case "pointer-drag":
      return `pointer-drag on ${describeTutorialLocator(action.locator)} from fraction ${describeFractionPoint(action.from)} to ${describeFractionPoint(action.to)} failed: ${message}`;
    case "click":
    case "fill":
    case "press":
    case "hover":
    case "wait-for":
      return `${action.type} on ${describeTutorialLocator(action.locator)} failed: ${message}`;
  }
}

function describeFractionPoint(point: { x: number; y: number }): string {
  return `(${String(point.x)}, ${String(point.y)})`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
