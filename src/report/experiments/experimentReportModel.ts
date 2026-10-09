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
import type { ContextStrategyComparisonV043ReportV1 } from "./contextStrategyComparisonV043ReportModel.js";
import type { WarmIndexReuseReportV1 } from "./warmIndexReuseReportModel.js";
import type { IncrementalChangeStalenessReportV1 } from "./incrementalChangeStalenessReportModel.js";
import type { IncrementalChangeStalenessReportV2 } from "./incrementalChangeStalenessReportModelV2.js";
import type { ContextWindowScalingReportV1 } from "./contextWindowScalingReportModel.js";
import type { RetrievalPrecisionRecallReportV1 } from "./retrievalPrecisionRecallReportModel.js";
import type { RetrievalQueryStrategyComparisonReportV1 } from "./retrievalQueryStrategyComparisonReportModel.js";
import type { ContextPackGenerationReportV1 } from "./contextPackGenerationReportModel.js";
import type { AgentSuccessRateReportV1 } from "./agentSuccessRateReportModel.js";

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
  /** Populated for warm-index-reuse runs; null for every other plugin. */
  warmIndexReuse: WarmIndexReuseReportV1 | null;
  /** Populated for incremental-change-staleness runs; null for every other plugin. */
  incrementalChangeStaleness: IncrementalChangeStalenessReportV1 | IncrementalChangeStalenessReportV2 | null;
  /** Populated for context-window-scaling runs; null for every other plugin. */
  contextWindowScaling: ContextWindowScalingReportV1 | null;
  /** Populated for retrieval-precision-recall runs; null for every other plugin. */
  retrievalPrecisionRecall: RetrievalPrecisionRecallReportV1 | null;
  /** Populated only for retrieval-query-strategy-comparison runs; null for every other plugin. */
  retrievalQueryStrategyComparison: RetrievalQueryStrategyComparisonReportV1 | null;
  /** Populated only for context-pack-generation runs; null for every other plugin. */
  contextPackGeneration: ContextPackGenerationReportV1 | null;
  /** Populated only for agent-success-rate runs; null for every other plugin. */
  agentSuccessRate?: AgentSuccessRateReportV1 | null;
  contextStrategyComparisonV043: ContextStrategyComparisonV043ReportV1 | null;
  interpretation: {
    summary: string;
    recommendedNextStep: string;
  };
  rawRun: ExperimentRun;
};

