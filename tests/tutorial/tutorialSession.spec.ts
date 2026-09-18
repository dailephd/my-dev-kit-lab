import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  closeTutorialSession,
  executeTutorialSteps,
  openTutorialSession
} from "../../src/tutorial/tutorialSession.js";
import type { TutorialScenarioV1 } from "../../src/tutorial/types.js";
import { createFakeBrowser, createFakePage, minimalScenario } from "./tutorialTestHelpers.js";

const APP_URL = "http://127.0.0.1:3000/";
const TARGET_ROOT = path.join(os.tmpdir(), "tutorial-session-unused");

function scenarioWithSteps(steps: TutorialScenarioV1["steps"]): TutorialScenarioV1 {
  return minimalScenario({ steps });
}

describe("openTutorialSession", () => {
  it("creates exactly one context and one page and forwards the viewport", async () => {
    const browser = createFakeBrowser();
    const opened = await openTutorialSession(browser, { viewport: { width: 1280, height: 720 } });

    expect(opened.ok).toBe(true);
    expect(browser.contextsCreated()).toBe(1);
    expect(browser.pagesCreated()).toBe(1);
    expect(browser.viewports).toEqual([{ width: 1280, height: 720 }]);
  });

  it("reports a clear failure when the runtime cannot create contexts", async () => {
    const browser = createFakeBrowser({ omitNewContext: true });
    const opened = await openTutorialSession(browser, { viewport: { width: 1280, height: 720 } });

    expect(opened.ok).toBe(false);
    if (opened.ok) throw new Error("expected failure");
    expect(opened.error).toContain("does not support browser contexts");
  });

  it("closes the context when the page cannot be created", async () => {
    const browser = createFakeBrowser({ newPageError: new Error("page crashed on create") });
    const opened = await openTutorialSession(browser, { viewport: { width: 1280, height: 720 } });

    expect(opened.ok).toBe(false);
    if (opened.ok) throw new Error("expected failure");
    expect(opened.error).toContain("Tutorial page could not be created");
    expect(browser.events).toEqual(["context.create", "context.close"]);
  });

  it("collects cleanup errors instead of throwing", async () => {
    const browser = createFakeBrowser({ contextCloseError: new Error("context stuck") });
    const opened = await openTutorialSession(browser, { viewport: { width: 1280, height: 720 } });
    if (!opened.ok) throw new Error(opened.error);

    const errors = await closeTutorialSession(opened.session);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("context stuck");
  });
});

describe("executeTutorialSteps", () => {
  const baseOptions = (scenario: TutorialScenarioV1, page = createFakePage()) => ({
    page,
    scenario,
    applicationUrl: APP_URL,
    targetRoot: TARGET_ROOT
  });

  it("runs every step against the same page", async () => {
    const page = createFakePage();
    const scenario = scenarioWithSteps([
      { id: "one", narration: "first", action: { type: "goto", path: "/a" } },
      { id: "two", narration: "second", action: { type: "goto", path: "/b" } },
      { id: "three", narration: "third", action: { type: "click", locator: { kind: "css", selector: ".x" } } }
    ]);

    const result = await executeTutorialSteps(baseOptions(scenario, page));

    expect(result.steps.map((step) => step.status)).toEqual(["passed", "passed", "passed"]);
    expect(page.calls.filter((call) => call.method === "goto")).toHaveLength(2);
    expect(page.url()).toBe("http://127.0.0.1:3000/b");
  });

  it("treats a narration-only step as passed", async () => {
    const scenario = scenarioWithSteps([{ id: "intro", narration: "Just talking." }]);
    const result = await executeTutorialSteps(baseOptions(scenario));

    expect(result.steps[0].status).toBe("passed");
    expect(result.steps[0].action).toBeUndefined();
    expect(result.steps[0].assertions).toEqual([]);
    expect(result.failedStepId).toBeUndefined();
  });

  it("honors pauseBeforeMs and pauseAfterMs through the injected sleep", async () => {
    const sleeps: number[] = [];
    const scenario = scenarioWithSteps([
      { id: "one", narration: "n", pauseBeforeMs: 120, pauseAfterMs: 340, action: { type: "goto", path: "/a" } }
    ]);

    await executeTutorialSteps({
      ...baseOptions(scenario),
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    });

    expect(sleeps).toEqual([120, 340]);
  });

  it("records requested visual declarations without producing any artifact", async () => {
    const page = createFakePage();
    const scenario = scenarioWithSteps([
      {
        id: "one",
        narration: "n",
        highlight: { kind: "css", selector: ".a" },
        callout: { text: "look" },
        screenshot: { id: "shot-one", fullPage: true }
      },
      { id: "two", narration: "n" }
    ]);

    const result = await executeTutorialSteps(baseOptions(scenario, page));

    expect(result.steps[0]).toMatchObject({
      screenshotRequested: true,
      highlightRequested: true,
      calloutRequested: true
    });
    expect(result.steps[1]).toMatchObject({
      screenshotRequested: false,
      highlightRequested: false,
      calloutRequested: false
    });
    // Visuals are off and no output paths were supplied, so nothing is rendered
    // or captured even though all three declarations were requested.
    expect(page.calls.some((call) => call.method === "screenshot")).toBe(false);
    expect(page.evaluateCalls).toEqual([]);
  });

  it("skips a step's assertions when its action fails and stops later steps", async () => {
    const page = createFakePage({
      locators: { "css:.broken": { clickError: new Error("element detached") } }
    });
    const scenario = scenarioWithSteps([
      {
        id: "one",
        narration: "n",
        action: { type: "click", locator: { kind: "css", selector: ".broken" } },
        assertions: [{ type: "url-path-equals", expected: "/never-checked" }]
      },
      { id: "two", narration: "n", action: { type: "goto", path: "/b" } }
    ]);

    const result = await executeTutorialSteps(baseOptions(scenario, page));

    expect(result.steps[0].status).toBe("failed");
    expect(result.steps[0].action?.status).toBe("failed");
    expect(result.steps[0].assertions).toEqual([]);
    expect(result.steps[0].error).toContain("because the click action failed");
    expect(result.steps[1].status).toBe("not-run");
    expect(result.failedStepId).toBe("one");
    expect(page.calls.filter((call) => call.method === "goto")).toHaveLength(0);
  });

  it("runs every assertion in a step before finalizing it, even after one fails", async () => {
    const page = createFakePage({ url: "http://127.0.0.1:3000/actual" });
    const scenario = scenarioWithSteps([
      {
        id: "one",
        narration: "n",
        assertions: [
          { type: "url-path-equals", expected: "/wrong-one" },
          { type: "url-path-equals", expected: "/actual" },
          { type: "url-path-equals", expected: "/wrong-two" }
        ]
      }
    ]);

    const result = await executeTutorialSteps(baseOptions(scenario, page));

    expect(result.steps[0].assertions.map((assertion) => assertion.status)).toEqual([
      "failed",
      "passed",
      "failed"
    ]);
    expect(result.steps[0].status).toBe("failed");
    expect(result.steps[0].error).toContain("2 of 3 assertions failed");
  });

  it("stops later steps after an assertion failure and marks them not-run", async () => {
    const page = createFakePage({ url: "http://127.0.0.1:3000/actual" });
    const scenario = scenarioWithSteps([
      { id: "one", narration: "n" },
      { id: "two", narration: "n", assertions: [{ type: "url-path-equals", expected: "/nope" }] },
      { id: "three", narration: "n", screenshot: { id: "later-shot" } },
      { id: "four", narration: "n" }
    ]);

    const result = await executeTutorialSteps(baseOptions(scenario, page));

    expect(result.steps.map((step) => step.status)).toEqual(["passed", "failed", "not-run", "not-run"]);
    // Skipped steps are reported, never omitted, and never reported as passed.
    expect(result.steps).toHaveLength(4);
    expect(result.steps[2].screenshotRequested).toBe(true);
    expect(result.steps[2].startedAt).toBeUndefined();
    expect(result.failedStepId).toBe("two");
  });

  it("does not apply pauseAfterMs when the action phase failed", async () => {
    const sleeps: number[] = [];
    const page = createFakePage({ locators: { "css:.x": { clickError: new Error("boom") } } });
    const scenario = scenarioWithSteps([
      {
        id: "one",
        narration: "n",
        pauseBeforeMs: 10,
        pauseAfterMs: 999,
        action: { type: "click", locator: { kind: "css", selector: ".x" } }
      }
    ]);

    await executeTutorialSteps({
      ...baseOptions(scenario, page),
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    });

    expect(sleeps).toEqual([10]);
  });

  it("records timing on executed steps", async () => {
    const scenario = scenarioWithSteps([{ id: "one", narration: "n" }]);
    const result = await executeTutorialSteps(baseOptions(scenario));

    expect(result.steps[0].startedAt).toBeTruthy();
    expect(result.steps[0].endedAt).toBeTruthy();
    expect(result.steps[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});
