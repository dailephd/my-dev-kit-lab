import type { AffectedNeighborhoodAssessmentV1 } from "./affectedNeighborhood.js";

// ---------------------------------------------------------------------------
// v0.6.2 Batch 4 extraction (allowed refactor per the frozen batch prompt,
// section 15/67): the exact six-affected-neighborhood-metric conversion that
// previously lived only inside src/experiments/plugins/warmIndexReuse/metrics.ts
// is now one generic owner both warm-index-reuse and incremental-change-
// staleness call. Field names, unit assignment (count vs percent), and the
// exact unavailability message wording are preserved byte-for-byte from the
// original warm-index implementation; only the outer wrapper representation
// (WarmIndexNumberMetricV1's `availability`/`source`/`tokenCountMethod`
// envelope) stays owned by each caller, since that envelope is a warm-index
// generic-metric convention, not an affected-neighborhood formula.
// ---------------------------------------------------------------------------

export type AffectedNeighborhoodMetricAvailability = "available" | "unavailable";
export type AffectedNeighborhoodMetricUnit = "count" | "percent";

export type AffectedNeighborhoodMetricValueV1 = {
  availability: AffectedNeighborhoodMetricAvailability;
  value: number | null;
  unit: AffectedNeighborhoodMetricUnit;
  reason: string | null;
};

export type AffectedNeighborhoodMetricField =
  | "changedFileCount"
  | "changedSymbolCount"
  | "affectedNodeCount"
  | "affectedEdgeCount"
  | "taskOverlapCount"
  | "taskOverlapPercent";

export type AffectedNeighborhoodMetricValuesV1 = Record<AffectedNeighborhoodMetricField, AffectedNeighborhoodMetricValueV1>;

const FIELD_LABELS: Record<AffectedNeighborhoodMetricField, string> = {
  changedFileCount: "the changed indexed file count",
  changedSymbolCount: "the changed baseline symbol count",
  affectedNodeCount: "the affected graph node count",
  affectedEdgeCount: "the affected graph edge count",
  taskOverlapCount: "the task-overlap node count",
  taskOverlapPercent: "the task-overlap percent"
};

/**
 * Converts a persisted (or in-memory) affected-neighborhood assessment into the six frozen v0.6.1
 * metrics, once. A finite value (including zero) is available; a missing assessment or a null
 * field is unavailable with a bounded reason, never zero. Pure; this is the ONLY owner of this
 * conversion, reused unchanged by every caller.
 */
export function toAffectedNeighborhoodMetricValues(
  assessment: AffectedNeighborhoodAssessmentV1 | null | undefined,
  noAssessmentReason: string
): AffectedNeighborhoodMetricValuesV1 {
  const one = (field: AffectedNeighborhoodMetricField): AffectedNeighborhoodMetricValueV1 => {
    const unit: AffectedNeighborhoodMetricUnit = field === "taskOverlapPercent" ? "percent" : "count";
    if (!assessment) {
      return { availability: "unavailable", value: null, unit, reason: noAssessmentReason };
    }
    const value = assessment[field];
    if (typeof value === "number") {
      return { availability: "available", value, unit, reason: null };
    }
    const context =
      `assessment ${assessment.status}; seed mapping ${assessment.seedMappingStatus}; ` +
      `graph ${assessment.graphEvidenceStatus}; neighborhood ${assessment.neighborhoodStatus}; task mapping ${assessment.taskMapping.status}` +
      (field === "taskOverlapPercent" ? `; resolvable task nodes ${assessment.taskMapping.resolvableTaskNodeCount}` : "");
    return {
      availability: "unavailable",
      value: null,
      unit,
      reason: `Affected-neighborhood evidence did not establish ${FIELD_LABELS[field]} (${context}).`
    };
  };
  return {
    changedFileCount: one("changedFileCount"),
    changedSymbolCount: one("changedSymbolCount"),
    affectedNodeCount: one("affectedNodeCount"),
    affectedEdgeCount: one("affectedEdgeCount"),
    taskOverlapCount: one("taskOverlapCount"),
    taskOverlapPercent: one("taskOverlapPercent")
  };
}

export const AFFECTED_NEIGHBORHOOD_METRIC_FIELDS: readonly AffectedNeighborhoodMetricField[] = [
  "changedFileCount",
  "changedSymbolCount",
  "affectedNodeCount",
  "affectedEdgeCount",
  "taskOverlapCount",
  "taskOverlapPercent"
];
