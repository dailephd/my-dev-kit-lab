import { describe, expect, it } from "vitest";
import {
  CLICK_FEEDBACK_DURATION_MS,
  CURSOR_MOVE_DURATION_MS,
  TUTORIAL_CLICK_FEEDBACK_ID,
  TUTORIAL_CURSOR_ID,
  TUTORIAL_VISUAL_ROOT_ID,
  centerOfBox,
  installCursorInPage,
  installTutorialCursor,
  moveCursorInPage,
  moveTutorialCursor,
  removeTutorialVisualsInPage,
  showClickFeedbackInPage
} from "../../src/tutorial/tutorialCursor.js";
import { executeTutorialSteps } from "../../src/tutorial/tutorialSession.js";
import { createFakePage, createStubDocument, minimalScenario, withStubDocument } from "./tutorialTestHelpers.js";

const INSTALL_ARG = {
  rootId: TUTORIAL_VISUAL_ROOT_ID,
  cursorId: TUTORIAL_CURSOR_ID,
  moveDurationMs: CURSOR_MOVE_DURATION_MS,
  sizePx: 24
};

describe("centerOfBox", () => {
  it("returns the deterministic center of a bounding box", () => {
    expect(centerOfBox({ x: 10, y: 20, width: 100, height: 40 })).toEqual({ x: 60, y: 40 });
    expect(centerOfBox({ x: 0, y: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("cursor installation in the page", () => {
  it("installs one cursor inside a tutorial-owned root", () => {
    const document = createStubDocument();
    const installed = withStubDocument(document, () => installCursorInPage(INSTALL_ARG));

    expect(installed).toBe(true);
    const root = document.getElementById(TUTORIAL_VISUAL_ROOT_ID);
    const cursor = document.getElementById(TUTORIAL_CURSOR_ID);
    expect(root).not.toBeNull();
    expect(cursor).not.toBeNull();
    expect(cursor?.parent).toBe(root);
  });

  it("is idempotent: a second install does not create a second cursor", () => {
    const document = createStubDocument();
    withStubDocument(document, () => installCursorInPage(INSTALL_ARG));
    const second = withStubDocument(document, () => installCursorInPage(INSTALL_ARG));

    expect(second).toBe(false);
    expect(document.all().filter((node) => node.id === TUTORIAL_CURSOR_ID)).toHaveLength(1);
    expect(document.all().filter((node) => node.id === TUTORIAL_VISUAL_ROOT_ID)).toHaveLength(1);
  });

  it("uses pointer-events: none on the root and the cursor", () => {
    const document = createStubDocument();
    withStubDocument(document, () => installCursorInPage(INSTALL_ARG));

    expect(document.getElementById(TUTORIAL_VISUAL_ROOT_ID)?.styles["pointer-events"]).toBe("none");
    expect(document.getElementById(TUTORIAL_CURSOR_ID)?.styles["pointer-events"]).toBe("none");
  });

  it("uses a deterministic, bounded transition rather than physics or easing", () => {
    const document = createStubDocument();
    withStubDocument(document, () => installCursorInPage(INSTALL_ARG));
    const transition = document.getElementById(TUTORIAL_CURSOR_ID)?.styles.transition ?? "";

    expect(CURSOR_MOVE_DURATION_MS).toBe(250);
    expect(transition).toContain(`transform ${CURSOR_MOVE_DURATION_MS}ms linear`);
    expect(transition).not.toContain("cubic-bezier");
    expect(transition).not.toContain("ease");
  });

  it("uses stable collision-resistant identities", () => {
    expect(TUTORIAL_VISUAL_ROOT_ID).toBe("__my_dev_kit_lab_tutorial_visuals__");
    expect(TUTORIAL_CURSOR_ID).toBe("__my_dev_kit_lab_tutorial_cursor__");
    expect(TUTORIAL_CLICK_FEEDBACK_ID).toBe("__my_dev_kit_lab_tutorial_click_feedback__");
  });
});

describe("cursor movement in the page", () => {
  it("translates the cursor to the requested point and makes it visible", () => {
    const document = createStubDocument();
    withStubDocument(document, () => installCursorInPage(INSTALL_ARG));
    const moved = withStubDocument(document, () =>
      moveCursorInPage({ cursorId: TUTORIAL_CURSOR_ID, x: 60, y: 40 })
    );

    expect(moved).toBe(true);
    const cursor = document.getElementById(TUTORIAL_CURSOR_ID);
    expect(cursor?.styles.transform).toBe("translate(60px, 40px)");
    expect(cursor?.styles.opacity).toBe("1");
  });

  it("reports false rather than throwing when the cursor is absent", () => {
    const document = createStubDocument();
    const moved = withStubDocument(document, () =>
      moveCursorInPage({ cursorId: TUTORIAL_CURSOR_ID, x: 1, y: 2 })
    );
    expect(moved).toBe(false);
  });
});

describe("click feedback in the page", () => {
  it("creates a presentation-only ripple centered on the click point", () => {
    const document = createStubDocument();
    withStubDocument(document, () => installCursorInPage(INSTALL_ARG));
    const shown = withStubDocument(document, () =>
      showClickFeedbackInPage({
        rootId: TUTORIAL_VISUAL_ROOT_ID,
        feedbackId: TUTORIAL_CLICK_FEEDBACK_ID,
        x: 100,
        y: 200,
        durationMs: CLICK_FEEDBACK_DURATION_MS,
        sizePx: 44
      })
    );

    expect(shown).toBe(true);
    const ripple = document.getElementById(TUTORIAL_CLICK_FEEDBACK_ID);
    expect(ripple?.styles["pointer-events"]).toBe("none");
    expect(ripple?.styles.position).toBe("fixed");
    expect(ripple?.styles.left).toBe("78px");
    expect(ripple?.styles.top).toBe("178px");
    expect(ripple?.parent?.id).toBe(TUTORIAL_VISUAL_ROOT_ID);
  });

  it("replaces a stale ripple instead of accumulating them", () => {
    const document = createStubDocument();
    withStubDocument(document, () => installCursorInPage(INSTALL_ARG));
    const arg = {
      rootId: TUTORIAL_VISUAL_ROOT_ID,
      feedbackId: TUTORIAL_CLICK_FEEDBACK_ID,
      x: 10,
      y: 10,
      durationMs: CLICK_FEEDBACK_DURATION_MS,
      sizePx: 44
    };
    withStubDocument(document, () => showClickFeedbackInPage(arg));
    withStubDocument(document, () => showClickFeedbackInPage({ ...arg, x: 50 }));

    expect(document.all().filter((node) => node.id === TUTORIAL_CLICK_FEEDBACK_ID)).toHaveLength(1);
  });

  it("uses the planner-owned deterministic lifetime", () => {
    expect(CLICK_FEEDBACK_DURATION_MS).toBe(300);
  });
});

describe("visual cleanup in the page", () => {
  it("removes the whole tutorial-owned root, taking the cursor with it", () => {
    const document = createStubDocument();
    withStubDocument(document, () => installCursorInPage(INSTALL_ARG));
    const removed = withStubDocument(document, () =>
      removeTutorialVisualsInPage({ rootId: TUTORIAL_VISUAL_ROOT_ID })
    );

    expect(removed).toBe(true);
    expect(document.getElementById(TUTORIAL_VISUAL_ROOT_ID)).toBeNull();
    expect(document.getElementById(TUTORIAL_CURSOR_ID)).toBeNull();
    expect(document.all()).toEqual([]);
  });
});

describe("host-side cursor helpers", () => {
  it("forward the canonical identities and sizes to the page", async () => {
    const page = createFakePage();
    await installTutorialCursor(page);
    await moveTutorialCursor(page, { x: 5, y: 6 });

    expect(page.evaluateCalls[0]).toMatchObject({
      fnName: "installCursorInPage",
      arg: { rootId: TUTORIAL_VISUAL_ROOT_ID, cursorId: TUTORIAL_CURSOR_ID, moveDurationMs: 250 }
    });
    expect(page.evaluateCalls[1]).toMatchObject({
      fnName: "moveCursorInPage",
      arg: { cursorId: TUTORIAL_CURSOR_ID, x: 5, y: 6 }
    });
  });
});

describe("cursor behavior during step execution", () => {
  const baseOptions = (scenario: ReturnType<typeof minimalScenario>, page = createFakePage()) => ({
    page,
    scenario,
    applicationUrl: "http://127.0.0.1:3000/",
    targetRoot: "/unused",
    visuals: true,
    sleep: async () => {}
  });

  it("moves the cursor to the locator center before a click", async () => {
    const page = createFakePage({
      locators: { "test-id:save": { boundingBox: { x: 100, y: 100, width: 40, height: 20 } } }
    });
    const scenario = minimalScenario({
      steps: [{ id: "click-step", narration: "n", action: { type: "click", locator: { kind: "test-id", testId: "save" } } }]
    });

    await executeTutorialSteps(baseOptions(scenario, page));

    const move = page.evaluateCalls.find((call) => call.fnName === "moveCursorInPage");
    expect(move?.arg).toMatchObject({ x: 120, y: 110 });
  });

  it("shows click feedback for a click action", async () => {
    const page = createFakePage();
    const scenario = minimalScenario({
      steps: [{ id: "click-step", narration: "n", action: { type: "click", locator: { kind: "css", selector: ".a" } } }]
    });

    await executeTutorialSteps(baseOptions(scenario, page));

    expect(page.evaluateCalls.some((call) => call.fnName === "showClickFeedbackInPage")).toBe(true);
    // The real click still went through the canonical locator.
    expect(page.locators.get("css:.a")?.calls.some((call) => call.method === "click")).toBe(true);
  });

  it("uses the declared fraction for pointer-click and shows feedback after real mouse input", async () => {
    const page = createFakePage({
      locators: { "css:#surface": { boundingBox: { x: 100, y: 50, width: 400, height: 200 } } }
    });
    const scenario = minimalScenario({
      steps: [{
        id: "pointer-click-step",
        narration: "n",
        action: {
          type: "pointer-click",
          locator: { kind: "css", selector: "#surface" },
          position: { x: 0.25, y: 0.5 },
          coordinateSpace: "fraction"
        }
      }]
    });

    const result = await executeTutorialSteps(baseOptions(scenario, page));

    expect(result.steps[0].action?.status).toBe("passed");
    const moves = page.evaluateCalls.filter((call) => call.fnName === "moveCursorInPage");
    expect(moves[0]?.arg).toMatchObject({ x: 200, y: 150 });
    const feedback = page.evaluateCalls.find((call) => call.fnName === "showClickFeedbackInPage");
    expect(feedback?.arg).toMatchObject({ x: 200, y: 150 });
    expect(page.mouse.calls).toEqual([
      { method: "mouse.move", args: [200, 150] },
      { method: "mouse.down", args: [] },
      { method: "mouse.up", args: [] }
    ]);
    const upIndex = page.interactionCalls.findIndex((call) => call.method === "mouse.up");
    const feedbackIndex = page.interactionCalls.findIndex((call) => call.method === "evaluate.showClickFeedbackInPage");
    expect(feedbackIndex).toBeGreaterThan(upIndex);
  });

  it("moves the pointer-drag cursor from the declared start to end around the real action", async () => {
    const page = createFakePage({
      locators: { "test-id:surface": { boundingBox: { x: 100, y: 50, width: 400, height: 200 } } }
    });
    const scenario = minimalScenario({
      steps: [{
        id: "pointer-drag-step",
        narration: "n",
        action: {
          type: "pointer-drag",
          locator: { kind: "test-id", testId: "surface" },
          from: { x: 0.25, y: 0.25 },
          to: { x: 0.75, y: 0.75 },
          coordinateSpace: "fraction"
        }
      }]
    });

    const result = await executeTutorialSteps(baseOptions(scenario, page));

    expect(result.steps[0].action?.status).toBe("passed");
    const moves = page.evaluateCalls.filter((call) => call.fnName === "moveCursorInPage");
    expect(moves.map((call) => call.arg)).toEqual([
      { cursorId: TUTORIAL_CURSOR_ID, x: 200, y: 100 },
      { cursorId: TUTORIAL_CURSOR_ID, x: 400, y: 200 }
    ]);
    const realUpIndex = page.interactionCalls.findIndex((call) => call.method === "mouse.up");
    const cursorMoveIndexes = page.interactionCalls
      .map((call, index) => call.method === "evaluate.moveCursorInPage" ? index : -1)
      .filter((index) => index >= 0);
    expect(cursorMoveIndexes[0]).toBeLessThan(realUpIndex);
    expect(cursorMoveIndexes[1]).toBeGreaterThan(realUpIndex);
  });

  it("keeps existing drag cursor behavior source-centered then target-centered", async () => {
    const page = createFakePage({
      locators: {
        "css:#source": { boundingBox: { x: 10, y: 20, width: 40, height: 20 } },
        "css:#target": { boundingBox: { x: 100, y: 200, width: 60, height: 40 } }
      }
    });
    const scenario = minimalScenario({
      steps: [{
        id: "drag-step",
        narration: "n",
        action: {
          type: "drag",
          source: { kind: "css", selector: "#source" },
          target: { kind: "css", selector: "#target" }
        }
      }]
    });

    await executeTutorialSteps(baseOptions(scenario, page));
    const moves = page.evaluateCalls.filter((call) => call.fnName === "moveCursorInPage");
    expect(moves.map((call) => call.arg)).toEqual([
      { cursorId: TUTORIAL_CURSOR_ID, x: 30, y: 30 },
      { cursorId: TUTORIAL_CURSOR_ID, x: 130, y: 220 }
    ]);
    expect(page.locators.get("css:#source")?.calls.some((call) => call.method === "dragTo")).toBe(true);
  });

  it("keeps a successful pointer action passed when synthetic visuals fail", async () => {
    const page = createFakePage({ evaluateError: new Error("visual renderer unavailable") });
    const scenario = minimalScenario({
      steps: [{
        id: "pointer-click-step",
        narration: "n",
        action: {
          type: "pointer-click",
          locator: { kind: "css", selector: "#surface" },
          position: { x: 0.5, y: 0.5 },
          coordinateSpace: "fraction"
        }
      }]
    });

    const result = await executeTutorialSteps(baseOptions(scenario, page));
    expect(result.steps[0].status).toBe("passed");
    expect(result.steps[0].action?.status).toBe("passed");
    expect(result.visualWarnings.join("\n")).toContain("visual renderer unavailable");
    expect(page.mouse.calls.map((call) => call.method)).toEqual(["mouse.move", "mouse.down", "mouse.up"]);
  });

  it("does not move the cursor for goto or wait-for", async () => {
    const page = createFakePage();
    const scenario = minimalScenario({
      steps: [
        { id: "goto-step", narration: "n", action: { type: "goto", path: "/a" } },
        { id: "wait-step", narration: "n", action: { type: "wait-for", locator: { kind: "css", selector: ".a" } } }
      ]
    });

    await executeTutorialSteps(baseOptions(scenario, page));

    expect(page.evaluateCalls.filter((call) => call.fnName === "moveCursorInPage")).toHaveLength(0);
  });

  it("records a warning and still runs the real action when the bounding box is null", async () => {
    const page = createFakePage({ locators: { "css:.a": { boundingBox: null } } });
    const scenario = minimalScenario({
      steps: [{ id: "click-step", narration: "n", action: { type: "click", locator: { kind: "css", selector: ".a" } } }]
    });

    const result = await executeTutorialSteps(baseOptions(scenario, page));

    expect(result.steps[0].status).toBe("passed");
    expect(result.steps[0].action?.status).toBe("passed");
    expect(result.visualWarnings.join("\n")).toContain("has no bounding box");
    expect(page.evaluateCalls.filter((call) => call.fnName === "moveCursorInPage")).toHaveLength(0);
    expect(page.locators.get("css:.a")?.calls.some((call) => call.method === "click")).toBe(true);
  });

  it("removes tutorial visuals when the run finishes", async () => {
    const page = createFakePage();
    const scenario = minimalScenario({ steps: [{ id: "one", narration: "n" }] });

    await executeTutorialSteps(baseOptions(scenario, page));

    expect(page.evaluateCalls.at(-1)?.fnName).toBe("removeTutorialVisualsInPage");
  });

  it("re-installs the cursor after a navigation destroys the document", async () => {
    const page = createFakePage();
    const scenario = minimalScenario({
      steps: [{ id: "goto-step", narration: "n", action: { type: "goto", path: "/a" } }]
    });

    await executeTutorialSteps(baseOptions(scenario, page));

    const installCalls = page.evaluateCalls.filter((call) => call.fnName === "installCursorInPage");
    // Once at session start, once at step start, once after the navigation.
    expect(installCalls.length).toBeGreaterThanOrEqual(3);
  });
});
