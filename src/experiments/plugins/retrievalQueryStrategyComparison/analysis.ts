import { RETRIEVAL_QUERY_STRATEGY_IDS, type RetrievalQueryStrategyId } from "../../../evaluation/retrievalQueryStrategies.js";
import type { RetrievalQueryStrategyEvidenceV1 } from "../../../evaluation/retrievalQueryStrategyEvidence.js";
import {
  calculateRetrievalQualityMetricsFromIdentityEvidence,
  type RetrievalQualityIdentityEvidence
} from "../../../evaluation/retrievalQuality/metrics.js";
import type { RetrievalQualityRatioMetricV1 } from "../../../evaluation/retrievalQuality/types.js";
import type { EvaluationCase } from "../../../evaluation/types.js";
import {
  RETRIEVAL_QUERY_STRATEGY_COMPARISON_SCOPE_IDS,
  type RetrievalQueryStrategyCaseAnalysisV1,
  type RetrievalQueryStrategyComparisonAnalysisV1,
  type RetrievalQueryStrategyComparisonScopeId,
  type RetrievalQueryStrategyObjectiveVectorV1,
  type RetrievalQueryStrategyScopeAnalysisV1,
  type RetrievalQueryStrategyScopeStrategySummaryV1,
  type RetrievalQueryStrategyTreatmentAnalysisV1
} from "./analysisTypes.js";
import type { RetrievalQueryStrategyComparisonCaseEvidenceV1, RetrievalQueryStrategyTreatmentEvidenceV1 } from "./types.js";

function toRetrievalQualityIdentityEvidence(evidence: RetrievalQueryStrategyEvidenceV1): RetrievalQualityIdentityEvidence {
  return {
    availability: evidence.availability,
    ...(evidence.availabilityReason !== null ? { availabilityReason: evidence.availabilityReason } : {}),
    files: evidence.files.map((file) => file.path),
    symbols: evidence.symbols.map((symbol) => ({
      name: symbol.name,
      ...(symbol.file !== null ? { file: symbol.file } : {})
    }))
  };
}

/**
 * Balanced F1 from identity-set sizes: 2TP / (2TP + FP + FN). Well defined when nothing was retrieved but
 * relevant identities exist (F1 = 0). Never averages precision and recall.
 */
export function calculateBalancedIdentityF1(
  relevant: readonly string[] | null,
  irrelevant: readonly string[] | null,
  missed: readonly string[] | null
): RetrievalQualityRatioMetricV1 {
  if (relevant === null || irrelevant === null || missed === null) {
    return { availability: "unavailable", numerator: null, denominator: null, value: null, reason: "quality-identity-sets-unavailable" };
  }
  const numerator = 2 * relevant.length;
  const denominator = numerator + irrelevant.length + missed.length;
  if (denominator === 0) {
    return { availability: "not-applicable", numerator: null, denominator: null, value: null, reason: "no-positive-or-retrieved-identities" };
  }
  return { availability: "available", numerator, denominator, value: numerator / denominator, reason: null };
}

const noMeasurementF1 = (): RetrievalQualityRatioMetricV1 => ({
  availability: "unavailable",
  numerator: null,
  denominator: null,
  value: null,
  reason: "no-retrieval-measurement"
});

/** Scores already-completed retrieval evidence. It never influences retrieval. */
export function analyzeRetrievalQueryStrategyTreatment(
  evaluationCase: EvaluationCase,
  treatment: RetrievalQueryStrategyTreatmentEvidenceV1
): RetrievalQueryStrategyTreatmentAnalysisV1 {
  if (treatment.evidence === null || treatment.retrieval === null) {
    return {
      strategyId: treatment.strategyId,
      executionStatus: treatment.status,
      quality: null,
      fileF1: noMeasurementF1(),
      symbolF1: noMeasurementF1()
    };
  }
  const quality = calculateRetrievalQualityMetricsFromIdentityEvidence({
    evaluationCase,
    retrieval: {
      identityEvidence: toRetrievalQualityIdentityEvidence(treatment.evidence),
      totalEstimatedTokens: treatment.retrieval.totalEstimatedTokens,
      tokenCountMethod: treatment.retrieval.tokenCountMethod
    }
  });
  return {
    strategyId: treatment.strategyId,
    executionStatus: treatment.status,
    quality,
    fileF1: calculateBalancedIdentityF1(quality.file.relevantRetrievedFiles, quality.file.irrelevantRetrievedFiles, quality.file.missedFiles),
    symbolF1: calculateBalancedIdentityF1(
      quality.symbol.relevantRetrievedSymbols,
      quality.symbol.irrelevantRetrievedSymbols,
      quality.symbol.missedSymbols
    )
  };
}

export function analyzeRetrievalQueryStrategyCase(
  evaluationCase: EvaluationCase,
  executionCase: RetrievalQueryStrategyComparisonCaseEvidenceV1
): RetrievalQueryStrategyCaseAnalysisV1 {
  if (evaluationCase.id !== executionCase.caseId) {
    throw new Error("Retrieval query strategy analysis case identity mismatch.");
  }
  const order = executionCase.treatments.map((treatment) => treatment.strategyId);
  if (order.length !== RETRIEVAL_QUERY_STRATEGY_IDS.length || order.some((id, index) => id !== RETRIEVAL_QUERY_STRATEGY_IDS[index])) {
    throw new Error("Retrieval query strategy analysis requires the seven canonical treatments in canonical order.");
  }
  return {
    caseId: executionCase.caseId,
    benchmarkProject: executionCase.benchmarkProject,
    taskLocality: executionCase.taskLocality,
    treatments: executionCase.treatments.map((treatment) => analyzeRetrievalQueryStrategyTreatment(evaluationCase, treatment))
  };
}

function isTreatmentComparable(treatment: RetrievalQueryStrategyTreatmentAnalysisV1): boolean {
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

/** Matched design: a case counts only when all seven strategies expose all four objectives. */
export function isCaseComparableAcrossAllStrategies(caseAnalysis: RetrievalQueryStrategyCaseAnalysisV1): boolean {
  return caseAnalysis.treatments.length === RETRIEVAL_QUERY_STRATEGY_IDS.length && caseAnalysis.treatments.every(isTreatmentComparable);
}

function casesForScope(
  cases: readonly RetrievalQueryStrategyCaseAnalysisV1[],
  scopeId: RetrievalQueryStrategyComparisonScopeId
): RetrievalQueryStrategyCaseAnalysisV1[] {
  return scopeId === "overall" ? [...cases] : cases.filter((entry) => entry.taskLocality === scopeId);
}

/** No epsilon, tolerance, rounding or weighting. */
export function paretoDominatesRetrievalStrategy(
  left: RetrievalQueryStrategyObjectiveVectorV1,
  right: RetrievalQueryStrategyObjectiveVectorV1
): boolean {
  const noWorse =
    left.meanFileF1 >= right.meanFileF1 &&
    left.meanSymbolF1 >= right.meanSymbolF1 &&
    left.meanFactCoverage >= right.meanFactCoverage &&
    left.meanRetrievedTokenCount <= right.meanRetrievedTokenCount;
  const strictlyBetter =
    left.meanFileF1 > right.meanFileF1 ||
    left.meanSymbolF1 > right.meanSymbolF1 ||
    left.meanFactCoverage > right.meanFactCoverage ||
    left.meanRetrievedTokenCount < right.meanRetrievedTokenCount;
  return noWorse && strictlyBetter;
}

/** Every nondominated strategy in the order given (canonical strategy order); never a performance ranking. */
export function findRetrievalStrategyParetoFront(
  summaries: readonly RetrievalQueryStrategyScopeStrategySummaryV1[]
): RetrievalQueryStrategyId[] {
  const candidates = summaries.filter(
    (summary): summary is RetrievalQueryStrategyScopeStrategySummaryV1 & { objectives: RetrievalQueryStrategyObjectiveVectorV1 } =>
      summary.objectives !== null
  );
  return candidates
    .filter((candidate) => !candidates.some((other) => other !== candidate && paretoDominatesRetrievalStrategy(other.objectives, candidate.objectives)))
    .map((candidate) => candidate.strategyId);
}

export function aggregateRetrievalQueryStrategyScope(
  scopeId: RetrievalQueryStrategyComparisonScopeId,
  cases: readonly RetrievalQueryStrategyCaseAnalysisV1[]
): RetrievalQueryStrategyScopeAnalysisV1 {
  const scopeCases = casesForScope(cases, scopeId);
  const comparisonCases = scopeCases.filter(isCaseComparableAcrossAllStrategies);

  const strategySummaries: RetrievalQueryStrategyScopeStrategySummaryV1[] = RETRIEVAL_QUERY_STRATEGY_IDS.map((strategyId, index) => {
    const treatmentsOfScope = scopeCases.map((entry) => entry.treatments[index]);
    const countStatus = (status: string) => treatmentsOfScope.filter((treatment) => treatment.executionStatus === status).length;
    let objectives: RetrievalQueryStrategyObjectiveVectorV1 | null = null;
    if (comparisonCases.length > 0) {
      const values = comparisonCases.map((entry) => {
        const treatment = entry.treatments[index];
        return {
          fileF1: treatment.fileF1.value as number,
          symbolF1: treatment.symbolF1.value as number,
          factCoverage: treatment.quality!.fact.coverage.value as number,
          retrievedTokens: treatment.quality!.retrievedTokenCount as number
        };
      });
      const mean = (select: (value: (typeof values)[number]) => number) => values.reduce((sum, value) => sum + select(value), 0) / values.length;
      objectives = {
        meanFileF1: mean((value) => value.fileF1),
        meanSymbolF1: mean((value) => value.symbolF1),
        meanFactCoverage: mean((value) => value.factCoverage),
        meanRetrievedTokenCount: mean((value) => value.retrievedTokens)
      };
    }
    return {
      strategyId,
      completedCaseCount: countStatus("completed"),
      partialCaseCount: countStatus("partial"),
      failedCaseCount: countStatus("failed"),
      objectives
    };
  });

  const paretoFrontStrategyIds = comparisonCases.length === 0 ? [] : findRetrievalStrategyParetoFront(strategySummaries);
  const unique = paretoFrontStrategyIds.length === 1;
  return {
    scopeId,
    caseCount: scopeCases.length,
    comparisonCaseCount: comparisonCases.length,
    excludedCaseCount: scopeCases.length - comparisonCases.length,
    comparisonCaseIds: comparisonCases.map((entry) => entry.caseId),
    strategySummaries,
    paretoFrontStrategyIds,
    bestStrategyId: unique ? paretoFrontStrategyIds[0] : null,
    interpretation: comparisonCases.length === 0 ? "unavailable" : unique ? "unique-best" : "tradeoff"
  };
}

export function analyzeRetrievalQueryStrategyComparison(
  evaluationCases: readonly EvaluationCase[],
  executionCases: readonly RetrievalQueryStrategyComparisonCaseEvidenceV1[]
): RetrievalQueryStrategyComparisonAnalysisV1 {
  if (
    evaluationCases.length !== executionCases.length ||
    evaluationCases.some((evaluationCase, index) => evaluationCase.id !== executionCases[index].caseId)
  ) {
    throw new Error("Retrieval query strategy analysis requires matching selected case IDs in the same order.");
  }
  const cases = evaluationCases.map((evaluationCase, index) => analyzeRetrievalQueryStrategyCase(evaluationCase, executionCases[index]));
  return {
    cases,
    scopes: RETRIEVAL_QUERY_STRATEGY_COMPARISON_SCOPE_IDS.map((scopeId) => aggregateRetrievalQueryStrategyScope(scopeId, cases))
  };
}
