import type { PlaywrightLikeTutorialPage } from "../browser/types.js";
import { TUTORIAL_VISUAL_ROOT_ID, type TutorialBox } from "./tutorialCursor.js";
import type { TutorialCalloutPlacement } from "./types.js";

/**
 * Deterministic highlight and callout overlays.
 *
 * Both are drawn as tutorial-owned fixed-position siblings derived from the
 * target's bounding box. Nothing is inserted into the target element and no
 * class list is touched, so the application's own DOM and state are unchanged
 * and an assertion can never accidentally observe an overlay as application
 * content. Both use `pointer-events: none`.
 */

export const TUTORIAL_HIGHLIGHT_ID = "__my_dev_kit_lab_tutorial_highlight__";
export const TUTORIAL_CALLOUT_ID = "__my_dev_kit_lab_tutorial_callout__";

/** Gap between the target box and the callout, and callout sizing bounds. */
const CALLOUT_GAP_PX = 12;
const CALLOUT_MAX_WIDTH_PX = 320;
const HIGHLIGHT_PADDING_PX = 4;

export type TutorialViewport = { width: number; height: number };

export type ResolvedCalloutPlacement = Exclude<TutorialCalloutPlacement, "auto">;

/**
 * Deterministic "auto" placement, in this exact branch order:
 *
 * 1. target mainly left of viewport center  -> "right"
 * 2. target mainly right of viewport center -> "left"
 * 3. target near horizontal center, in the upper half -> "bottom"
 * 4. otherwise -> "top"
 *
 * "Mainly left/right" means the target's own center sits outside the middle
 * third of the viewport. No search, no scoring, no randomness.
 */
export function resolveCalloutPlacement(
  placement: TutorialCalloutPlacement | undefined,
  box: TutorialBox | undefined,
  viewport: TutorialViewport
): ResolvedCalloutPlacement {
  if (placement !== undefined && placement !== "auto") {
    return placement;
  }
  if (!box) {
    // Nothing to be relative to; a viewport callout sits at the bottom.
    return "bottom";
  }

  const targetCenterX = box.x + box.width / 2;
  const targetCenterY = box.y + box.height / 2;
  const leftThird = viewport.width / 3;
  const rightThird = (viewport.width * 2) / 3;

  if (targetCenterX < leftThird) {
    return "right";
  }
  if (targetCenterX > rightThird) {
    return "left";
  }
  if (targetCenterY < viewport.height / 2) {
    return "bottom";
  }
  return "top";
}

// ---------------------------------------------------------------------------
// Browser-side scripts (page globals plus one serializable argument only)
// ---------------------------------------------------------------------------

type HTMLElementLike = {
  id: string;
  style: { setProperty(name: string, value: string): void };
  setAttribute(name: string, value: string): void;
  appendChild(node: HTMLElementLike): void;
  remove(): void;
  textContent: string;
};

type DocumentLike = {
  getElementById(id: string): HTMLElementLike | null;
  createElement(tag: string): HTMLElementLike;
};

export type ApplyHighlightArg = {
  rootId: string;
  highlightId: string;
  box: TutorialBox;
  paddingPx: number;
};

export function applyHighlightInPage(arg: ApplyHighlightArg): boolean {
  const doc = globalThis.document as unknown as DocumentLike | undefined;
  const root = doc?.getElementById(arg.rootId);
  if (!doc || !root) {
    return false;
  }
  const stale = doc.getElementById(arg.highlightId);
  if (stale) {
    stale.remove();
  }

  const highlight = doc.createElement("div");
  highlight.id = arg.highlightId;
  highlight.setAttribute("aria-hidden", "true");
  highlight.style.setProperty("position", "fixed");
  highlight.style.setProperty("left", `${arg.box.x - arg.paddingPx}px`);
  highlight.style.setProperty("top", `${arg.box.y - arg.paddingPx}px`);
  highlight.style.setProperty("width", `${arg.box.width + arg.paddingPx * 2}px`);
  highlight.style.setProperty("height", `${arg.box.height + arg.paddingPx * 2}px`);
  // An outline plus a translucent wash keeps the target's own content readable.
  highlight.style.setProperty("border", "3px solid rgba(255, 176, 0, 0.95)");
  highlight.style.setProperty("border-radius", "6px");
  highlight.style.setProperty("background", "rgba(255, 176, 0, 0.12)");
  highlight.style.setProperty("box-shadow", "0 0 0 9999px rgba(0, 0, 0, 0.08)");
  highlight.style.setProperty("pointer-events", "none");
  highlight.style.setProperty("z-index", "2147483645");
  root.appendChild(highlight);
  return true;
}

export type ApplyCalloutArg = {
  rootId: string;
  calloutId: string;
  text: string;
  placement: ResolvedCalloutPlacement;
  box: TutorialBox | null;
  viewport: TutorialViewport;
  gapPx: number;
  maxWidthPx: number;
};

export function applyCalloutInPage(arg: ApplyCalloutArg): boolean {
  const doc = globalThis.document as unknown as DocumentLike | undefined;
  const root = doc?.getElementById(arg.rootId);
  if (!doc || !root) {
    return false;
  }
  const stale = doc.getElementById(arg.calloutId);
  if (stale) {
    stale.remove();
  }

  const callout = doc.createElement("div");
  callout.id = arg.calloutId;
  callout.setAttribute("aria-hidden", "true");
  callout.textContent = arg.text;
  callout.style.setProperty("position", "fixed");
  callout.style.setProperty("max-width", `${arg.maxWidthPx}px`);
  callout.style.setProperty("padding", "10px 14px");
  callout.style.setProperty("border-radius", "8px");
  callout.style.setProperty("background", "rgba(17, 17, 17, 0.92)");
  callout.style.setProperty("color", "#ffffff");
  callout.style.setProperty("font", "16px/1.4 system-ui, sans-serif");
  callout.style.setProperty("box-shadow", "0 6px 20px rgba(0, 0, 0, 0.35)");
  callout.style.setProperty("pointer-events", "none");
  callout.style.setProperty("z-index", "2147483647");

  if (!arg.box) {
    // No locator: a deterministic viewport position, bottom-center.
    callout.style.setProperty("left", "50%");
    callout.style.setProperty("bottom", `${arg.gapPx * 2}px`);
    callout.style.setProperty("transform", "translateX(-50%)");
    root.appendChild(callout);
    return true;
  }

  const box = arg.box;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  if (arg.placement === "top") {
    callout.style.setProperty("left", `${centerX}px`);
    callout.style.setProperty("top", `${box.y - arg.gapPx}px`);
    callout.style.setProperty("transform", "translate(-50%, -100%)");
  } else if (arg.placement === "bottom") {
    callout.style.setProperty("left", `${centerX}px`);
    callout.style.setProperty("top", `${box.y + box.height + arg.gapPx}px`);
    callout.style.setProperty("transform", "translateX(-50%)");
  } else if (arg.placement === "left") {
    callout.style.setProperty("left", `${box.x - arg.gapPx}px`);
    callout.style.setProperty("top", `${centerY}px`);
    callout.style.setProperty("transform", "translate(-100%, -50%)");
  } else {
    callout.style.setProperty("left", `${box.x + box.width + arg.gapPx}px`);
    callout.style.setProperty("top", `${centerY}px`);
    callout.style.setProperty("transform", "translateY(-50%)");
  }

  root.appendChild(callout);
  return true;
}

export type ClearStepOverlaysArg = { highlightId: string; calloutId: string };

export function clearStepOverlaysInPage(arg: ClearStepOverlaysArg): number {
  const doc = globalThis.document as unknown as DocumentLike | undefined;
  if (!doc) {
    return 0;
  }
  let removed = 0;
  for (const id of [arg.highlightId, arg.calloutId]) {
    const node = doc.getElementById(id);
    if (node) {
      node.remove();
      removed += 1;
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Host-side helpers
// ---------------------------------------------------------------------------

export async function applyTutorialHighlight(
  page: PlaywrightLikeTutorialPage,
  box: TutorialBox
): Promise<boolean> {
  return page.evaluate(applyHighlightInPage, {
    rootId: TUTORIAL_VISUAL_ROOT_ID,
    highlightId: TUTORIAL_HIGHLIGHT_ID,
    box,
    paddingPx: HIGHLIGHT_PADDING_PX
  });
}

export async function applyTutorialCallout(
  page: PlaywrightLikeTutorialPage,
  options: {
    text: string;
    placement: ResolvedCalloutPlacement;
    box: TutorialBox | null;
    viewport: TutorialViewport;
  }
): Promise<boolean> {
  return page.evaluate(applyCalloutInPage, {
    rootId: TUTORIAL_VISUAL_ROOT_ID,
    calloutId: TUTORIAL_CALLOUT_ID,
    text: options.text,
    placement: options.placement,
    box: options.box,
    viewport: options.viewport,
    gapPx: CALLOUT_GAP_PX,
    maxWidthPx: CALLOUT_MAX_WIDTH_PX
  });
}

export async function clearTutorialStepOverlays(page: PlaywrightLikeTutorialPage): Promise<number> {
  return page.evaluate(clearStepOverlaysInPage, {
    highlightId: TUTORIAL_HIGHLIGHT_ID,
    calloutId: TUTORIAL_CALLOUT_ID
  });
}
