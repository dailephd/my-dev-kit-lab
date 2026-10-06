import type {
  RetrievalQueryStrategyComparisonReportMetricV1,
  RetrievalQueryStrategyComparisonReportScopeV1,
  RetrievalQueryStrategyComparisonReportV1
} from "./retrievalQueryStrategyComparisonReportModel.js";

export const RETRIEVAL_QUERY_STRATEGY_EXTERNAL_PRIVACY_NOTE =
  "External-local report: private file, symbol, fact, semantic-node, warning, and case-title identities are withheld; numeric scientific results and strategy interpretations are preserved.";

/** Available values keep four decimals; unavailable/not-applicable are never shown as zero. */
export function formatRetrievalQueryStrategyMetric(metric: RetrievalQueryStrategyComparisonReportMetricV1): string {
  if (metric.availability === "available" && metric.value !== null) return metric.value.toFixed(4);
  return `${metric.availability}${metric.reason ? ` (${metric.reason})` : ""}`;
}

export const formatRetrievalQueryStrategyNumber = (value: number | null): string => (value === null ? "unavailable" : String(value));
const formatMean = (value: number | undefined): string => (value === undefined ? "unavailable" : value.toFixed(4));
const formatTokenMean = (value: number | undefined): string => (value === undefined ? "unavailable" : String(value));

export const formatRetrievalQueryStrategyList = (items: readonly string[]): string => (items.length === 0 ? "none" : items.join(", "));

/** One human sentence per scope: a best strategy only for a single-member front; otherwise an explicit tradeoff. */
export function describeRetrievalQueryStrategyScope(scope: RetrievalQueryStrategyComparisonReportScopeV1): string {
  if (scope.interpretation === "unique-best") {
    return `${scope.scopeId}: unique-best ${scope.bestStrategyId} (single-member Pareto front).`;
  }
  if (scope.interpretation === "tradeoff") {
    return `${scope.scopeId}: No Single Best strategy; Pareto front (nondominated, not ranked): ${formatRetrievalQueryStrategyList(scope.paretoFrontStrategyIds)}.`;
  }
  return `${scope.scopeId}: unavailable; no matched complete-case comparison.`;
}

export function renderRetrievalQueryStrategyComparisonTextLines(section: RetrievalQueryStrategyComparisonReportV1): string[] {
  const lines: string[] = [];
  const methodology = section.methodology;
  lines.push(`Schema: ${section.schemaVersion}`);
  lines.push(`File F1: ${methodology.fileF1}`);
  lines.push(`Symbol F1: ${methodology.symbolF1}`);
  lines.push(`Aggregation: ${methodology.aggregation}`);
  lines.push(`Multi-objective comparison: ${methodology.multiObjectiveComparison}`);
  lines.push(`Unique-best rule: ${methodology.uniqueBestRule}`);
  lines.push(`Strategy order: ${section.strategyOrder.join(", ")}`);
  if (section.identityRedaction !== null) lines.push(RETRIEVAL_QUERY_STRATEGY_EXTERNAL_PRIVACY_NOTE);

  lines.push("", "Task-Type Comparison");
  for (const scope of section.scopes) {
    lines.push(
      `- scope=${scope.scopeId} cases=${scope.caseCount} matched=${scope.comparisonCaseCount} excluded=${scope.excludedCaseCount} interpretation=${scope.interpretation} best=${scope.bestStrategyId ?? "none"} pareto=${formatRetrievalQueryStrategyList(scope.paretoFrontStrategyIds)}`
    );
  }
  for (const scope of section.scopes) lines.push(describeRetrievalQueryStrategyScope(scope));

  lines.push("", "Per-Scope Strategy Objectives");
  for (const scope of section.scopes) {
    lines.push(`Scope ${scope.scopeId}:`);
    for (const summary of scope.strategySummaries) {
      const objectives = summary.objectives;
      lines.push(
        `- ${summary.strategyId} completed=${summary.completedCaseCount} partial=${summary.partialCaseCount} failed=${summary.failedCaseCount} meanFileF1=${formatMean(objectives?.meanFileF1)} meanSymbolF1=${formatMean(objectives?.meanSymbolF1)} meanFactCoverage=${formatMean(objectives?.meanFactCoverage)} meanRetrievedTokens=${formatTokenMean(objectives?.meanRetrievedTokenCount)}`
      );
    }
  }

  lines.push("", "Per-Case Treatments");
  for (const entry of section.cases) {
    for (const treatment of entry.treatments) {
      lines.push(
        `- case=${entry.caseId} taskType=${entry.taskLocality ?? "unavailable"} strategy=${treatment.strategyId} status=${treatment.executionStatus} evidence=${treatment.evidenceAvailability ?? "unavailable"} filePrecision=${formatRetrievalQueryStrategyMetric(treatment.filePrecision)} fileRecall=${formatRetrievalQueryStrategyMetric(treatment.fileRecall)} fileF1=${formatRetrievalQueryStrategyMetric(treatment.fileF1)} symbolPrecision=${formatRetrievalQueryStrategyMetric(treatment.symbolPrecision)} symbolRecall=${formatRetrievalQueryStrategyMetric(treatment.symbolRecall)} symbolF1=${formatRetrievalQueryStrategyMetric(treatment.symbolF1)} factCoverage=${formatRetrievalQueryStrategyMetric(treatment.factCoverage)} irrelevantContextRatio=${formatRetrievalQueryStrategyMetric(treatment.irrelevantContextRatio)} retrievedTokens=${formatRetrievalQueryStrategyNumber(treatment.retrievedTokenCount)}`
      );
    }
  }

  lines.push("", "Interpretation Limits");
  for (const limitation of section.limitations) lines.push(`- ${limitation}`);
  return lines;
}
