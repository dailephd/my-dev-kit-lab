import {
  calculateRetrievalQualityMetricsFromIdentityEvidence
} from "../../../evaluation/retrievalQuality/metrics.js";
import type { RetrievalQualityRatioMetricV1 } from "../../../evaluation/retrievalQuality/types.js";
import type { EvaluationCase } from "../../../evaluation/types.js";
import { calculateBalancedIdentityF1 } from "../retrievalQueryStrategyComparison/analysis.js";
import { RETRIEVAL_QUERY_STRATEGY_COMPARISON_SCOPE_IDS } from "../retrievalQueryStrategyComparison/analysisTypes.js";
import type {
  ContextPackGenerationAnalysisV1,
  ContextPackGenerationCaseAnalysisV1,
  ContextPackGenerationComparisonV1,
  ContextPackGenerationScopeAnalysisV1,
  ContextPackGenerationScopeId,
  ContextPackGenerationScopeTreatmentSummaryV1,
  ContextPackGenerationTreatmentAnalysisV1
} from "./analysisTypes.js";
import type { ContextPackGenerationCaseEvidenceV1, ContextPackGenerationTreatmentEvidenceV1 } from "./executionTypes.js";
import { CONTEXT_PACK_GENERATION_TREATMENT_IDS } from "./metadata.js";

const noMeasurementF1 = (): RetrievalQualityRatioMetricV1 => ({
  availability: "unavailable",
  numerator: null,
  denominator: null,
  value: null,
  reason: "no-measurement"
});

/** Scores already-completed treatment evidence with the frozen retrieval-quality science. It never influences retrieval. */
export function analyzeContextPackGenerationTreatment(
  evaluationCase: EvaluationCase,
  treatment: ContextPackGenerationTreatmentEvidenceV1
): ContextPackGenerationTreatmentAnalysisV1 {
  if (treatment.identityEvidence === null || treatment.size === null) {
    return {
      treatmentId: treatment.treatmentId,
      executionStatus: treatment.status,
      availability: treatment.availability,
      quality: null,
      fileF1: noMeasurementF1(),
      symbolF1: noMeasurementF1(),
      estimatedTokens: null,
      tokenCountMethod: null
    };
  }
  const quality = calculateRetrievalQualityMetricsFromIdentityEvidence({
    evaluationCase,
    retrieval: {
      identityEvidence: treatment.identityEvidence,
      totalEstimatedTokens: treatment.size.totalEstimatedTokens,
      tokenCountMethod: treatment.size.tokenCountMethod
    }
  });
  return {
    treatmentId: treatment.treatmentId,
    executionStatus: treatment.status,
    availability: treatment.availability,
    quality,
    fileF1: calculateBalancedIdentityF1(quality.file.relevantRetrievedFiles, quality.file.irrelevantRetrievedFiles, quality.file.missedFiles),
    symbolF1: calculateBalancedIdentityF1(quality.symbol.relevantRetrievedSymbols, quality.symbol.irrelevantRetrievedSymbols, quality.symbol.missedSymbols),
    estimatedTokens: treatment.size.totalEstimatedTokens,
    tokenCountMethod: treatment.size.tokenCountMethod
  };
}

/**
 * Same arithmetic as the existing repository token-savings comparison (tokensSaved = raw - other; percentSaved =
 * tokensSaved / raw * 100, 0 when raw is 0). Negative savings are valid and never clamped.
 */
export function calculateContextPackTokenSavings(rawTokens: number, packTokens: number): { tokensSaved: number; percentSaved: number } {
  const tokensSaved = rawTokens - packTokens;
  return { tokensSaved, percentSaved: rawTokens === 0 ? 0 : (tokensSaved / rawTokens) * 100 };
}

const valueOf = (metric: RetrievalQualityRatioMetricV1 | undefined): number | null => (metric && metric.availability === "available" ? metric.value : null);

function compareTreatments(raw: ContextPackGenerationTreatmentAnalysisV1, pack: ContextPackGenerationTreatmentAnalysisV1): ContextPackGenerationComparisonV1 {
  const delta = (packValue: number | null, rawValue: number | null): number | null => (packValue === null || rawValue === null ? null : packValue - rawValue);
  const factPack = valueOf(pack.quality?.fact.coverage);
  const factRaw = valueOf(raw.quality?.fact.coverage);
  const sizes = raw.estimatedTokens !== null && pack.estimatedTokens !== null ? calculateContextPackTokenSavings(raw.estimatedTokens, pack.estimatedTokens) : null;
  return {
    fileF1Delta: delta(valueOf(pack.fileF1), valueOf(raw.fileF1)),
    symbolF1Delta: delta(valueOf(pack.symbolF1), valueOf(raw.symbolF1)),
    factCoverageDelta: delta(factPack, factRaw),
    estimatedTokenDelta: delta(pack.estimatedTokens, raw.estimatedTokens),
    tokensSaved: sizes?.tokensSaved ?? null,
    percentSaved: sizes?.percentSaved ?? null
  };
}

export function analyzeContextPackGenerationCase(
  evaluationCase: EvaluationCase,
  executionCase: ContextPackGenerationCaseEvidenceV1
): ContextPackGenerationCaseAnalysisV1 {
  if (evaluationCase.id !== executionCase.caseId) throw new Error("Context pack generation analysis case identity mismatch.");
  const order = executionCase.treatments.map((treatment) => treatment.treatmentId);
  if (order.length !== CONTEXT_PACK_GENERATION_TREATMENT_IDS.length || order.some((id, index) => id !== CONTEXT_PACK_GENERATION_TREATMENT_IDS[index])) {
    throw new Error("Context pack generation analysis requires the two canonical treatments in canonical order.");
  }
  const treatments = executionCase.treatments.map((treatment) => analyzeContextPackGenerationTreatment(evaluationCase, treatment));
  return {
    caseId: executionCase.caseId,
    benchmarkProject: executionCase.benchmarkProject,
    taskLocality: executionCase.taskLocality,
    treatments,
    comparison: compareTreatments(treatments[0], treatments[1])
  };
}

function isComparable(treatment: ContextPackGenerationTreatmentAnalysisV1): boolean {
  const quality = treatment.quality;
  return (
    quality !== null &&
    treatment.fileF1.availability === "available" &&
    treatment.symbolF1.availability === "available" &&
    quality.fact.coverage.availability === "available" &&
    typeof quality.retrievedTokenCount === "number" &&
    Number.isFinite(quality.retrievedTokenCount) &&
    quality.retrievedTokenCount >= 0
  );
}

/** Matched design: a case counts only when BOTH treatments expose all four required measures. */
export function isContextPackCaseComparable(caseAnalysis: ContextPackGenerationCaseAnalysisV1): boolean {
  return caseAnalysis.treatments.length === CONTEXT_PACK_GENERATION_TREATMENT_IDS.length && caseAnalysis.treatments.every(isComparable);
}

const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

function casesForScope(cases: readonly ContextPackGenerationCaseAnalysisV1[], scopeId: ContextPackGenerationScopeId): ContextPackGenerationCaseAnalysisV1[] {
  return scopeId === "overall" ? [...cases] : cases.filter((entry) => entry.taskLocality === scopeId);
}

export function aggregateContextPackGenerationScope(
  scopeId: ContextPackGenerationScopeId,
  cases: readonly ContextPackGenerationCaseAnalysisV1[]
): ContextPackGenerationScopeAnalysisV1 {
  const scopeCases = casesForScope(cases, scopeId);
  const included = scopeCases.filter(isContextPackCaseComparable);
  const excluded = scopeCases.filter((entry) => !isContextPackCaseComparable(entry));

  const treatmentSummaries: ContextPackGenerationScopeTreatmentSummaryV1[] = CONTEXT_PACK_GENERATION_TREATMENT_IDS.map((treatmentId, index) => {
    const countStatus = (status: string) => scopeCases.filter((entry) => entry.treatments[index].executionStatus === status).length;
    const rows = included.map((entry) => entry.treatments[index]);
    return {
      treatmentId,
      completedCaseCount: countStatus("completed"),
      partialCaseCount: countStatus("partial"),
      failedCaseCount: countStatus("failed"),
      objectives:
        rows.length === 0
          ? null
          : {
              meanFileF1: mean(rows.map((row) => row.fileF1.value as number)),
              meanSymbolF1: mean(rows.map((row) => row.symbolF1.value as number)),
              meanFactCoverage: mean(rows.map((row) => row.quality!.fact.coverage.value as number)),
              meanEstimatedTokenCount: mean(rows.map((row) => row.quality!.retrievedTokenCount as number))
            }
    };
  });

  const [rawSummary, packSummary] = treatmentSummaries;
  const rawObjectives = rawSummary.objectives;
  const packObjectives = packSummary.objectives;
  const paired = rawObjectives && packObjectives;
  return {
    scopeId,
    caseCount: scopeCases.length,
    includedCaseCount: included.length,
    excludedCaseCount: excluded.length,
    includedCaseIds: included.map((entry) => entry.caseId),
    excludedCaseIds: excluded.map((entry) => entry.caseId),
    treatmentSummaries,
    pairedDeltas: paired
      ? {
          meanFileF1Delta: mean(included.map((entry) => entry.comparison.fileF1Delta as number)),
          meanSymbolF1Delta: mean(included.map((entry) => entry.comparison.symbolF1Delta as number)),
          meanFactCoverageDelta: mean(included.map((entry) => entry.comparison.factCoverageDelta as number)),
          meanEstimatedTokenDelta: mean(included.map((entry) => entry.comparison.estimatedTokenDelta as number))
        }
      : null,
    tokenSavings: paired
      ? {
          meanTokensSaved: mean(included.map((entry) => entry.comparison.tokensSaved as number)),
          percentSavedOfMeans: calculateContextPackTokenSavings(rawObjectives.meanEstimatedTokenCount, packObjectives.meanEstimatedTokenCount).percentSaved
        }
      : null
  };
}

export function analyzeContextPackGeneration(
  evaluationCases: readonly EvaluationCase[],
  executionCases: readonly ContextPackGenerationCaseEvidenceV1[]
): ContextPackGenerationAnalysisV1 {
  if (evaluationCases.length !== executionCases.length) throw new Error("Context pack generation analysis requires one execution case per evaluation case.");
  const cases = evaluationCases.map((evaluationCase, index) => analyzeContextPackGenerationCase(evaluationCase, executionCases[index]));
  return { cases, scopes: RETRIEVAL_QUERY_STRATEGY_COMPARISON_SCOPE_IDS.map((scopeId) => aggregateContextPackGenerationScope(scopeId, cases)) };
}
