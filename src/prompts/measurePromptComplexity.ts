import { countEstimatedTokens, tokenCountMethod } from "../core/countTokens.js";
import type { PromptComplexityMetrics, PromptGenerationContext } from "./types.js";

const OUTPUT_FIELD_NAMES = [
  "answer",
  "relevantFiles",
  "relevantSymbols",
  "expectedFactsFound",
  "confidence",
  "tokenUsage",
  "tokenUsageSource",
  "executionTime",
  "notes",
  "commandsRun",
  "selectedContext",
  "fullFileReads",
  "fullFileReadJustifications"
];

export function measurePromptComplexity(promptText: string, context: PromptGenerationContext): PromptComplexityMetrics {
  return {
    promptChars: promptText.length,
    promptEstimatedTokens: countEstimatedTokens(promptText),
    tokenCountMethod,
    instructionCount: countMatches(promptText, /\b(instruction|use|return|identify|report|answer|state|include|do not)\b/gi),
    constraintCount: countMatches(promptText, /\b(must|must not|do not|only|unless|avoid|required|default)\b/gi),
    requestedOutputFieldCount: OUTPUT_FIELD_NAMES.filter((field) => promptText.includes(field)).length,
    taskStepCount: countMatches(promptText, /^\d+\./gm),
    expectedFactCount: context.answerKey.expectedFacts.length,
    expectedFileCount: context.answerKey.expectedFiles.length,
    expectedSymbolCount: context.answerKey.expectedSymbols.length,
    includesFileTree: promptText.includes("File Tree"),
    includesProjectDescription: promptText.includes(context.projectProfile.description),
    includesAnswerKeySummary: promptText.includes("Answer Key Summary"),
    requiresMultipleFiles: context.answerKey.expectedFiles.length > 1,
    requiresGraphGuidedRetrieval: context.strategy === "my-dev-kit-guided",
    requiresCommandExecution: context.strategy === "my-dev-kit-guided",
    requiresTokenReport: promptText.includes("tokenUsage"),
    requiresTimingReport: promptText.includes("executionTime")
  };
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}
