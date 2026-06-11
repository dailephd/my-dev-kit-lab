import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBenchmarkProjectProfiles, readEvaluationCases } from "../../src/evaluation/index.js";
import {
  ALL_PROMPT_COMPLEXITY_LEVELS,
  buildPromptGenerationContext,
  generateMyDevKitPrompt,
  generatePromptVariants,
  generateRawFullFilePrompt
} from "../../src/prompts/index.js";

async function loadFixtureContext(complexityLevel: "short" | "medium" | "long" | "multi-step" = "medium") {
  const profiles = await readBenchmarkProjectProfiles(path.join(process.cwd(), "benchmarks/contracts/benchmark-project-profiles.json"));
  const cases = await readEvaluationCases(path.join(process.cwd(), "examples/token-savings-cases.json"), process.cwd(), {
    projectProfiles: profiles,
    requireProjectProfileRef: true
  });
  return buildPromptGenerationContext({
    evaluationCase: cases[0],
    projectProfiles: profiles,
    strategy: "raw-full-file",
    complexityLevel
  });
}

describe("prompt generation", () => {
  it("generates a raw-full-file prompt without requiring my-dev-kit commands", async () => {
    const context = await loadFixtureContext("medium");
    const variant = generateRawFullFilePrompt(context);
    expect(variant.promptText).toContain("use the full source files");
    expect(variant.promptText).toContain("Project: Todo TypeScript");
    expect(variant.promptText).toContain("File Tree:");
    expect(variant.promptText).toContain("Expected Output Fields:");
    expect(variant.promptText).toContain("tokenUsage");
    expect(variant.promptText).toContain("executionTime");
    expect(variant.promptText).not.toContain("Use my-dev-kit index");
    expect(variant.promptMetrics.requiresGraphGuidedRetrieval).toBe(false);
  });

  it("generates a my-dev-kit-guided prompt with required retrieval workflow instructions", async () => {
    const rawContext = await loadFixtureContext("medium");
    const context = { ...rawContext, strategy: "my-dev-kit-guided" as const };
    const variant = generateMyDevKitPrompt(context);
    expect(variant.promptText).toContain("Do not read full files by default");
    expect(variant.promptText).toContain("Use my-dev-kit index");
    expect(variant.promptText).toContain("Use my-dev-kit search");
    expect(variant.promptText).toContain("Use my-dev-kit lookup");
    expect(variant.promptText).toContain("Use my-dev-kit slice");
    expect(variant.promptText).toContain("Use my-dev-kit source");
    expect(variant.promptText).toContain("commandsRun");
    expect(variant.promptMetrics.requiresGraphGuidedRetrieval).toBe(true);
    expect(variant.promptMetrics.requiresCommandExecution).toBe(true);
  });

  it("orders prompt complexity levels by prompt size", async () => {
    const variants = [];
    for (const complexityLevel of ALL_PROMPT_COMPLEXITY_LEVELS) {
      const context = await loadFixtureContext(complexityLevel);
      variants.push(generateRawFullFilePrompt(context));
    }
    expect(variants[0].promptText.length).toBeLessThan(variants[1].promptText.length);
    expect(variants[1].promptText.length).toBeLessThan(variants[2].promptText.length);
    expect(variants[2].promptText.length).toBeLessThanOrEqual(variants[3].promptText.length);
    expect(variants[3].promptText).toContain("Workflow Steps:");
    expect(variants[3].promptText).toContain("Validation Checklist:");
  });

  it("computes deterministic prompt complexity metrics using the existing token counter", async () => {
    const context = await loadFixtureContext("long");
    const first = generateRawFullFilePrompt(context);
    const second = generateRawFullFilePrompt(context);
    expect(second.promptMetrics).toEqual(first.promptMetrics);
    expect(first.promptMetrics.promptChars).toBe(first.promptText.length);
    expect(first.promptMetrics.promptEstimatedTokens).toBe(Math.ceil(first.promptText.length / 4));
    expect(first.promptMetrics.instructionCount).toBeGreaterThanOrEqual(0);
    expect(first.promptMetrics.constraintCount).toBeGreaterThanOrEqual(0);
    expect(first.promptMetrics.requestedOutputFieldCount).toBeGreaterThan(0);
    expect(first.promptMetrics.expectedFactCount).toBe(context.answerKey.expectedFacts.length);
    expect(first.promptMetrics.requiresTokenReport).toBe(true);
    expect(first.promptMetrics.requiresTimingReport).toBe(true);
  });

  it("generates variants for all four benchmark projects", async () => {
    const profiles = await readBenchmarkProjectProfiles(path.join(process.cwd(), "benchmarks/contracts/benchmark-project-profiles.json"));
    const cases = await readEvaluationCases(path.join(process.cwd(), "examples/token-savings-cases.json"), process.cwd(), {
      projectProfiles: profiles,
      requireProjectProfileRef: true
    });
    const variants = generatePromptVariants({ cases, projectProfiles: profiles, strategies: ["raw-full-file"], complexityLevels: ["short"] });
    expect(new Set(variants.map((variant) => variant.benchmarkProject))).toEqual(
      new Set(["todo-ts", "todo-python", "todo-js", "todo-mixed-ts-py"])
    );
    expect(variants.every((variant) => variant.promptMetrics.promptEstimatedTokens > 0)).toBe(true);
  });
});
