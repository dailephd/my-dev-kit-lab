import { describe, expect, it } from "vitest";
import { calculateGroupAllocationMetrics } from "../../../src/evaluation/stageContextMetrics/calculateAllocationMetrics.js";
import type { GroupTruncationEntry } from "../../../src/evaluation/upstreamArtifacts/index.js";

function fullEntry(overrides: Partial<GroupTruncationEntry> = {}): GroupTruncationEntry {
  return {
    groupId: "implementation-owners",
    limit: 2,
    availableCount: 1,
    usedCount: 1,
    truncated: false,
    droppedCount: 0,
    droppedEvidenceIds: [],
    required: true,
    reservation: 2,
    initiallySelectedCount: 1,
    unusedReservationContributed: 1,
    borrowedCapacity: 0,
    requiredOmittedCount: 0,
    optionalOmittedCount: 0,
    adequacyAffected: false,
    governingHardBound: 4,
    aggregateCapacityUsed: 1,
    aggregateCapacityRemaining: 3,
    ...overrides
  };
}

function legacyEntry(overrides: Partial<GroupTruncationEntry> = {}): GroupTruncationEntry {
  return { groupId: "implementation-owners", limit: null, availableCount: 1, usedCount: 1, truncated: false, droppedCount: 0, ...overrides };
}

describe("calculateGroupAllocationMetrics: per-group evidence", () => {
  it("retains the exact per-group allocation fields for a current v1.10.4 group", () => {
    const result = calculateGroupAllocationMetrics([fullEntry()], "implementation");
    expect(result.perGroup[0]).toMatchObject({
      groupId: "implementation-owners",
      sourceArtifact: "context-capsule",
      sourceInstance: "implementation",
      availability: "available",
      required: true,
      reservation: 2,
      initiallySelectedCount: 1,
      unusedReservationContributed: 1,
      borrowedCapacity: 0,
      governingHardBound: 4,
      requiredOmittedCount: 0,
      optionalOmittedCount: 0,
      adequacyAffected: false,
      aggregateCapacityUsed: 1,
      aggregateCapacityRemaining: 3
    });
  });

  it("reports a legacy group (no additive fields) as unavailable rather than zero", () => {
    const result = calculateGroupAllocationMetrics([legacyEntry()], "implementation");
    const entry = result.perGroup[0];
    expect(entry.availability).toBe("unavailable");
    expect(entry.reservation).toBeNull();
    expect(entry.required).toBeNull();
    expect(entry.reason).toContain("legacy");
  });

  it("undefined groupTruncation input reports empty evidence, not fabricated groups", () => {
    const result = calculateGroupAllocationMetrics(undefined, "implementation");
    expect(result.perGroup).toEqual([]);
    expect(result.aggregate.availability).toBe("not-applicable");
  });
});

describe("calculateGroupAllocationMetrics: aggregate evidence", () => {
  it("sums totals only when every group supplies the field", () => {
    const result = calculateGroupAllocationMetrics(
      [fullEntry({ groupId: "a", reservation: 2 }), fullEntry({ groupId: "b", reservation: 3 })],
      "implementation"
    );
    expect(result.aggregate).toMatchObject({ availability: "available", groupCount: 2, totalReservation: 5, partial: false });
  });

  it("reports partial aggregation with null totals when one group lacks a field", () => {
    const result = calculateGroupAllocationMetrics(
      [fullEntry({ groupId: "a" }), legacyEntry({ groupId: "b" })],
      "implementation"
    );
    // At least one group (b) exposes no allocation evidence at all, but group "a" does, so
    // the aggregate is available with partial totals rather than unavailable outright.
    expect(result.aggregate.availability).toBe("available");
    expect(result.aggregate.totalReservation).toBeNull();
    expect(result.aggregate.partial).toBe(true);
  });

  it("reports unavailable when no group exposes any allocation evidence", () => {
    const result = calculateGroupAllocationMetrics([legacyEntry({ groupId: "a" }), legacyEntry({ groupId: "b" })], "implementation");
    expect(result.aggregate.availability).toBe("unavailable");
    expect(result.aggregate.totalReservation).toBeNull();
  });

  it("classifies groups with required omission separately from optional-only omission", () => {
    const result = calculateGroupAllocationMetrics(
      [
        fullEntry({ groupId: "required-loss", requiredOmittedCount: 1, optionalOmittedCount: 0, adequacyAffected: true }),
        fullEntry({ groupId: "optional-only", requiredOmittedCount: 0, optionalOmittedCount: 2, adequacyAffected: false })
      ],
      "implementation"
    );
    expect(result.aggregate.groupsWithRequiredOmission).toEqual(["required-loss"]);
    expect(result.aggregate.groupsWithOptionalOnlyOmission).toEqual(["optional-only"]);
    expect(result.aggregate.groupsWithAdequacyAffected).toEqual(["required-loss"]);
  });
});

describe("calculateGroupAllocationMetrics: spillover diagnostics", () => {
  it("reports contributing and borrowing groups descriptively without enforcing conservation", () => {
    const result = calculateGroupAllocationMetrics(
      [fullEntry({ groupId: "donor", unusedReservationContributed: 1, borrowedCapacity: 0 }), fullEntry({ groupId: "borrower", unusedReservationContributed: 0, borrowedCapacity: 1 })],
      "implementation"
    );
    expect(result.spillover.groupsContributing).toEqual(["donor"]);
    expect(result.spillover.groupsBorrowing).toEqual(["borrower"]);
    expect(result.spillover.totalContributed).toBe(1);
    expect(result.spillover.totalBorrowed).toBe(1);
    expect(result.spillover.contributionCoversBorrowing).toBe(true);
  });

  it("unborrowed donated capacity is not treated as a violated invariant", () => {
    const result = calculateGroupAllocationMetrics(
      [fullEntry({ groupId: "donor", unusedReservationContributed: 3, borrowedCapacity: 0 })],
      "implementation"
    );
    expect(result.spillover.contributionCoversBorrowing).toBe(true);
    expect(result.spillover.totalBorrowed).toBe(0);
  });

  it("reports unavailable spillover for legacy evidence", () => {
    const result = calculateGroupAllocationMetrics([legacyEntry()], "implementation");
    expect(result.spillover.availability).toBe("unavailable");
  });
});
