import {
  RETRIEVAL_PRECISION_RECALL_RATIO_KEYS
} from "../../experiments/plugins/retrievalPrecisionRecall/types.js";
import type { RetrievalPrecisionRecallReportBoundedListV1, RetrievalPrecisionRecallReportV1 } from "./retrievalPrecisionRecallReportModel.js";
import {
  formatRetrievalCount,
  formatRetrievalList,
  formatRetrievalMean,
  formatRetrievalMetric,
  RETRIEVAL_RATIO_LABELS
} from "./renderRetrievalPrecisionRecallText.js";

export function renderRetrievalPrecisionRecallHtml(section: RetrievalPrecisionRecallReportV1 | null): string {
  if (section === null) {
    return `<section>
    <h2>Retrieval Precision/Recall</h2>
    <p>Not applicable to this plugin.</p>
  </section>`;
  }
  const tokens = section.tokenSummary;
  const occurrences = section.occurrenceSummary;
  return `<section>
    <h2>Retrieval Precision/Recall</h2>
    <p class="muted">Measures which expected files, symbols and facts the my-dev-kit retrieval lifecycle surfaced, and which irrelevant files it surfaced, without agents. It is descriptive and does not rank anything.</p>
    ${table(["Field", "Value"], [
      ["Schema", section.schemaVersion],
      ["Token count method", section.tokenCountMethod ?? "unavailable"],
      ...Object.entries(section.runSummary).map(([label, value]): string[] => [label, String(value)])
    ])}
    <h3>Macro Averages</h3>
    <p class="muted">Mean over available per-case values only. Unavailable and not-applicable cases are counted separately and are never treated as zero.</p>
    ${table(
      ["Metric", "Available", "Unavailable", "Not applicable", "Mean"],
      RETRIEVAL_PRECISION_RECALL_RATIO_KEYS.map((key) => {
        const summary = section.ratioSummaries[key];
        return [RETRIEVAL_RATIO_LABELS[key], String(summary.availableCount), String(summary.unavailableCount), String(summary.notApplicableCount), formatRetrievalMean(summary.meanValue)];
      })
    )}
    <h3>Retrieved Token Summary</h3>
    <p class="muted">Measured retrieval payload size; not a relevant versus irrelevant token attribution.</p>
    ${table(["Available", "Unavailable", "Total", "Mean", "Min", "Max"], [[
      String(tokens.availableCount),
      String(tokens.unavailableCount),
      formatRetrievalCount(tokens.totalTokens),
      formatRetrievalMean(tokens.meanTokens),
      formatRetrievalCount(tokens.minTokens),
      formatRetrievalCount(tokens.maxTokens)
    ]])}
    <h3>Missed And Irrelevant Occurrence Totals</h3>
    <p class="muted">Summed per case; identical paths in different cases or projects are not deduplicated.</p>
    ${table(
      ["Missed files", "Irrelevant files", "Cases with file evidence", "Missed symbols", "Irrelevant symbols", "Cases with symbol evidence", "Uncovered facts", "Cases with fact evidence"],
      [[
        String(occurrences.totalMissedFileOccurrences),
        String(occurrences.totalIrrelevantRetrievedFileOccurrences),
        String(occurrences.fileOccurrenceEvidenceCaseCount),
        String(occurrences.totalMissedSymbolOccurrences),
        String(occurrences.totalIrrelevantRetrievedSymbolOccurrences),
        String(occurrences.symbolOccurrenceEvidenceCaseCount),
        String(occurrences.totalUncoveredFactOccurrences),
        String(occurrences.factOccurrenceEvidenceCaseCount)
      ]]
    )}
    <h3>Per-Case Results</h3>
    ${table(
      ["Case", "Project", "Locality", "Status", "Evidence", ...RETRIEVAL_PRECISION_RECALL_RATIO_KEYS.map((key) => RETRIEVAL_RATIO_LABELS[key]), "Retrieved tokens"],
      section.cases.map((entry) => [
        entry.caseId,
        entry.benchmarkProject,
        entry.taskLocality ?? "unavailable",
        entry.status,
        entry.evidenceAvailability ?? "unavailable",
        ...RETRIEVAL_PRECISION_RECALL_RATIO_KEYS.map((key) => formatRetrievalMetric(entry.metrics[key])),
        formatRetrievalCount(entry.retrievedTokenCount)
      ])
    )}
    <h3>Per-Case Missed And Irrelevant Context</h3>
    <p class="muted">Displayed lists are bounded; totals are exact.</p>
    ${section.cases
      .map((entry) => {
        const lists: Array<[string, RetrievalPrecisionRecallReportBoundedListV1 | null]> = [
          ["Missed files", entry.missedFiles],
          ["Irrelevant retrieved files", entry.irrelevantRetrievedFiles],
          ["Missed symbols", entry.missedSymbols],
          ["Irrelevant retrieved symbols", entry.irrelevantRetrievedSymbols],
          ["Uncovered fact IDs", entry.uncoveredFactIds]
        ];
        return `<h4><code>${escapeHtml(entry.caseId)}</code> (${escapeHtml(entry.status)})</h4>
    ${lists
      .map(([label, list]) => `<p>${escapeHtml(label)}: ${escapeHtml(formatRetrievalList(list))}</p>${list && list.displayed.length > 0 ? listHtml(list.displayed) : ""}`)
      .join("\n    ")}${entry.errors.length > 0 ? `\n    ${listHtml(entry.errors)}` : ""}`;
      })
      .join("\n    ")}
    <h3>Interpretation Limits</h3>
    ${listHtml(section.limitations)}
  </section>`;
}

function listHtml(items: readonly string[]): string {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function table(headers: string[], rows: string[][]): string {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function escapeHtml(value: string | number | boolean | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
