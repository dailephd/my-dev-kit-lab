// v0.6.3 -- V2 HTML section for the incremental-change-staleness plugin report. Renders the same persisted
// facts as the text renderer through the shared row builders; every persisted string is HTML-escaped.

import {
  COMPARISON_PRESENTATION_ORDER,
  EVIDENCE_FAMILY_NOTE,
  SCENARIO_SUMMARY_ROWS,
  TREATMENT_PRESENTATION_ORDER,
  affectedNeighborhoodSummary,
  comparisonBlock,
  treatmentBlock,
  type ReportRow
} from "./incrementalChangeStalenessReportRowsV2.js";
import type { IncrementalChangeStalenessReportScenarioV2, IncrementalChangeStalenessReportV2 } from "./incrementalChangeStalenessReportModelV2.js";

const MAX_DISPLAY_ITEMS = 20;

export function renderIncrementalChangeStalenessHtmlV2(section: IncrementalChangeStalenessReportV2): string {
  return `<section>
    <h2>Incremental-Change And Staleness Evidence</h2>
    <p class="muted">Scoped experimental evidence: results are limited to the executed scenarios below. Full refresh is a comparison reference, not a declared best treatment.</p>
    ${table(["Field", "Value"], SCENARIO_SUMMARY_ROWS(section.summary))}
    ${section.scenarios.map(renderScenario).join("\n")}
    <h3>Limitations</h3>
    ${list(section.limitations)}
  </section>`;
}

function renderScenario(scenario: IncrementalChangeStalenessReportScenarioV2): string {
  const lifecycle = scenario.lifecycle;
  const affected = affectedNeighborhoodSummary(scenario);
  return `<h3>Scenario: ${escapeHtml(scenario.scenarioId)}</h3>
    <h4>Scenario Definition</h4>
    ${table(["Field", "Value"], [
      ["Scenario ID", scenario.scenarioId],
      ["Category", scenario.category],
      ["Benchmark project", scenario.benchmarkProjectId],
      ["Base case", scenario.baseCaseId],
      ["Answer policy", scenario.answerPolicy],
      ["Query", scenario.query ?? "unavailable"],
      ["Status", scenario.status],
      ["Failure reason", scenario.failureReason ?? "not applicable"]
    ])}
    <p>Expected files:</p>
    ${boundedList(scenario.expectedFiles)}
    <p>Expected symbols:</p>
    ${boundedList(scenario.expectedSymbols)}
    <h4>Lifecycle Integrity</h4>
    ${
      lifecycle
        ? `${table(
            ["Field", "Value"],
            [
              ["my-dev-kit version", lifecycle.myDevKitVersion ?? "unavailable"],
              ["Index invocations (total)", String(lifecycle.totalIndexInvocationCount)],
              ["Freshness assessments (total)", String(lifecycle.totalFreshnessAssessmentCount)],
              ...Object.entries(lifecycle.preMutationEquivalence).map(([id, result]): ReportRow => [`Pre-mutation equivalence (${id} vs stale-index reference)`, result]),
              ...Object.entries(lifecycle.postMutationEquivalence).map(([id, result]): ReportRow => [`Post-mutation equivalence (${id} vs stale-index reference)`, result])
            ]
          )}<p>Controlled file paths:</p>${boundedList(lifecycle.controlledFilePaths)}<p>Source roots:</p>${boundedList(lifecycle.sourceRoots)}`
        : "<p>Not available for this scenario.</p>"
    }
    <h4>Affected-Neighborhood Evidence (Changed Baseline Neighborhood Relative To The Task)</h4>
    ${
      affected.state === "none"
        ? "<p>Not available.</p>"
        : affected.state === "inconsistent"
          ? "<p>inconsistent persisted evidence</p>"
          : `${table(["Field", "Value"], affected.rows)}<p>${escapeHtml(affected.explanation)}</p>`
    }
    <p class="muted">${escapeHtml(EVIDENCE_FAMILY_NOTE)}</p>
    ${
      scenario.treatments.length === 0
        ? "<h4>Treatments</h4><p>Not produced: the scenario failed before any treatment evidence existed.</p>"
        : TREATMENT_PRESENTATION_ORDER.map((entry) => renderTreatment(scenario, entry)).join("\n")
    }
    <h4>Reference Comparisons (Against The Full-Refresh Reference)</h4>
    ${COMPARISON_PRESENTATION_ORDER.map((entry) => renderComparison(scenario, entry)).join("\n")}`;
}

function renderTreatment(scenario: IncrementalChangeStalenessReportScenarioV2, entry: (typeof TREATMENT_PRESENTATION_ORDER)[number]): string {
  const block = treatmentBlock(scenario, entry.id, entry.label);
  const title = `${block.label} Treatment (${entry.id})`;
  if (!block.available) return `<h4>${escapeHtml(title)}</h4><p>Not available.</p>`;
  return `<h4>${escapeHtml(title)}</h4>
    ${table(["Field", "Value"], block.rows)}
    <p><strong>Refresh Execution</strong> (upstream evidence of what my-dev-kit actually did)</p>
    ${table(["Field", "Value"], block.refreshRows)}
    ${block.fallbackStatement ? `<p class="fallback"><strong>${escapeHtml(block.fallbackStatement)}</strong></p>` : ""}
    ${block.forcedNeighborSample ? `<p>Forced-neighbor sample:</p>${boundedList(block.forcedNeighborSample)}` : ""}
    <p>Files read:</p>
    ${boundedList(block.filesRead)}
    <p>Required files:</p>
    ${boundedList(block.requiredFiles)}
    <p>Observed files:</p>
    ${boundedList(block.observedFiles)}
    <p>Missing files:</p>
    ${boundedList(block.missingFiles)}`;
}

function renderComparison(scenario: IncrementalChangeStalenessReportScenarioV2, entry: (typeof COMPARISON_PRESENTATION_ORDER)[number]): string {
  const block = comparisonBlock(scenario, entry);
  if (!block.available) return `<h5>${escapeHtml(block.label)}</h5><p>Not available.</p>`;
  return `<h5>${escapeHtml(block.label)}</h5>
    ${table(["Field", "Value"], block.rows)}
    <p>Reason codes:</p>
    ${list(block.reasonCodes)}
    <p>${escapeHtml(block.explanation)}</p>`;
}

function boundedList(items: readonly string[]): string {
  if (items.length === 0) return "<p>none</p>";
  const shown = items.slice(0, MAX_DISPLAY_ITEMS);
  const omitted = items.length - shown.length;
  return `${list(shown)}${omitted > 0 ? `<p class="muted">... ${omitted} more</p>` : ""}`;
}

function list(items: readonly string[]): string {
  if (items.length === 0) return "<ul><li>none</li></ul>";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function table(headers: string[], rows: ReadonlyArray<readonly string[]>): string {
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
