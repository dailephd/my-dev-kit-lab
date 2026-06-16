import type { tokenCountMethod } from "../core/countTokens.js";
import type { BenchmarkProjectProfile, BenchmarkTaskAnswerKey, EvaluationCase, ProjectFileTree } from "../evaluation/types.js";

export type PromptStrategy = "raw-full-file" | "my-dev-kit-guided";

export type PromptComplexityLevel = "short" | "medium" | "long" | "multi-step";

export type PromptComplexityMetrics = {
  promptChars: number;
  promptEstimatedTokens: number;
  tokenCountMethod: typeof tokenCountMethod;
  instructionCount: number;
  constraintCount: number;
  requestedOutputFieldCount: number;
  taskStepCount: number;
  expectedFactCount: number;
  expectedFileCount: number;
  expectedSymbolCount: number;
  includesFileTree: boolean;
  includesProjectDescription: boolean;
  includesAnswerKeySummary: boolean;
  requiresMultipleFiles: boolean;
  requiresGraphGuidedRetrieval: boolean;
  requiresCommandExecution: boolean;
  requiresTokenReport: boolean;
  requiresTimingReport: boolean;
};

export type PromptGenerationContext = {
  evaluationCase: EvaluationCase;
  projectProfile: BenchmarkProjectProfile;
  answerKey: BenchmarkTaskAnswerKey;
  fileTree: ProjectFileTree;
  complexityLevel: PromptComplexityLevel;
  strategy: PromptStrategy;
};

export type PromptVariant = {
  id: string;
  caseId: string;
  benchmarkProject: string;
  strategy: PromptStrategy;
  complexityLevel: PromptComplexityLevel;
  title: string;
  promptText: string;
  promptMetrics: PromptComplexityMetrics;
  expectedAnswerKey: BenchmarkTaskAnswerKey;
  projectProfile: BenchmarkProjectProfile;
  createdFrom: {
    evaluationCaseId: string;
    projectProfileId: string;
    tokenCountMethod: typeof tokenCountMethod;
  };
  warnings: string[];
};

export type PromptArtifactSummary = {
  generatedAt: string;
  caseCount: number;
  promptCount: number;
  strategies: PromptStrategy[];
  complexityLevels: PromptComplexityLevel[];
  tokenCountMethod: typeof tokenCountMethod;
  outputPaths: {
    summaryPath: string;
    variantsPath: string;
    promptDirectory: string;
    promptFiles: string[];
  };
  warnings: string[];
};
