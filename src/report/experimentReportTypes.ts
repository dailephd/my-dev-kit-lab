import type { ScreenshotCaptureResult } from "../screenshot/types.js";
import type { BenchmarkProjectProfile, EvaluationCase, ProjectFileTreeEntry } from "../evaluation/types.js";
import type { ExperimentComparison, ExperimentRun, ExperimentSummary } from "../evaluation/controlledExperimentTypes.js";

export type AggregateAnswerLabel = "yes" | "no" | "mixed" | "inconclusive" | "unavailable";

export type ExperimentReportExecutiveSummary = {
  doesMyDevKitSaveTokens: AggregateAnswerLabel;
  doesMyDevKitPreserveCorrectness: AggregateAnswerLabel;
  doesMyDevKitReduceExecutionTime: AggregateAnswerLabel;
  completedRuns: number;
  failedRuns: number;
  unavailableRuns: number;
  limitReachedRuns: number;
  timeoutRuns: number;
  invalidOutputRuns: number;
  comparisonReliabilityCounts: Record<string, number>;
  summaryText: string;
};

export type ExperimentReportProjectSection = {
  profile: BenchmarkProjectProfile;
  complexityMetrics: Record<string, number | undefined>;
};

export type ExperimentReportFileTreeSection = {
  projectId: string;
  entries: ProjectFileTreeEntry[];
  totalEntries: number;
  truncated: boolean;
};

export type ExperimentReportBenchmarkCaseSection = {
  caseId: string;
  title: string;
  benchmarkProject: string;
  query: string;
  expectedOperation?: string;
  expectedFiles: string[];
  expectedSymbols: string[];
  expectedFacts: Array<{ id: string; required: boolean; weight: number; text: string }>;
  minimumCorrectFacts: number;
  notes?: string;
};

export type ExperimentReportPromptSection = {
  runId: string;
  caseId: string;
  agentId: string;
  strategy: string;
  complexityLevel: string;
  promptPath?: string;
  promptExcerpt: string;
  promptWasTruncated: boolean;
  metrics: ExperimentRun["promptMetrics"];
};

export type ExperimentReportInput = {
  generatedAt: string;
  sourceExperimentDir: string;
  title: string;
  subtitle: string;
  executiveSummary: ExperimentReportExecutiveSummary;
  methodology: string[];
  projectProfiles: ExperimentReportProjectSection[];
  benchmarkCases: ExperimentReportBenchmarkCaseSection[];
  fileTreeSections: ExperimentReportFileTreeSection[];
  promptComparisonSections: ExperimentReportPromptSection[];
  agentRunSections: ExperimentRun[];
  correctnessSections: ExperimentRun[];
  tokenSections: ExperimentComparison[];
  timingSections: ExperimentComparison[];
  comparisonSections: ExperimentComparison[];
  plotSections: Array<{ id: string; title: string; path: string; kind: string }>;
  visualizationSections: Array<{
    id: string;
    name: string;
    status: string;
    durationMs: number;
    producedArtifactPaths: string[];
    warnings: string[];
  }>;
  formulaSections: Array<{ id: string; title: string; formula: string; notes: string[] }>;
  limitations: string[];
  warnings: string[];
  artifactLinks: Array<{ label: string; path: string; kind: string }>;
  nextSteps: string[];
  rawArtifacts: {
    summary: ExperimentSummary;
    runs: ExperimentRun[];
    comparisons: ExperimentComparison[];
    config: Record<string, unknown>;
  };
};

export type ExperimentReportArtifactPaths = {
  outDir: string;
  jsonPath: string;
  htmlPath: string;
  pngPath: string;
  artifactIndexPath: string;
};

export type ExperimentReportWriteResult = {
  report: ExperimentReportInput;
  outputPaths: ExperimentReportArtifactPaths;
  screenshot: ScreenshotCaptureResult;
  warnings: string[];
};
