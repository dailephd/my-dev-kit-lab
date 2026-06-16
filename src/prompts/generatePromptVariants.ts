import { buildPromptGenerationContext } from "./buildPromptContext.js";
import { generateMyDevKitPrompt } from "./generateMyDevKitPrompt.js";
import { generateRawFullFilePrompt } from "./generateRawFullFilePrompt.js";
import type { BenchmarkProjectProfile, EvaluationCase } from "../evaluation/types.js";
import type { PromptComplexityLevel, PromptStrategy, PromptVariant } from "./types.js";

export const ALL_PROMPT_STRATEGIES: PromptStrategy[] = ["raw-full-file", "my-dev-kit-guided"];
export const ALL_PROMPT_COMPLEXITY_LEVELS: PromptComplexityLevel[] = ["short", "medium", "long", "multi-step"];

export function generatePromptVariants(args: {
  cases: EvaluationCase[];
  projectProfiles: BenchmarkProjectProfile[];
  strategies?: PromptStrategy[];
  complexityLevels?: PromptComplexityLevel[];
}): PromptVariant[] {
  const strategies = args.strategies ?? ALL_PROMPT_STRATEGIES;
  const complexityLevels = args.complexityLevels ?? ALL_PROMPT_COMPLEXITY_LEVELS;
  const variants: PromptVariant[] = [];
  for (const evaluationCase of args.cases) {
    for (const strategy of strategies) {
      for (const complexityLevel of complexityLevels) {
        const context = buildPromptGenerationContext({
          evaluationCase,
          projectProfiles: args.projectProfiles,
          strategy,
          complexityLevel
        });
        variants.push(strategy === "raw-full-file" ? generateRawFullFilePrompt(context) : generateMyDevKitPrompt(context));
      }
    }
  }
  return variants;
}

export function parsePromptStrategy(value: string): PromptStrategy {
  if (value === "raw-full-file" || value === "my-dev-kit-guided") {
    return value;
  }
  throw new Error(`Invalid prompt strategy: ${value}`);
}

export function parsePromptComplexityLevel(value: string): PromptComplexityLevel {
  if (value === "short" || value === "medium" || value === "long" || value === "multi-step") {
    return value;
  }
  throw new Error(`Invalid prompt complexity level: ${value}`);
}
