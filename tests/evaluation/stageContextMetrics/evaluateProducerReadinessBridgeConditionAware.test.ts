// v0.4.5 Batch 2 (sections 21-23): bounded metric-level regression cases for the original
// my-dev-kit v1.11.0 Batch 1 false-negative evidence shape, its corrected-positive
// counterpart, and focused negative cases, exercised through the full
// evaluateProducerReadinessBridge integration seam. This is NOT the Batch 4 frozen
// ecosystem fixture -- it is a bounded, hand-built condition-aware case built from the
// Batch 1 v1.10.4 fixtures.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateProducerReadinessBridge } from "../../../src/evaluation/stageContextMetrics/evaluateProducerReadinessBridge.js";
import type { ContextCapsule, OrchestratorContextReadinessResultV1, RetrievalAuditRecord } from "../../../src/evaluation/upstreamArtifacts/index.js";
import type { StageContextExpectationFixtureV1 } from "../../../src/evaluation/stageContextExpectations/index.js";

const CAPSULE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.4/context-capsule/complete-v1.0.0.json";
const AUDIT_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.4/retrieval-audit-record/complete-v1.0.0.json";
const LEGACY_CAPSULE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";

function loadCapsule(): ContextCapsule {
  return JSON.parse(readFileSync(CAPSULE_PATH, "utf8")) as ContextCapsule;
}

function loadAudit(): RetrievalAuditRecord {
  return JSON.parse(readFileSync(AUDIT_PATH, "utf8")) as RetrievalAuditRecord;
}

function loadLegacyCapsule(): ContextCapsule {
  return JSON.parse(readFileSync(LEGACY_CAPSULE_PATH, "utf8")) as ContextCapsule;
}

function baseExpectations(): StageContextExpectationFixtureV1 {
  return {
    schemaVersion: "1.0.0",
    caseId: "CASE-V045-B2-CONDITION-AWARE",
    title: "condition-aware bridge integration",
    description: "d",
    expectedEvidence: [],
    expectedStates: {},
    warnings: [],
    producerReadinessExpectations: {}
  };
}

function readinessResult(overrides: Partial<OrchestratorContextReadinessResultV1> = {}): OrchestratorContextReadinessResultV1 {
  return {
    schemaVersion: "1.0.0",
    kind: "implementation",
    role: "implementation",
    decision: "ready",
    classification: "ready",
    stageId: "stage.feature.implementation",
    packetPath: "fixture:implementation-context-packet",
    reportPath: "fixture:implementation-context-retrieval-report",
    issues: [],
    warnings: [],
    blockingIssueCodes: [],
    affectedResponsibilityIds: [],
    evaluatedFreshness: "fresh",
    evaluatedAdequacy: "sufficient",
    requiredEvidenceTruncated: "no",
    readyWithAssumptions: false,
    provenanceSummary: "fixture",
    indexIdentity: "Z:/fixture/project",
    ...overrides
  };
}

// CASE-V045-B2-001: the original v1.11.0 Batch 1 false-negative shape.
describe("Batch 2 false-negative diagnostic case (section 21)", () => {
  it("diagnoses producer-reported inadequacy that contradicts fully-retained required conditions", () => {
    const capsule = loadCapsule();
    // All required conditions explicitly satisfied and no required loss...
    capsule.roleConditionCoverage = capsule.roleConditionCoverage!.map((c) => ({
      ...c,
      conditionSatisfied: true,
      lostRequiredCondition: false,
      lossReason: null,
      retainedWitnessCount: c.requiredWitnessCount,
      availableWitnessCount: c.requiredWitnessCount,
      retainedWitnessIds: ["src/example.ts"]
    }));
    capsule.groupTruncation = [{ ...capsule.groupTruncation[0], requiredOmittedCount: 0, optionalOmittedCount: 2, adequacyAffected: false }];
    capsule.truncation = { truncated: true, requiredEvidenceLost: false, records: [], warnings: [] };
    // ...yet the producer's own role adequacy claims insufficiency (the historical bug).
    capsule.roleAdequacy = { ...capsule.roleAdequacy, status: "context insufficient and more retrieval required" };

    const audit = loadAudit();
    audit.roleConditionCoverage = capsule.roleConditionCoverage;
    audit.truncation = capsule.truncation;
    audit.roleAdequacy = capsule.roleAdequacy;

    const readiness = readinessResult({ decision: "refresh-required", classification: "required-evidence-truncated" });

    const result = evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: capsule, retrievalAuditRecord: audit },
      readiness,
      expectations: baseExpectations()
    });

    const side = result.implementation!;
    // Optional truncation is distinguished from required loss.
    expect(side.conditionAwareTruncationEvaluation?.state).toBe("optional-only-truncation");
    // Required conditions are reported satisfied.
    expect(side.conditionCoverageEvaluation.requiredConditionsSatisfied.count).toBe(side.conditionCoverageEvaluation.requiredConditionsTotal.count);
    // Last-witness-loss count is zero.
    expect(side.conditionCoverageEvaluation.lastWitnessLoss.count).toBe(0);
    // Producer adequacy vs condition coverage reports contradiction (the diagnosable bug).
    expect(side.producerConditionAgreement.outcome).toBe("contradiction");
    expect(side.producerConditionAgreement.contradictionCodes).toContain("PRODUCER_INADEQUATE_BUT_ALL_REQUIRED_CONDITIONS_RETAINED");
    // requiredEvidenceLost vs condition coverage agrees that nothing required was lost.
    expect(side.requiredEvidenceLossAgreement.outcome).toBe("agreement");
    // Capsule/audit agree.
    expect(side.capsuleAuditConditionAgreement.consistent).toBe(true);
    // Producer/readiness relationship is reported without replacing either verdict.
    expect(result.producerReadinessRelationship?.observedRoleAdequacyStatus).toBe("context insufficient and more retrieval required");
    expect(result.producerReadinessRelationship?.observedReadinessDecision).toBe("refresh-required");
  });
});

// CASE-V045-B2-002: the corrected local v1.10.4 positive shape.
describe("Batch 2 corrected positive case (section 22)", () => {
  it("reports agreement across producer adequacy, condition coverage, and readiness", () => {
    const capsule = loadCapsule();
    capsule.roleConditionCoverage = capsule.roleConditionCoverage!.map((c) => ({
      ...c,
      conditionSatisfied: true,
      lostRequiredCondition: false,
      lossReason: null,
      retainedWitnessCount: c.requiredWitnessCount,
      availableWitnessCount: c.requiredWitnessCount,
      retainedWitnessIds: ["src/example.ts"]
    }));
    capsule.groupTruncation = [{ ...capsule.groupTruncation[0], requiredOmittedCount: 0, optionalOmittedCount: 1, adequacyAffected: false }];
    capsule.truncation = { truncated: true, requiredEvidenceLost: false, records: [], warnings: [] };
    capsule.roleAdequacy = { ...capsule.roleAdequacy, status: "context sufficient with listed assumptions" };

    const audit = loadAudit();
    audit.roleConditionCoverage = capsule.roleConditionCoverage;
    audit.truncation = capsule.truncation;
    audit.roleAdequacy = capsule.roleAdequacy;

    const readiness = readinessResult({ decision: "ready", classification: "ready" });

    const result = evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: capsule, retrievalAuditRecord: audit },
      readiness,
      expectations: baseExpectations()
    });

    const side = result.implementation!;
    expect(side.conditionAwareTruncationEvaluation?.state).toBe("optional-only-truncation");
    expect(side.conditionCoverageEvaluation.requiredConditionsLost.count).toBe(0);
    expect(side.producerConditionAgreement.outcome).toBe("agreement");
    expect(side.requiredEvidenceLossAgreement.outcome).toBe("agreement");
    expect(side.capsuleAuditConditionAgreement.consistent).toBe(true);
    expect(result.producerReadinessRelationship?.outcome).toBe("agreement");
  });
});

// Section 23: focused negative cases exercised through the full bridge.
describe("Batch 2 negative cases (section 23)", () => {
  it("detects an explicit required-condition (last-adequate-witness) loss", () => {
    const capsule = loadCapsule();
    capsule.roleConditionCoverage = [
      { ...capsule.roleConditionCoverage![0], availableWitnessCount: 2, retainedWitnessCount: 0, retainedWitnessIds: [], conditionSatisfied: false, lostRequiredCondition: true, lossReason: "bounded-allocation-omitted-required-witnesses" },
      capsule.roleConditionCoverage![1]
    ];
    capsule.truncation = { truncated: true, requiredEvidenceLost: true, records: [], warnings: [] };
    const result = evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: capsule },
      expectations: baseExpectations()
    });
    const side = result.implementation!;
    expect(side.conditionAwareTruncationEvaluation?.state).toBe("required-condition-or-last-witness-loss");
    expect(side.conditionCoverageEvaluation.lastWitnessLoss.count).toBe(1);
    expect(side.conditionCoverageEvaluation.requiredConditionsLost.evidenceKeys).toEqual(["implementation.selected-owner"]);
  });

  it("detects required omitted count greater than zero at the group level", () => {
    const capsule = loadCapsule();
    capsule.groupTruncation = [{ ...capsule.groupTruncation[0], requiredOmittedCount: 1, optionalOmittedCount: 0, adequacyAffected: true }];
    const result = evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: capsule },
      expectations: baseExpectations()
    });
    expect(result.implementation!.groupAllocationEvaluation.aggregate.groupsWithRequiredOmission).toEqual(["implementation-owners"]);
  });

  it("detects producer adequate despite explicit required-condition loss", () => {
    const capsule = loadCapsule();
    capsule.roleConditionCoverage = [
      { ...capsule.roleConditionCoverage![0], availableWitnessCount: 2, retainedWitnessCount: 0, retainedWitnessIds: [], conditionSatisfied: false, lostRequiredCondition: true, lossReason: "bounded-allocation-omitted-required-witnesses" },
      capsule.roleConditionCoverage![1]
    ];
    capsule.roleAdequacy = { ...capsule.roleAdequacy, status: "context sufficient with listed assumptions" };
    const result = evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: capsule },
      expectations: baseExpectations()
    });
    expect(result.implementation!.producerConditionAgreement.outcome).toBe("contradiction");
    expect(result.implementation!.producerConditionAgreement.contradictionCodes).toContain("PRODUCER_ADEQUATE_BUT_REQUIRED_CONDITION_LOST");
  });

  it("detects requiredEvidenceLost contradicting explicit condition loss", () => {
    const capsule = loadCapsule();
    capsule.roleConditionCoverage = [
      { ...capsule.roleConditionCoverage![0], availableWitnessCount: 2, retainedWitnessCount: 0, retainedWitnessIds: [], conditionSatisfied: false, lostRequiredCondition: true, lossReason: "bounded-allocation-omitted-required-witnesses" },
      capsule.roleConditionCoverage![1]
    ];
    capsule.truncation = { truncated: true, requiredEvidenceLost: false, records: [], warnings: [] };
    const result = evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: capsule },
      expectations: baseExpectations()
    });
    expect(result.implementation!.requiredEvidenceLossAgreement.outcome).toBe("contradiction");
    expect(result.implementation!.requiredEvidenceLossAgreement.contradictionCodes).toContain("REQUIRED_EVIDENCE_LOST_FALSE_BUT_CONDITION_LOSS_DETECTED");
    expect(result.implementation!.conditionAwareTruncationEvaluation?.state).toBe("contradictory-producer-evidence");
  });

  it("detects a capsule/audit condition contradiction", () => {
    const capsule = loadCapsule();
    const audit = loadAudit();
    audit.roleConditionCoverage = [{ ...audit.roleConditionCoverage![0], conditionSatisfied: false, lostRequiredCondition: true }, audit.roleConditionCoverage![1]];
    const result = evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: capsule, retrievalAuditRecord: audit },
      expectations: baseExpectations()
    });
    expect(result.implementation!.capsuleAuditConditionAgreement.consistent).toBe(false);
    expect(result.implementation!.capsuleAuditConditionAgreement.contradictingFieldPaths).toEqual(["roleConditionCoverage"]);
  });

  it("reports legacy artifacts as unavailable rather than fabricating condition/allocation evidence", () => {
    const capsule = loadLegacyCapsule();
    const result = evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: capsule },
      expectations: baseExpectations()
    });
    const side = result.implementation!;
    expect(side.conditionCoverageEvaluation.availability).toBe("unavailable");
    expect(side.groupAllocationEvaluation.aggregate.availability).toBe("unavailable");
    expect(side.conditionAwareTruncationEvaluation?.state).toBe("unsupported-legacy-diagnostics");
    expect(side.producerConditionAgreement.outcome).toBe("unsupported-legacy-evidence");
  });
});
