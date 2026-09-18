import { describe, expect, it } from "vitest";
import {
  renderTutorialMarkdown,
  toMarkdownScreenshotLink
} from "../../src/tutorial/markdownTutorialWriter.js";
import type { TutorialArtifactRecordV1, TutorialStepResultV1 } from "../../src/tutorial/types.js";
import { minimalScenario } from "./tutorialTestHelpers.js";

function stepResult(
  id: string,
  status: TutorialStepResultV1["status"],
  extra: Partial<TutorialStepResultV1> = {}
): TutorialStepResultV1 {
  return {
    id,
    status,
    assertions: [],
    screenshotRequested: false,
    highlightRequested: false,
    calloutRequested: false,
    ...extra
  };
}

function screenshot(id: string, status: TutorialArtifactRecordV1["status"]): TutorialArtifactRecordV1 {
  return {
    kind: "screenshot",
    id,
    status,
    ...(status === "written" ? { path: `screenshots/${id}.png`, sizeBytes: 100 } : {})
  };
}

describe("toMarkdownScreenshotLink", () => {
  it("turns a run-relative path into a portable sibling link", () => {
    expect(toMarkdownScreenshotLink("screenshots/one.png")).toBe("../screenshots/one.png");
  });

  it("normalizes Windows separators to POSIX", () => {
    expect(toMarkdownScreenshotLink("screenshots\\one.png")).toBe("../screenshots/one.png");
  });
});

describe("renderTutorialMarkdown", () => {
  it("uses the scenario title and description", () => {
    const scenario = minimalScenario({
      title: "My Tutorial",
      description: "What this tutorial shows.",
      steps: [{ id: "one", narration: "First." }]
    });

    const markdown = renderTutorialMarkdown({
      scenario,
      steps: [stepResult("one", "passed")],
      screenshots: []
    });

    expect(markdown.startsWith("# My Tutorial\n")).toBe(true);
    expect(markdown).toContain("What this tutorial shows.");
  });

  it("omits the description block when the scenario has none", () => {
    const scenario = minimalScenario({ steps: [{ id: "one", narration: "First." }] });
    const markdown = renderTutorialMarkdown({
      scenario,
      steps: [stepResult("one", "passed")],
      screenshots: []
    });

    expect(markdown.split("\n").slice(0, 3).join("\n")).toBe("# Demo tutorial\n\n## Step 1: one");
  });

  it("lists executed steps in scenario order with unchanged narration", () => {
    const scenario = minimalScenario({
      steps: [
        { id: "one", narration: "First narration." },
        { id: "two", narration: "Second narration." },
        { id: "three", narration: "Third narration." }
      ]
    });

    const markdown = renderTutorialMarkdown({
      scenario,
      steps: [stepResult("one", "passed"), stepResult("two", "passed"), stepResult("three", "passed")],
      screenshots: []
    });

    expect(markdown.indexOf("## Step 1: one")).toBeLessThan(markdown.indexOf("## Step 2: two"));
    expect(markdown.indexOf("## Step 2: two")).toBeLessThan(markdown.indexOf("## Step 3: three"));
    expect(markdown).toContain("First narration.");
    expect(markdown).toContain("Second narration.");
    expect(markdown).toContain("Third narration.");
  });

  it("links a successful screenshot with a relative POSIX path", () => {
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "First.", screenshot: { id: "shot-one" } }]
    });

    const markdown = renderTutorialMarkdown({
      scenario,
      steps: [stepResult("one", "passed", { screenshotRequested: true })],
      screenshots: [screenshot("shot-one", "written")]
    });

    expect(markdown).toContain("![one](../screenshots/shot-one.png)");
  });

  it("invents no image for a step without a screenshot", () => {
    const scenario = minimalScenario({ steps: [{ id: "one", narration: "First." }] });
    const markdown = renderTutorialMarkdown({
      scenario,
      steps: [stepResult("one", "passed")],
      screenshots: []
    });

    expect(markdown).not.toContain("![");
  });

  it("invents no image when the requested screenshot failed", () => {
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "First.", screenshot: { id: "shot-one" } }]
    });
    const markdown = renderTutorialMarkdown({
      scenario,
      steps: [stepResult("one", "passed", { screenshotRequested: true })],
      screenshots: [screenshot("shot-one", "failed")]
    });

    expect(markdown).not.toContain("![");
  });

  it("identifies a failed executed step without inventing advice", () => {
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "First." }]
    });
    const markdown = renderTutorialMarkdown({
      scenario,
      steps: [stepResult("one", "failed", { error: "click action failed: boom" })],
      screenshots: []
    });

    expect(markdown).toContain("## Step 1: one");
    expect(markdown).toContain("**This step failed during execution.** click action failed: boom");
    expect(markdown).not.toMatch(/try |check that|you (should|can)/i);
  });

  it("does not present not-run steps as completed", () => {
    const scenario = minimalScenario({
      steps: [
        { id: "one", narration: "First." },
        { id: "skipped", narration: "Never happened." }
      ]
    });
    const markdown = renderTutorialMarkdown({
      scenario,
      steps: [stepResult("one", "passed"), stepResult("skipped", "not-run")],
      screenshots: []
    });

    expect(markdown).toContain("## Step 1: one");
    expect(markdown).not.toContain("skipped");
    expect(markdown).not.toContain("Never happened.");
  });

  it("contains no absolute filesystem paths", () => {
    const scenario = minimalScenario({
      steps: [{ id: "one", narration: "First.", screenshot: { id: "shot-one" } }]
    });
    const markdown = renderTutorialMarkdown({
      scenario,
      steps: [stepResult("one", "passed", { screenshotRequested: true })],
      screenshots: [screenshot("shot-one", "written")]
    });

    expect(markdown).not.toMatch(/[A-Za-z]:\\/);
    expect(markdown).not.toContain("/home/");
    expect(markdown).not.toContain("/Users/");
    expect(markdown).not.toContain("\\");
  });

  it("is deterministic for a fixed run model", () => {
    const scenario = minimalScenario({
      steps: [
        { id: "one", narration: "First.", screenshot: { id: "shot-one" } },
        { id: "two", narration: "Second." }
      ]
    });
    const model = {
      scenario,
      steps: [stepResult("one", "passed", { screenshotRequested: true }), stepResult("two", "passed")],
      screenshots: [screenshot("shot-one", "written")]
    };

    expect(renderTutorialMarkdown(model)).toBe(renderTutorialMarkdown(model));
  });
});
