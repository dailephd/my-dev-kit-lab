import {
  RETRIEVAL_PRECISION_RECALL_RATIO_KEYS,
  type RetrievalPrecisionRecallRatioKey
} from "../../experiments/plugins/retrievalPrecisionRecall/types.js";
import type {
  RetrievalPrecisionRecallReportBoundedListV1,
  RetrievalPrecisionRecallReportMetricV1,
  RetrievalPrecisionRecallReportV1
} from "./retrievalPrecisionRecallReportModel.js";

export const RETRIEVAL_RATIO_LABELS: Record<RetrievalPrecisionRecallRatioKey, string> = {
  filePrecision: "File precision",
  fileRecall: "File recall",
  symbolPrecision: "Symbol precision",
  symbolRecall: "Symbol recall",
  factCoverage: "Fact coverage",
  irrelevantContextRatio: "Irrelevant context ratio"
};

// Render-time formatting only; the JSON report keeps exact unrounded values. Unavailable and not-applicable are
// always named, never shown as a number.
export function formatRetrievalMetric(metric: RetrievalPrecisionRecallReportMetricV1): string {
  if (metric.availability === "available" && metric.value !== null) {
    return `${metric.value.toFixed(4)} (${metric.numerator}/${metric.denominator})`;
  }
  return `${metric.availability}${metric.reason ? ` (${metric.reason})` : ""}`;
}

/** Explains the placeholders; shown only when at least one case was externally projected. */
export const RETRIEVAL_IDENTITY_REDACTION_EXPLANATION =
  "External-local run: file, symbol and fact identities, warning text and case titles are withheld. A placeholder such as <redacted file 1> stands for exactly one withheld identity; it is not a file name and not an absence of files. Counts and metric values are exact.";

export function formatRetrievalMean(value: number | null): string {
  return value === null ? "unavailable" : value.toFixed(4);
}

export function formatRetrievalCount(value: number | null): string {
  return value === null ? "unavailable" : String(value);
}

export function formatRetrievalList(list: RetrievalPrecisionRecallReportBoundedListV1 | null): string {
  if (list === null) return "unavailable";
  return `${list.totalCount} (displayed ${list.displayedCount}, omitted ${list.omittedCount})`;
}

function clean(value: unknown): string {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ");
}

function row(parts: Array<[string, unknown]>): string {
  return `- ${parts.map(([label, value]) => `${label}: ${clean(value)}`).join(" | ")}`;
}

/** Lines for the "Retrieval Precision/Recall" section; every value comes from the report model. */
export function renderRetrievalPrecisionRecallTextLines(section: RetrievalPrecisionRecallReportV1): string[] {
  const lines: string[] = [];
  lines.push(`Schema: ${clean(section.schemaVersion)}`);
  lines.push(`Token Count Method: ${clean(section.tokenCountMethod ?? "unavailable")}`);
  if (section.cases.some((entry) => entry.identityRedaction !== null)) {
    lines.push(`Identity Redaction: ${RETRIEVAL_IDENTITY_REDACTION_EXPLANATION}`);
  }

  lines.push("Run Summary:");
  for (const [label, value] of Object.entries(section.runSummary)) {
    lines.push(`${label}: ${value}`);
  }

  lines.push("Macro Averages (mean over available per-case values only; unavailable and not-applicable are counted, never zero):");
  for (const key of RETRIEVAL_PRECISION_RECALL_RATIO_KEYS) {
    const summary = section.ratioSummaries[key];
    lines.push(
      row([
        ["Metric", RETRIEVAL_RATIO_LABELS[key]],
        ["Available", summary.availableCount],
        ["Unavailable", summary.unavailableCount],
        ["Not Applicable", summary.notApplicableCount],
        ["Mean", formatRetrievalMean(summary.meanValue)]
      ])
    );
  }

  lines.push("Retrieved Token Summary (measured payload, not relevant/irrelevant attribution):");
  const tokens = section.tokenSummary;
  lines.push(
    row([
      ["Available", tokens.availableCount],
      ["Unavailable", tokens.unavailableCount],
      ["Total", formatRetrievalCount(tokens.totalTokens)],
      ["Mean", formatRetrievalMean(tokens.meanTokens)],
      ["Min", formatRetrievalCount(tokens.minTokens)],
      ["Max", formatRetrievalCount(tokens.maxTokens)]
    ])
  );

  lines.push("Missed And Irrelevant Occurrence Totals (summed per case; not deduplicated across cases or projects):");
  const occurrences = section.occurrenceSummary;
  lines.push(
    row([
      ["Missed Files", occurrences.totalMissedFileOccurrences],
      ["Irrelevant Files", occurrences.totalIrrelevantRetrievedFileOccurrences],
      ["Cases With File Evidence", occurrences.fileOccurrenceEvidenceCaseCount],
      ["Missed Symbols", occurrences.totalMissedSymbolOccurrences],
      ["Irrelevant Symbols", occurrences.totalIrrelevantRetrievedSymbolOccurrences],
      ["Cases With Symbol Evidence", occurrences.symbolOccurrenceEvidenceCaseCount],
      ["Uncovered Facts", occurrences.totalUncoveredFactOccurrences],
      ["Cases With Fact Evidence", occurrences.factOccurrenceEvidenceCaseCount]
    ])
  );

  lines.push("Per-Case Results (one row per case):");
  for (const entry of section.cases) {
    lines.push(
      row([
        ["Case", entry.caseId],
        ["Project", entry.benchmarkProject],
        ["Locality", entry.taskLocality ?? "unavailable"],
        ["Status", entry.status],
        ["Evidence", entry.evidenceAvailability ?? "unavailable"],
        ...RETRIEVAL_PRECISION_RECALL_RATIO_KEYS.map((key): [string, unknown] => [RETRIEVAL_RATIO_LABELS[key], formatRetrievalMetric(entry.metrics[key])]),
        ["Retrieved Tokens", formatRetrievalCount(entry.retrievedTokenCount)]
      ])
    );
  }

  lines.push("Per-Case Missed And Irrelevant Context (displayed lists are bounded; totals are exact):");
  for (const entry of section.cases) {
    lines.push(`Case ${clean(entry.caseId)} (${clean(entry.status)})`);
    if (entry.identityRedaction !== null) lines.push("  Identity redaction: files, symbols, facts, warnings and case title withheld");
    const lists: Array<[string, RetrievalPrecisionRecallReportBoundedListV1 | null]> = [
      ["Missed Files", entry.missedFiles],
      ["Irrelevant Retrieved Files", entry.irrelevantRetrievedFiles],
      ["Missed Symbols", entry.missedSymbols],
      ["Irrelevant Retrieved Symbols", entry.irrelevantRetrievedSymbols],
      ["Uncovered Fact IDs", entry.uncoveredFactIds]
    ];
    for (const [label, list] of lists) {
      lines.push(`  ${label}: ${formatRetrievalList(list)}`);
      for (const item of list?.displayed ?? []) {
        lines.push(`    - ${clean(item)}`);
      }
    }
    for (const error of entry.errors) {
      lines.push(`  Error: ${clean(error)}`);
    }
  }

  lines.push("Interpretation Limits:");
  for (const limitation of section.limitations) {
    lines.push(`- ${clean(limitation)}`);
  }
  return lines;
}
