import type { RetrievalQualityMetricsV1, RetrievalQualityRatioMetricV1 } from "../../../evaluation/retrievalQuality/index.js";
import type { ExperimentMetric, ExperimentRunStatus } from "../../types.js";
import {
  RETRIEVAL_PRECISION_RECALL_RATIO_KEYS,
  type RetrievalPrecisionRecallAggregateV1,
  type RetrievalPrecisionRecallCaseEvidenceV1,
  type RetrievalPrecisionRecallRatioAggregateV1,
  type RetrievalPrecisionRecallRatioKey,
  type RetrievalPrecisionRecallTokenAggregateV1
} from "./types.js";

const UNAVAILABLE_RATIO: RetrievalQualityRatioMetricV1 = {
  availability: "unavailable",
  numerator: null,
  denominator: null,
  value: null,
  reason: "no-retrieval-measurement"
};

/** Per-case ratio selector. A failed case has no quality result and is counted as unavailable, never as zero. */
export function retrievalRatioOf(quality: RetrievalQualityMetricsV1 | null, key: RetrievalPrecisionRecallRatioKey): RetrievalQualityRatioMetricV1 {
  if (quality === null) return UNAVAILABLE_RATIO;
  switch (key) {
    case "filePrecision":
      return quality.file.precision;
    case "fileRecall":
      return quality.file.recall;
    case "symbolPrecision":
      return quality.symbol.precision;
    case "symbolRecall":
      return quality.symbol.recall;
    case "factCoverage":
      return quality.fact.coverage;
    case "irrelevantContextRatio":
      return quality.irrelevantContextRatio;
  }
}

function aggregateRatio(metrics: readonly RetrievalQualityRatioMetricV1[]): RetrievalPrecisionRecallRatioAggregateV1 {
  const available = metrics.filter((metric) => metric.availability === "available" && typeof metric.value === "number");
  return {
    availableCount: available.length,
    unavailableCount: metrics.filter((metric) => metric.availability === "unavailable").length,
    notApplicableCount: metrics.filter((metric) => metric.availability === "not-applicable").length,
    meanValue: available.length === 0 ? null : available.reduce((sum, metric) => sum + (metric.value as number), 0) / available.length
  };
}

function aggregateTokens(cases: readonly RetrievalPrecisionRecallCaseEvidenceV1[]): RetrievalPrecisionRecallTokenAggregateV1 {
  const counts = cases
    .map((entry) => entry.quality?.retrievedTokenCount)
    .filter((count): count is number => typeof count === "number" && Number.isFinite(count) && count >= 0);
  const total = counts.reduce((sum, count) => sum + count, 0);
  return {
    availableCount: counts.length,
    unavailableCount: cases.length - counts.length,
    totalTokens: counts.length === 0 ? null : total,
    meanTokens: counts.length === 0 ? null : total / counts.length,
    minTokens: counts.length === 0 ? null : Math.min(...counts),
    maxTokens: counts.length === 0 ? null : Math.max(...counts)
  };
}

const countStatus = (cases: readonly RetrievalPrecisionRecallCaseEvidenceV1[], status: ExperimentRunStatus) =>
  cases.filter((entry) => entry.status === status).length;

/**
 * Pure macro aggregation over per-case Batch 2 results. It never recalculates a per-case metric, never weights by
 * denominators, and never produces a score, winner, ranking or threshold.
 */
export function aggregateRetrievalPrecisionRecall(cases: readonly RetrievalPrecisionRecallCaseEvidenceV1[]): RetrievalPrecisionRecallAggregateV1 {
  const ratios = Object.fromEntries(
    RETRIEVAL_PRECISION_RECALL_RATIO_KEYS.map((key) => [key, aggregateRatio(cases.map((entry) => retrievalRatioOf(entry.quality, key)))])
  ) as RetrievalPrecisionRecallAggregateV1["ratios"];

  const sumLists = (select: (quality: RetrievalQualityMetricsV1) => readonly string[] | null) => {
    let total = 0;
    let evidenceCases = 0;
    for (const entry of cases) {
      const list = entry.quality === null ? null : select(entry.quality);
      if (list === null) continue;
      total += list.length;
      evidenceCases += 1;
    }
    return { total, evidenceCases };
  };
  const missedFiles = sumLists((quality) => quality.file.missedFiles);
  const irrelevantFiles = sumLists((quality) => quality.file.irrelevantRetrievedFiles);
  const missedSymbols = sumLists((quality) => quality.symbol.missedSymbols);
  const irrelevantSymbols = sumLists((quality) => quality.symbol.irrelevantRetrievedSymbols);
  const uncoveredFacts = sumLists((quality) => quality.fact.uncoveredFactIds);

  const evidenceCount = (availability: string) => cases.filter((entry) => entry.retrieval?.evidenceAvailability === availability).length;
  return {
    runSummary: {
      projectCount: new Set(cases.map((entry) => entry.benchmarkProject)).size,
      caseCount: cases.length,
      completedCaseCount: countStatus(cases, "completed"),
      partialCaseCount: countStatus(cases, "partial"),
      failedCaseCount: countStatus(cases, "failed"),
      retrievalEvidenceAvailableCaseCount: evidenceCount("available"),
      retrievalEvidencePartialCaseCount: evidenceCount("partial"),
      retrievalEvidenceUnavailableCaseCount: cases.filter(
        (entry) => entry.retrieval !== null && entry.retrieval.evidenceAvailability !== "available" && entry.retrieval.evidenceAvailability !== "partial"
      ).length
    },
    ratios,
    tokens: aggregateTokens(cases),
    occurrences: {
      totalMissedFileOccurrences: missedFiles.total,
      totalMissedSymbolOccurrences: missedSymbols.total,
      totalUncoveredFactOccurrences: uncoveredFacts.total,
      totalIrrelevantRetrievedFileOccurrences: irrelevantFiles.total,
      totalIrrelevantRetrievedSymbolOccurrences: irrelevantSymbols.total,
      fileOccurrenceEvidenceCaseCount: missedFiles.evidenceCases,
      symbolOccurrenceEvidenceCaseCount: missedSymbols.evidenceCases,
      factOccurrenceEvidenceCaseCount: uncoveredFacts.evidenceCases
    }
  };
}

const RATIO_METRIC_IDS: Record<RetrievalPrecisionRecallRatioKey, { id: string; name: string }> = {
  filePrecision: { id: "file-precision", name: "File precision" },
  fileRecall: { id: "file-recall", name: "File recall" },
  symbolPrecision: { id: "symbol-precision", name: "Symbol precision" },
  symbolRecall: { id: "symbol-recall", name: "Symbol recall" },
  factCoverage: { id: "fact-coverage", name: "Fact coverage" },
  irrelevantContextRatio: { id: "irrelevant-context-ratio", name: "Irrelevant context ratio" }
};

/** Run-level generic metric projection. Ratios stay canonical (0..1, never percent); null means no available evidence. */
export function toRetrievalPrecisionRecallRunMetrics(aggregate: RetrievalPrecisionRecallAggregateV1): ExperimentMetric[] {
  const summary = aggregate.runSummary;
  const occurrences = aggregate.occurrences;
  return [
    { id: "case-count", name: "Cases", value: summary.caseCount, unit: "count" },
    { id: "completed-case-count", name: "Completed cases", value: summary.completedCaseCount, unit: "count" },
    { id: "partial-case-count", name: "Partial cases", value: summary.partialCaseCount, unit: "count" },
    { id: "failed-case-count", name: "Failed cases", value: summary.failedCaseCount, unit: "count" },
    ...RETRIEVAL_PRECISION_RECALL_RATIO_KEYS.map((key) => ({
      id: `mean-${RATIO_METRIC_IDS[key].id}`,
      name: `Mean ${RATIO_METRIC_IDS[key].name.toLowerCase()}`,
      value: aggregate.ratios[key].meanValue,
      unit: "ratio"
    })),
    { id: "total-retrieved-tokens", name: "Total retrieved tokens", value: aggregate.tokens.totalTokens, unit: "tokens" },
    { id: "mean-retrieved-tokens", name: "Mean retrieved tokens", value: aggregate.tokens.meanTokens, unit: "tokens" },
    { id: "total-missed-file-occurrences", name: "Total missed file occurrences", value: occurrences.totalMissedFileOccurrences, unit: "count" },
    { id: "total-missed-symbol-occurrences", name: "Total missed symbol occurrences", value: occurrences.totalMissedSymbolOccurrences, unit: "count" },
    { id: "total-uncovered-fact-occurrences", name: "Total uncovered fact occurrences", value: occurrences.totalUncoveredFactOccurrences, unit: "count" },
    { id: "total-irrelevant-file-occurrences", name: "Total irrelevant file occurrences", value: occurrences.totalIrrelevantRetrievedFileOccurrences, unit: "count" }
  ];
}

/** Per-case metric projection for the single variant; unavailable and not-applicable ratios project as null. */
export function toRetrievalPrecisionRecallOutcomeMetrics(quality: RetrievalQualityMetricsV1 | null, variantId: string, caseId: string): ExperimentMetric[] {
  const base = { variantId, caseId };
  const ratio = (key: RetrievalPrecisionRecallRatioKey): ExperimentMetric => ({
    ...base,
    id: RATIO_METRIC_IDS[key].id,
    name: RATIO_METRIC_IDS[key].name,
    value: retrievalRatioOf(quality, key).value,
    unit: "ratio"
  });
  const count = (id: string, name: string, value: number | null | undefined): ExperimentMetric => ({
    ...base,
    id,
    name,
    value: value ?? null,
    unit: "count"
  });
  return [
    ...RETRIEVAL_PRECISION_RECALL_RATIO_KEYS.map(ratio),
    { ...base, id: "retrieved-token-count", name: "Retrieved token count", value: quality?.retrievedTokenCount ?? null, unit: "tokens" },
    count("missed-file-count", "Missed file count", quality?.file.missedFileCount),
    count("missed-symbol-count", "Missed symbol count", quality?.symbol.missedSymbolCount),
    count("uncovered-fact-count", "Uncovered fact count", quality?.fact.uncoveredFactCount),
    count("irrelevant-retrieved-file-count", "Irrelevant retrieved file count", quality?.file.irrelevantRetrievedFiles?.length),
    count("irrelevant-retrieved-symbol-count", "Irrelevant retrieved symbol count", quality?.symbol.irrelevantRetrievedSymbols?.length)
  ];
}
