import type { RetrievalQueryStrategyId } from "../../../evaluation/retrievalQueryStrategies.js";
import type { RetrievalQualityMetricsV1, RetrievalQualityRatioMetricV1 } from "../../../evaluation/retrievalQuality/index.js";
import type { ExperimentRunStatus } from "../../types.js";

/** Comparison scopes, in output order. Named scopes reuse the existing TASK_LOCALITIES taxonomy. */
export const RETRIEVAL_QUERY_STRATEGY_COMPARISON_SCOPE_IDS = ["overall", "localized", "cross-module", "broad-change"] as const;

export type RetrievalQueryStrategyComparisonScopeId = (typeof RETRIEVAL_QUERY_STRATEGY_COMPARISON_SCOPE_IDS)[number];

export type RetrievalQueryStrategyTreatmentAnalysisV1 = {
  strategyId: RetrievalQueryStrategyId;
  /** Inherited execution status; the analysis never recreates status from metric values. */
  executionStatus: ExperimentRunStatus;
  quality: RetrievalQualityMetricsV1 | null;
  fileF1: RetrievalQualityRatioMetricV1;
  symbolF1: RetrievalQualityRatioMetricV1;
};

export type RetrievalQueryStrategyCaseAnalysisV1 = {
  caseId: string;
  benchmarkProject: string;
  taskLocality: string | null;
  /** Always the canonical seven-strategy order. */
  treatments: RetrievalQueryStrategyTreatmentAnalysisV1[];
};

/** The only four Pareto objectives. Higher is better except meanRetrievedTokenCount. */
export type RetrievalQueryStrategyObjectiveVectorV1 = {
  meanFileF1: number;
  meanSymbolF1: number;
  meanFactCoverage: number;
  meanRetrievedTokenCount: number;
};

export type RetrievalQueryStrategyScopeStrategySummaryV1 = {
  strategyId: RetrievalQueryStrategyId;
  completedCaseCount: number;
  partialCaseCount: number;
  failedCaseCount: number;
  objectives: RetrievalQueryStrategyObjectiveVectorV1 | null;
};

export type RetrievalQueryStrategyScopeInterpretation = "unique-best" | "tradeoff" | "unavailable";

export type RetrievalQueryStrategyScopeAnalysisV1 = {
  scopeId: RetrievalQueryStrategyComparisonScopeId;
  caseCount: number;
  comparisonCaseCount: number;
  excludedCaseCount: number;
  comparisonCaseIds: string[];
  strategySummaries: RetrievalQueryStrategyScopeStrategySummaryV1[];
  paretoFrontStrategyIds: RetrievalQueryStrategyId[];
  bestStrategyId: RetrievalQueryStrategyId | null;
  interpretation: RetrievalQueryStrategyScopeInterpretation;
};

export type RetrievalQueryStrategyComparisonAnalysisV1 = {
  cases: RetrievalQueryStrategyCaseAnalysisV1[];
  scopes: RetrievalQueryStrategyScopeAnalysisV1[];
};
