import type { ExperimentRun } from "../../experiments/index.js";
import { RETRIEVAL_PRECISION_RECALL_PLUGIN_ID } from "../../experiments/plugins/retrievalPrecisionRecall/metadata.js";
import { retrievalRatioOf } from "../../experiments/plugins/retrievalPrecisionRecall/metrics.js";
import type { RetrievalPrecisionRecallRun } from "../../experiments/plugins/retrievalPrecisionRecall/plugin.js";
import { RETRIEVAL_PRECISION_RECALL_RATIO_KEYS } from "../../experiments/plugins/retrievalPrecisionRecall/types.js";
import {
  MAX_RETRIEVAL_REPORT_IDENTITIES,
  RETRIEVAL_PRECISION_RECALL_REPORT_SCHEMA_VERSION,
  type RetrievalPrecisionRecallReportBoundedListV1,
  type RetrievalPrecisionRecallReportCaseV1,
  type RetrievalPrecisionRecallReportV1
} from "./retrievalPrecisionRecallReportModel.js";

/** Fixed wording; the report states observed evidence only and never ranks or scores anything. */
export const RETRIEVAL_PRECISION_RECALL_LIMITATIONS: readonly string[] = [
  "File and symbol precision and recall are set-based measures, not ranked metrics.",
  "Symbol scoring uses exact unique symbol names, because the answer key lists names rather than node identities.",
  "Fact coverage uses explicit fact-to-context mappings in the answer key; it does not judge generated answers or interpret fact text.",
  "Irrelevant context ratio is file-identity based and is the complement of file precision when both are available.",
  "Retrieved token count measures the selected retrieval context payload; it is not a relevant versus irrelevant token attribution.",
  "The current lifecycle expands only the top search candidate (lookup, slice and source).",
  "Unavailable and not-applicable values are not zeros and are excluded from macro means.",
  "The experiment uses no real agents.",
  "v0.8.0 does not compare retrieval strategies."
];

function boundedList(items: readonly string[] | null): RetrievalPrecisionRecallReportBoundedListV1 | null {
  if (items === null) return null;
  const displayed = items.slice(0, MAX_RETRIEVAL_REPORT_IDENTITIES);
  return {
    totalCount: items.length,
    displayed: [...displayed],
    displayedCount: displayed.length,
    omittedCount: items.length - displayed.length
  };
}

/**
 * Presents the per-case metric results and aggregate already calculated on the run. It performs no precision, recall,
 * coverage, ratio or mean calculation of its own; identity lists are only bounded for display.
 */
export function buildRetrievalPrecisionRecallReport(run: ExperimentRun): RetrievalPrecisionRecallReportV1 | null {
  if (run.pluginId !== RETRIEVAL_PRECISION_RECALL_PLUGIN_ID) return null;

  const candidate = run as Partial<RetrievalPrecisionRecallRun>;
  const evidence = candidate.caseExecutionEvidence;
  const aggregate = candidate.aggregate;
  if (!evidence || !aggregate) {
    // A run that failed before producing evidence (for example an unknown case id or a non-self target) still gets the
    // generic report with its failure; only a non-failed run with missing evidence is a broken report source.
    if (run.status === "failed") return null;
    throw new Error("Invalid retrieval-precision-recall report source: case execution evidence and aggregate are required.");
  }
  if (aggregate.runSummary.caseCount !== evidence.length) {
    throw new Error("Invalid retrieval-precision-recall report source: aggregate and case execution evidence are inconsistent.");
  }

  const cases: RetrievalPrecisionRecallReportCaseV1[] = evidence.map((entry) => {
    const quality = entry.quality;
    const metrics = Object.fromEntries(
      RETRIEVAL_PRECISION_RECALL_RATIO_KEYS.map((key) => {
        const ratio = retrievalRatioOf(quality, key);
        return [key, { availability: ratio.availability, numerator: ratio.numerator, denominator: ratio.denominator, value: ratio.value, reason: ratio.reason }];
      })
    ) as RetrievalPrecisionRecallReportCaseV1["metrics"];
    return {
      caseId: entry.caseId,
      caseName: entry.caseName,
      benchmarkProject: entry.benchmarkProject,
      taskLocality: entry.taskLocality,
      status: entry.status,
      evidenceAvailability: entry.retrieval?.evidenceAvailability ?? null,
      metrics,
      retrievedTokenCount: quality?.retrievedTokenCount ?? null,
      tokenCountMethod: quality?.tokenCountMethod ?? null,
      missedFiles: boundedList(quality?.file.missedFiles ?? null),
      irrelevantRetrievedFiles: boundedList(quality?.file.irrelevantRetrievedFiles ?? null),
      missedSymbols: boundedList(quality?.symbol.missedSymbols ?? null),
      irrelevantRetrievedSymbols: boundedList(quality?.symbol.irrelevantRetrievedSymbols ?? null),
      uncoveredFactIds: boundedList(quality?.fact.uncoveredFactIds ?? null),
      errors: entry.errors.map((error) => `${error.code}: ${error.message}`)
    };
  });

  return {
    schemaVersion: RETRIEVAL_PRECISION_RECALL_REPORT_SCHEMA_VERSION,
    tokenCountMethod: evidence.find((entry) => entry.quality?.tokenCountMethod != null)?.quality?.tokenCountMethod ?? null,
    runSummary: { ...aggregate.runSummary },
    ratioSummaries: structuredClone(aggregate.ratios),
    tokenSummary: { ...aggregate.tokens },
    occurrenceSummary: { ...aggregate.occurrences },
    cases,
    limitations: [...RETRIEVAL_PRECISION_RECALL_LIMITATIONS]
  };
}
