// v0.6.3 -- shared semantic content for the V2 text and HTML renderers, so both present exactly the same
// persisted facts. Formatting only: no classification, arithmetic, or recomputation. Unavailable evidence
// is written as words ("unavailable", "not applicable"), never as zero.

import type { AffectedNeighborhoodAssessmentV1 } from "../../evaluation/affectedNeighborhood.js";
import { STALE_RISK_CLASSIFICATION_EXPLANATIONS } from "./buildIncrementalChangeStalenessReport.js";
import {
  COMPARISON_PRESENTATION,
  PARTIAL_REFERENCE_CLASSIFICATION_EXPLANATIONS,
  TREATMENT_PRESENTATION,
  findReportComparison,
  findReportTreatment
} from "./buildIncrementalChangeStalenessReportV2.js";
import { REINDEX_RECOMMENDATION_EXPLANATIONS } from "./buildWarmIndexReuseReport.js";
import type {
  IncrementalChangeStalenessReportReferenceComparisonV2,
  IncrementalChangeStalenessReportScenarioV2,
  IncrementalChangeStalenessReportTreatmentV2
} from "./incrementalChangeStalenessReportModelV2.js";

export type ReportRow = [label: string, value: string];

export function display(value: string | number | boolean | null | undefined, missing = "unavailable"): string {
  return value === null || value === undefined ? missing : String(value);
}

export type ReportTreatmentBlock = {
  label: string;
  available: boolean;
  rows: ReportRow[];
  /** Present only for an incremental treatment that fell back to a full rebuild. */
  fallbackStatement: string | null;
  refreshRows: ReportRow[];
  forcedNeighborSample: string[] | null;
  filesRead: string[];
  requiredFiles: string[];
  observedFiles: string[];
  missingFiles: string[];
};

export function treatmentBlock(scenario: IncrementalChangeStalenessReportScenarioV2, treatmentId: IncrementalChangeStalenessReportTreatmentV2["treatmentId"], label: string): ReportTreatmentBlock {
  const treatment = findReportTreatment(scenario, treatmentId);
  if (!treatment) {
    return { label, available: false, rows: [], fallbackStatement: null, refreshRows: [], forcedNeighborSample: null, filesRead: [], requiredFiles: [], observedFiles: [], missingFiles: [] };
  }
  const retrieval = treatment.retrieval;
  const correctness = treatment.fakeAgent?.correctness;
  const refresh = treatment.refreshExecution;
  const rows: ReportRow[] = [
    ["Treatment status", treatment.status],
    ["Treatment intent", treatment.treatmentIntent],
    ["Failure reason", display(treatment.failureReason, "not applicable")],
    ["Active index phase", treatment.activeIndexPhase],
    ["Baseline freshness", treatment.baselineFreshness.status],
    ["Refreshed freshness", display(treatment.refreshedFreshness?.status, "not applicable")],
    ["Retrieval status", retrieval.status],
    ["Context characters", retrieval.status === "not-run" ? "unavailable" : String(retrieval.totalChars)],
    ["Estimated context tokens", retrieval.status === "not-run" ? "unavailable" : String(retrieval.totalEstimatedTokens)],
    ["Retrieval duration (ms)", retrieval.status === "not-run" ? "unavailable" : String(retrieval.durationMs)],
    ["Fake-agent status", display(treatment.fakeAgent?.status, "not run")],
    ["Correctness score", correctness && correctness.available && correctness.score !== null ? String(correctness.score) : "unavailable"],
    ["Required-file evidence", treatment.requiredFileEvidence.status],
    ["Required-file reason", display(treatment.requiredFileEvidence.reason, "not applicable")],
    ["Affected-neighborhood relationship", treatment.affectedNeighborhood.relationship],
    ["Reindex recommendation (observational)", treatment.affectedNeighborhood.reindexRecommendation]
  ];

  const refreshRows: ReportRow[] = [
    ["Refresh kind", refresh.kind],
    ["Refresh realization", refresh.realization]
  ];
  let fallbackStatement: string | null = null;
  let forcedNeighborSample: string[] | null = null;
  if (refresh.kind === "incremental") {
    const upstream = refresh.incrementalRefresh;
    refreshRows.push(
      ["Requested scope", upstream.requestedScope],
      ["Applied scope", upstream.appliedScope],
      ["Selection status", upstream.selectionStatus],
      ["Fallback reason", display(upstream.fallbackReason, "not applicable")],
      ["Fresh extraction files", String(upstream.freshExtractionFileCount)],
      ["Reused files", String(upstream.reusedFileCount)],
      ["Forced-neighbor reanalysis files", String(upstream.forcedNeighborReanalysisFileCount)],
      ["Upstream seed files", display(upstream.seedFileCount, "not recorded")],
      ["Upstream seed symbols", display(upstream.seedSymbolCount, "not recorded")],
      ["Upstream affected nodes", display(upstream.affectedNodeCount, "not recorded")],
      ["Upstream affected edges", display(upstream.affectedEdgeCount, "not recorded")]
    );
    forcedNeighborSample = [...upstream.forcedNeighborSample];
    if (refresh.realization === "FALLBACK_FULL") {
      fallbackStatement = `FALLBACK_FULL: requested ${upstream.requestedScope}, applied ${upstream.appliedScope}, selection status ${upstream.selectionStatus}, reason ${display(upstream.fallbackReason, "not recorded")}. The requested partial refresh was not applied; a full rebuild produced this index.`;
    }
  } else {
    refreshRows.push(["Upstream incremental refresh evidence", "not applicable"]);
  }

  return {
    label,
    available: true,
    rows,
    fallbackStatement,
    refreshRows,
    forcedNeighborSample,
    filesRead: [...retrieval.filesRead],
    requiredFiles: [...treatment.requiredFileEvidence.requiredFiles],
    observedFiles: [...treatment.requiredFileEvidence.observedFiles],
    missingFiles: [...treatment.requiredFileEvidence.missingFiles]
  };
}

export type ReportComparisonBlock = {
  label: string;
  available: boolean;
  rows: ReportRow[];
  reasonCodes: string[];
  explanation: string;
};

export function comparisonBlock(scenario: IncrementalChangeStalenessReportScenarioV2, presentation: { candidate: IncrementalChangeStalenessReportTreatmentV2["treatmentId"]; label: string }): ReportComparisonBlock {
  const comparison: IncrementalChangeStalenessReportReferenceComparisonV2 | null = findReportComparison(scenario, presentation.candidate);
  if (!comparison) return { label: presentation.label, available: false, rows: [], reasonCodes: [], explanation: "" };
  if (comparison.kind === "stale-risk") {
    const value = comparison.comparison;
    return {
      label: presentation.label,
      available: true,
      rows: [
        ["Correctness relation", value.correctnessRelation],
        ["Required-file evidence relation", value.requiredFileEvidenceRelation],
        ["Stale-risk classification", value.staleRiskClassification]
      ],
      reasonCodes: [...value.reasonCodes],
      explanation: STALE_RISK_CLASSIFICATION_EXPLANATIONS[value.staleRiskClassification]
    };
  }
  return {
    label: presentation.label,
    available: true,
    rows: [
      ["Refresh realization", display(comparison.refreshRealization, "not recorded")],
      ["Candidate correctness relation", comparison.correctnessRelation],
      ["Candidate required-file relation", comparison.requiredFileEvidenceRelation],
      ["Reference classification", comparison.classification]
    ],
    reasonCodes: [...comparison.reasonCodes],
    explanation: PARTIAL_REFERENCE_CLASSIFICATION_EXPLANATIONS[comparison.classification]
  };
}

export const TREATMENT_PRESENTATION_ORDER = TREATMENT_PRESENTATION;
export const COMPARISON_PRESENTATION_ORDER = COMPARISON_PRESENTATION;

/**
 * Baseline affected-neighborhood evidence is symmetric by construction of the execution; the report
 * presents it once only when the persisted relationship and recommendation agree, and otherwise says so.
 */
export function affectedNeighborhoodSummary(
  scenario: IncrementalChangeStalenessReportScenarioV2
): { state: "none" } | { state: "inconsistent" } | { state: "ok"; rows: ReportRow[]; explanation: string } {
  const assessments = TREATMENT_PRESENTATION.map((entry) => findReportTreatment(scenario, entry.id)?.affectedNeighborhood ?? null).filter(
    (assessment): assessment is AffectedNeighborhoodAssessmentV1 => assessment !== null
  );
  if (assessments.length === 0) return { state: "none" };
  const first = assessments[0];
  if (assessments.some((a) => a.relationship !== first.relationship || a.reindexRecommendation !== first.reindexRecommendation)) return { state: "inconsistent" };
  const number = (value: number | null) => display(value);
  return {
    state: "ok",
    rows: [
      ["Relationship", first.relationship],
      ["Reindex recommendation (observational)", first.reindexRecommendation],
      ["Changed indexed files", number(first.changedFileCount)],
      ["Changed baseline symbols", number(first.changedSymbolCount)],
      ["Affected graph nodes", number(first.affectedNodeCount)],
      ["Affected graph edges", number(first.affectedEdgeCount)],
      ["Task-overlap nodes", number(first.taskOverlapCount)],
      ["Task-overlap percent", number(first.taskOverlapPercent)]
    ],
    explanation: REINDEX_RECOMMENDATION_EXPLANATIONS[first.reindexRecommendation]
  };
}

export const EVIDENCE_FAMILY_NOTE =
  "Lab affected-neighborhood evidence describes the baseline graph neighborhood implicated by the controlled change. Upstream refresh evidence describes what my-dev-kit actually refreshed. They are different evidence families.";

export const SCENARIO_SUMMARY_ROWS = (summary: import("../../experiments/plugins/incrementalChangeStaleness/executionArtifactV2.js").IncrementalChangeStalenessExecutionSummaryV2): ReportRow[] => [
  ["Scenarios", String(summary.scenarioCount)],
  ["Ready", String(summary.readyScenarioCount)],
  ["Failed", String(summary.failedScenarioCount)],
  ["No refresh: observed stale regression", String(summary.staleObservedRegressionCount)],
  ["No refresh: no observed stale regression", String(summary.staleNoObservedRegressionCount)],
  ["No refresh: inconclusive", String(summary.staleInconclusiveCount)],
  ["Changed-files: applied partial", String(summary.changedFilesAppliedPartialCount)],
  ["Changed-files: fallback to full", String(summary.changedFilesFallbackFullCount)],
  ["Affected-neighborhood: applied partial", String(summary.affectedNeighborhoodAppliedPartialCount)],
  ["Affected-neighborhood: fallback to full", String(summary.affectedNeighborhoodFallbackFullCount)],
  ["Changed-files: observed regression relative to full", String(summary.changedFilesObservedRegressionRelativeToFullCount)],
  ["Changed-files: no observed regression relative to full", String(summary.changedFilesNoObservedRegressionRelativeToFullCount)],
  ["Changed-files: inconclusive", String(summary.changedFilesInconclusiveCount)],
  ["Changed-files: not comparable as partial refresh", String(summary.changedFilesNotComparableCount)],
  ["Affected-neighborhood: observed regression relative to full", String(summary.affectedNeighborhoodObservedRegressionRelativeToFullCount)],
  ["Affected-neighborhood: no observed regression relative to full", String(summary.affectedNeighborhoodNoObservedRegressionRelativeToFullCount)],
  ["Affected-neighborhood: inconclusive", String(summary.affectedNeighborhoodInconclusiveCount)],
  ["Affected-neighborhood: not comparable as partial refresh", String(summary.affectedNeighborhoodNotComparableCount)]
];
