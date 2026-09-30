// v0.6.3 -- projects the persisted V2 incremental-change-staleness execution artifact into the V2 report
// model. A deterministic projection only: no retrieval, fake-agent evaluation, correctness scoring,
// affected-neighborhood assessment, freshness assessment, refresh-realization or classification
// recomputation, and no source/index/benchmark reads. The only integrity check is the artifact's own
// contradiction validator, so a hand-edited or corrupted artifact is rejected rather than presented.

import type { ExperimentRun } from "../../experiments/index.js";
import {
  validateIncrementalChangeStalenessScenarioRecordV2,
  type IncrementalChangeStalenessExecutionArtifactV2,
  type IncrementalChangeStalenessScenarioArtifactRecordV2
} from "../../experiments/plugins/incrementalChangeStaleness/executionArtifactV2.js";
import { INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS, type IncrementalChangeStalenessV2TreatmentId } from "../../experiments/plugins/incrementalChangeStaleness/disposableTarget.js";
import type { PartialRefreshReferenceClassificationV2 } from "../../experiments/plugins/incrementalChangeStaleness/comparisonV2.js";
import {
  INCREMENTAL_CHANGE_STALENESS_REPORT_SCHEMA_VERSION_V2,
  type IncrementalChangeStalenessReportReferenceComparisonV2,
  type IncrementalChangeStalenessReportScenarioV2,
  type IncrementalChangeStalenessReportTreatmentV2,
  type IncrementalChangeStalenessReportV2
} from "./incrementalChangeStalenessReportModelV2.js";

// Frozen V2 wording. Every point must appear in report.txt and report.html.
export const LIMITATIONS_V2: string[] = [
  "Results are scoped to the executed deterministic benchmark scenarios and the configured upstream my-dev-kit tool.",
  "Full refresh is a comparison reference, not an asserted optimal strategy.",
  "A partial treatment that falls back to a full rebuild is not evidence about the requested partial-refresh behavior.",
  "\"no-observed-regression-relative-to-full\" means only that the executed scenario did not show a regression under the frozen correctness and required-file evidence dimensions. It does not prove general equivalence or safety, and does not show that full refresh is unnecessary.",
  "Required-file evidence is a bounded answer-key file-presence check, not retrieval precision/recall.",
  "Correctness remains deterministic fake-agent/harness evidence in v0.6.3.",
  "Lab affected-neighborhood evidence (changed baseline neighborhood relative to the task) is distinct from upstream refresh execution evidence (what my-dev-kit actually refreshed).",
  "\"reindexRecommendation\" remains observational evidence; it did not select or trigger any treatment.",
  "\"changedSymbolCount\" does not mean source-level symbol-diff proof; it retains the released v0.6.1 baseline-symbol-identity definition.",
  "The experiment does not use graph-diff."
];

/** Fixed neutral wording per partial-refresh reference classification. Presentation only. */
export const PARTIAL_REFERENCE_CLASSIFICATION_EXPLANATIONS: Record<PartialRefreshReferenceClassificationV2, string> = {
  "observed-regression-relative-to-full":
    "The persisted comparison observed at least one regression relative to the full-refresh reference under the frozen evidence dimensions: correctness and/or required-file presence.",
  "no-observed-regression-relative-to-full":
    "This executed scenario did not show a regression relative to the full-refresh reference under the frozen correctness and required-file evidence dimensions. This does not establish general equivalence or safety, and does not imply that full refresh is unnecessary.",
  inconclusive:
    "Available persisted evidence was insufficient to determine whether a regression relative to the full-refresh reference occurred. Inconclusive is not the same as no regression.",
  "not-comparable-as-partial-refresh":
    "The requested partial-refresh treatment fell back to a full rebuild, so this run does not provide evidence about the requested partial-refresh behavior."
};

/** Presentation order and labels; identity is always resolved by treatment id, never by array position. */
export const TREATMENT_PRESENTATION: ReadonlyArray<{ id: IncrementalChangeStalenessV2TreatmentId; label: string }> = [
  { id: "stale-index", label: "No Refresh" },
  { id: "changed-files-refresh", label: "Changed-Files Refresh" },
  { id: "affected-neighborhood-refresh", label: "Affected-Neighborhood Refresh" },
  { id: "full-refresh", label: "Full Refresh" }
];

export const COMPARISON_PRESENTATION: ReadonlyArray<{ candidate: IncrementalChangeStalenessV2TreatmentId; label: string }> = [
  { candidate: "stale-index", label: "No Refresh vs Full Refresh" },
  { candidate: "changed-files-refresh", label: "Changed-Files Refresh vs Full Refresh" },
  { candidate: "affected-neighborhood-refresh", label: "Affected-Neighborhood Refresh vs Full Refresh" }
];

export function findReportTreatment(
  scenario: Pick<IncrementalChangeStalenessReportScenarioV2, "treatments">,
  treatmentId: IncrementalChangeStalenessV2TreatmentId
): IncrementalChangeStalenessReportTreatmentV2 | null {
  return scenario.treatments.find((treatment) => treatment.treatmentId === treatmentId) ?? null;
}

export function findReportComparison(
  scenario: Pick<IncrementalChangeStalenessReportScenarioV2, "referenceComparisons">,
  candidateTreatmentId: IncrementalChangeStalenessV2TreatmentId
): IncrementalChangeStalenessReportReferenceComparisonV2 | null {
  return scenario.referenceComparisons.find((comparison) => comparison.candidateTreatmentId === candidateTreatmentId && comparison.referenceTreatmentId === "full-refresh") ?? null;
}

export function buildIncrementalChangeStalenessReportV2FromArtifact(artifact: IncrementalChangeStalenessExecutionArtifactV2): IncrementalChangeStalenessReportV2 {
  for (const scenario of artifact.scenarios) validateIncrementalChangeStalenessScenarioRecordV2(scenario);
  return {
    schemaVersion: INCREMENTAL_CHANGE_STALENESS_REPORT_SCHEMA_VERSION_V2,
    pluginId: artifact.pluginId,
    summary: { ...artifact.summary },
    scenarios: artifact.scenarios.map(toReportScenario),
    limitations: [...LIMITATIONS_V2]
  };
}

function toReportScenario(record: IncrementalChangeStalenessScenarioArtifactRecordV2): IncrementalChangeStalenessReportScenarioV2 {
  return {
    scenarioId: record.scenarioId,
    category: record.category,
    benchmarkProjectId: record.benchmarkProjectId,
    baseCaseId: record.baseCaseId,
    status: record.status,
    failureReason: record.failureReason,
    query: record.query,
    answerPolicy: record.answerPolicy,
    expectedFiles: [...record.expectedFiles],
    expectedSymbols: [...record.expectedSymbols],
    lifecycle: record.lifecycle ? structuredClone(record.lifecycle) : null,
    // Persisted order is preserved; consumers resolve identity by id (see findReportTreatment/findReportComparison).
    treatments: record.treatments.map((treatment) => structuredClone(treatment)),
    referenceComparisons: record.referenceComparisons.map((comparison) => structuredClone(comparison))
  };
}

/** Kept for callers that need the fixed id list without importing the plugin layer. */
export const REPORT_TREATMENT_IDS: readonly IncrementalChangeStalenessV2TreatmentId[] = INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS;

export function isV2ReportSection(section: { schemaVersion: string } | null): section is IncrementalChangeStalenessReportV2 {
  return section !== null && section.schemaVersion === INCREMENTAL_CHANGE_STALENESS_REPORT_SCHEMA_VERSION_V2;
}

export type IncrementalChangeStalenessRunForReport = Pick<ExperimentRun, "pluginId" | "metadata" | "artifacts">;
