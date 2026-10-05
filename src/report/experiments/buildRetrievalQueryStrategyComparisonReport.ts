import { RETRIEVAL_QUERY_STRATEGY_IDS } from "../../evaluation/retrievalQueryStrategies.js";
import type { ExperimentRun } from "../../experiments/index.js";
import { RETRIEVAL_QUERY_STRATEGY_COMPARISON_METHODOLOGY } from "../../experiments/plugins/retrievalQueryStrategyComparison/analysisArtifact.js";
import { RETRIEVAL_QUERY_STRATEGY_COMPARISON_PLUGIN_ID } from "../../experiments/plugins/retrievalQueryStrategyComparison/metadata.js";
import type { RetrievalQueryStrategyComparisonRun } from "../../experiments/plugins/retrievalQueryStrategyComparison/plugin.js";
import {
  RETRIEVAL_QUERY_STRATEGY_COMPARISON_REPORT_SCHEMA_VERSION,
  type RetrievalQueryStrategyComparisonReportCaseV1,
  type RetrievalQueryStrategyComparisonReportMetricV1,
  type RetrievalQueryStrategyComparisonReportV1
} from "./retrievalQueryStrategyComparisonReportModel.js";

/** Fixed wording: observed evidence only. It never claims a strategy is generally superior. */
export const RETRIEVAL_QUERY_STRATEGY_COMPARISON_LIMITATIONS: readonly string[] = [
  "Retrieval treatments are deterministic my-dev-kit workflows; no coding agent or learned judge participates.",
  "File and symbol precision and recall retain the v0.8.0 set-based identity semantics.",
  "Balanced file and symbol F1 use 2TP / (2TP + FP + FN).",
  "Cross-strategy scope means use matched complete cases only: a task is excluded from every strategy aggregate when any strategy lacks a primary objective.",
  "Scope means are unweighted macro means over task instances.",
  "Pareto dominance compares mean file F1, mean symbol F1, mean fact coverage, and mean retrieved token count without scalar weights.",
  "A unique best strategy is reported only when the Pareto front has exactly one member; multiple nondominated strategies are reported as a tradeoff, not forcibly ranked.",
  "Task-type scopes reuse the existing taskLocality labels: localized, cross-module, and broad-change.",
  "Retrieved token count is a context-size estimate from the selected retrieval payload, not provider billing telemetry.",
  "Unavailable and not-applicable metric values are not converted to zero.",
  "External-local durable reports withhold private file, symbol, fact, semantic-node, warning, and case-title identities."
];

const NO_RETRIEVAL_MEASUREMENT: RetrievalQueryStrategyComparisonReportMetricV1 = {
  availability: "unavailable",
  numerator: null,
  denominator: null,
  value: null,
  reason: "no-retrieval-measurement"
};

const noMeasurement = (): RetrievalQueryStrategyComparisonReportMetricV1 => ({ ...NO_RETRIEVAL_MEASUREMENT });

const copyMetric = (metric: RetrievalQueryStrategyComparisonReportMetricV1): RetrievalQueryStrategyComparisonReportMetricV1 => ({
  availability: metric.availability,
  numerator: metric.numerator,
  denominator: metric.denominator,
  value: metric.value,
  reason: metric.reason
});

/**
 * Presentation-only adapter over the already-calculated `run.analysis`. It recalculates no precision, recall, F1, fact
 * coverage, mean, Pareto front or best strategy; it only copies values and reads persisted execution status.
 */
export function buildRetrievalQueryStrategyComparisonReport(run: ExperimentRun): RetrievalQueryStrategyComparisonReportV1 | null {
  if (run.pluginId !== RETRIEVAL_QUERY_STRATEGY_COMPARISON_PLUGIN_ID) return null;

  const candidate = run as Partial<RetrievalQueryStrategyComparisonRun>;
  const analysis = candidate.analysis;
  const execution = candidate.caseExecutionEvidence;
  if (!analysis || !execution) {
    // A run that failed before analysis exists still gets the generic failure report.
    if (run.status === "failed") return null;
    throw new Error("Invalid retrieval-query-strategy-comparison report source: execution evidence and analysis are required.");
  }
  const inconsistent =
    analysis.cases.length !== execution.length ||
    analysis.cases.some(
      (entry, index) =>
        entry.caseId !== execution[index].caseId ||
        entry.treatments.length !== RETRIEVAL_QUERY_STRATEGY_IDS.length ||
        entry.treatments.some((treatment, position) => treatment.strategyId !== RETRIEVAL_QUERY_STRATEGY_IDS[position]) ||
        execution[index].treatments.length !== RETRIEVAL_QUERY_STRATEGY_IDS.length
    );
  if (inconsistent) {
    throw new Error("Invalid retrieval-query-strategy-comparison report source: execution evidence and analysis are inconsistent.");
  }

  const cases: RetrievalQueryStrategyComparisonReportCaseV1[] = analysis.cases.map((entry, caseIndex) => ({
    caseId: entry.caseId,
    caseName: execution[caseIndex].caseName,
    benchmarkProject: entry.benchmarkProject,
    taskLocality: entry.taskLocality,
    treatments: entry.treatments.map((treatment, position) => {
      const quality = treatment.quality;
      return {
        strategyId: treatment.strategyId,
        executionStatus: treatment.executionStatus,
        evidenceAvailability: execution[caseIndex].treatments[position].retrieval?.evidenceAvailability ?? null,
        filePrecision: quality ? copyMetric(quality.file.precision) : noMeasurement(),
        fileRecall: quality ? copyMetric(quality.file.recall) : noMeasurement(),
        fileF1: copyMetric(treatment.fileF1),
        symbolPrecision: quality ? copyMetric(quality.symbol.precision) : noMeasurement(),
        symbolRecall: quality ? copyMetric(quality.symbol.recall) : noMeasurement(),
        symbolF1: copyMetric(treatment.symbolF1),
        factCoverage: quality ? copyMetric(quality.fact.coverage) : noMeasurement(),
        irrelevantContextRatio: quality ? copyMetric(quality.irrelevantContextRatio) : noMeasurement(),
        retrievedTokenCount: quality?.retrievedTokenCount ?? null,
        tokenCountMethod: quality?.tokenCountMethod ?? null
      };
    })
  }));

  return {
    schemaVersion: RETRIEVAL_QUERY_STRATEGY_COMPARISON_REPORT_SCHEMA_VERSION,
    methodology: structuredClone(RETRIEVAL_QUERY_STRATEGY_COMPARISON_METHODOLOGY),
    strategyOrder: [...RETRIEVAL_QUERY_STRATEGY_IDS],
    identityRedaction: run.target.privacyProjection === "external-local-redacted" ? "external-local-redacted" : null,
    scopes: structuredClone(analysis.scopes),
    cases,
    limitations: [...RETRIEVAL_QUERY_STRATEGY_COMPARISON_LIMITATIONS]
  };
}
