import type { RetrievalQualityRatioMetricV1 } from "../../../evaluation/retrievalQuality/types.js";
import type { ExperimentMetric } from "../../types.js";
import type { ContextPackGenerationAnalysisV1, ContextPackGenerationCaseAnalysisV1, ContextPackGenerationTreatmentAnalysisV1 } from "./analysisTypes.js";
import { CONTEXT_PACK_GENERATION_TREATMENT_IDS } from "./metadata.js";

/** Projects already-calculated scientific values onto generic metrics. Owns no formula. */
export function toContextPackGenerationOutcomeMetrics(treatment: ContextPackGenerationTreatmentAnalysisV1, caseId: string): ExperimentMetric[] {
  const base = { variantId: treatment.treatmentId, caseId };
  const quality = treatment.quality;
  const ratio = (id: string, name: string, metric: RetrievalQualityRatioMetricV1 | undefined): ExperimentMetric => ({ ...base, id, name, value: metric?.value ?? null, unit: "ratio" });
  const count = (id: string, name: string, value: number | null | undefined): ExperimentMetric => ({ ...base, id, name, value: value ?? null, unit: "count" });
  return [
    ratio("file-precision", "File precision", quality?.file.precision),
    ratio("file-recall", "File recall", quality?.file.recall),
    ratio("file-f1", "File F1", treatment.fileF1),
    ratio("symbol-precision", "Symbol precision", quality?.symbol.precision),
    ratio("symbol-recall", "Symbol recall", quality?.symbol.recall),
    ratio("symbol-f1", "Symbol F1", treatment.symbolF1),
    ratio("fact-coverage", "Fact coverage", quality?.fact.coverage),
    ratio("irrelevant-context-ratio", "Irrelevant context ratio", quality?.irrelevantContextRatio),
    { ...base, id: "estimated-token-count", name: "Estimated token count", value: treatment.estimatedTokens, unit: "tokens" },
    count("missed-file-count", "Missed file count", quality?.file.missedFileCount),
    count("missed-symbol-count", "Missed symbol count", quality?.symbol.missedSymbolCount),
    count("uncovered-fact-count", "Uncovered fact count", quality?.fact.uncoveredFactCount)
  ];
}

export function toContextPackGenerationCaseComparisonMetrics(caseAnalysis: ContextPackGenerationCaseAnalysisV1): ExperimentMetric[] {
  const { comparison, caseId } = caseAnalysis;
  return [
    { id: "file-f1-delta", name: "File F1 delta (pack minus raw)", value: comparison.fileF1Delta, unit: "ratio", caseId },
    { id: "symbol-f1-delta", name: "Symbol F1 delta (pack minus raw)", value: comparison.symbolF1Delta, unit: "ratio", caseId },
    { id: "fact-coverage-delta", name: "Fact coverage delta (pack minus raw)", value: comparison.factCoverageDelta, unit: "ratio", caseId },
    { id: "estimated-token-delta", name: "Estimated token delta (pack minus raw)", value: comparison.estimatedTokenDelta, unit: "tokens", caseId },
    { id: "tokens-saved", name: "Tokens saved (raw minus pack)", value: comparison.tokensSaved, unit: "tokens", caseId },
    { id: "percent-saved", name: "Percent saved", value: comparison.percentSaved, unit: "percent", caseId }
  ];
}

/** Per scope: matched case count, then four objective means per treatment in fixed order. No best/rank/score/front metric. */
export function toContextPackGenerationRunMetrics(analysis: ContextPackGenerationAnalysisV1): ExperimentMetric[] {
  const metrics: ExperimentMetric[] = [];
  for (const scope of analysis.scopes) {
    const { scopeId } = scope;
    metrics.push({ id: `${scopeId}-comparison-case-count`, name: `${scopeId} matched comparison cases`, value: scope.includedCaseCount, unit: "count" });
    for (const treatmentId of CONTEXT_PACK_GENERATION_TREATMENT_IDS) {
      const objectives = scope.treatmentSummaries.find((summary) => summary.treatmentId === treatmentId)?.objectives ?? null;
      metrics.push(
        { id: `${scopeId}-mean-file-f1`, name: `${scopeId} mean file F1`, value: objectives?.meanFileF1 ?? null, unit: "ratio", variantId: treatmentId },
        { id: `${scopeId}-mean-symbol-f1`, name: `${scopeId} mean symbol F1`, value: objectives?.meanSymbolF1 ?? null, unit: "ratio", variantId: treatmentId },
        { id: `${scopeId}-mean-fact-coverage`, name: `${scopeId} mean fact coverage`, value: objectives?.meanFactCoverage ?? null, unit: "ratio", variantId: treatmentId },
        { id: `${scopeId}-mean-estimated-token-count`, name: `${scopeId} mean estimated token count`, value: objectives?.meanEstimatedTokenCount ?? null, unit: "tokens", variantId: treatmentId }
      );
    }
  }
  return metrics;
}
