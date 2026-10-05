import type { LabReportInput } from "../report/types.js";
import type { MeasuredCommandResult } from "../core/runMeasuredCommand.js";
import type { tokenCountMethod } from "../core/countTokens.js";
import type { ScreenshotCaptureResult } from "../screenshot/types.js";
import type { RetrievalEvidenceV1 } from "./retrievalQuality/types.js";

export const TASK_LOCALITIES = ["localized", "cross-module", "broad-change"] as const;

export type TaskLocality = (typeof TASK_LOCALITIES)[number];

export type EvaluationCaseInput = {
  id: string;
  title: string;
  benchmarkProject: string;
  targetRoot: string;
  sourceRoots: string[];
  query: string;
  expectedFiles: string[];
  expectedSymbols: string[];
  rawIncludeGlobs: string[];
  answerKey?: BenchmarkTaskAnswerKey;
  expectedFacts?: ExpectedAnswerFact[];
  expectedFilesByProject?: Record<string, string[]>;
  expectedOperation?: string;
  projectProfileRef?: string;
  taskLocality?: TaskLocality;
  promptComplexityHint?: string;
  projectComplexityRelevance?: string;
  notes?: string;
};

export type EvaluationCase = EvaluationCaseInput & {
  absoluteTargetRoot: string;
};

export type RawFullFileBaselineResult = {
  caseId: string;
  targetRoot: string;
  filesIncluded: string[];
  totalFiles: number;
  totalChars: number;
  totalEstimatedTokens: number;
  tokenCountMethod: typeof tokenCountMethod;
  contextText: string;
  durationMs: number;
};

export type MyDevKitRetrievalResult = {
  caseId: string;
  skipped: boolean;
  warnings: string[];
  totalChars: number;
  totalEstimatedTokens: number;
  tokenCountMethod: typeof tokenCountMethod;
  contextText: string;
  filesRead: string[];
  commands: MeasuredCommandResult[];
  selectedNodeId?: string;
  selectedFile?: string;
  selectedSymbol?: string;
  /**
   * Normalized observation of the files and symbols the search/lookup/slice/source commands surfaced.
   * Additive and internal: it holds no source text, raw output, or machine-local paths. No artifact writer is
   * changed to emit it; any future durable use of it for external-local subjects needs privacy projection.
   */
  retrievalEvidence?: RetrievalEvidenceV1;
  durationMs: number;
};

/** Target identity a my-dev-kit index is built from: one root plus its ordered source roots. */
export type MyDevKitIndexTarget = Pick<EvaluationCase, "absoluteTargetRoot" | "sourceRoots">;

/** Outcome of one my-dev-kit `index` invocation, measured separately from any retrieval. */
export type MyDevKitRefreshScope = "changed-files" | "affected-neighborhood";

export type MyDevKitAppliedRefreshScope = "none" | "changed-files" | "affected-neighborhood" | "full";

export type MyDevKitRefreshSelectionStatus = "not-needed" | "applied" | "fallback-full";

/** Requested index build mode. `full` is the ordinary complete index without `--incremental`. */
export type MyDevKitIndexBuildMode =
  | { kind: "full" }
  | { kind: "incremental"; refreshScope: MyDevKitRefreshScope };

/** Lab's typed interpretation of the per-invocation `incrementalRefresh` object from my-dev-kit >= 1.12.5. */
export type MyDevKitIncrementalRefreshEvidence = {
  requestedScope: MyDevKitRefreshScope;
  appliedScope: MyDevKitAppliedRefreshScope;
  selectionStatus: MyDevKitRefreshSelectionStatus;
  fallbackReason: string | null;
  seedFileCount: number | null;
  seedSymbolCount: number | null;
  affectedNodeCount: number | null;
  affectedEdgeCount: number | null;
  forcedNeighborReanalysisFileCount: number;
  forcedNeighborSample: string[];
  freshExtractionFileCount: number;
  reusedFileCount: number;
};

export type MyDevKitIndexBuildResult = {
  ok: boolean;
  indexDir: string;
  durationMs: number;
  warnings: string[];
  command: MeasuredCommandResult;
  /** The requested build mode (defaults to `full`). */
  mode: MyDevKitIndexBuildMode;
  /** Validated upstream evidence; `null` for full builds and for any incremental build without valid evidence. */
  incrementalRefresh: MyDevKitIncrementalRefreshEvidence | null;
};

export type TokenSavingsCaseResult = {
  caseId: string;
  title: string;
  benchmarkProject: string;
  rawChars: number;
  rawEstimatedTokens: number;
  myDevKitChars: number;
  myDevKitEstimatedTokens: number;
  tokensSaved: number;
  percentSaved: number;
  filesReadRaw: number;
  filesReadMyDevKit: number;
  commandsRun: number;
  durationMsRaw: number;
  durationMsMyDevKit: number;
  skipped: boolean;
  warnings: string[];
};

export type TokenSavingsSummary = {
  caseCount: number;
  completedCaseCount: number;
  skippedCaseCount: number;
  averageRawTokens: number;
  averageMyDevKitTokens: number;
  averageTokensSaved: number;
  averagePercentSaved: number;
  totalRawTokens: number;
  totalMyDevKitTokens: number;
  totalTokensSaved: number;
  totalCommandsRun: number;
  totalDurationMs: number;
  tokenCountMethod: typeof tokenCountMethod;
  warnings: string[];
};

export type TokenSavingsRunRecord = {
  case: EvaluationCaseInput;
  rawBaseline: Omit<RawFullFileBaselineResult, "contextText">;
  myDevKit: Omit<MyDevKitRetrievalResult, "contextText"> & {
    commandTelemetry: Array<Pick<MeasuredCommandResult, "commandId" | "stdoutPath" | "stderrPath" | "telemetryPath" | "exitCode" | "ok">>;
  };
  comparison: TokenSavingsCaseResult;
};

export type TokenSavingsArtifacts = {
  summary: TokenSavingsSummary;
  runs: TokenSavingsRunRecord[];
  report: LabReportInput;
  screenshot: ScreenshotCaptureResult;
  artifactPaths: {
    summaryPath: string;
    runsPath: string;
    htmlPath: string;
    pngPath: string;
  };
  warnings: string[];
};

export type TokenSavingsCommandConfig = {
  casesPath: string;
  kitCommand: string;
  requireKit: boolean;
  noScreenshot: boolean;
  outputDir: string;
};

export type ProjectComplexityLevel = "small" | "medium" | "large" | "mixed-language";

export type ProjectFileTreeEntry = {
  path: string;
  kind: "file" | "directory";
  role: "source" | "test" | "config" | "docs" | "contract" | "other";
  language?: string;
  lines?: number;
};

export type ProjectFileTree = {
  entries: ProjectFileTreeEntry[];
};

export type ProjectComplexityMetrics = {
  fileCount: number;
  sourceFileCount: number;
  testFileCount: number;
  totalLinesOfCode: number;
  sourceLinesOfCode: number;
  testLinesOfCode: number;
  languageCount: number;
  dependencyFileCount: number;
  internalImportCount: number;
  exportedSymbolEstimate: number;
  taskCount: number;
  expectedRelevantFilesAverage: number;
  expectedRelevantSymbolsAverage: number;
  maxFileLines: number;
  averageFileLines: number;
  packageDependencyCount?: number;
  functionOrClassEstimate?: number;
  callGraphEdgeEstimate?: number;
};

export type ProjectComplexityFormula = {
  id: string;
  description: string;
  scoreRange: [number, number];
  normalizedValue: string;
  weights: {
    sourceFileCount: number;
    sourceLinesOfCode: number;
    languageCount: number;
    internalImportCount: number;
    maxFileLines: number;
    expectedRelevantFilesAverage: number;
    expectedRelevantSymbolsAverage: number;
  };
  caps: {
    sourceFileCount: number;
    sourceLinesOfCode: number;
    languageCount: number;
    internalImportCount: number;
    maxFileLines: number;
    expectedRelevantFilesAverage: number;
    expectedRelevantSymbolsAverage: number;
  };
};

export type BenchmarkProjectProfile = {
  projectId: string;
  displayName: string;
  description: string;
  languageMix: string;
  primaryLanguage: string;
  languages: string[];
  complexityLevel: ProjectComplexityLevel;
  complexityScore: number;
  complexityMetrics: ProjectComplexityMetrics;
  complexityFormula: ProjectComplexityFormula;
  rootPath: string;
  sourceRoots: string[];
  testRoots: string[];
  fileTree: ProjectFileTree;
  benchmarkPurpose: string;
  expectedUseCases: string[];
};

export type BenchmarkProjectProfilesContract = {
  schemaVersion: string;
  profiles: BenchmarkProjectProfile[];
};

export type ExpectedAnswerFact = {
  id: string;
  text: string;
  weight: number;
  required: boolean;
};

export type ExpectedContextTarget = {
  projectId?: string;
  file: string;
  symbols?: string[];
  required?: boolean;
  /**
   * Ids of `expectedFacts` this target supports. Explicit mapping that lets retrieval fact coverage be computed
   * deterministically; targets without it remain valid but carry no fact-coverage evidence.
   */
  factIds?: string[];
};

export type BenchmarkTaskAnswerKey = {
  expectedFiles: string[];
  expectedSymbols: string[];
  expectedFacts: ExpectedAnswerFact[];
  expectedContextTargets?: ExpectedContextTarget[];
  forbiddenWrongClaims?: string[];
  minimumCorrectFacts: number;
  notes?: string;
};

export type BenchmarkMetadataValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};
