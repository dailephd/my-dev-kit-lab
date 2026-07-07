import type {
  ExperimentArtifact,
  ExperimentCase,
  ExperimentFailure,
  ExperimentMetric,
  ExperimentPluginMetadata,
  ExperimentRun,
  ExperimentTarget,
  ExperimentVariant,
  ExperimentWarning,
} from "../../experiments/index.js";

export type PluginExperimentReportMetadata = {
  generatedAt: string;
  runId: string;
  startedAt: string;
  completedAt: string | null;
  status: ExperimentRun["status"];
  outputRoot: string | null;
};

export type PluginExperimentReportPlugin = ExperimentPluginMetadata;

export type PluginExperimentReportTarget = ExperimentTarget & {
  mode: "self" | "external target";
};

export type PluginExperimentReportCaseSummary = {
  id: string;
  name: string;
  status: ExperimentRun["status"];
  outcomeCount: number;
  completedOutcomes: number;
  partialOutcomes: number;
  failedOutcomes: number;
  skippedOutcomes: number;
  outcomes: ExperimentCase["outcomes"];
};

export type PluginExperimentReportVariantSummary = ExperimentVariant & {
  outcomeCount: number;
  completedOutcomes: number;
  partialOutcomes: number;
  failedOutcomes: number;
  skippedOutcomes: number;
  metrics: ExperimentMetric[];
};

export type PluginExperimentReportFinding = {
  severity: "warning" | "failure" | "skip";
  code: string;
  message: string;
  caseId?: string;
  variantId?: string;
};

export type PluginExperimentReport = {
  metadata: PluginExperimentReportMetadata;
  plugin: PluginExperimentReportPlugin;
  target: PluginExperimentReportTarget;
  summary: ExperimentRun["summary"] | null;
  variants: PluginExperimentReportVariantSummary[];
  cases: PluginExperimentReportCaseSummary[];
  metrics: ExperimentMetric[];
  artifacts: ExperimentArtifact[];
  warnings: ExperimentWarning[];
  failures: ExperimentFailure[];
  skippedOutcomes: ExperimentCase["outcomes"];
  findings: PluginExperimentReportFinding[];
  interpretation: {
    summary: string;
    recommendedNextStep: string;
  };
  rawRun: ExperimentRun;
};

