import type { RetrievalQueryStrategyComparisonReportV1 } from "./retrievalQueryStrategyComparisonReportModel.js";
import {
  RETRIEVAL_QUERY_STRATEGY_EXTERNAL_PRIVACY_NOTE,
  describeRetrievalQueryStrategyScope,
  formatRetrievalQueryStrategyList,
  formatRetrievalQueryStrategyMetric,
  formatRetrievalQueryStrategyNumber
} from "./renderRetrievalQueryStrategyComparisonText.js";

export function renderRetrievalQueryStrategyComparisonHtml(section: RetrievalQueryStrategyComparisonReportV1 | null): string {
  if (section === null) return "";
  const methodology = section.methodology;
  const objective = (value: number | undefined, digits: boolean) => (value === undefined ? "unavailable" : digits ? value.toFixed(4) : String(value));
  return `<section>
    <h2>Retrieval Query Strategy Comparison</h2>
    <h3>Methodology</h3>
    ${table(["Field", "Value"], [
      ["Schema", section.schemaVersion],
      ["File F1", methodology.fileF1],
      ["Symbol F1", methodology.symbolF1],
      ["Aggregation", methodology.aggregation],
      ["Multi-objective comparison", methodology.multiObjectiveComparison],
      ["Unique-best rule", methodology.uniqueBestRule],
      ["Strategy order", section.strategyOrder.join(", ")]
    ])}
    ${section.identityRedaction !== null ? `<p><strong>Identity redaction.</strong> ${escapeHtml(RETRIEVAL_QUERY_STRATEGY_EXTERNAL_PRIVACY_NOTE)}</p>` : ""}
    <h3>Task-Type Comparison</h3>
    ${table(
      ["Scope", "Cases", "Matched Cases", "Excluded Cases", "Interpretation", "Best Strategy", "Pareto Front"],
      section.scopes.map((scope) => [
        scope.scopeId,
        String(scope.caseCount),
        String(scope.comparisonCaseCount),
        String(scope.excludedCaseCount),
        scope.interpretation,
        scope.bestStrategyId ?? "none",
        formatRetrievalQueryStrategyList(scope.paretoFrontStrategyIds)
      ])
    )}
    ${listHtml(section.scopes.map(describeRetrievalQueryStrategyScope))}
    <h3>Per-Scope Strategy Objectives</h3>
    ${section.scopes
      .map(
        (scope) => `<h4>${escapeHtml(scope.scopeId)}</h4>
    ${table(
      ["Strategy", "Completed", "Partial", "Failed", "Mean File F1", "Mean Symbol F1", "Mean Fact Coverage", "Mean Retrieved Tokens"],
      scope.strategySummaries.map((summary) => [
        summary.strategyId,
        String(summary.completedCaseCount),
        String(summary.partialCaseCount),
        String(summary.failedCaseCount),
        objective(summary.objectives?.meanFileF1, true),
        objective(summary.objectives?.meanSymbolF1, true),
        objective(summary.objectives?.meanFactCoverage, true),
        objective(summary.objectives?.meanRetrievedTokenCount, false)
      ])
    )}`
      )
      .join("\n    ")}
    <h3>Per-Case Treatments</h3>
    ${table(
      [
        "Case",
        "Task Type",
        "Strategy",
        "Status",
        "Evidence",
        "File Precision",
        "File Recall",
        "File F1",
        "Symbol Precision",
        "Symbol Recall",
        "Symbol F1",
        "Fact Coverage",
        "Irrelevant Context Ratio",
        "Retrieved Tokens"
      ],
      section.cases.flatMap((entry) =>
        entry.treatments.map((treatment) => [
          entry.caseId,
          entry.taskLocality ?? "unavailable",
          treatment.strategyId,
          treatment.executionStatus,
          treatment.evidenceAvailability ?? "unavailable",
          formatRetrievalQueryStrategyMetric(treatment.filePrecision),
          formatRetrievalQueryStrategyMetric(treatment.fileRecall),
          formatRetrievalQueryStrategyMetric(treatment.fileF1),
          formatRetrievalQueryStrategyMetric(treatment.symbolPrecision),
          formatRetrievalQueryStrategyMetric(treatment.symbolRecall),
          formatRetrievalQueryStrategyMetric(treatment.symbolF1),
          formatRetrievalQueryStrategyMetric(treatment.factCoverage),
          formatRetrievalQueryStrategyMetric(treatment.irrelevantContextRatio),
          formatRetrievalQueryStrategyNumber(treatment.retrievedTokenCount)
        ])
      )
    )}
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
