import path from "node:path";
import { readBenchmarkProjectProfiles, readEvaluationCases } from "../../src/evaluation/index.js";
import { generatePromptVariants } from "../../src/prompts/index.js";
import type { PromptComplexityLevel, PromptStrategy, PromptVariant } from "../../src/prompts/types.js";

export async function loadPromptVariant(
  strategy: PromptStrategy = "raw-full-file",
  complexityLevel: PromptComplexityLevel = "short"
): Promise<PromptVariant> {
  const profiles = await readBenchmarkProjectProfiles(path.resolve(process.cwd(), "benchmarks/contracts/benchmark-project-profiles.json"));
  const cases = await readEvaluationCases(path.resolve(process.cwd(), "examples/token-savings-cases.json"), process.cwd(), {
    projectProfiles: profiles,
    requireProjectProfileRef: true
  });
  const [variant] = generatePromptVariants({
    cases: [cases[0]],
    projectProfiles: profiles,
    strategies: [strategy],
    complexityLevels: [complexityLevel]
  });
  if (!variant) {
    throw new Error("Missing prompt variant fixture.");
  }
  return variant;
}
