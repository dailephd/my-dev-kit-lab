import type { BenchmarkProjectProfile, BenchmarkTaskAnswerKey, EvaluationCase } from "../evaluation/types.js";
import type { PromptComplexityLevel, PromptGenerationContext, PromptStrategy } from "./types.js";

export function buildPromptGenerationContext(args: {
  evaluationCase: EvaluationCase;
  projectProfiles: BenchmarkProjectProfile[];
  strategy: PromptStrategy;
  complexityLevel: PromptComplexityLevel;
}): PromptGenerationContext {
  const profileId = args.evaluationCase.projectProfileRef ?? args.evaluationCase.benchmarkProject;
  const projectProfile = args.projectProfiles.find((profile) => profile.projectId === profileId);
  if (!projectProfile) {
    throw new Error(`No benchmark project profile found for ${profileId}.`);
  }
  const answerKey = resolveAnswerKey(args.evaluationCase);
  return {
    evaluationCase: args.evaluationCase,
    projectProfile,
    answerKey,
    fileTree: projectProfile.fileTree,
    complexityLevel: args.complexityLevel,
    strategy: args.strategy
  };
}

function resolveAnswerKey(evaluationCase: EvaluationCase): BenchmarkTaskAnswerKey {
  if (evaluationCase.answerKey) {
    return evaluationCase.answerKey;
  }
  return {
    expectedFiles: evaluationCase.expectedFiles,
    expectedSymbols: evaluationCase.expectedSymbols,
    expectedFacts: evaluationCase.expectedFacts ?? [],
    minimumCorrectFacts: 0,
    notes: "Fallback answer key built from legacy evaluation case fields."
  };
}

export function formatCompactFileTree(context: PromptGenerationContext): string {
  const maxEntries = context.complexityLevel === "short" ? 6 : context.complexityLevel === "medium" ? 12 : 24;
  const entries = context.fileTree.entries
    .filter((entry) => entry.kind === "file")
    .slice(0, maxEntries)
    .map((entry) => {
      const details = [entry.role, entry.language, typeof entry.lines === "number" ? `${entry.lines} lines` : undefined].filter(Boolean).join(", ");
      return `- ${entry.path}${details ? ` (${details})` : ""}`;
    });
  if (context.fileTree.entries.filter((entry) => entry.kind === "file").length > maxEntries) {
    entries.push(`- ... ${context.fileTree.entries.filter((entry) => entry.kind === "file").length - maxEntries} more files omitted from preview`);
  }
  return entries.join("\n");
}

export function formatAnswerKeySummary(context: PromptGenerationContext): string {
  const facts =
    context.complexityLevel === "long" || context.complexityLevel === "multi-step"
      ? context.answerKey.expectedFacts.map((fact) => `- ${fact.id}: ${fact.required ? "required" : "optional"}, weight ${fact.weight}`).join("\n")
      : `Expected fact count: ${context.answerKey.expectedFacts.length}`;
  return [
    `Expected file count: ${context.answerKey.expectedFiles.length}`,
    `Expected symbol count: ${context.answerKey.expectedSymbols.length}`,
    `Minimum correct facts later required: ${context.answerKey.minimumCorrectFacts}`,
    facts
  ].join("\n");
}

export function formatExpectedOutputFields(strategy: PromptStrategy): string {
  const baseFields = [
    "answer",
    "relevantFiles",
    "relevantSymbols",
    "expectedFactsFound",
    "confidence",
    "tokenUsage, if available",
    "tokenUsageSource: provider-reported, agent-reported, estimated, or unavailable",
    "executionTime, if available",
    "notes"
  ];
  const guidedFields = ["commandsRun", "selectedContext", "fullFileReads, if any", "fullFileReadJustifications, if any"];
  return [...baseFields, ...(strategy === "my-dev-kit-guided" ? guidedFields : [])].map((field) => `- ${field}`).join("\n");
}
