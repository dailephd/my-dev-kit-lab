import type { ContextPackGenerationReportPreviewV1, ContextPackGenerationReportV1 } from "./contextPackGenerationReportModel.js";
import { formatContextPackNumber, redactedPreviewDisplayLines } from "./renderContextPackGenerationText.js";
import { formatRetrievalQueryStrategyMetric } from "./renderRetrievalQueryStrategyComparisonText.js";

const formatMean = (value: number | undefined | null): string => (value === undefined || value === null ? "unavailable" : value.toFixed(4));

export function renderContextPackGenerationHtml(section: ContextPackGenerationReportV1 | null): string {
  if (section === null) return "";
  return `<section>
    <h2>Context Pack Generation</h2>
    <h3>Methodology</h3>
    ${table(["Field", "Value"], [
      ["Schema", section.schemaVersion],
      ["Experiment", `${section.experiment.pluginId} (${section.experiment.target})`],
      ["Treatment order", section.treatmentOrder.join(", ")],
      ["File F1", section.methodology.fileF1],
      ["Symbol F1", section.methodology.symbolF1],
      ["Aggregation", section.methodology.aggregation],
      ["Treatment comparison", section.methodology.treatmentComparison],
      ["Size measure", section.methodology.sizeMeasure]
    ])}
    <h3>Per-Case Treatments</h3>
    ${table(
      ["Case", "Project", "Task Type", "Treatment", "Status", "Availability", "File F1", "Symbol F1", "Fact Coverage", "Estimated Tokens"],
      section.cases.flatMap((entry) =>
        entry.treatments.map((treatment) => [
          entry.caseId,
          entry.benchmarkProject,
          entry.taskLocality ?? "unavailable",
          treatment.treatmentId,
          treatment.executionStatus,
          treatment.availability ?? "unavailable",
          formatRetrievalQueryStrategyMetric(treatment.fileF1),
          formatRetrievalQueryStrategyMetric(treatment.symbolF1),
          formatRetrievalQueryStrategyMetric(treatment.factCoverage),
          formatContextPackNumber(treatment.estimatedTokens)
        ])
      )
    )}
    <h3>Paired Comparison (context-pack minus raw-full-file)</h3>
    ${table(
      ["Case", "File F1 Delta", "Symbol F1 Delta", "Fact Coverage Delta", "Estimated Token Delta", "Tokens Saved", "Percent Saved"],
      section.cases.map((entry) => [
        entry.caseId,
        formatMean(entry.comparison.fileF1Delta),
        formatMean(entry.comparison.symbolF1Delta),
        formatMean(entry.comparison.factCoverageDelta),
        formatContextPackNumber(entry.comparison.estimatedTokenDelta),
        formatContextPackNumber(entry.comparison.tokensSaved),
        formatMean(entry.comparison.percentSaved)
      ])
    )}
    <h3>Scope Aggregates</h3>
    ${section.scopes
      .map(
        (scope) => `<h4>${escapeHtml(scope.scopeId)}</h4>
    <p>Cases ${scope.caseCount}; included ${scope.includedCaseCount} (${escapeHtml(scope.includedCaseIds.join(", ") || "none")}); excluded ${scope.excludedCaseCount} (${escapeHtml(scope.excludedCaseIds.join(", ") || "none")}).</p>
    ${table(
      ["Treatment", "Completed", "Partial", "Failed", "Mean File F1", "Mean Symbol F1", "Mean Fact Coverage", "Mean Estimated Tokens"],
      scope.treatmentSummaries.map((summary) => [
        summary.treatmentId,
        String(summary.completedCaseCount),
        String(summary.partialCaseCount),
        String(summary.failedCaseCount),
        formatMean(summary.objectives?.meanFileF1),
        formatMean(summary.objectives?.meanSymbolF1),
        formatMean(summary.objectives?.meanFactCoverage),
        formatContextPackNumber(summary.objectives?.meanEstimatedTokenCount)
      ])
    )}
    ${table(
      ["Mean File F1 Delta", "Mean Symbol F1 Delta", "Mean Fact Coverage Delta", "Mean Estimated Token Delta", "Mean Tokens Saved", "Percent Saved Of Means"],
      [
        [
          formatMean(scope.pairedDeltas?.meanFileF1Delta),
          formatMean(scope.pairedDeltas?.meanSymbolF1Delta),
          formatMean(scope.pairedDeltas?.meanFactCoverageDelta),
          formatContextPackNumber(scope.pairedDeltas?.meanEstimatedTokenDelta),
          formatContextPackNumber(scope.tokenSavings?.meanTokensSaved),
          formatMean(scope.tokenSavings?.percentSavedOfMeans)
        ]
      ]
    )}`
      )
      .join("\n    ")}
    <h3>Context Pack Preview</h3>
    <p>Bounded for display only; stored packs and measured sizes are unchanged.</p>
    ${section.previews.map(previewHtml).join("\n    ")}
    <h3>Interpretation Limits</h3>
    ${listHtml(section.limitations)}
  </section>`;
}

function previewHtml(preview: ContextPackGenerationReportPreviewV1): string {
  if (preview.status === "redacted-external-local") {
    return `<h4>${escapeHtml(preview.caseId)}</h4>
    <p>Status ${escapeHtml(preview.status)}; pack availability ${escapeHtml(preview.packAvailability ?? "unavailable")}.</p>
    ${table(
      ["Section", "Availability", "Items", "Estimated Tokens"],
      preview.sections.map((s) => [s.id, s.availability, String(s.itemCount), String(s.estimatedTokens)])
    )}
    ${listHtml(redactedPreviewDisplayLines(preview))}`;
  }
  const head = `<h4>${escapeHtml(preview.caseId)}</h4>
    <p>Status ${escapeHtml(preview.status)}; pack availability ${escapeHtml(preview.packAvailability ?? "unavailable")}.</p>
    ${table(
      ["Section", "Availability", "Items", "Estimated Tokens"],
      preview.sections.map((s) => [s.id, s.availability, String(s.itemCount), String(s.estimatedTokens)])
    )}`;
  if (preview.task === null) return head;
  const count = (list: { items: unknown[]; totalCount: number; omittedCount: number }) => `shown ${list.items.length} of ${list.totalCount}; omitted ${list.omittedCount}`;
  return `${head}
    <h5>1. Task</h5>
    <p><strong>${escapeHtml(preview.task.title)}</strong> ${escapeHtml(preview.task.summary)}</p>
    <h5>2. Relevant files (${count(preview.files!)})</h5>
    ${listHtml(preview.files!.items.map((file) => `${file.path} rank=${file.rank} reason=${file.reason}`))}
    <h5>3. Relevant symbols (${count(preview.symbols!)})</h5>
    ${listHtml(preview.symbols!.items.map((symbol) => `${symbol.name} file=${symbol.file ?? "unknown"} line=${symbol.line ?? "unknown"}`))}
    <h5>4. Source slices (${count(preview.sourceSlices!)})</h5>
    ${preview
      .sourceSlices!.items.map(
        (slice) => `<p>${escapeHtml(`${slice.file}:${slice.startLine}-${slice.endLine}`)} boundary known: ${slice.boundaryKnown}; truncated by experiment policy: ${slice.truncated}; truncated by report preview: ${slice.previewTruncated} (showing ${slice.previewLineCount} of ${slice.lineCount} lines)</p>
    <pre>${escapeHtml(slice.previewText)}</pre>`
      )
      .join("\n    ")}
    <h5>5. Call relationships (${count(preview.callRelationships!)})</h5>
    ${listHtml(preview.callRelationships!.items.map((call) => `${call.fromNodeId} calls ${call.toNodeId}`))}
    <h5>6. Tests (${count(preview.tests!)})</h5>
    ${listHtml(preview.tests!.items.map((test) => `${test.path} how=${test.how}`))}
    <h5>7. Evidence notes (${count(preview.evidenceNotes!)})</h5>
    ${listHtml(preview.evidenceNotes!.items)}`;
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
