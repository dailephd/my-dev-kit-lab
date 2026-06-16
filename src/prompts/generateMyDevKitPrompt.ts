import { tokenCountMethod } from "../core/countTokens.js";
import { formatAnswerKeySummary, formatCompactFileTree, formatExpectedOutputFields } from "./buildPromptContext.js";
import { measurePromptComplexity } from "./measurePromptComplexity.js";
import type { PromptGenerationContext, PromptVariant } from "./types.js";

export function generateMyDevKitPrompt(context: PromptGenerationContext): PromptVariant {
  const promptText = buildMyDevKitPromptText(context);
  return {
    id: `${context.evaluationCase.id}.my-dev-kit-guided.${context.complexityLevel}`,
    caseId: context.evaluationCase.id,
    benchmarkProject: context.evaluationCase.benchmarkProject,
    strategy: "my-dev-kit-guided",
    complexityLevel: context.complexityLevel,
    title: `${context.evaluationCase.title} - my-dev-kit guided - ${context.complexityLevel}`,
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

function buildMyDevKitPromptText(context: PromptGenerationContext): string {
  const base = [
    "# my-dev-kit-Guided Benchmark Prompt",
    "",
    `Project: ${context.projectProfile.displayName}`,
    `Project ID: ${context.projectProfile.projectId}`,
    `Complexity: ${context.projectProfile.complexityLevel}, score ${context.projectProfile.complexityScore}`,
    `Task: ${context.evaluationCase.title}`,
    `Query: ${context.evaluationCase.query}`,
    "",
    "Instruction: gather targeted context using my-dev-kit.",
    "Do not read full files by default. Read whole files only if targeted retrieval is insufficient, and explain why.",
    "Use my-dev-kit index before retrieval.",
    "Use my-dev-kit search to find candidate files or symbols.",
    "Use my-dev-kit lookup to inspect selected nodes.",
    "Use my-dev-kit slice where useful for nearby context.",
    "Use my-dev-kit source for selected symbols or line ranges.",
    "Report commandsRun, selected files, selected symbols, and selectedContext.",
    "Return tokenUsage if the platform exposes it, and state tokenUsageSource as provider-reported, agent-reported, estimated, or unavailable.",
    "Return executionTime if available.",
    "",
    "Expected Output Fields:",
    formatExpectedOutputFields("my-dev-kit-guided")
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
    "Answer with concise reasoning and cite the my-dev-kit commands that supplied context."
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
    "- Do not create a full-file reading workflow by default.",
    "- Do not invent files, symbols, commands, or behavior.",
    "- Prefer search, lookup, slice, and source over broad reads.",
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
    "1. Run my-dev-kit index for the target project.",
    "2. Run my-dev-kit search with the benchmark query.",
    "3. Run my-dev-kit lookup for promising files or symbols.",
    "4. Run my-dev-kit slice where local context is needed.",
    "5. Run my-dev-kit source for selected symbols or line ranges.",
    "6. Avoid full-file reads unless targeted context is insufficient.",
    "7. Answer the task and report selected files, selected symbols, commandsRun, and any fullFileReads.",
    "",
    "Validation Checklist:",
    "- commandsRun includes index, search, lookup, and any slice/source commands used",
    "- selectedContext explains why each file or symbol was chosen",
    "- fullFileReads is empty unless justified",
    "- expectedFactsFound uses fact IDs when known",
    "- notes include uncertainty or missing telemetry"
  ].join("\n");
}
