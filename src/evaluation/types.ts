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
