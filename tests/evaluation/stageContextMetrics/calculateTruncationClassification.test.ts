import { describe, expect, it } from "vitest";
import {
  classifyConditionAwareTruncation,
  classifyTruncationRecord,
  classifyTruncationRecords
} from "../../../src/evaluation/stageContextMetrics/calculateTruncationClassification.js";
import type { ContextCapsule, GroupTruncationEntry, RoleConditionCoverage, TruncationRecord } from "../../../src/evaluation/upstreamArtifacts/index.js";

function record(overrides: Partial<TruncationRecord>): TruncationRecord {
  return {
    id: "trunc.001",
    affectedGroup: "implementation-owners",
    limit: 10,
    used: 5,
    available: 5,
    droppedCount: 0,
    droppedEvidenceIds: [],
    requiredEvidenceLost: false,
    adequacyImpact: null,
    reason: "within declared limit",
    ...overrides
  };
}

describe("classifyTruncationRecord", () => {
  // TST-B2-022
  it("detects avoidable required truncation when used remains below the declared limit", () => {
    const result = classifyTruncationRecord(
      record({ requiredEvidenceLost: true, limit: 10, used: 6, droppedEvidenceIds: ["req.1"] }),
      "context-capsule",
      "instance"
    );
    expect(result).toMatchObject({ cause: "avoidable", availability: "available", omittedRequiredEvidenceIds: ["req.1"] });
  });

  // TST-B2-023 (borrowable capacity is not exposed by the frozen contract; avoidability is
  // proven here purely from headroom under the declared limit, the only authoritative signal
  // my-dev-kit exposes)
  it("still classifies avoidable when headroom exists even without separate borrow evidence", () => {
    const result = classifyTruncationRecord(record({ requiredEvidenceLost: true, limit: 20, used: 1 }), "context-capsule", "instance");
    expect(result.cause).toBe("avoidable");
  });

  // TST-B2-024
  it("detects genuine hard-limit truncation when the limit is exhausted", () => {
    const result = classifyTruncationRecord(record({ requiredEvidenceLost: true, limit: 10, used: 10 }), "context-capsule", "instance");
    expect(result).toMatchObject({ cause: "genuine-hard-limit", availability: "available" });
  });

  it("treats used exceeding the limit as genuine hard-limit exhaustion too", () => {
    const result = classifyTruncationRecord(record({ requiredEvidenceLost: true, limit: 10, used: 11 }), "context-capsule", "instance");
    expect(result.cause).toBe("genuine-hard-limit");
  });

  // TST-B2-025
  it("missing required evidence alone (no requiredEvidenceLost signal) does not prove avoidable truncation", () => {
    const result = classifyTruncationRecord(record({ requiredEvidenceLost: false, limit: 10, used: 3 }), "context-capsule", "instance");
    expect(result.cause).toBe("none");
  });

  // TST-B2-026
  it("insufficient allocation evidence (no declared limit) produces unresolved truncation cause", () => {
    const result = classifyTruncationRecord(record({ requiredEvidenceLost: true, limit: null }), "context-capsule", "instance");
    expect(result).toMatchObject({ cause: "unresolved", availability: "available" });
  });

  // TST-B2-027
  it("no truncation produces an available, non-blocking result", () => {
    const result = classifyTruncationRecord(record({ requiredEvidenceLost: false }), "context-capsule", "instance");
    expect(result).toMatchObject({ cause: "none", availability: "available" });
    expect(result.omittedRequiredEvidenceIds).toEqual([]);
  });

  // TST-B2-028
  it("a strategy with no truncation records at all produces an empty (not-applicable) classification set", () => {
    expect(classifyTruncationRecords([], "context-capsule", "instance")).toEqual([]);
  });
});

function condition(overrides: Partial<RoleConditionCoverage> = {}): RoleConditionCoverage {
  return {
    conditionId: "implementation.selected-owner",
    role: "implementation",
    required: true,
    evidenceGroupIds: ["implementation-owners"],
    witnessPolicy: "at-least-one",
    requiredWitnessCount: 1,
    availableWitnessCount: 1,
    retainedWitnessCount: 1,
    retainedWitnessIds: ["src/example.ts"],
    conditionSatisfied: true,
    lostRequiredCondition: false,
    lossReason: null,
    evaluationOrder: 10,
    ...overrides
  };
}

function groupEntry(overrides: Partial<GroupTruncationEntry> = {}): GroupTruncationEntry {
  return {
    groupId: "implementation-owners",
    limit: 2,
    availableCount: 1,
    usedCount: 1,
    truncated: false,
    droppedCount: 0,
    requiredOmittedCount: 0,
    optionalOmittedCount: 0,
    ...overrides
  };
}

function capsuleLike(overrides: {
  truncated?: boolean;
  requiredEvidenceLost?: boolean;
  roleConditionCoverage?: RoleConditionCoverage[];
  groupTruncation?: GroupTruncationEntry[];
}): ContextCapsule {
  return {
    truncation: { truncated: overrides.truncated ?? false, requiredEvidenceLost: overrides.requiredEvidenceLost, records: [], warnings: [] },
    roleConditionCoverage: overrides.roleConditionCoverage,
    groupTruncation: overrides.groupTruncation ?? []
  } as unknown as ContextCapsule;
}

describe("classifyConditionAwareTruncation", () => {
  it("reports unsupported-legacy-diagnostics when no current diagnostics exist", () => {
    const result = classifyConditionAwareTruncation(capsuleLike({ truncated: false }), "context-capsule", "instance");
    expect(result.state).toBe("unsupported-legacy-diagnostics");
    expect(result.availability).toBe("unavailable");
  });

  it("reports no-truncation when truncated is false and no loss evidence exists", () => {
    const result = classifyConditionAwareTruncation(
      capsuleLike({ truncated: false, requiredEvidenceLost: false, roleConditionCoverage: [condition()] }),
      "context-capsule",
      "instance"
    );
    expect(result.state).toBe("no-truncation");
  });

  it("reports optional-only-truncation when truncated but no required loss occurred", () => {
    const result = classifyConditionAwareTruncation(
      capsuleLike({ truncated: true, requiredEvidenceLost: false, roleConditionCoverage: [condition()] }),
      "context-capsule",
      "instance"
    );
    expect(result.state).toBe("optional-only-truncation");
  });

  it("reports required-condition-or-last-witness-loss when a condition explicitly lost its witness", () => {
    const lost = condition({ conditionSatisfied: false, lostRequiredCondition: true, availableWitnessCount: 2, retainedWitnessCount: 0 });
    const result = classifyConditionAwareTruncation(
      capsuleLike({ truncated: true, requiredEvidenceLost: true, roleConditionCoverage: [lost] }),
      "context-capsule",
      "instance"
    );
    expect(result.state).toBe("required-condition-or-last-witness-loss");
    expect(result.lostRequiredConditionIds).toEqual(["implementation.selected-owner"]);
  });

  it("reports required-evidence-loss when required loss is signaled without condition-level detail", () => {
    const result = classifyConditionAwareTruncation(
      capsuleLike({ truncated: true, requiredEvidenceLost: true, groupTruncation: [groupEntry({ requiredOmittedCount: 1 })] }),
      "context-capsule",
      "instance"
    );
    expect(result.state).toBe("required-evidence-loss");
  });

  it("reports unknown-criticality when truncated but requiredEvidenceLost is absent", () => {
    const result = classifyConditionAwareTruncation(
      capsuleLike({ truncated: true, requiredEvidenceLost: undefined, roleConditionCoverage: [condition()] }),
      "context-capsule",
      "instance"
    );
    expect(result.state).toBe("unknown-criticality");
  });

  it("detects the contradiction: requiredEvidenceLost false but explicit condition loss reported", () => {
    const lost = condition({ conditionSatisfied: false, lostRequiredCondition: true });
    const result = classifyConditionAwareTruncation(
      capsuleLike({ truncated: true, requiredEvidenceLost: false, roleConditionCoverage: [lost] }),
      "context-capsule",
      "instance"
    );
    expect(result.state).toBe("contradictory-producer-evidence");
    expect(result.contradictionCodes).toEqual(["REQUIRED_EVIDENCE_LOST_FALSE_BUT_CONDITION_LOSS_REPORTED"]);
  });

  it("detects the contradiction: requiredEvidenceLost true but all required conditions retained", () => {
    const result = classifyConditionAwareTruncation(
      capsuleLike({
        truncated: true,
        requiredEvidenceLost: true,
        roleConditionCoverage: [condition()],
        groupTruncation: [groupEntry({ requiredOmittedCount: 0 })]
      }),
      "context-capsule",
      "instance"
    );
    expect(result.state).toBe("contradictory-producer-evidence");
    expect(result.contradictionCodes).toEqual(["REQUIRED_EVIDENCE_LOST_TRUE_BUT_ALL_REQUIRED_CONDITIONS_RETAINED"]);
  });

  it("required and optional omission totals stay distinct rather than collapsing into one boolean", () => {
    const result = classifyConditionAwareTruncation(
      capsuleLike({
        truncated: true,
        requiredEvidenceLost: false,
        roleConditionCoverage: [condition()],
        groupTruncation: [groupEntry({ requiredOmittedCount: 0, optionalOmittedCount: 3 })]
      }),
      "context-capsule",
      "instance"
    );
    expect(result.requiredOmittedTotal).toBe(0);
    expect(result.optionalOmittedTotal).toBe(3);
    expect(result.state).toBe("optional-only-truncation");
  });
});
