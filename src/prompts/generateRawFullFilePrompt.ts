import { tokenCountMethod } from "../core/countTokens.js";
import { formatAnswerKeySummary, formatCompactFileTree, formatExpectedOutputFields } from "./buildPromptContext.js";
import { measurePromptComplexity } from "./measurePromptComplexity.js";
import type { PromptGenerationContext, PromptVariant } from "./types.js";

export function generateRawFullFilePrompt(context: PromptGenerationContext): PromptVariant {
  const promptText = buildRawPromptText(context);
  return {
    id: `${context.evaluationCase.id}.raw-full-file.${context.complexityLevel}`,
    caseId: context.evaluationCase.id,
    benchmarkProject: context.evaluationCase.benchmarkProject,
    strategy: "raw-full-file",
    complexityLevel: context.complexityLevel,
    title: `${context.evaluationCase.title} - raw full-file - ${context.complexityLevel}`,
    promptText,
    promptMetrics: measurePromptComplexity(promptText, context),
    expectedAnswerKey: context.answerKey,
    projectProfile: context.projectProfile,
    createdFrom: {
      evaluationCaseId: context.evaluationCase.id,
      projectProfileId: context.projectProfile.projectId,
      tokenCountMethod
    },
    warnings: []
  };
}

function buildRawPromptText(context: PromptGenerationContext): string {
  const base = [
    "# Raw Full-File Benchmark Prompt",
    "",
    `Project: ${context.projectProfile.displayName}`,
    `Project ID: ${context.projectProfile.projectId}`,
    `Complexity: ${context.projectProfile.complexityLevel}, score ${context.projectProfile.complexityScore}`,
    `Task: ${context.evaluationCase.title}`,
    `Query: ${context.evaluationCase.query}`,
    "",
    "Instruction: use the full source files supplied separately by the runner as the primary context.",
    "Do not use my-dev-kit as the required retrieval method for this strategy.",
    "Identify the relevant files and relevant symbols before giving the answer.",
    "Return tokenUsage if the platform exposes it, and state tokenUsageSource as provider-reported, agent-reported, estimated, or unavailable.",
    "Return executionTime if available.",
    "",
    "Expected Output Fields:",
    formatExpectedOutputFields("raw-full-file")
  ];

  if (context.complexityLevel === "short") {
    return [
      ...base,
      "",
      `Expected file count: ${context.answerKey.expectedFiles.length}`,
      `Expected symbol count: ${context.answerKey.expectedSymbols.length}`,
      "Answer with concise reasoning."
    ].join("\n");
  }

  const medium = [
    ...base,
    "",
    `Description: ${context.projectProfile.description}`,
    "",
    "File Tree:",
    formatCompactFileTree(context),
    "",
    "Answer with concise reasoning and cite the files/symbols used."
  ];

  if (context.complexityLevel === "medium") {
    return medium.join("\n");
  }

  const long = [
    ...medium,
    "",
    "Answer Key Summary:",
    formatAnswerKeySummary(context),
    "",
    "Constraints:",
    "- Do not invent files, symbols, or behavior.",
    "- Keep the answer tied to supplied source context.",
    "- Include confidence as high, medium, or low.",
    "- State whether token usage is provider-reported, agent-reported, estimated, or unavailable."
  ];

  if (context.complexityLevel === "long") {
    return long.join("\n");
  }

  return [
    ...long,
    "",
    "Workflow Steps:",
    "1. Review the provided full-file context.",
    "2. Identify candidate files and symbols.",
    "3. Match the behavior against the benchmark task.",
    "4. List expected facts found and any missing uncertainty.",
    "5. Return the structured response fields.",
    "",
    "Validation Checklist:",
    "- relevantFiles are project-relative paths",
    "- relevantSymbols are concrete functions, classes, exports, or methods",
    "- expectedFactsFound uses fact IDs when known",
    "- notes include any uncertainty or missing telemetry"
  ].join("\n");
}
