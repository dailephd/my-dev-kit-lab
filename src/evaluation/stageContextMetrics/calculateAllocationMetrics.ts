// v0.4.4 Batch 2: allocation-evidence metrics, read directly from the frozen my-dev-kit
// EvidenceGroup/TruncationRecord fields already preserved by the existing v0.4.3 readers.
// The lab never derives allocation from character/token counts and never infers a value
// the producer does not expose (e.g. cross-group borrowing is always unavailable, because
// no frozen my-dev-kit artifact field exposes it).
import type { EvidenceGroup, GroupTruncationEntry } from "../upstreamArtifacts/index.js";
import type { ProducerReadinessAllocationExpectationV1 } from "../stageContextExpectations/index.js";
import type { StageContextCountMetricV1, StageContextExpectationMatchV1 } from "./types.js";
import type {
  AggregateAllocationEvidenceV1,
  AllocationCapacityFactV1,
  AllocationMetricsV1,
  GroupAllocationMetricsV1,
  PerGroupAllocationEvidenceV1,
  RequiredEvidenceOmittedEntryV1,
  SpilloverDiagnosticsV1
} from "./producerReadinessMetricTypes.js";

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

// v0.4.5 Batch 2: per-group/aggregate allocation and spillover evidence, read directly from
// ContextCapsule.groupTruncation (the Batch 1 mirror of the v1.10.3/v1.10.4 required-first
// allocator diagnostics). A group entry that lacks every additive allocation field is
// legacy/unavailable, never fabricated as zero. RetrievalAuditRecord has no groupTruncation
// field, so this evidence is context-capsule-only (sourceArtifact is always fixed).

function hasAnyAllocationField(entry: GroupTruncationEntry): boolean {
  return (
    entry.required !== undefined ||
    entry.reservation !== undefined ||
    entry.initiallySelectedCount !== undefined ||
    entry.unusedReservationContributed !== undefined ||
    entry.borrowedCapacity !== undefined ||
    entry.requiredOmittedCount !== undefined ||
    entry.optionalOmittedCount !== undefined ||
    entry.adequacyAffected !== undefined ||
    entry.governingHardBound !== undefined ||
    entry.aggregateCapacityUsed !== undefined ||
    entry.aggregateCapacityRemaining !== undefined
  );
}

function calculatePerGroupAllocation(entries: readonly GroupTruncationEntry[], sourceInstance: string): PerGroupAllocationEvidenceV1[] {
  return entries.map((entry) => {
    const available = hasAnyAllocationField(entry);
    return {
      groupId: entry.groupId,
      sourceArtifact: "context-capsule",
      sourceInstance,
      availability: available ? "available" : "unavailable",
      required: entry.required ?? null,
      reservation: entry.reservation ?? null,
      initiallySelectedCount: entry.initiallySelectedCount ?? null,
      unusedReservationContributed: entry.unusedReservationContributed ?? null,
      borrowedCapacity: entry.borrowedCapacity ?? null,
      governingHardBound: entry.governingHardBound ?? null,
      requiredOmittedCount: entry.requiredOmittedCount ?? null,
      optionalOmittedCount: entry.optionalOmittedCount ?? null,
      droppedCount: entry.droppedCount,
      droppedEvidenceIds: entry.droppedEvidenceIds ?? [],
      adequacyAffected: entry.adequacyAffected ?? null,
      aggregateCapacityUsed: entry.aggregateCapacityUsed ?? null,
      aggregateCapacityRemaining: entry.aggregateCapacityRemaining ?? null,
      reason: available ? null : `Group "${entry.groupId}" exposes no v1.10.3/v1.10.4 allocation diagnostics (legacy schema-major-1 evidence).`
    };
  });
}

function sumIfComplete(entries: readonly GroupTruncationEntry[], field: keyof GroupTruncationEntry): number | null {
  if (entries.length === 0) return null;
  let total = 0;
  for (const entry of entries) {
    const value = entry[field];
    if (typeof value !== "number") return null;
    total += value;
  }
  return total;
}

function calculateAggregateAllocation(entries: readonly GroupTruncationEntry[]): AggregateAllocationEvidenceV1 {
  if (entries.length === 0) {
    return {
      availability: "not-applicable",
      groupCount: 0,
      totalReservation: null,
      totalInitiallySelected: null,
      totalUnusedReservationContributed: null,
      totalBorrowedCapacity: null,
      totalRequiredOmitted: null,
      totalOptionalOmitted: null,
      totalDropped: null,
      groupsContributingUnusedReservation: [],
      groupsBorrowingCapacity: [],
      groupsWithRequiredOmission: [],
      groupsWithOptionalOnlyOmission: [],
      groupsWithAdequacyAffected: [],
      partial: false,
      reason: "No evidence groups were supplied."
    };
  }

  const anyAllocationEvidence = entries.some(hasAnyAllocationField);
  if (!anyAllocationEvidence) {
    return {
      availability: "unavailable",
      groupCount: entries.length,
      totalReservation: null,
      totalInitiallySelected: null,
      totalUnusedReservationContributed: null,
      totalBorrowedCapacity: null,
      totalRequiredOmitted: null,
      totalOptionalOmitted: null,
      totalDropped: null,
      groupsContributingUnusedReservation: [],
      groupsBorrowingCapacity: [],
      groupsWithRequiredOmission: [],
      groupsWithOptionalOnlyOmission: [],
      groupsWithAdequacyAffected: [],
      partial: false,
      reason: "No group exposes v1.10.3/v1.10.4 allocation diagnostics (legacy schema-major-1 evidence)."
    };
  }

  const totalReservation = sumIfComplete(entries, "reservation");
  const totalInitiallySelected = sumIfComplete(entries, "initiallySelectedCount");
  const totalUnusedReservationContributed = sumIfComplete(entries, "unusedReservationContributed");
  const totalBorrowedCapacity = sumIfComplete(entries, "borrowedCapacity");
  const totalRequiredOmitted = sumIfComplete(entries, "requiredOmittedCount");
  const totalOptionalOmitted = sumIfComplete(entries, "optionalOmittedCount");
  const totalDropped = sumIfComplete(entries, "droppedCount");

  const totals = [
    totalReservation,
    totalInitiallySelected,
    totalUnusedReservationContributed,
    totalBorrowedCapacity,
    totalRequiredOmitted,
    totalOptionalOmitted
  ];
  const partial = totals.some((t) => t === null);

  return {
    availability: "available",
    groupCount: entries.length,
    totalReservation,
    totalInitiallySelected,
    totalUnusedReservationContributed,
    totalBorrowedCapacity,
    totalRequiredOmitted,
    totalOptionalOmitted,
    totalDropped,
    groupsContributingUnusedReservation: entries.filter((e) => (e.unusedReservationContributed ?? 0) > 0).map((e) => e.groupId),
    groupsBorrowingCapacity: entries.filter((e) => (e.borrowedCapacity ?? 0) > 0).map((e) => e.groupId),
    groupsWithRequiredOmission: entries.filter((e) => (e.requiredOmittedCount ?? 0) > 0).map((e) => e.groupId),
    groupsWithOptionalOnlyOmission: entries
      .filter((e) => (e.optionalOmittedCount ?? 0) > 0 && (e.requiredOmittedCount ?? 0) === 0)
      .map((e) => e.groupId),
    groupsWithAdequacyAffected: entries.filter((e) => e.adequacyAffected === true).map((e) => e.groupId),
    partial,
    reason: partial ? "At least one group lacks the full allocation field set; incomplete totals are reported as null rather than partially summed." : null
  };
}

function calculateSpillover(entries: readonly GroupTruncationEntry[]): SpilloverDiagnosticsV1 {
  const anyAllocationEvidence = entries.some(hasAnyAllocationField);
  if (!anyAllocationEvidence) {
    return {
      availability: "unavailable",
      groupsContributing: [],
      groupsBorrowing: [],
      totalContributed: null,
      totalBorrowed: null,
      contributionCoversBorrowing: null,
      reason: "No group exposes v1.10.3/v1.10.4 allocation diagnostics (legacy schema-major-1 evidence)."
    };
  }

  const groupsContributing = entries.filter((e) => (e.unusedReservationContributed ?? 0) > 0).map((e) => e.groupId);
  const groupsBorrowing = entries.filter((e) => (e.borrowedCapacity ?? 0) > 0).map((e) => e.groupId);
  const totalContributed = sumIfComplete(entries, "unusedReservationContributed");
  const totalBorrowed = sumIfComplete(entries, "borrowedCapacity");

  return {
    availability: "available",
    groupsContributing,
    groupsBorrowing,
    totalContributed,
    totalBorrowed,
    contributionCoversBorrowing: totalContributed !== null && totalBorrowed !== null ? totalContributed >= totalBorrowed : null,
    reason: null
  };
}

export function calculateGroupAllocationMetrics(
  groupTruncation: readonly GroupTruncationEntry[] | undefined,
  sourceInstance: string
): GroupAllocationMetricsV1 {
  const entries = groupTruncation ?? [];
  return {
    perGroup: calculatePerGroupAllocation(entries, sourceInstance),
    aggregate: calculateAggregateAllocation(entries),
    spillover: calculateSpillover(entries)
  };
}
