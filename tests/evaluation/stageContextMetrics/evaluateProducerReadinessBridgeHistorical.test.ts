import { describe, expect, it } from "vitest";
import { evaluateProducerReadinessBridge } from "../../../src/evaluation/stageContextMetrics/evaluateProducerReadinessBridge.js";
import { checkSupplementalReadinessIdentityConsistency } from "../../../src/evaluation/upstreamArtifacts/index.js";
import type { StageContextExpectationFixtureV1 } from "../../../src/evaluation/stageContextExpectations/index.js";
import { buildCanonicalCapsule, buildReadinessResult, buildSupplementalDocument, PRODUCER_READINESS_FIXTURE_MANIFEST } from "./producerReadinessBridgeFixtures.js";

function fixture(producerReadinessExpectations: StageContextExpectationFixtureV1["producerReadinessExpectations"] = {}): StageContextExpectationFixtureV1 {
  return {
    schemaVersion: "1.0.0",
    caseId: "CASE-B3-HIST-001",
    title: "t",
    description: "d",
    expectedEvidence: [
      { expectationId: "REQ-FILE-001", inclusion: "required", sourceArtifact: "context-capsule", category: "file", match: { path: "src/a.ts" }, notes: [] }
    ],
    expectedStates: {},
    warnings: [],
    producerReadinessExpectations
  };
}

// CASE-V044-001
describe("neutral owner false negative", () => {
  it("TST-B3-018 detects the missing expected owner without rerunning owner selection", () => {
    const capsule = buildCanonicalCapsule((c) => {
      c.selectedOwners = [];
    });
    const result = evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: capsule },
      expectations: fixture({ ownerExpectations: [{ expectationId: "OWNER-REQ-001", inclusion: "required", sourceArtifact: "context-capsule", ownerId: "src/example.ts", notes: [] }] })
    });
    expect(result.implementation?.ownerEvaluation.falseNegativeCount).toMatchObject({ availability: "available", count: 1, evidenceKeys: ["src/example.ts"] });
  });
});

// CASE-V044-002
describe("focused false owner", () => {
  it("TST-B3-019 detects a forbidden owner in selected-owner evidence", () => {
    const capsule = buildCanonicalCapsule((c) => {
      c.selectedOwners = [{ id: "src/forbidden.ts", itemKind: "file", path: "src/forbidden.ts", relationship: "owner", basis: "candidate-ranking", provenance: "candidate-ranking" }];
    });
    const result = evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: capsule },
      expectations: fixture({ ownerExpectations: [{ expectationId: "OWNER-FORBID-001", inclusion: "forbidden", sourceArtifact: "context-capsule", ownerId: "src/forbidden.ts", notes: [] }] })
    });
    expect(result.implementation?.ownerEvaluation.falsePositiveCount).toMatchObject({ availability: "available", count: 1, evidenceKeys: ["src/forbidden.ts"] });
  });
});

// CASE-V044-003 / CASE-V044-004 / CASE-V044-005
describe("truncation classification", () => {
  it("TST-B3-020 detects avoidable required truncation", () => {
    const capsule = buildCanonicalCapsule((c) => {
      c.truncation.records = [{ id: "t1", affectedGroup: "implementation-owners", limit: 10, used: 6, available: 6, droppedCount: 1, droppedEvidenceIds: ["req.1"], requiredEvidenceLost: true, adequacyImpact: null, reason: "test" }];
    });
    const result = evaluateProducerReadinessBridge({ implementation: { role: "implementation", contextCapsule: capsule }, expectations: fixture() });
    expect(result.implementation?.truncationEvaluation[0]).toMatchObject({ cause: "avoidable", availability: "available" });
  });

  it("TST-B3-021 detects genuine hard-limit truncation with zero unused capacity", () => {
    const capsule = buildCanonicalCapsule((c) => {
      c.evidenceGroups[0].limit = 5;
      c.evidenceGroups[0].usedCount = 5;
      c.truncation.records = [{ id: "t1", affectedGroup: "implementation-owners", limit: 5, used: 5, available: 5, droppedCount: 1, droppedEvidenceIds: ["req.1"], requiredEvidenceLost: true, adequacyImpact: null, reason: "test" }];
    });
    const result = evaluateProducerReadinessBridge({ implementation: { role: "implementation", contextCapsule: capsule }, expectations: fixture() });
    expect(result.implementation?.truncationEvaluation[0]).toMatchObject({ cause: "genuine-hard-limit", availability: "available" });
    const unused = result.implementation?.allocationEvaluation.unusedCapacity[0];
    expect(unused).toMatchObject({ value: 0, availability: "available" });
  });

  it("TST-B3-022 preserves unresolved truncation cause when no hard limit exists", () => {
    const capsule = buildCanonicalCapsule((c) => {
      c.truncation.records = [{ id: "t1", affectedGroup: "implementation-owners", limit: null, used: 6, available: 6, droppedCount: 1, droppedEvidenceIds: ["req.1"], requiredEvidenceLost: true, adequacyImpact: null, reason: "test" }];
    });
    const result = evaluateProducerReadinessBridge({ implementation: { role: "implementation", contextCapsule: capsule }, expectations: fixture() });
    expect(result.implementation?.truncationEvaluation[0]).toMatchObject({ cause: "unresolved", availability: "available" });
  });
});

// CASE-V044-007
describe("contradictory supplemental evidence", () => {
  it("TST-B3-024 preserves a packet/raw contradiction without recomputing producer parity", () => {
    const capsule = buildCanonicalCapsule();
    const packet = buildSupplementalDocument("implementation-context-packet", { "Index identity": "Z:/repo/different" });
    const result = evaluateProducerReadinessBridge({ implementation: { role: "implementation", contextCapsule: capsule, packet }, expectations: fixture() });
    const identity = result.implementation?.packetAgreement?.fields.find((f) => f.field === "canonicalRepositoryIdentity");
    expect(identity?.agreement).toBe(false);
    expect(result.implementation?.packetAgreement?.upstreamProducerParityPreserved).toBe(true);
  });
});

// CASE-V044-011
describe("wrong index identity between readiness and supplemental packet", () => {
  it("TST-B3-028 reports the identity mismatch structurally without a lab readiness verdict", () => {
    const packet = buildSupplementalDocument("implementation-context-packet");
    const readiness = buildReadinessResult({ indexIdentity: "Z:/repo/other-index" });
    const diagnostic = checkSupplementalReadinessIdentityConsistency(packet, readiness);
    expect(diagnostic?.code).toBe("INCOMPATIBLE_ARTIFACT_IDENTITY");
    expect(readiness.decision).toBe("ready");
  });
});

// CASE-V044-012
describe("invalid ready", () => {
  it("TST-B3-029 detects observed ready against explicit blocking expectations", () => {
    const readiness = buildReadinessResult({ decision: "ready" });
    const result = evaluateProducerReadinessBridge({
      readiness,
      expectations: fixture({ readinessExpectations: [{ expectationId: "READY-001", kind: "implementation", allowedDecisions: ["refresh-required"], expectedIssueCodes: ["CONTEXT_PACKET_TEMPLATE"], notes: [] }] })
    });
    expect(result.readinessAgreement?.invalidReady).toMatchObject({ availability: "available", invalidReady: true, missingExpectedIssueCodes: ["CONTEXT_PACKET_TEMPLATE"] });
  });
});

// CASE-V044-013
describe("valid blocked", () => {
  it("TST-B3-030 detects a matching observed blocked decision", () => {
    const readiness = buildReadinessResult({ decision: "refresh-required", classification: "template", blockingIssueCodes: ["CONTEXT_PACKET_TEMPLATE"] });
    const result = evaluateProducerReadinessBridge({
      readiness,
      expectations: fixture({ readinessExpectations: [{ expectationId: "READY-001", kind: "implementation", allowedDecisions: ["refresh-required"], expectedIssueCodes: ["CONTEXT_PACKET_TEMPLATE"], notes: [] }] })
    });
    expect(result.readinessAgreement?.validBlocked).toMatchObject({ availability: "available", validBlocked: true });
  });
});

// CASE-V044-014
describe("valid refresh-required stays distinct from blocked", () => {
  it("TST-B3-031 reports validRefreshRequired true alongside validBlocked", () => {
    const readiness = buildReadinessResult({ decision: "refresh-required", blockingIssueCodes: ["CONTEXT_REPORT_TEMPLATE"] });
    const result = evaluateProducerReadinessBridge({
      readiness,
      expectations: fixture({ readinessExpectations: [{ expectationId: "READY-001", kind: "implementation", allowedDecisions: ["refresh-required"], expectedIssueCodes: ["CONTEXT_REPORT_TEMPLATE"], notes: [] }] })
    });
    expect(result.readinessAgreement?.validBlocked.validRefreshRequired).toBe(true);
    expect(result.readinessAgreement?.decisionAgreement.observedDecision).toBe("refresh-required");
  });
});

// CASE-V044-015
describe("blocked with wrong issue code", () => {
  it("TST-B3-032 does not count as valid blocked", () => {
    const readiness = buildReadinessResult({ decision: "refresh-required", blockingIssueCodes: ["CONTEXT_PACKET_MALFORMED"] });
    const result = evaluateProducerReadinessBridge({
      readiness,
      expectations: fixture({ readinessExpectations: [{ expectationId: "READY-001", kind: "implementation", allowedDecisions: ["refresh-required"], expectedIssueCodes: ["CONTEXT_PACKET_TEMPLATE"], notes: [] }] })
    });
    expect(result.readinessAgreement?.validBlocked.validBlocked).toBe(false);
  });
});

// CASE-V044-016 / CASE-V044-017 / CASE-V044-018
describe("criticality evaluation", () => {
  function capsuleWithMapping(mapping: Record<string, unknown>) {
    return buildCanonicalCapsule((c) => {
      c.responsibilityMappings.mappings = [{ ...c.responsibilityMappings.mappings[0], ...mapping }];
    });
  }

  it("TST-B3-033 detects a criticality-overlay mismatch", () => {
    const capsule = capsuleWithMapping({ responsibilityId: "resp.001", criticality: "noncritical" });
    const result = evaluateProducerReadinessBridge({
      testImplementation: { role: "test-implementation", contextCapsule: capsule },
      expectations: fixture({ criticalityExpectations: [{ expectationId: "CRIT-001", responsibilityId: "resp.001", expectedCriticality: "critical", applicable: true, requiresFullMapping: true, notes: [] }] })
    });
    expect(result.criticalityEvaluation?.conflictingCriticalityResponsibilityIds).toEqual(["resp.001"]);
  });

  it("TST-B3-034 excludes a partially mapped critical responsibility from the mapped numerator", () => {
    const capsule = capsuleWithMapping({ responsibilityId: "resp.001", criticality: "critical", mappingStatus: "partially-mapped" });
    const result = evaluateProducerReadinessBridge({
      testImplementation: { role: "test-implementation", contextCapsule: capsule },
      expectations: fixture({ criticalityExpectations: [{ expectationId: "CRIT-001", responsibilityId: "resp.001", expectedCriticality: "critical", applicable: true, requiresFullMapping: true, notes: [] }] })
    });
    expect(result.criticalityEvaluation?.partiallyMappedCriticalIds).toEqual(["resp.001"]);
    expect(result.criticalityEvaluation?.fullyMappedCriticalIds).toEqual([]);
    expect(result.criticalityEvaluation?.mappedCriticalCompleteness.numerator).toBe(0);
  });

  it("TST-B3-035 reports missing criticality when no raw mapping evidence exists", () => {
    const result = evaluateProducerReadinessBridge({
      expectations: fixture({ criticalityExpectations: [{ expectationId: "CRIT-001", responsibilityId: "resp.missing", expectedCriticality: "critical", applicable: true, requiresFullMapping: true, notes: [] }] }),
      readiness: buildReadinessResult()
    });
    expect(result.criticalityEvaluation?.missingCriticalityResponsibilityIds).toEqual(["resp.missing"]);
  });
});

// CASE-V044-020
describe("corrected full bridge", () => {
  it("TST-B3-036 produces expected agreement and available zeros with no residual contradictions", () => {
    const capsule = buildCanonicalCapsule((c) => {
      c.selectedOwners = [{ id: "src/example.ts", itemKind: "file", path: "src/example.ts", relationship: "owner", basis: "candidate-ranking", provenance: "candidate-ranking" }];
    });
    const packet = buildSupplementalDocument("implementation-context-packet");
    const report = buildSupplementalDocument("implementation-context-retrieval-report");
    const readiness = buildReadinessResult();

    const result = evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: capsule, packet, report },
      readiness,
      expectations: fixture({
        ownerExpectations: [{ expectationId: "OWNER-REQ-001", inclusion: "required", sourceArtifact: "context-capsule", ownerId: "src/example.ts", notes: [] }],
        readinessExpectations: [{ expectationId: "READY-001", kind: "implementation", allowedDecisions: ["ready"], notes: [] }]
      })
    });

    expect(result.implementation?.ownerEvaluation.falsePositiveCount).toMatchObject({ availability: "available", count: 0 });
    expect(result.implementation?.ownerEvaluation.falseNegativeCount).toMatchObject({ availability: "available", count: 0 });
    expect(result.implementation?.packetAgreement?.contradictions).toEqual([]);
    expect(result.implementation?.reportAgreement?.contradictions).toEqual([]);
    expect(result.readinessAgreement?.decisionAgreement.decisionAgreement).toBe(true);
  });
});

describe("PRODUCER_READINESS_FIXTURE_MANIFEST", () => {
  // TST-B3-001 / TST-B3-002 / TST-B3-003
  it("declares a stable, unique case ID per scenario without absolute local paths", () => {
    expect(new Set(PRODUCER_READINESS_FIXTURE_MANIFEST.caseIds).size).toBe(PRODUCER_READINESS_FIXTURE_MANIFEST.caseIds.length);
    for (const value of Object.values(PRODUCER_READINESS_FIXTURE_MANIFEST)) {
      if (typeof value === "string") {
        expect(value).not.toMatch(/^[A-Za-z]:\\/);
      }
    }
  });
});

describe("fixture determinism", () => {
  // TST-B3-004 / TST-B3-005
  it("base fixture construction is deterministic and variants do not mutate the base", () => {
    const base1 = buildCanonicalCapsule();
    const base2 = buildCanonicalCapsule();
    expect(base1).toEqual(base2);
    const variant = buildCanonicalCapsule((c) => {
      c.selectedOwners = [];
    });
    expect(variant.selectedOwners).toEqual([]);
    const baseAfterVariant = buildCanonicalCapsule();
    expect(baseAfterVariant.selectedOwners.length).toBeGreaterThan(0);
  });
});
