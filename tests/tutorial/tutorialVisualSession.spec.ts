import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeTutorialSteps } from "../../src/tutorial/tutorialSession.js";
import { buildTutorialRunPaths, createTutorialRunDirectories } from "../../src/tutorial/tutorialPaths.js";
import type { TutorialRunPaths, TutorialScenarioV1 } from "../../src/tutorial/types.js";
import { createFakePage, minimalScenario } from "./tutorialTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRunPaths(): Promise<TutorialRunPaths> {
  const root = mkdtempSync(path.join(os.tmpdir(), "tutorial-visual-"));
  tempDirs.push(root);
  const paths = buildTutorialRunPaths({
    workspaceRoot: root,
    invocationCwd: root,
    scenarioId: "demo",
    runId: "run",
    outDir: path.join(root, "run")
  });
  await createTutorialRunDirectories(paths);
  return paths;
}

function options(scenario: TutorialScenarioV1, page: ReturnType<typeof createFakePage>, paths?: TutorialRunPaths) {
  return {
    page,
    scenario,
    applicationUrl: "http://127.0.0.1:3000/",
    targetRoot: paths?.targetRoot ?? "/unused",
    visuals: true,
    sleep: async () => {},
    ...(paths ? { paths } : {})
  };
}

describe("step screenshot capture", () => {
  it("captures nothing when the scenario requests no screenshot", async () => {
    const paths = await makeRunPaths();
    const page = createFakePage();
    const scenario = minimalScenario({ steps: [{ id: "one", narration: "n" }] });

    const result = await executeTutorialSteps(options(scenario, page, paths));

    expect(result.screenshots).toEqual([]);
    expect(page.screenshotCalls).toEqual([]);
  });

  it("captures a requested screenshot at its canonical id path with fullPage false by default", async () => {
    const paths = await makeRunPaths();
    const page = createFakePage();
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "n", screenshot: { id: "shot-one" } }]
    });

    const result = await executeTutorialSteps(options(scenario, page, paths));

    expect(page.screenshotCalls).toEqual([
      { path: path.join(paths.screenshotsRoot, "shot-one.png"), fullPage: false }
    ]);
    expect(result.screenshots[0]).toMatchObject({
      kind: "screenshot",
      id: "shot-one",
      status: "written",
      path: "screenshots/shot-one.png"
    });
    expect(result.screenshots[0].sizeBytes).toBeGreaterThan(0);
  });

  it("forwards an explicit fullPage request", async () => {
    const paths = await makeRunPaths();
    const page = createFakePage();
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "n", screenshot: { id: "shot-one", fullPage: true } }]
    });

    await executeTutorialSteps(options(scenario, page, paths));

    expect(page.screenshotCalls[0].fullPage).toBe(true);
  });

  it("captures after assertions, after overlays and after pauseAfterMs", async () => {
    const paths = await makeRunPaths();
    const page = createFakePage({ url: "http://127.0.0.1:3000/x" });
    const scenario = minimalScenario({
      steps: [
        {
          id: "one",
          narration: "n",
          pauseAfterMs: 25,
          highlight: { kind: "css", selector: ".a" },
          screenshot: { id: "shot-one" },
          assertions: [{ type: "url-path-equals", expected: "/x" }]
        }
      ]
    });

    const timeline: string[] = [];
    const page2 = createFakePage({ url: "http://127.0.0.1:3000/x" });
    await executeTutorialSteps({
      ...options(scenario, page2, paths),
      sleep: async () => {
        timeline.push("pause");
      }
    });

    // The screenshot is the last page interaction of the step.
    const lastCalls = page2.calls.map((call) => call.method);
    expect(lastCalls.at(-1)).toBe("screenshot");
    // Assertion (url) and overlay (evaluate) both happened before it.
    expect(page2.evaluateCalls.some((call) => call.fnName === "applyHighlightInPage")).toBe(true);
    expect(timeline).toContain("pause");
    void page;
  });

  it("skips the screenshot when the step's action failed before a usable state", async () => {
    const paths = await makeRunPaths();
    const page = createFakePage({ locators: { "css:.a": { clickError: new Error("detached") } } });
    const scenario = minimalScenario({
      steps: [
        {
          id: "one",
          narration: "n",
          action: { type: "click", locator: { kind: "css", selector: ".a" } },
          screenshot: { id: "shot-one" }
        }
      ]
    });

    const result = await executeTutorialSteps(options(scenario, page, paths));

    expect(result.screenshots[0]).toMatchObject({ id: "shot-one", status: "skipped" });
    expect(result.screenshots[0].error).toContain("failed before reaching a usable state");
    expect(page.screenshotCalls).toEqual([]);
    expect(existsSync(path.join(paths.screenshotsRoot, "shot-one.png"))).toBe(false);
  });

  it("refuses to overwrite an existing canonical screenshot", async () => {
    const paths = await makeRunPaths();
    writeFileSync(path.join(paths.screenshotsRoot, "shot-one.png"), "existing");
    const page = createFakePage();
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "n", screenshot: { id: "shot-one" } }]
    });

    const result = await executeTutorialSteps(options(scenario, page, paths));

    expect(result.screenshots[0]).toMatchObject({ id: "shot-one", status: "failed" });
    expect(result.screenshots[0].error).toContain("refusing to overwrite");
    // No random suffix was invented.
    expect(page.screenshotCalls).toEqual([]);
  });

  it("records a failed screenshot when capture throws", async () => {
    const paths = await makeRunPaths();
    const page = createFakePage({ screenshotError: new Error("page closed") });
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "n", screenshot: { id: "shot-one" } }]
    });

    const result = await executeTutorialSteps(options(scenario, page, paths));

    expect(result.screenshots[0]).toMatchObject({ id: "shot-one", status: "failed" });
    expect(result.screenshots[0].error).toContain("page closed");
  });

  it("keeps every screenshot beneath screenshotsRoot", async () => {
    const paths = await makeRunPaths();
    const page = createFakePage();
    const scenario = minimalScenario({
      steps: [
        { id: "one", narration: "n", screenshot: { id: "a" } },
        { id: "two", narration: "n", screenshot: { id: "b" } }
      ]
    });

    const result = await executeTutorialSteps(options(scenario, page, paths));

    for (const call of page.screenshotCalls) {
      expect(path.relative(paths.screenshotsRoot, call.path).startsWith("..")).toBe(false);
    }
    for (const record of result.screenshots) {
      expect(record.path?.startsWith("screenshots/")).toBe(true);
    }
  });

  it("reports failure when a screenshot is requested without run paths", async () => {
    const page = createFakePage();
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "n", screenshot: { id: "shot-one" } }]
    });

    const result = await executeTutorialSteps(options(scenario, page));

    expect(result.screenshots[0]).toMatchObject({ status: "failed" });
    expect(result.screenshots[0].error).toContain("no screenshot output directory");
  });
});

describe("tutorial timeline", () => {
  /** Deterministic monotonic clock so timeline assertions never depend on wall time. */
  function fakeClock(startAt = 1000) {
    let value = startAt;
    return {
      now: () => value,
      advance: (ms: number) => {
        value += ms;
      }
    };
  }

  it("starts the first executed step at zero and keeps end >= start", async () => {
    const clock = fakeClock();
    const scenario = minimalScenario({ steps: [{ id: "one", narration: "n" }] });

    const result = await executeTutorialSteps({
      ...options(scenario, createFakePage()),
      now: clock.now
    });

    expect(result.steps[0].timelineStartMs).toBe(0);
    expect(result.steps[0].timelineEndMs).toBeGreaterThanOrEqual(result.steps[0].timelineStartMs!);
  });

  it("is monotonic across steps and accumulates pauses, actions and assertions", async () => {
    const clock = fakeClock();
    const scenario = minimalScenario({
      steps: [
        {
          id: "one",
          narration: "n",
          pauseBeforeMs: 100,
          pauseAfterMs: 200,
          action: { type: "goto", path: "/a" },
          assertions: [{ type: "url-path-equals", expected: "/a" }]
        },
        { id: "two", narration: "n", pauseBeforeMs: 50 }
      ]
    });
    const page = createFakePage({ url: "http://127.0.0.1:3000/a" });

    const result = await executeTutorialSteps({
      ...options(scenario, page),
      now: clock.now,
      // Every waiting period advances the monotonic clock, exactly as real time would.
      sleep: async (ms) => {
        clock.advance(ms);
      }
    });

    const [first, second] = result.steps;
    // pauseBefore 100 + cursor/visual waits + pauseAfter 200 are all inside step one.
    expect(first.timelineStartMs).toBe(0);
    expect(first.timelineEndMs).toBeGreaterThanOrEqual(300);
    expect(second.timelineStartMs).toBeGreaterThanOrEqual(first.timelineEndMs!);
    expect(second.timelineEndMs).toBeGreaterThanOrEqual(second.timelineStartMs! + 50);
  });

  it("fabricates no timeline for not-run steps and keeps ISO evidence separately", async () => {
    const scenario = minimalScenario({
      steps: [
        {
          id: "one",
          narration: "n",
          assertions: [{ type: "url-path-equals", expected: "/nope" }]
        },
        { id: "two", narration: "n" }
      ]
    });

    const result = await executeTutorialSteps(options(scenario, createFakePage()));

    expect(result.steps[0].status).toBe("failed");
    expect(result.steps[0].timelineStartMs).toBeGreaterThanOrEqual(0);
    expect(result.steps[0].startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.steps[0].endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(result.steps[1].status).toBe("not-run");
    expect(result.steps[1].timelineStartMs).toBeUndefined();
    expect(result.steps[1].timelineEndMs).toBeUndefined();
    expect(result.steps[1].startedAt).toBeUndefined();
  });
});
