import type { RetrievalQualityMetricsV1, RetrievalQualityRatioMetricV1 } from "../../../evaluation/retrievalQuality/index.js";
import type { ExperimentRunStatus } from "../../types.js";
import type { RetrievalQueryStrategyComparisonScopeId } from "../retrievalQueryStrategyComparison/analysisTypes.js";
import type { ContextPackGenerationTreatmentId } from "./metadata.js";
import type { ContextPackAvailability } from "./types.js";

/** Scopes reuse the established order and taxonomy: overall, localized, cross-module, broad-change. */
export type ContextPackGenerationScopeId = RetrievalQueryStrategyComparisonScopeId;

export type ContextPackGenerationTreatmentAnalysisV1 = {
  treatmentId: ContextPackGenerationTreatmentId;
  /** Inherited execution status; the analysis never recreates status from metric values. */
  executionStatus: ExperimentRunStatus;
  availability: ContextPackAvailability | null;
  quality: RetrievalQualityMetricsV1 | null;
  fileF1: RetrievalQualityRatioMetricV1;
  symbolF1: RetrievalQualityRatioMetricV1;
  /** Measured size from the exact rendered pack text (pack) or the raw baseline text (raw); null when unavailable. */
  estimatedTokens: number | null;
  tokenCountMethod: string | null;
};

/** Pack minus raw for quality deltas; raw minus pack for savings. Null whenever either side is unavailable; never zero. */
export type ContextPackGenerationComparisonV1 = {
  fileF1Delta: number | null;
  symbolF1Delta: number | null;
  factCoverageDelta: number | null;
  estimatedTokenDelta: number | null;
  tokensSaved: number | null;
  percentSaved: number | null;
};

export type ContextPackGenerationCaseAnalysisV1 = {
  caseId: string;
  benchmarkProject: string;
  taskLocality: string | null;
  /** Always [raw-full-file, context-pack]. */
  treatments: ContextPackGenerationTreatmentAnalysisV1[];
  comparison: ContextPackGenerationComparisonV1;
};

export type ContextPackGenerationObjectivesV1 = {
  meanFileF1: number;
  meanSymbolF1: number;
  meanFactCoverage: number;
  meanEstimatedTokenCount: number;
};

export type ContextPackGenerationScopeTreatmentSummaryV1 = {
  treatmentId: ContextPackGenerationTreatmentId;
  completedCaseCount: number;
  partialCaseCount: number;
  failedCaseCount: number;
  /** Unweighted macro means over included (matched complete) cases; null when none are included. */
  objectives: ContextPackGenerationObjectivesV1 | null;
};

export type ContextPackGenerationScopeAnalysisV1 = {
  scopeId: ContextPackGenerationScopeId;
  caseCount: number;
  includedCaseCount: number;
  excludedCaseCount: number;
  includedCaseIds: string[];
  excludedCaseIds: string[];
  treatmentSummaries: ContextPackGenerationScopeTreatmentSummaryV1[];
  /** Mean of per-case pack-minus-raw differences over included cases (equal to the difference of the means). */
  pairedDeltas: {
    meanFileF1Delta: number;
    meanSymbolF1Delta: number;
    meanFactCoverageDelta: number;
    meanEstimatedTokenDelta: number;
  } | null;
  tokenSavings: { meanTokensSaved: number; percentSavedOfMeans: number } | null;
};

export type ContextPackGenerationAnalysisV1 = {
  cases: ContextPackGenerationCaseAnalysisV1[];
  scopes: ContextPackGenerationScopeAnalysisV1[];
};
