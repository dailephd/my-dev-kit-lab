import type { ContextWindowScalingReportV1 } from "./contextWindowScalingReportModel.js";
import {
  formatContextWindowScalingCount,
  formatContextWindowScalingPercent,
  formatContextWindowScalingScore,
} from "./renderContextWindowScalingText.js";

export function renderContextWindowScalingHtml(section: ContextWindowScalingReportV1 | null): string {
  if (section === null) {
    return `<section>
    <h2>Context Window Scaling</h2>
    <p>Not applicable to this plugin.</p>
  </section>`;
  }
  const summary = section.runSummary;
  return `<section>
    <h2>Context Window Scaling</h2>
    ${table(["Field", "Value"], [
      ["Schema", section.schemaVersion],
      ["Budgets (estimated context tokens)", section.budgets.join(", ")],
      ["Treatments", section.treatments.join(", ")],
      ["Token count method", section.tokenCountMethod ?? "unavailable"],
      ...Object.entries(summary).map(([label, value]): string[] => [label, String(value)]),
    ])}
    <h3>Budget Summary</h3>
    ${table(
      ["Budget", "Treatment", "Cells", "Fits", "Too large", "Context unavailable", "Success", "Not successful", "Success unavailable", "Success rate", "Correctness available", "Mean correctness", "Mean utilization", "Min utilization", "Max utilization"],
      section.budgetTreatmentSummaries.map((s) => [
        String(s.contextBudgetTokens),
        s.variantId,
        String(s.totalCellCount),
        String(s.fitCount),
        String(s.contextTooLargeCount),
        String(s.contextUnavailableCount),
        String(s.successfulCellCount),
        String(s.notSuccessfulCellCount),
        String(s.successEvidenceUnavailableCount),
        formatContextWindowScalingPercent(s.successRatePercent),
        String(s.correctnessAvailableCount),
        formatContextWindowScalingScore(s.meanCorrectnessScore),
        formatContextWindowScalingPercent(s.meanContextBudgetUtilizationPercent),
        formatContextWindowScalingPercent(s.minContextBudgetUtilizationPercent),
        formatContextWindowScalingPercent(s.maxContextBudgetUtilizationPercent),
      ])
    )}
    <h3>Case Context Evidence</h3>
    <p class="muted">Context does not vary by budget, so there is one row per case and treatment.</p>
    ${table(
      ["Case", "Treatment", "Context", "Characters", "Estimated tokens", "Token method", "Observed files", "Relevant-file evidence", "Expected relevant files", "Observed expected files", "Omitted relevant files"],
      section.caseTreatmentContexts.map((c) => [
        c.caseId,
        c.variantId,
        c.contextStatus,
        formatContextWindowScalingCount(c.characterCount),
        formatContextWindowScalingCount(c.estimatedTokens),
        c.tokenCountMethod ?? "unavailable",
        formatContextWindowScalingCount(c.observedFileCount),
        c.relevantFileStatus,
        String(c.expectedRelevantFileCount),
        formatContextWindowScalingCount(c.observedExpectedFileCount),
        formatContextWindowScalingCount(c.omittedRelevantFileCount),
      ])
    )}
    <h3>Omitted Relevant Files</h3>
    <p class="muted">Benchmark-expected files not observed in the treatment context. Not retrieval precision or recall.</p>
    ${table(["Evidence available", "Unavailable", "Not applicable", "Total omitted"], [[
      String(section.relevantFileSummary.relevantFileEvidenceAvailableCount),
      String(section.relevantFileSummary.relevantFileEvidenceUnavailableCount),
      String(section.relevantFileSummary.relevantFileEvidenceNotApplicableCount),
      String(section.relevantFileSummary.totalOmittedRelevantFileCount),
    ]])}
    ${section.caseTreatmentContexts
      .filter((c) => c.relevantFileStatus === "available" && (c.omittedRelevantFileCount ?? 0) > 0)
      .map(
        (c) => `<p><code>${escapeHtml(c.caseId)}</code> / ${escapeHtml(c.variantId)}: omitted ${c.omittedRelevantFiles.totalCount}; displayed ${c.omittedRelevantFiles.displayedCount} of ${c.omittedRelevantFiles.totalCount}; omitted from display ${c.omittedRelevantFiles.omittedCount}; truncated ${c.omittedRelevantFiles.truncated ? "yes" : "no"}</p>${list(c.omittedRelevantFiles.items)}`
      )
      .join("\n    ")}
    <h3>Per-Case Budget Matrix</h3>
    ${table(
      ["Case", "Treatment", "Budget", "Estimated context tokens", "Fit", "Utilization", "Evaluation", "Correctness", "Correctness score", "Correctness pass", "Success evidence", "Success", "Success reason"],
      section.caseBudgetCells.map((cell) => [
        cell.caseId,
        cell.variantId,
        String(cell.contextBudgetTokens),
        formatContextWindowScalingCount(cell.contextEstimatedTokens),
        cell.contextFitStatus,
        formatContextWindowScalingPercent(cell.contextBudgetUtilizationPercent),
        cell.evaluationStatus,
        cell.correctness.availability,
        formatContextWindowScalingScore(cell.correctness.score),
        cell.correctness.pass === null ? "unavailable" : String(cell.correctness.pass),
        cell.successEvidence.status,
        cell.successEvidence.success === null ? "unavailable" : String(cell.successEvidence.success),
        cell.successEvidence.reason,
      ])
    )}
    <h3>Interpretation And Limitations</h3>
    ${list(section.interpretation)}
  </section>`;
}

function list(items: readonly string[]): string {
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
