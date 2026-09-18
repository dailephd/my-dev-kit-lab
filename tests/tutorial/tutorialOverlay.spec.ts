import { describe, expect, it } from "vitest";
import {
  TUTORIAL_CALLOUT_ID,
  TUTORIAL_HIGHLIGHT_ID,
  applyCalloutInPage,
  applyHighlightInPage,
  clearStepOverlaysInPage,
  resolveCalloutPlacement
} from "../../src/tutorial/tutorialOverlay.js";
import {
  TUTORIAL_CURSOR_ID,
  TUTORIAL_VISUAL_ROOT_ID,
  CURSOR_MOVE_DURATION_MS,
  installCursorInPage
} from "../../src/tutorial/tutorialCursor.js";
import { executeTutorialSteps } from "../../src/tutorial/tutorialSession.js";
import { createFakePage, createStubDocument, minimalScenario, withStubDocument } from "./tutorialTestHelpers.js";

const VIEWPORT = { width: 1000, height: 800 };
const BOX = { x: 100, y: 200, width: 60, height: 40 };

function installedDocument() {
  const document = createStubDocument();
  withStubDocument(document, () =>
    installCursorInPage({
      rootId: TUTORIAL_VISUAL_ROOT_ID,
      cursorId: TUTORIAL_CURSOR_ID,
      moveDurationMs: CURSOR_MOVE_DURATION_MS,
      sizePx: 24
    })
  );
  return document;
}

describe("resolveCalloutPlacement", () => {
  it("returns an explicit placement unchanged", () => {
    for (const placement of ["top", "right", "bottom", "left"] as const) {
      expect(resolveCalloutPlacement(placement, BOX, VIEWPORT)).toBe(placement);
    }
  });

  // Documented deterministic branch order: left-of-center -> right,
  // right-of-center -> left, centered upper half -> bottom, otherwise -> top.
  it("prefers right when the target sits in the left third", () => {
    expect(resolveCalloutPlacement("auto", { x: 10, y: 400, width: 50, height: 20 }, VIEWPORT)).toBe("right");
  });

  it("prefers left when the target sits in the right third", () => {
    expect(resolveCalloutPlacement("auto", { x: 900, y: 400, width: 50, height: 20 }, VIEWPORT)).toBe("left");
  });

  it("prefers bottom for a horizontally centered target in the upper half", () => {
    expect(resolveCalloutPlacement("auto", { x: 480, y: 100, width: 40, height: 20 }, VIEWPORT)).toBe("bottom");
  });

  it("prefers top for a horizontally centered target in the lower half", () => {
    expect(resolveCalloutPlacement("auto", { x: 480, y: 600, width: 40, height: 20 }, VIEWPORT)).toBe("top");
  });

  it("falls back to bottom when there is no target box", () => {
    expect(resolveCalloutPlacement("auto", undefined, VIEWPORT)).toBe("bottom");
    expect(resolveCalloutPlacement(undefined, undefined, VIEWPORT)).toBe("bottom");
  });

  it("is deterministic across repeated calls", () => {
    const results = new Set(
      Array.from({ length: 20 }, () => resolveCalloutPlacement("auto", BOX, VIEWPORT))
    );
    expect(results.size).toBe(1);
  });
});

describe("highlight overlay in the page", () => {
  it("draws a pointer-events-none overlay derived from the target box", () => {
    const document = installedDocument();
    const applied = withStubDocument(document, () =>
      applyHighlightInPage({
        rootId: TUTORIAL_VISUAL_ROOT_ID,
        highlightId: TUTORIAL_HIGHLIGHT_ID,
        box: BOX,
        paddingPx: 4
      })
    );

    expect(applied).toBe(true);
    const highlight = document.getElementById(TUTORIAL_HIGHLIGHT_ID);
    expect(highlight?.styles["pointer-events"]).toBe("none");
    expect(highlight?.styles.position).toBe("fixed");
    expect(highlight?.styles.left).toBe("96px");
    expect(highlight?.styles.top).toBe("196px");
    expect(highlight?.styles.width).toBe("68px");
    expect(highlight?.styles.height).toBe("48px");
    expect(highlight?.parent?.id).toBe(TUTORIAL_VISUAL_ROOT_ID);
  });

  it("does not touch the target element's own DOM or classes", () => {
    const document = installedDocument();
    const target = document.createElement("div");
    target.id = "app-target";
    target.setAttribute("class", "card active");
    document.body.appendChild(target);

    withStubDocument(document, () =>
      applyHighlightInPage({
        rootId: TUTORIAL_VISUAL_ROOT_ID,
        highlightId: TUTORIAL_HIGHLIGHT_ID,
        box: BOX,
        paddingPx: 4
      })
    );

    expect(target.attributes.class).toBe("card active");
    expect(target.children).toEqual([]);
    expect(Object.keys(target.styles)).toEqual([]);
  });

  it("replaces a previous highlight rather than stacking them", () => {
    const document = installedDocument();
    const arg = {
      rootId: TUTORIAL_VISUAL_ROOT_ID,
      highlightId: TUTORIAL_HIGHLIGHT_ID,
      box: BOX,
      paddingPx: 4
    };
    withStubDocument(document, () => applyHighlightInPage(arg));
    withStubDocument(document, () => applyHighlightInPage({ ...arg, box: { ...BOX, x: 500 } }));

    expect(document.all().filter((node) => node.id === TUTORIAL_HIGHLIGHT_ID)).toHaveLength(1);
    expect(document.getElementById(TUTORIAL_HIGHLIGHT_ID)?.styles.left).toBe("496px");
  });
});

describe("callout overlay in the page", () => {
  const baseArg = {
    rootId: TUTORIAL_VISUAL_ROOT_ID,
    calloutId: TUTORIAL_CALLOUT_ID,
    text: "Look here.",
    box: BOX,
    viewport: VIEWPORT,
    gapPx: 12,
    maxWidthPx: 320
  };

  it("uses the scenario callout text verbatim and pointer-events none", () => {
    const document = installedDocument();
    withStubDocument(document, () => applyCalloutInPage({ ...baseArg, placement: "top" }));

    const callout = document.getElementById(TUTORIAL_CALLOUT_ID);
    expect(callout?.textContent).toBe("Look here.");
    expect(callout?.styles["pointer-events"]).toBe("none");
  });

  it("positions an explicit top placement above the target", () => {
    const document = installedDocument();
    withStubDocument(document, () => applyCalloutInPage({ ...baseArg, placement: "top" }));
    const callout = document.getElementById(TUTORIAL_CALLOUT_ID);

    expect(callout?.styles.left).toBe("130px");
    expect(callout?.styles.top).toBe("188px");
    expect(callout?.styles.transform).toBe("translate(-50%, -100%)");
  });

  it("positions an explicit bottom placement below the target", () => {
    const document = installedDocument();
    withStubDocument(document, () => applyCalloutInPage({ ...baseArg, placement: "bottom" }));
    const callout = document.getElementById(TUTORIAL_CALLOUT_ID);

    expect(callout?.styles.top).toBe("252px");
    expect(callout?.styles.transform).toBe("translateX(-50%)");
  });

  it("positions an explicit left placement beside the target", () => {
    const document = installedDocument();
    withStubDocument(document, () => applyCalloutInPage({ ...baseArg, placement: "left" }));
    const callout = document.getElementById(TUTORIAL_CALLOUT_ID);

    expect(callout?.styles.left).toBe("88px");
    expect(callout?.styles.transform).toBe("translate(-100%, -50%)");
  });

  it("positions an explicit right placement beside the target", () => {
    const document = installedDocument();
    withStubDocument(document, () => applyCalloutInPage({ ...baseArg, placement: "right" }));
    const callout = document.getElementById(TUTORIAL_CALLOUT_ID);

    expect(callout?.styles.left).toBe("172px");
    expect(callout?.styles.transform).toBe("translateY(-50%)");
  });

  it("uses a deterministic viewport position when no locator box exists", () => {
    const document = installedDocument();
    withStubDocument(document, () => applyCalloutInPage({ ...baseArg, box: null, placement: "bottom" }));
    const callout = document.getElementById(TUTORIAL_CALLOUT_ID);

    expect(callout?.styles.left).toBe("50%");
    expect(callout?.styles.bottom).toBe("24px");
    expect(callout?.styles.transform).toBe("translateX(-50%)");
  });
});

describe("clearing step overlays in the page", () => {
  it("removes the highlight and callout but leaves the cursor installed", () => {
    const document = installedDocument();
    withStubDocument(document, () =>
      applyHighlightInPage({ rootId: TUTORIAL_VISUAL_ROOT_ID, highlightId: TUTORIAL_HIGHLIGHT_ID, box: BOX, paddingPx: 4 })
    );
    withStubDocument(document, () =>
      applyCalloutInPage({
        rootId: TUTORIAL_VISUAL_ROOT_ID,
        calloutId: TUTORIAL_CALLOUT_ID,
        text: "x",
        placement: "top",
        box: BOX,
        viewport: VIEWPORT,
        gapPx: 12,
        maxWidthPx: 320
      })
    );

    const removed = withStubDocument(document, () =>
      clearStepOverlaysInPage({ highlightId: TUTORIAL_HIGHLIGHT_ID, calloutId: TUTORIAL_CALLOUT_ID })
    );

    expect(removed).toBe(2);
    expect(document.getElementById(TUTORIAL_HIGHLIGHT_ID)).toBeNull();
    expect(document.getElementById(TUTORIAL_CALLOUT_ID)).toBeNull();
    expect(document.getElementById(TUTORIAL_CURSOR_ID)).not.toBeNull();
  });
});

describe("overlay lifecycle during step execution", () => {
  const baseOptions = (scenario: ReturnType<typeof minimalScenario>, page = createFakePage()) => ({
    page,
    scenario,
    applicationUrl: "http://127.0.0.1:3000/",
    targetRoot: "/unused",
    visuals: true,
    sleep: async () => {}
  });

  it("resolves the highlight locator through the canonical resolver", async () => {
    const page = createFakePage();
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "n", highlight: { kind: "role", role: "button", name: "Save" } }]
    });

    await executeTutorialSteps(baseOptions(scenario, page));

    expect(page.calls).toContainEqual({ method: "getByRole", args: ["button", { name: "Save" }] });
    expect(page.evaluateCalls.some((call) => call.fnName === "applyHighlightInPage")).toBe(true);
  });

  it("clears the previous step's overlays before applying the next step's", async () => {
    const page = createFakePage();
    const scenario = minimalScenario({
      steps: [
        { id: "one", narration: "n", highlight: { kind: "css", selector: ".a" } },
        { id: "two", narration: "n", callout: { text: "second" } }
      ]
    });

    await executeTutorialSteps(baseOptions(scenario, page));

    const order = page.evaluateCalls.map((call) => call.fnName);
    const firstHighlight = order.indexOf("applyHighlightInPage");
    const clearAfterFirst = order.indexOf("clearStepOverlaysInPage", firstHighlight);
    const secondCallout = order.indexOf("applyCalloutInPage");
    expect(firstHighlight).toBeGreaterThanOrEqual(0);
    expect(clearAfterFirst).toBeGreaterThan(firstHighlight);
    expect(secondCallout).toBeGreaterThan(clearAfterFirst);
  });

  it("keeps the requested highlight in place through pauseAfterMs and the screenshot", async () => {
    const page = createFakePage();
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "n", pauseAfterMs: 50, highlight: { kind: "css", selector: ".a" } }]
    });
    const sleepOrder: string[] = [];

    await executeTutorialSteps({
      ...baseOptions(scenario, page),
      sleep: async () => {
        sleepOrder.push(page.evaluateCalls.map((call) => call.fnName).join(","));
      }
    });

    // The highlight was already applied when pauseAfterMs began.
    expect(sleepOrder.at(-1)).toContain("applyHighlightInPage");
    // No clear happened between applying the highlight and the end of the step.
    const order = page.evaluateCalls.map((call) => call.fnName);
    expect(order.lastIndexOf("applyHighlightInPage")).toBeGreaterThan(
      order.lastIndexOf("clearStepOverlaysInPage")
    );
  });

  it("records a warning and skips the visual when a highlight target has no box", async () => {
    const page = createFakePage({ locators: { "css:.gone": { boundingBox: null } } });
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "n", highlight: { kind: "css", selector: ".gone" } }]
    });

    const result = await executeTutorialSteps(baseOptions(scenario, page));

    expect(result.steps[0].status).toBe("passed");
    expect(result.visualWarnings.join("\n")).toContain("has no bounding box");
    expect(page.evaluateCalls.some((call) => call.fnName === "applyHighlightInPage")).toBe(false);
  });

  it("uses a viewport callout when the scenario declares no locator", async () => {
    const page = createFakePage();
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "n", callout: { text: "no target" } }]
    });

    await executeTutorialSteps(baseOptions(scenario, page));

    const callout = page.evaluateCalls.find((call) => call.fnName === "applyCalloutInPage");
    expect(callout?.arg).toMatchObject({ text: "no target", box: null, placement: "bottom" });
  });

  it("does not let an overlay failure fail the step", async () => {
    const page = createFakePage({ evaluateError: new Error("injection blocked") });
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "n", highlight: { kind: "css", selector: ".a" }, callout: { text: "x" } }]
    });

    const result = await executeTutorialSteps(baseOptions(scenario, page));

    expect(result.steps[0].status).toBe("passed");
    // Recorded, never swallowed.
    expect(result.visualWarnings.join("\n")).toContain("injection blocked");
  });
});
