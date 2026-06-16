import type { LabReportInput } from "../report/types.js";
import type { MeasuredCommandResult } from "../core/runMeasuredCommand.js";
import type { tokenCountMethod } from "../core/countTokens.js";
import type { ScreenshotCaptureResult } from "../screenshot/types.js";

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
  durationMs: number;
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
