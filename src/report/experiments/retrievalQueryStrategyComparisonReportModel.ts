import type { RetrievalQualityMetricAvailability } from "../../evaluation/retrievalQuality/index.js";
import type { RetrievalQueryStrategyId } from "../../evaluation/retrievalQueryStrategies.js";
import type { RetrievalQueryStrategyEvidenceAvailability } from "../../evaluation/retrievalQueryStrategyEvidence.js";
import type { ExperimentRunStatus } from "../../experiments/index.js";
import type { RetrievalQueryStrategyComparisonMethodologyV1 } from "../../experiments/plugins/retrievalQueryStrategyComparison/analysisArtifact.js";
import type {
  RetrievalQueryStrategyComparisonScopeId,
  RetrievalQueryStrategyObjectiveVectorV1,
  RetrievalQueryStrategyScopeInterpretation
} from "../../experiments/plugins/retrievalQueryStrategyComparison/analysisTypes.js";

export const RETRIEVAL_QUERY_STRATEGY_COMPARISON_REPORT_SCHEMA_VERSION = "my-dev-kit-lab-retrieval-query-strategy-comparison-report-v1";

export type RetrievalQueryStrategyComparisonReportMetricV1 = {
  availability: RetrievalQualityMetricAvailability;
  numerator: number | null;
  denominator: number | null;
  value: number | null;
  reason: string | null;
};

export type RetrievalQueryStrategyComparisonReportTreatmentV1 = {
  strategyId: RetrievalQueryStrategyId;
  executionStatus: ExperimentRunStatus;
  evidenceAvailability: RetrievalQueryStrategyEvidenceAvailability | null;
  filePrecision: RetrievalQueryStrategyComparisonReportMetricV1;
  fileRecall: RetrievalQueryStrategyComparisonReportMetricV1;
  fileF1: RetrievalQueryStrategyComparisonReportMetricV1;
  symbolPrecision: RetrievalQueryStrategyComparisonReportMetricV1;
  symbolRecall: RetrievalQueryStrategyComparisonReportMetricV1;
  symbolF1: RetrievalQueryStrategyComparisonReportMetricV1;
  factCoverage: RetrievalQueryStrategyComparisonReportMetricV1;
  irrelevantContextRatio: RetrievalQueryStrategyComparisonReportMetricV1;
  retrievedTokenCount: number | null;
  tokenCountMethod: string | null;
};

export type RetrievalQueryStrategyComparisonReportCaseV1 = {
  caseId: string;
  /** For external-local reports this is already the redacted placeholder; the original is never recovered. */
  caseName: string;
  benchmarkProject: string;
  taskLocality: string | null;
  treatments: RetrievalQueryStrategyComparisonReportTreatmentV1[];
};

export type RetrievalQueryStrategyComparisonReportScopeStrategyV1 = {
  strategyId: RetrievalQueryStrategyId;
  completedCaseCount: number;
  partialCaseCount: number;
  failedCaseCount: number;
  objectives: RetrievalQueryStrategyObjectiveVectorV1 | null;
};

export type RetrievalQueryStrategyComparisonReportScopeV1 = {
  scopeId: RetrievalQueryStrategyComparisonScopeId;
  caseCount: number;
  comparisonCaseCount: number;
  excludedCaseCount: number;
  comparisonCaseIds: string[];
  strategySummaries: RetrievalQueryStrategyComparisonReportScopeStrategyV1[];
  paretoFrontStrategyIds: RetrievalQueryStrategyId[];
  bestStrategyId: RetrievalQueryStrategyId | null;
  interpretation: RetrievalQueryStrategyScopeInterpretation;
};

export type RetrievalQueryStrategyComparisonReportV1 = {
  schemaVersion: typeof RETRIEVAL_QUERY_STRATEGY_COMPARISON_REPORT_SCHEMA_VERSION;
  methodology: RetrievalQueryStrategyComparisonMethodologyV1;
  strategyOrder: RetrievalQueryStrategyId[];
  identityRedaction: "external-local-redacted" | null;
  scopes: RetrievalQueryStrategyComparisonReportScopeV1[];
  cases: RetrievalQueryStrategyComparisonReportCaseV1[];
  limitations: string[];
};
