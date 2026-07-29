import { describe, expect, it } from "vitest";
import { calculateAllocationFactsForGroups, calculateRequiredEvidenceOmitted } from "../../../src/evaluation/stageContextMetrics/calculateAllocationMetrics.js";
import type { EvidenceGroup } from "../../../src/evaluation/upstreamArtifacts/index.js";
import type { StageContextExpectationMatchV1 } from "../../../src/evaluation/stageContextMetrics/types.js";

function group(overrides: Partial<EvidenceGroup>): EvidenceGroup {
  return {
    id: "implementation-owners",
    kind: "owners",
    role: "implementation",
    title: "Owners",
    required: true,
    items: [],
    unresolved: [],
    warnings: [],
    limit: 10,
    availableCount: 5,
    usedCount: 5,
    truncated: false,
    droppedCount: 0,
    provenance: "candidate-ranking",
    ...overrides
  };
}

describe("calculateAllocationFactsForGroups", () => {
  // TST-B2-015
  it("required group capacity is preserved with correct source and unit", () => {
    const [facts] = calculateAllocationFactsForGroups([group({ limit: 10 })], "context-capsule", "instance").requiredGroupCapacity;
    expect(facts).toMatchObject({ groupId: "implementation-owners", value: 10, unit: "items", sourceArtifact: "context-capsule", sourceInstance: "instance", availability: "available" });
  });

  // TST-B2-016
  it("used reservation is reported from authoritative evidence", () => {
    const [facts] = calculateAllocationFactsForGroups([group({ usedCount: 7 })], "context-capsule", "instance").usedReservation;
    expect(facts).toMatchObject({ value: 7, availability: "available" });
  });

  // TST-B2-017 / borrowed capacity is not exposed by the frozen my-dev-kit artifacts
  it("borrowed capacity reports unavailable because the frozen producer does not expose it", () => {
    const [facts] = calculateAllocationFactsForGroups([group({})], "context-capsule", "instance").borrowedCapacity;
    expect(facts.availability).toBe("unavailable");
    expect(facts.value).toBeNull();
  });

  // TST-B2-018
  it("unused capacity is calculated only for compatible values", () => {
    const [facts] = calculateAllocationFactsForGroups([group({ limit: 10, usedCount: 6 })], "context-capsule", "instance").unusedCapacity;
    expect(facts).toMatchObject({ value: 4, availability: "available" });
  });

  // TST-B2-019
  it("no declared limit reports unavailable rather than an invalid calculation", () => {
    const [facts] = calculateAllocationFactsForGroups([group({ limit: null, usedCount: 6 })], "context-capsule", "instance").unusedCapacity;
    expect(facts.availability).toBe("unavailable");
    expect(facts.value).toBeNull();
  });

  it("a negative computed unused capacity is reported unavailable with a diagnostic reason", () => {
    const [facts] = calculateAllocationFactsForGroups([group({ limit: 5, usedCount: 8 })], "context-capsule", "instance").unusedCapacity;
    expect(facts.availability).toBe("unavailable");
    expect(facts.value).toBeNull();
    expect(facts.reason).toContain("negative");
  });
});

function matchItem(overrides: Partial<StageContextExpectationMatchV1>): StageContextExpectationMatchV1 {
  return {
    expectationId: "REQ-FILE-001",
    inclusion: "required",
    sourceArtifact: "context-capsule",
    category: "file",
    targetKey: "context-capsule|file|path:src/a.ts",
    outcome: "missing",
    matchedSourceInstances: [],
    matchedSourceFieldPaths: [],
    ...overrides
  };
}

describe("calculateRequiredEvidenceOmitted", () => {
  // TST-B2-020
  it("preserves evidence IDs and reports truncation status per artifact", () => {
    const { metric, entries } = calculateRequiredEvidenceOmitted([matchItem({})], { "context-capsule": true });
    expect(metric).toMatchObject({ availability: "available", count: 1 });
    expect(entries[0]).toMatchObject({ evidenceKey: "context-capsule|file|path:src/a.ts", truncationReported: true, sourceArtifact: "context-capsule" });
  });

  // TST-B2-021
  it("no missing required evidence reports not applicable, not zero", () => {
    const { metric } = calculateRequiredEvidenceOmitted([matchItem({ outcome: "matched" })], {});
    expect(metric.availability).toBe("not-applicable");
    expect(metric.count).toBeNull();
  });
});
