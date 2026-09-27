// v0.6.2 Batch 5 -- plugin-specific HTML section rendering only. Renders exactly the persisted
// report-model fields; performs no classification, no metric arithmetic, and no percent
// calculation beyond formatting an already-persisted number.

import type {
  IncrementalChangeStalenessReportScenarioV1,
  IncrementalChangeStalenessReportTreatmentV1,
  IncrementalChangeStalenessReportV1
} from "./incrementalChangeStalenessReportModel.js";
import { STALE_RISK_CLASSIFICATION_EXPLANATIONS } from "./buildIncrementalChangeStalenessReport.js";
import { REINDEX_RECOMMENDATION_EXPLANATIONS } from "./buildWarmIndexReuseReport.js";
import type { AffectedNeighborhoodAssessmentV1 } from "../../evaluation/affectedNeighborhood.js";

const MAX_DISPLAY_ITEMS = 20;

export function renderIncrementalChangeStalenessHtml(section: IncrementalChangeStalenessReportV1 | null): string {
  if (section === null) {
    return `<section>
    <h2>Incremental-Change And Staleness Evidence</h2>
    <p>Not applicable to this plugin.</p>
  </section>`;
  }
  return `<section>
    <h2>Incremental-Change And Staleness Evidence</h2>
    <p class="muted">Scoped experimental evidence: results are limited to the executed scenarios below, not a general safety verdict.</p>
    ${table(["Field", "Value"], [
      ["Scenarios", String(section.scenarioCount)],
      ["Ready", String(section.readyScenarioCount)],
      ["Failed", String(section.failedScenarioCount)],
      ["Observed stale regression", String(section.observedStaleRegressionCount)],
      ["No observed stale regression", String(section.noObservedStaleRegressionCount)],
      ["Inconclusive", String(section.inconclusiveCount)]
    ])}
    <h3>Scenario Comparison</h3>
    ${table(
      [
        "Scenario",
        "Category",
        "Status",
        "Relationship",
        "Reindex recommendation",
        "Stale correctness",
        "Full-refresh correctness",
        "Correctness relation",
        "Stale required files",
        "Full-refresh required files",
        "Required-file relation",
        "Stale-risk classification"
      ],
      section.scenarios.map(comparisonRow)
    )}
    ${section.scenarios.map(renderScenarioDetail).join("\n")}
    <h3>Limitations</h3>
    ${list(section.limitations)}
  </section>`;
}

function symmetricAffectedNeighborhood(scenario: IncrementalChangeStalenessReportScenarioV1): AffectedNeighborhoodAssessmentV1 | null {
  const stale = scenario.staleTreatment?.affectedNeighborhood ?? null;
  const fullRefresh = scenario.fullRefreshTreatment?.affectedNeighborhood ?? null;
  if (!stale || !fullRefresh) return null;
  if (stale.relationship !== fullRefresh.relationship || stale.reindexRecommendation !== fullRefresh.reindexRecommendation) {
    return null;
  }
  return stale;
}

function comparisonRow(scenario: IncrementalChangeStalenessReportScenarioV1): string[] {
  const stale = scenario.staleTreatment?.affectedNeighborhood ?? null;
  const fullRefresh = scenario.fullRefreshTreatment?.affectedNeighborhood ?? null;
  const symmetric = symmetricAffectedNeighborhood(scenario);
  const inconsistent = stale !== null && fullRefresh !== null && symmetric === null;
  return [
    `${scenario.scenarioId}`,
    scenario.category,
    scenario.status,
    inconsistent ? "inconsistent persisted evidence" : symmetric?.relationship ?? "not available",
    inconsistent ? "inconsistent persisted evidence" : symmetric?.reindexRecommendation ?? "not available",
    formatCorrectness(scenario.staleTreatment),
    formatCorrectness(scenario.fullRefreshTreatment),
    scenario.comparison.correctnessRelation,
    scenario.staleTreatment?.requiredFileEvidence.status ?? "not available",
    scenario.fullRefreshTreatment?.requiredFileEvidence.status ?? "not available",
    scenario.comparison.requiredFileEvidenceRelation,
    scenario.comparison.staleRiskClassification
  ];
}

function formatCorrectness(treatment: IncrementalChangeStalenessReportTreatmentV1 | null): string {
  if (!treatment || !treatment.fakeAgent) return "unavailable";
  const correctness = treatment.fakeAgent.correctness;
  return correctness.available && correctness.score !== null ? String(correctness.score) : "unavailable";
}

function renderScenarioDetail(scenario: IncrementalChangeStalenessReportScenarioV1): string {
  return `<h3>Scenario: ${escapeHtml(scenario.scenarioId)}</h3>
    ${renderDefinition(scenario)}
    ${renderLifecycle(scenario)}
    ${renderAffectedNeighborhoodSection(scenario)}
    ${renderTreatment("Stale-Index Treatment", scenario.staleTreatment)}
    ${renderTreatment("Full-Refresh Treatment", scenario.fullRefreshTreatment)}
    ${renderComparison(scenario)}`;
}

function renderDefinition(scenario: IncrementalChangeStalenessReportScenarioV1): string {
  return `<h4>Scenario Definition</h4>
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
    ${boundedList(scenario.expectedSymbols)}`;
}

function renderLifecycle(scenario: IncrementalChangeStalenessReportScenarioV1): string {
  const lifecycle = scenario.lifecycle;
  if (!lifecycle) {
    return `<h4>Lifecycle Integrity</h4><p>Not available for this scenario.</p>`;
  }
  return `<h4>Lifecycle Integrity</h4>
    ${table(["Field", "Value"], [
      ["Pre-mutation equivalence", lifecycle.preMutationEquivalence],
      ["Post-mutation equivalence", lifecycle.postMutationEquivalence],
      ["my-dev-kit version", lifecycle.myDevKitVersion ?? "unavailable"],
      ["Stale baseline freshness", lifecycle.staleBaselineFreshnessStatus],
      ["Full-refresh baseline freshness", lifecycle.fullRefreshBaselineFreshnessStatus],
      ["Full-refresh refreshed freshness", lifecycle.fullRefreshRefreshedFreshnessStatus ?? "unavailable"]
    ])}
    <p>Controlled file paths:</p>
    ${boundedList(lifecycle.controlledFilePaths)}
    <p>Source roots:</p>
    ${boundedList(lifecycle.sourceRoots)}`;
}

function renderAffectedNeighborhoodSection(scenario: IncrementalChangeStalenessReportScenarioV1): string {
  const stale = scenario.staleTreatment?.affectedNeighborhood ?? null;
  const fullRefresh = scenario.fullRefreshTreatment?.affectedNeighborhood ?? null;
  if (!stale && !fullRefresh) {
    return `<h4>Affected-Neighborhood Evidence (Changed Baseline Neighborhood Relative To The Task)</h4><p>Not available.</p>`;
  }
  const symmetric = symmetricAffectedNeighborhood(scenario);
  if (!symmetric) {
    return `<h4>Affected-Neighborhood Evidence (Changed Baseline Neighborhood Relative To The Task)</h4><p>inconsistent persisted evidence</p>`;
  }
  const explanation = REINDEX_RECOMMENDATION_EXPLANATIONS[symmetric.reindexRecommendation];
  return `<h4>Affected-Neighborhood Evidence (Changed Baseline Neighborhood Relative To The Task)</h4>
    ${table(["Field", "Value"], [
      ["Relationship", symmetric.relationship],
      ["Reindex recommendation", symmetric.reindexRecommendation],
      ["Changed indexed files", formatAffectedNumber(symmetric.changedFileCount)],
      ["Changed baseline symbols", formatAffectedNumber(symmetric.changedSymbolCount)],
      ["Affected graph nodes", formatAffectedNumber(symmetric.affectedNodeCount)],
      ["Affected graph edges", formatAffectedNumber(symmetric.affectedEdgeCount)],
      ["Task-overlap nodes", formatAffectedNumber(symmetric.taskOverlapCount)],
      ["Task-overlap percent", formatAffectedNumber(symmetric.taskOverlapPercent)]
    ])}
    <p>${escapeHtml(explanation)}</p>`;
}

function renderTreatment(title: string, treatment: IncrementalChangeStalenessReportTreatmentV1 | null): string {
  if (!treatment) {
    return `<h4>${escapeHtml(title)}</h4><p>Not available.</p>`;
  }
  const retrieval = treatment.retrieval;
  const fakeAgent = treatment.fakeAgent;
  const requiredFileEvidence = treatment.requiredFileEvidence;
  return `<h4>${escapeHtml(title)}</h4>
    ${table(["Field", "Value"], [
      ["Treatment status", treatment.status],
      ["Failure reason", treatment.failureReason ?? "not applicable"],
      ["Active index phase", treatment.activeIndexPhase],
      ["Baseline freshness status", treatment.baselineFreshness.status]
    ])}
    <p><strong>Retrieval</strong> (bounded evidence; full retrieved context body is never rendered here)</p>
    ${table(["Field", "Value"], [
      ["Status", retrieval.status],
      ["Selected node ID", retrieval.selectedNodeId ?? "unavailable"],
      ["Selected file", retrieval.selectedFile ?? "unavailable"],
      ["Selected symbol", retrieval.selectedSymbol ?? "unavailable"],
      ["Context characters", String(retrieval.totalChars)],
      ["Estimated context tokens", String(retrieval.totalEstimatedTokens)],
      ["Duration (ms)", String(retrieval.durationMs)]
    ])}
    <p>Files read:</p>
    ${boundedList(retrieval.filesRead)}
    <p>Retrieval warnings:</p>
    ${boundedList(retrieval.warnings)}
    <p><strong>Fake-Agent Evidence</strong> (deterministic fake-agent / simulated harness evidence, not a provider or real-model measurement)</p>
    ${
      fakeAgent
        ? table(["Field", "Value"], [
            ["Status", fakeAgent.status],
            ["Correctness score", fakeAgent.correctness.available && fakeAgent.correctness.score !== null ? String(fakeAgent.correctness.score) : "unavailable"],
            ["Passed", fakeAgent.correctness.passed === null ? "unavailable" : String(fakeAgent.correctness.passed)],
            ["Duration (ms)", fakeAgent.durationMs === null ? "unavailable" : String(fakeAgent.durationMs)]
          ])
        : "<p>Not run for this treatment.</p>"
    }
    <p><strong>Required-File Evidence</strong> (bounded answer-key file-presence check, not retrieval precision/recall)</p>
    ${table(["Field", "Value"], [
      ["Status", requiredFileEvidence.status],
      ["Reason", requiredFileEvidence.reason ?? "not applicable"]
    ])}
    <p>Required files:</p>
    ${boundedList(requiredFileEvidence.requiredFiles)}
    <p>Observed files:</p>
    ${boundedList(requiredFileEvidence.observedFiles)}
    <p>Missing files:</p>
    ${boundedList(requiredFileEvidence.missingFiles)}`;
}

function renderComparison(scenario: IncrementalChangeStalenessReportScenarioV1): string {
  const comparison = scenario.comparison;
  const explanation = STALE_RISK_CLASSIFICATION_EXPLANATIONS[comparison.staleRiskClassification];
  return `<h4>Matched Comparison</h4>
    ${table(["Field", "Value"], [
      ["Correctness relation", comparison.correctnessRelation],
      ["Required-file evidence relation", comparison.requiredFileEvidenceRelation],
      ["Stale-risk classification", comparison.staleRiskClassification]
    ])}
    <p>Reason codes:</p>
    ${list(comparison.reasonCodes)}
    <p>${escapeHtml(explanation)}</p>`;
}

function formatAffectedNumber(value: number | null): string {
  return value === null ? "unavailable" : String(value);
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
