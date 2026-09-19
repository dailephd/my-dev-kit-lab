import { describe, expect, it } from "vitest";
import {
  executeTutorialAction,
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
