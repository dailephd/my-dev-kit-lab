import type { RetrievalQualityRatioMetricV1 } from "../../../evaluation/retrievalQuality/types.js";
import { RETRIEVAL_QUERY_STRATEGY_IDS } from "../../../evaluation/retrievalQueryStrategies.js";
import type { ExperimentMetric } from "../../types.js";
import type { RetrievalQueryStrategyComparisonAnalysisV1, RetrievalQueryStrategyTreatmentAnalysisV1 } from "./analysisTypes.js";

/** Projects already-calculated scientific values onto generic metrics. Owns no formula. */
export function toRetrievalQueryStrategyOutcomeMetrics(
  treatment: RetrievalQueryStrategyTreatmentAnalysisV1,
  caseId: string
): ExperimentMetric[] {
  const base = { variantId: treatment.strategyId, caseId };
  const quality = treatment.quality;
  const ratio = (id: string, name: string, metric: RetrievalQualityRatioMetricV1 | undefined): ExperimentMetric => ({
    ...base,
    id,
    name,
    value: metric?.value ?? null,
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
    ratio("file-precision", "File precision", quality?.file.precision),
    ratio("file-recall", "File recall", quality?.file.recall),
    ratio("file-f1", "File F1", treatment.fileF1),
    ratio("symbol-precision", "Symbol precision", quality?.symbol.precision),
    ratio("symbol-recall", "Symbol recall", quality?.symbol.recall),
    ratio("symbol-f1", "Symbol F1", treatment.symbolF1),
    ratio("fact-coverage", "Fact coverage", quality?.fact.coverage),
    ratio("irrelevant-context-ratio", "Irrelevant context ratio", quality?.irrelevantContextRatio),
    { ...base, id: "retrieved-token-count", name: "Retrieved token count", value: quality?.retrievedTokenCount ?? null, unit: "tokens" },
    count("missed-file-count", "Missed file count", quality?.file.missedFileCount),
    count("missed-symbol-count", "Missed symbol count", quality?.symbol.missedSymbolCount),
    count("uncovered-fact-count", "Uncovered fact count", quality?.fact.uncoveredFactCount),
    count("irrelevant-retrieved-file-count", "Irrelevant retrieved file count", quality?.file.irrelevantRetrievedFiles?.length),
    count("irrelevant-retrieved-symbol-count", "Irrelevant retrieved symbol count", quality?.symbol.irrelevantRetrievedSymbols?.length)
  ];
}

/** Per scope: one matched-case count, then four objective means per strategy in canonical order. No best/rank/score metric. */
export function toRetrievalQueryStrategyRunMetrics(analysis: RetrievalQueryStrategyComparisonAnalysisV1): ExperimentMetric[] {
  const metrics: ExperimentMetric[] = [];
  for (const scope of analysis.scopes) {
    const { scopeId } = scope;
    metrics.push({
      id: `${scopeId}-comparison-case-count`,
      name: `${scopeId} matched comparison cases`,
      value: scope.comparisonCaseCount,
      unit: "count"
    });
    for (const strategyId of RETRIEVAL_QUERY_STRATEGY_IDS) {
      const objectives = scope.strategySummaries.find((summary) => summary.strategyId === strategyId)?.objectives ?? null;
      metrics.push(
        { id: `${scopeId}-mean-file-f1`, name: `${scopeId} mean file F1`, value: objectives?.meanFileF1 ?? null, unit: "ratio", variantId: strategyId },
        { id: `${scopeId}-mean-symbol-f1`, name: `${scopeId} mean symbol F1`, value: objectives?.meanSymbolF1 ?? null, unit: "ratio", variantId: strategyId },
        { id: `${scopeId}-mean-fact-coverage`, name: `${scopeId} mean fact coverage`, value: objectives?.meanFactCoverage ?? null, unit: "ratio", variantId: strategyId },
        {
          id: `${scopeId}-mean-retrieved-token-count`,
          name: `${scopeId} mean retrieved token count`,
          value: objectives?.meanRetrievedTokenCount ?? null,
          unit: "tokens",
          variantId: strategyId
        }
      );
    }
  }
  return metrics;
}
