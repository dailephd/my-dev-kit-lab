import { describe, expect, it } from "vitest";
import {
  executeTutorialAction,
  POINTER_DRAG_MOVE_STEPS,
  resolveTutorialNavigationUrl
} from "../../src/tutorial/tutorialActions.js";
import { DEFAULT_TUTORIAL_ACTION_TIMEOUT_MS } from "../../src/tutorial/types.js";
import { createFakePage } from "./tutorialTestHelpers.js";

const APP_URL = "http://127.0.0.1:3000/";
const CONTEXT = { applicationUrl: APP_URL };

describe("resolveTutorialNavigationUrl", () => {
  it("resolves a root-relative path against the application URL", () => {
    expect(resolveTutorialNavigationUrl(APP_URL, "/dashboard")).toBe("http://127.0.0.1:3000/dashboard");
    expect(resolveTutorialNavigationUrl(APP_URL, "/a/b?q=1#top")).toBe("http://127.0.0.1:3000/a/b?q=1#top");
  });

  it("preserves a non-root application base path segment policy by staying same-origin", () => {
    expect(resolveTutorialNavigationUrl("http://localhost:8080/app/", "/other")).toBe(
      "http://localhost:8080/other"
    );
  });

  it("rejects absolute URLs", () => {
    expect(() => resolveTutorialNavigationUrl(APP_URL, "http://evil.example.com/")).toThrow(
      /root-relative path/
    );
    expect(() => resolveTutorialNavigationUrl(APP_URL, "file:///etc/hosts")).toThrow(/root-relative path/);
  });

  it("rejects a protocol-relative path that would change origin", () => {
    expect(() => resolveTutorialNavigationUrl(APP_URL, "//evil.example.com/x")).toThrow(
      /must not be protocol-relative/
    );
  });

  it("rejects a resolved URL on a different port or host", () => {
    // Same hostname, different port is still a different origin.
    expect(() => resolveTutorialNavigationUrl("http://127.0.0.1:3000/", "//127.0.0.1:4000/x")).toThrow(
      /protocol-relative/
    );
  });
});

describe("executeTutorialAction", () => {
  it("performs goto and records a passed result", async () => {
    const page = createFakePage();
    const result = await executeTutorialAction(
      page,
      { type: "goto", path: "/dashboard", waitUntil: "networkidle" },
      CONTEXT
    );

    expect(result.status).toBe("passed");
    expect(result.type).toBe("goto");
    expect(page.calls).toEqual([
      { method: "goto", args: ["http://127.0.0.1:3000/dashboard", { waitUntil: "networkidle" }] }
    ]);
    expect(page.url()).toBe("http://127.0.0.1:3000/dashboard");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("turns a cross-origin goto into a structured failed result rather than throwing", async () => {
    const page = createFakePage();
    const result = await executeTutorialAction(
      page,
      { type: "goto", path: "http://evil.example.com/" as string },
      CONTEXT
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("root-relative path");
    expect(page.calls).toHaveLength(0);
  });

  it("performs click with the default timeout when none is declared", async () => {
    const page = createFakePage();
    const result = await executeTutorialAction(
      page,
      { type: "click", locator: { kind: "test-id", testId: "save" } },
      CONTEXT
    );

    expect(result.status).toBe("passed");
    expect(page.locators.get("test-id:save")?.calls).toEqual([
      { method: "click", args: [{ timeout: DEFAULT_TUTORIAL_ACTION_TIMEOUT_MS }] }
    ]);
  });

  it("forwards an explicit timeout", async () => {
    const page = createFakePage();
    await executeTutorialAction(
      page,
      { type: "click", locator: { kind: "test-id", testId: "save" }, timeoutMs: 1234 },
      CONTEXT
    );

    expect(page.locators.get("test-id:save")?.calls).toEqual([
      { method: "click", args: [{ timeout: 1234 }] }
    ]);
  });

  it("performs fill with the declared value", async () => {
    const page = createFakePage();
    const result = await executeTutorialAction(
      page,
      { type: "fill", locator: { kind: "css", selector: "#name" }, value: "Ada Lovelace" },
      CONTEXT
    );

    expect(result.status).toBe("passed");
    expect(page.locators.get("css:#name")?.calls).toEqual([
      { method: "fill", args: ["Ada Lovelace", { timeout: DEFAULT_TUTORIAL_ACTION_TIMEOUT_MS }] }
    ]);
  });

  it("performs press with the declared key", async () => {
    const page = createFakePage();
    await executeTutorialAction(
      page,
      { type: "press", locator: { kind: "css", selector: "#name" }, key: "Enter" },
      CONTEXT
    );

    expect(page.locators.get("css:#name")?.calls).toEqual([
      { method: "press", args: ["Enter", { timeout: DEFAULT_TUTORIAL_ACTION_TIMEOUT_MS }] }
    ]);
  });

  it("performs hover", async () => {
    const page = createFakePage();
    await executeTutorialAction(page, { type: "hover", locator: { kind: "css", selector: ".card" } }, CONTEXT);

    expect(page.locators.get("css:.card")?.calls).toEqual([
      { method: "hover", args: [{ timeout: DEFAULT_TUTORIAL_ACTION_TIMEOUT_MS }] }
    ]);
  });

  it("performs drag through the canonical resolver for both source and target", async () => {
    const page = createFakePage();
    const result = await executeTutorialAction(
      page,
      {
        type: "drag",
        source: { kind: "test-id", testId: "card-1" },
        target: { kind: "role", role: "list", name: "Done" }
      },
      CONTEXT
    );

    expect(result.status).toBe("passed");
    expect(page.calls).toEqual([
      { method: "getByTestId", args: ["card-1"] },
      { method: "getByRole", args: ["list", { name: "Done" }] }
    ]);
    expect(page.locators.get("test-id:card-1")?.calls).toEqual([
      {
        method: "dragTo",
        args: ["role:list|name=Done|exact=undefined", { timeout: DEFAULT_TUTORIAL_ACTION_TIMEOUT_MS }]
      }
    ]);
  });

  it("performs pointer-click with visible readiness and real mouse input in order", async () => {
    const page = createFakePage({
      locators: { "css:#surface": { boundingBox: { x: 100, y: 50, width: 400, height: 200 } } }
    });
    const result = await executeTutorialAction(
      page,
      {
        type: "pointer-click",
        locator: { kind: "css", selector: "#surface" },
        position: { x: 0.25, y: 0.5 },
        coordinateSpace: "fraction"
      },
      CONTEXT
    );

    expect(result.status).toBe("passed");
    expect(page.interactionCalls).toEqual([
      { method: "locator.waitFor", args: [{ state: "visible", timeout: 5000 }] },
      { method: "locator.boundingBox", args: [] },
      { method: "mouse.move", args: [200, 150] },
      { method: "mouse.down", args: [] },
      { method: "mouse.up", args: [] }
    ]);
  });

  it("uses the declared pointer-click timeout only for locator readiness", async () => {
    const page = createFakePage();
    await executeTutorialAction(
      page,
      {
        type: "pointer-click",
        locator: { kind: "test-id", testId: "surface" },
        position: { x: 0.5, y: 0.5 },
        coordinateSpace: "fraction",
        timeoutMs: 1234
      },
      CONTEXT
    );

    expect(page.locators.get("test-id:surface")?.calls[0]).toEqual({
      method: "waitFor",
      args: [{ state: "visible", timeout: 1234 }]
    });
    expect(page.mouse.calls).toEqual([
      { method: "mouse.move", args: [60, 40] },
      { method: "mouse.down", args: [] },
      { method: "mouse.up", args: [] }
    ]);
  });

  it("performs pointer-drag with one box and the fixed eight-step real mouse sequence", async () => {
    const page = createFakePage({
      locators: { "css:#surface": { boundingBox: { x: 100, y: 50, width: 400, height: 200 } } }
    });
    const result = await executeTutorialAction(
      page,
      {
        type: "pointer-drag",
        locator: { kind: "css", selector: "#surface" },
        from: { x: 0.25, y: 0.25 },
        to: { x: 0.75, y: 0.75 },
        coordinateSpace: "fraction"
      },
      CONTEXT
    );

    expect(result.status).toBe("passed");
    expect(POINTER_DRAG_MOVE_STEPS).toBe(8);
    expect(page.interactionCalls).toEqual([
      { method: "locator.waitFor", args: [{ state: "visible", timeout: 5000 }] },
      { method: "locator.boundingBox", args: [] },
      { method: "mouse.move", args: [200, 100] },
      { method: "mouse.down", args: [] },
      { method: "mouse.move", args: [400, 200, { steps: 8 }] },
      { method: "mouse.up", args: [] }
    ]);
    expect(page.locators.get("css:#surface")?.calls.filter((call) => call.method === "boundingBox")).toHaveLength(1);
  });

  it.each([
    ["pointer-click", null],
    ["pointer-click", { x: 0, y: 0, width: 0, height: 20 }],
    ["pointer-drag", null],
    ["pointer-drag", { x: 0, y: 0, width: 20, height: 0 }]
  ] as const)("fails %s before mouse.down when the box is unavailable or non-positive", async (type, boundingBox) => {
    const page = createFakePage({ locators: { "css:#surface": { boundingBox } } });
    const action = type === "pointer-click"
      ? {
          type,
          locator: { kind: "css" as const, selector: "#surface" },
          position: { x: 0.5, y: 0.5 },
          coordinateSpace: "fraction" as const
        }
      : {
          type,
          locator: { kind: "css" as const, selector: "#surface" },
          from: { x: 0.25, y: 0.25 },
          to: { x: 0.75, y: 0.75 },
          coordinateSpace: "fraction" as const
        };

    const result = await executeTutorialAction(page, action, CONTEXT);
    expect(result.status).toBe("failed");
    expect(page.mouse.calls.some((call) => call.method === "mouse.down")).toBe(false);
  });

  it("attempts mouse.up exactly once and preserves an end-move failure", async () => {
    const page = createFakePage({ mouse: { moveErrors: [undefined, new Error("end move failed")] } });
    const result = await executeTutorialAction(
      page,
      {
        type: "pointer-drag",
        locator: { kind: "css", selector: "#surface" },
        from: { x: 0.25, y: 0.25 },
        to: { x: 0.75, y: 0.75 },
        coordinateSpace: "fraction"
      },
      CONTEXT
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("end move failed");
    expect(page.mouse.calls.filter((call) => call.method === "mouse.up")).toHaveLength(1);
    expect(page.mouse.calls.filter((call) => call.method === "mouse.move")).toHaveLength(2);
    expect(page.mouse.calls.filter((call) => call.method === "mouse.down")).toHaveLength(1);
  });

  it("reports mouse.up failure after a successful end move", async () => {
    const page = createFakePage({ mouse: { upError: new Error("mouse release failed") } });
    const result = await executeTutorialAction(
      page,
      {
        type: "pointer-drag",
        locator: { kind: "css", selector: "#surface" },
        from: { x: 0.25, y: 0.25 },
        to: { x: 0.75, y: 0.75 },
        coordinateSpace: "fraction"
      },
      CONTEXT
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("mouse release failed");
    expect(page.mouse.calls.filter((call) => call.method === "mouse.up")).toHaveLength(1);
  });

  it("preserves the primary failure and appends bounded cleanup context when both fail", async () => {
    const page = createFakePage({
      mouse: { moveErrors: [undefined, new Error("primary move failure")], upError: new Error("cleanup release failure") }
    });
    const result = await executeTutorialAction(
      page,
      {
        type: "pointer-drag",
        locator: { kind: "css", selector: "#surface" },
        from: { x: 0.25, y: 0.25 },
        to: { x: 0.75, y: 0.75 },
        coordinateSpace: "fraction"
      },
      CONTEXT
    );
    expect(result.error).toContain("primary move failure");
    expect(result.error).toContain("mouse.up cleanup also failed: cleanup release failure");
  });

  it("does not call mouse.up when mouse.down never succeeds", async () => {
    const page = createFakePage({ mouse: { downError: new Error("down failed") } });
    const result = await executeTutorialAction(
      page,
      {
        type: "pointer-click",
        locator: { kind: "css", selector: "#surface" },
        position: { x: 0.5, y: 0.5 },
        coordinateSpace: "fraction"
      },
      CONTEXT
    );
    expect(result.status).toBe("failed");
    expect(page.mouse.calls.filter((call) => call.method === "mouse.up")).toHaveLength(0);
  });

  it("performs wait-for with the declared state", async () => {
    const page = createFakePage();
    await executeTutorialAction(
      page,
      { type: "wait-for", locator: { kind: "css", selector: ".spinner" }, state: "hidden", timeoutMs: 900 },
      CONTEXT
    );

    expect(page.locators.get("css:.spinner")?.calls).toEqual([
      { method: "waitFor", args: [{ state: "hidden", timeout: 900 }] }
    ]);
  });

  it("omits state from waitFor when the scenario did not declare one", async () => {
    const page = createFakePage();
    await executeTutorialAction(page, { type: "wait-for", locator: { kind: "css", selector: ".x" } }, CONTEXT);

    expect(page.locators.get("css:.x")?.calls).toEqual([
      { method: "waitFor", args: [{ timeout: DEFAULT_TUTORIAL_ACTION_TIMEOUT_MS }] }
    ]);
  });

  it("converts an action exception into a structured failed result with the cause", async () => {
    const page = createFakePage({
      locators: { "css:.missing": { clickError: new Error("locator resolved to 0 elements") } }
    });
    const result = await executeTutorialAction(
      page,
      { type: "click", locator: { kind: "css", selector: ".missing" } },
      CONTEXT
    );

    expect(result.status).toBe("failed");
    expect(result.type).toBe("click");
    expect(result.error).toContain("click on css=.missing failed");
    expect(result.error).toContain("locator resolved to 0 elements");
    expect(result.startedAt).toBeTruthy();
    expect(result.endedAt).toBeTruthy();
  });

  it("does not retry a failing action", async () => {
    const page = createFakePage({
      locators: { "css:.flaky": { clickError: new Error("boom") } }
    });
    await executeTutorialAction(page, { type: "click", locator: { kind: "css", selector: ".flaky" } }, CONTEXT);

    // Exactly one attempt: no tutorial-level retry loop exists.
    expect(page.locators.get("css:.flaky")?.calls.filter((call) => call.method === "click")).toHaveLength(1);
    expect(page.calls.filter((call) => call.method === "locator")).toHaveLength(1);
  });
});
