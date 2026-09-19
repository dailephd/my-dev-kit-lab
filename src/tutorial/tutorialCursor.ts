import type { PlaywrightLikeTutorialPage } from "../browser/types.js";

/**
 * Synthetic tutorial cursor and click feedback.
 *
 * Everything this module injects is presentation only. Playwright still performs
 * every real interaction, locator resolution and assertion; the cursor exists so
 * a viewer of the recording can see where the tutorial is pointing. All injected
 * nodes use `pointer-events: none` so they can never intercept application input,
 * and they live in one tutorial-owned container so cleanup is a single removal.
 */

/** Stable, collision-resistant identities owned by the tutorial runtime. */
export const TUTORIAL_VISUAL_ROOT_ID = "__my_dev_kit_lab_tutorial_visuals__";
export const TUTORIAL_CURSOR_ID = "__my_dev_kit_lab_tutorial_cursor__";
export const TUTORIAL_CLICK_FEEDBACK_ID = "__my_dev_kit_lab_tutorial_click_feedback__";

/** Planner-owned, machine-independent so recordings are reproducible. */
export const CURSOR_MOVE_DURATION_MS = 250;
export const CLICK_FEEDBACK_DURATION_MS = 300;

const CURSOR_SIZE_PX = 24;
const CLICK_FEEDBACK_SIZE_PX = 44;

export type TutorialBox = { x: number; y: number; width: number; height: number };
export type TutorialPoint = { x: number; y: number };

/** Center of a bounding box; the deterministic cursor target for every action. */
export function centerOfBox(box: TutorialBox): TutorialPoint {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// ---------------------------------------------------------------------------
// Browser-side scripts
//
// These run inside the page, so they may only use page globals and their single
// serializable argument -- no closure over module state. They are exported so
// unit tests can drive them against a stub `document` without a real browser.
// ---------------------------------------------------------------------------

export type InstallCursorArg = {
  rootId: string;
  cursorId: string;
  moveDurationMs: number;
  sizePx: number;
};

export function installCursorInPage(arg: InstallCursorArg): boolean {
  const doc = globalThis.document as unknown as {
    getElementById(id: string): HTMLElementLike | null;
    createElement(tag: string): HTMLElementLike;
    body: { appendChild(node: HTMLElementLike): void };
  };
  if (!doc || !doc.body) {
    return false;
  }

  let root = doc.getElementById(arg.rootId);
  if (!root) {
    root = doc.createElement("div");
    root.id = arg.rootId;
    root.setAttribute("aria-hidden", "true");
    root.style.setProperty("position", "fixed");
    root.style.setProperty("left", "0");
    root.style.setProperty("top", "0");
    root.style.setProperty("width", "0");
    root.style.setProperty("height", "0");
    root.style.setProperty("pointer-events", "none");
    root.style.setProperty("z-index", "2147483646");
    doc.body.appendChild(root);
  }

  if (doc.getElementById(arg.cursorId)) {
    // Installing twice must not produce two cursors.
    return false;
  }

  const cursor = doc.createElement("div");
  cursor.id = arg.cursorId;
  cursor.setAttribute("aria-hidden", "true");
  cursor.style.setProperty("position", "fixed");
  cursor.style.setProperty("left", "0");
  cursor.style.setProperty("top", "0");
  cursor.style.setProperty("width", `${arg.sizePx}px`);
  cursor.style.setProperty("height", `${arg.sizePx}px`);
  cursor.style.setProperty("margin-left", `${-arg.sizePx / 2}px`);
  cursor.style.setProperty("margin-top", `${-arg.sizePx / 2}px`);
  cursor.style.setProperty("border-radius", "50%");
  cursor.style.setProperty("background", "rgba(20, 20, 20, 0.35)");
  cursor.style.setProperty("border", "2px solid rgba(255, 255, 255, 0.9)");
  cursor.style.setProperty("box-shadow", "0 0 0 1px rgba(0, 0, 0, 0.45)");
  cursor.style.setProperty("pointer-events", "none");
  cursor.style.setProperty("z-index", "2147483647");
  cursor.style.setProperty("opacity", "0");
  cursor.style.setProperty("transform", "translate(0px, 0px)");
  cursor.style.setProperty("transition", `transform ${arg.moveDurationMs}ms linear, opacity 120ms linear`);
  root.appendChild(cursor);
  return true;
}

export type MoveCursorArg = { cursorId: string; x: number; y: number };

export function moveCursorInPage(arg: MoveCursorArg): boolean {
  const doc = globalThis.document as unknown as { getElementById(id: string): HTMLElementLike | null };
  const cursor = doc?.getElementById(arg.cursorId);
  if (!cursor) {
    return false;
  }
  cursor.style.setProperty("opacity", "1");
  cursor.style.setProperty("transform", `translate(${arg.x}px, ${arg.y}px)`);
  return true;
}

export type ClickFeedbackArg = {
  rootId: string;
  feedbackId: string;
  x: number;
  y: number;
  durationMs: number;
  sizePx: number;
};

export function showClickFeedbackInPage(arg: ClickFeedbackArg): boolean {
  const doc = globalThis.document as unknown as {
    getElementById(id: string): HTMLElementLike | null;
    createElement(tag: string): HTMLElementLike;
  };
  const root = doc?.getElementById(arg.rootId);
  if (!root) {
    return false;
  }
  // A previous ripple is replaced rather than accumulated.
  const stale = doc.getElementById(arg.feedbackId);
  if (stale) {
    stale.remove();
  }

  const ripple = doc.createElement("div");
  ripple.id = arg.feedbackId;
  ripple.setAttribute("aria-hidden", "true");
  ripple.style.setProperty("position", "fixed");
  ripple.style.setProperty("left", `${arg.x - arg.sizePx / 2}px`);
  ripple.style.setProperty("top", `${arg.y - arg.sizePx / 2}px`);
  ripple.style.setProperty("width", `${arg.sizePx}px`);
  ripple.style.setProperty("height", `${arg.sizePx}px`);
  ripple.style.setProperty("border-radius", "50%");
  ripple.style.setProperty("border", "3px solid rgba(255, 92, 0, 0.95)");
  ripple.style.setProperty("background", "rgba(255, 92, 0, 0.18)");
  ripple.style.setProperty("pointer-events", "none");
  ripple.style.setProperty("z-index", "2147483647");
  root.appendChild(ripple);

  const timers = globalThis as unknown as { setTimeout?: (fn: () => void, ms: number) => unknown };
  if (typeof timers.setTimeout === "function") {
    timers.setTimeout(() => {
      const current = doc.getElementById(arg.feedbackId);
      if (current) {
        current.remove();
      }
    }, arg.durationMs);
  }
  return true;
}

export type RemoveVisualsArg = { rootId: string };

export function removeTutorialVisualsInPage(arg: RemoveVisualsArg): boolean {
  const doc = globalThis.document as unknown as { getElementById(id: string): HTMLElementLike | null };
  const root = doc?.getElementById(arg.rootId);
  if (!root) {
    return false;
  }
  root.remove();
  return true;
}

/** Minimal structural DOM element shape the injected scripts rely on. */
type HTMLElementLike = {
  id: string;
  style: { setProperty(name: string, value: string): void };
  setAttribute(name: string, value: string): void;
  appendChild(node: HTMLElementLike): void;
  remove(): void;
  textContent?: string;
};

// ---------------------------------------------------------------------------
// Host-side helpers
// ---------------------------------------------------------------------------

export async function installTutorialCursor(page: PlaywrightLikeTutorialPage): Promise<boolean> {
  return page.evaluate(installCursorInPage, {
    rootId: TUTORIAL_VISUAL_ROOT_ID,
    cursorId: TUTORIAL_CURSOR_ID,
    moveDurationMs: CURSOR_MOVE_DURATION_MS,
    sizePx: CURSOR_SIZE_PX
  });
}

export async function moveTutorialCursor(
  page: PlaywrightLikeTutorialPage,
  point: TutorialPoint
): Promise<boolean> {
  return page.evaluate(moveCursorInPage, { cursorId: TUTORIAL_CURSOR_ID, x: point.x, y: point.y });
}

export async function showTutorialClickFeedback(
  page: PlaywrightLikeTutorialPage,
  point: TutorialPoint
): Promise<boolean> {
  return page.evaluate(showClickFeedbackInPage, {
    rootId: TUTORIAL_VISUAL_ROOT_ID,
    feedbackId: TUTORIAL_CLICK_FEEDBACK_ID,
    x: point.x,
    y: point.y,
    durationMs: CLICK_FEEDBACK_DURATION_MS,
    sizePx: CLICK_FEEDBACK_SIZE_PX
  });
}

export async function removeTutorialVisuals(page: PlaywrightLikeTutorialPage): Promise<boolean> {
  return page.evaluate(removeTutorialVisualsInPage, { rootId: TUTORIAL_VISUAL_ROOT_ID });
}
