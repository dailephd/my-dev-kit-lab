import type { AgentCommandTemplate, AgentRunResult, AgentTokenUsage, TokenUsageReliability, TokenUsageSource } from "../agents/types.js";
import type { PromptComplexityLevel, PromptComplexityMetrics, PromptStrategy } from "../prompts/types.js";

export type ExperimentAgentId = "fake-agent" | "codex" | "claude";

export type ExperimentStrategy = PromptStrategy;

export type ExperimentRunStatus =
  | "completed"
  | "failed"
  | "skipped"
  | "agent-unavailable"
  | "agent-limit-reached"
  | "timeout"
  | "invalid-output";

export type ExperimentMatrixConfig = {
  casesPath: string;
  projectProfilesPath?: string;
  caseIds?: string[];
  benchmarkProjects?: string[];
  agents?: ExperimentAgentId[];
  strategies?: ExperimentStrategy[];
  complexityLevels?: PromptComplexityLevel[];
  outDir: string;
  timeoutMs?: number;
  requireAgents?: boolean;
  continueOnFailure?: boolean;
  maxRuns?: number;
  commandTemplates?: Partial<Record<"codex" | "claude", AgentCommandTemplate>>;
  includeRealAgents?: boolean;
};

export type ExperimentMatrixCell = {
  caseId: string;
  benchmarkProject: string;
  agentId: ExperimentAgentId;
  strategy: ExperimentStrategy;
  complexityLevel: PromptComplexityLevel;
  runId: string;
};

export type ParsedAgentAnswer = {
  answerText: string;
  relevantFiles: string[];
  relevantSymbols: string[];
  expectedFactsFound: string[];
  confidence?: string;
  commandsRun: string[];
  selectedContext: string[];
  fullFileReads: string[];
  fullFileReadJustifications: string[];
  parseStatus: "parsed" | "partial" | "failed";
  warnings: string[];
  tokenUsage?: AgentTokenUsage;
};

export type CorrectnessScore = {
  caseId: string;
  fileMatchScore: number;
  symbolMatchScore: number;
  factMatchScore: number;
  correctnessScore: number;
  requiredFactsFound: number;
  requiredFactsTotal: number;
  optionalFactsFound: number;
  optionalFactsTotal: number;
  expectedFilesFound: number;
  expectedFilesTotal: number;
  expectedSymbolsFound: number;
  expectedSymbolsTotal: number;
  passed: boolean;
  failureReasons: string[];
  formula: string;
};

export type ExperimentRun = {
  runId: string;
  caseId: string;
  benchmarkProject: string;
  agentId: ExperimentAgentId;
  promptStrategy: ExperimentStrategy;
  promptComplexityLevel: PromptComplexityLevel;
  promptVariantId: string;
  promptTextForArtifact?: string;
  projectComplexityLevel: string;
  projectComplexityScore: number;
  promptMetrics: PromptComplexityMetrics;
  agentRunResult: AgentRunResult;
  parsedAnswer: ParsedAgentAnswer;
  correctness: CorrectnessScore;
  status: ExperimentRunStatus;
  statusReason: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  tokenUsage: AgentTokenUsage;
  tokenUsageSource: TokenUsageSource;
  tokenUsageReliability: TokenUsageReliability;
  warnings: string[];
  errors: string[];
  artifactPaths: {
    promptPath?: string;
    agentRunResultPath?: string;
    parsedAnswerPath?: string;
    correctnessScorePath?: string;
  };
};

export type ExperimentComparison = {
  comparisonId: string;
  caseId: string;
  benchmarkProject: string;
  agentId: ExperimentAgentId;
  complexityLevel: PromptComplexityLevel;
  rawRunId?: string;
  myDevKitRunId?: string;
  rawStatus?: ExperimentRunStatus;
  myDevKitStatus?: ExperimentRunStatus;
  rawCorrectnessScore?: number;
  myDevKitCorrectnessScore?: number;
  sameCorrectnessPass: boolean;
  correctnessDelta?: number;
  rawDurationMs?: number;
  myDevKitDurationMs?: number;
  durationDeltaMs?: number;
  durationReductionPercent?: number;
  rawTotalTokens?: number;
  myDevKitTotalTokens?: number;
  tokenDelta?: number;
  tokenSavingsPercent?: number;
  tokenComparisonAvailable: boolean;
  reliabilityLabel: "strong" | "correctness-only" | "partial" | "unavailable" | "limit-reached" | "failed";
  warnings: string[];
};

export type ExperimentSummary = {
  generatedAt: string;
  casesPath: string;
  projectProfilesPath?: string;
  agents: ExperimentAgentId[];
  strategies: ExperimentStrategy[];
  complexityLevels: PromptComplexityLevel[];
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  skippedRuns: number;
  unavailableRuns: number;
  limitReachedRuns: number;
  timeoutRuns: number;
  invalidOutputRuns: number;
  totalComparisons: number;
  averageTokenSavingsPercent: number | null;
  averageDurationReductionPercent: number | null;
  averageCorrectnessDelta: number | null;
  answerDoesMyDevKitSaveTokens: boolean | null;
  answerDoesMyDevKitPreserveCorrectness: boolean | null;
  answerDoesMyDevKitReduceExecutionTime: boolean | null;
  warnings: string[];
};

export type ExperimentArtifacts = {
  summary: ExperimentSummary;
  runs: ExperimentRun[];
  comparisons: ExperimentComparison[];
  artifactPaths: {
    summaryPath: string;
    runsPath: string;
    comparisonsPath: string;
    configPath: string;
    runsDir: string;
  };
  warnings: string[];
};
