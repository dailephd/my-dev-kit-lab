// v0.4.4 Batch 2: allocation-evidence metrics, read directly from the frozen my-dev-kit
// EvidenceGroup/TruncationRecord fields already preserved by the existing v0.4.3 readers.
// The lab never derives allocation from character/token counts and never infers a value
// the producer does not expose (e.g. cross-group borrowing is always unavailable, because
// no frozen my-dev-kit artifact field exposes it).
import type { EvidenceGroup } from "../upstreamArtifacts/index.js";
import type { ProducerReadinessAllocationExpectationV1 } from "../stageContextExpectations/index.js";
import type { StageContextCountMetricV1, StageContextExpectationMatchV1 } from "./types.js";
import type { AllocationCapacityFactV1, AllocationMetricsV1, RequiredEvidenceOmittedEntryV1 } from "./producerReadinessMetricTypes.js";

const NO_BORROW_EVIDENCE_REASON =
  "The frozen my-dev-kit artifacts do not expose cross-group capacity borrowing evidence.";

export function calculateAllocationFactsForGroups(
  evidenceGroups: readonly EvidenceGroup[],
  sourceArtifact: "context-capsule" | "retrieval-audit-record",
  sourceInstance: string
): Pick<AllocationMetricsV1, "requiredGroupCapacity" | "usedReservation" | "borrowedCapacity" | "unusedCapacity"> {
  const requiredGroupCapacity: AllocationCapacityFactV1[] = [];
  const usedReservation: AllocationCapacityFactV1[] = [];
  const borrowedCapacity: AllocationCapacityFactV1[] = [];
  const unusedCapacity: AllocationCapacityFactV1[] = [];

  for (const group of evidenceGroups) {
    requiredGroupCapacity.push({
      groupId: group.id,
      sourceArtifact,
      sourceInstance,
      value: group.limit,
      unit: "items",
      availability: group.limit === null ? "unavailable" : "available",
      reason: group.limit === null ? "No hard limit is declared for this evidence group." : null
    });

    usedReservation.push({
      groupId: group.id,
      sourceArtifact,
      sourceInstance,
      value: group.usedCount,
      unit: "items",
      availability: "available",
      reason: null
    });

    borrowedCapacity.push({
      groupId: group.id,
      sourceArtifact,
      sourceInstance,
      value: null,
      unit: "items",
      availability: "unavailable",
      reason: NO_BORROW_EVIDENCE_REASON
    });

    if (group.limit === null) {
      unusedCapacity.push({
        groupId: group.id,
        sourceArtifact,
        sourceInstance,
        value: null,
        unit: "items",
        availability: "unavailable",
        reason: "No hard limit is declared for this evidence group, so unused capacity cannot be computed."
      });
      continue;
    }
    const unused = group.limit - group.usedCount;
    if (unused < 0) {
      unusedCapacity.push({
        groupId: group.id,
        sourceArtifact,
        sourceInstance,
        value: null,
        unit: "items",
        availability: "unavailable",
        reason: `Computed unused capacity was negative (used ${group.usedCount} exceeds limit ${group.limit}); treated as a data inconsistency rather than a valid value.`
      });
      continue;
    }
    unusedCapacity.push({
      groupId: group.id,
      sourceArtifact,
      sourceInstance,
      value: unused,
      unit: "items",
      availability: "available",
      reason: null
    });
  }

  return { requiredGroupCapacity, usedReservation, borrowedCapacity, unusedCapacity };
}

export function calculateRequiredEvidenceOmitted(
  matches: readonly StageContextExpectationMatchV1[],
  sourceArtifactTruncated: Record<string, boolean>
): { metric: StageContextCountMetricV1; entries: RequiredEvidenceOmittedEntryV1[] } {
  const missing = matches.filter((m) => m.inclusion === "required" && m.outcome === "missing");
  if (missing.length === 0) {
    return {
      metric: { availability: "not-applicable", count: null, evidenceKeys: [], reason: "No required expectation is missing from observed evidence." },
      entries: []
    };
  }
  const entries: RequiredEvidenceOmittedEntryV1[] = missing.map((m) => ({
    evidenceKey: m.targetKey,
    groupId: null,
    truncationReported: sourceArtifactTruncated[m.sourceArtifact] ?? false,
    sourceArtifact: m.sourceArtifact
  }));
  return {
    metric: { availability: "available", count: entries.length, evidenceKeys: entries.map((e) => e.evidenceKey), reason: null },
    entries
  };
}

// Not currently consumed by the calculators above, but kept available for callers that
// want to cross-check allocation expectations directly (bounded, deterministic; the lab
// still never recalculates the producer's allocation decision).
export function findAllocationExpectationForGroup(
  expectations: readonly ProducerReadinessAllocationExpectationV1[] | undefined,
  groupId: string
): ProducerReadinessAllocationExpectationV1 | undefined {
  return (expectations ?? []).find((e) => e.groupId === groupId);
}
