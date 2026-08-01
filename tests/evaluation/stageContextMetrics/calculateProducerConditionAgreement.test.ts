import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calculateCapsuleAuditConditionAgreement,
  calculateProducerConditionAgreement,
  calculateRequiredEvidenceLossAgreement
} from "../../../src/evaluation/stageContextMetrics/calculateProducerConditionAgreement.js";
import { calculateConditionCoverageMetrics } from "../../../src/evaluation/stageContextMetrics/calculateConditionCoverageMetrics.js";
import type { ContextCapsule, RetrievalAuditRecord, RoleConditionCoverage } from "../../../src/evaluation/upstreamArtifacts/index.js";

function satisfiedRequired(): RoleConditionCoverage {
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
    evaluationOrder: 10
  };
}

function lostRequired(): RoleConditionCoverage {
  return {
    ...satisfiedRequired(),
    conditionId: "implementation.required-contract",
    availableWitnessCount: 2,
    retainedWitnessCount: 0,
    retainedWitnessIds: [],
    conditionSatisfied: false,
    lostRequiredCondition: true,
    lossReason: "bounded-allocation-omitted-required-witnesses"
  };
}

describe("calculateProducerConditionAgreement", () => {
  it("is insufficient-evidence when roleAdequacy.status is absent", () => {
    const coverage = calculateConditionCoverageMetrics([satisfiedRequired()], undefined);
    const result = calculateProducerConditionAgreement(undefined, coverage);
    expect(result.outcome).toBe("insufficient-evidence");
    expect(result.availability).toBe("unavailable");
  });

  it("is unsupported-legacy-evidence when condition coverage is unavailable", () => {
    const coverage = calculateConditionCoverageMetrics(undefined, undefined);
    const result = calculateProducerConditionAgreement("context sufficient with listed assumptions", coverage);
    expect(result.outcome).toBe("unsupported-legacy-evidence");
  });

  it("detects the false-negative shape: producer inadequate but all required conditions retained", () => {
    const coverage = calculateConditionCoverageMetrics([satisfiedRequired()], undefined);
    const result = calculateProducerConditionAgreement("context insufficient and more retrieval required", coverage);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictionCodes).toEqual(["PRODUCER_INADEQUATE_BUT_ALL_REQUIRED_CONDITIONS_RETAINED"]);
  });

  it("detects the inverse contradiction: producer adequate despite explicit required-condition loss", () => {
    const coverage = calculateConditionCoverageMetrics([lostRequired()], undefined);
    const result = calculateProducerConditionAgreement("context sufficient with listed assumptions", coverage);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictionCodes).toEqual(["PRODUCER_ADEQUATE_BUT_REQUIRED_CONDITION_LOST"]);
  });

  it("reports agreement for the corrected-positive shape", () => {
    const coverage = calculateConditionCoverageMetrics([satisfiedRequired()], undefined);
    const result = calculateProducerConditionAgreement("context sufficient with listed assumptions", coverage);
    expect(result.outcome).toBe("agreement");
    expect(result.contradictionCodes).toEqual([]);
  });

  it("does not replace the producer verdict even when reporting a contradiction", () => {
    const coverage = calculateConditionCoverageMetrics([satisfiedRequired()], undefined);
    const result = calculateProducerConditionAgreement("context insufficient and more retrieval required", coverage);
    expect(result.observedRoleAdequacyStatus).toBe("context insufficient and more retrieval required");
  });
});

describe("calculateRequiredEvidenceLossAgreement", () => {
  it("is insufficient-evidence when requiredEvidenceLost is undefined", () => {
    const coverage = calculateConditionCoverageMetrics([satisfiedRequired()], undefined);
    const result = calculateRequiredEvidenceLossAgreement(undefined, coverage, null);
    expect(result.outcome).toBe("insufficient-evidence");
  });

  it("detects requiredEvidenceLost=false contradicting explicit condition loss", () => {
    const coverage = calculateConditionCoverageMetrics([lostRequired()], undefined);
    const result = calculateRequiredEvidenceLossAgreement(false, coverage, 0);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictionCodes).toEqual(["REQUIRED_EVIDENCE_LOST_FALSE_BUT_CONDITION_LOSS_DETECTED"]);
  });

  it("detects requiredEvidenceLost=true with no corroborating condition or group loss", () => {
    const coverage = calculateConditionCoverageMetrics([satisfiedRequired()], undefined);
    const result = calculateRequiredEvidenceLossAgreement(true, coverage, 0);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictionCodes).toEqual(["REQUIRED_EVIDENCE_LOST_TRUE_BUT_NO_CONDITION_OR_GROUP_LOSS_DETECTED"]);
  });

  it("agrees that no required condition was lost when requiredEvidenceLost is false and none is lost", () => {
    const coverage = calculateConditionCoverageMetrics([satisfiedRequired()], undefined);
    const result = calculateRequiredEvidenceLossAgreement(false, coverage, 0);
    expect(result.outcome).toBe("agreement");
  });

  it("does not contradict when requiredEvidenceLost=true is supported by a required-omitted count", () => {
    const coverage = calculateConditionCoverageMetrics([satisfiedRequired()], undefined);
    const result = calculateRequiredEvidenceLossAgreement(true, coverage, 1);
    expect(result.outcome).toBe("agreement");
  });
});

function baseCapsule(): ContextCapsule {
  return JSON.parse(
    readFileSync("tests/fixtures/upstream-artifacts/my-dev-kit/1.10.4/context-capsule/complete-v1.0.0.json", "utf8")
  ) as ContextCapsule;
}

function baseAudit(): RetrievalAuditRecord {
  return JSON.parse(
    readFileSync("tests/fixtures/upstream-artifacts/my-dev-kit/1.10.4/retrieval-audit-record/complete-v1.0.0.json", "utf8")
  ) as RetrievalAuditRecord;
}

describe("calculateCapsuleAuditConditionAgreement", () => {
  it("is unavailable when either artifact is missing", () => {
    expect(calculateCapsuleAuditConditionAgreement(undefined, undefined).availability).toBe("unavailable");
  });

  it("reports consistent for a matching v1.10.4 pair (reusing the Batch 1 parity owner)", () => {
    const result = calculateCapsuleAuditConditionAgreement(baseCapsule(), baseAudit());
    expect(result).toMatchObject({ availability: "available", consistent: true, contradictingFieldPaths: [] });
  });

  it("reports the contradicting field path for a roleConditionCoverage mismatch", () => {
    const audit = baseAudit();
    audit.roleConditionCoverage = [{ ...audit.roleConditionCoverage![0], conditionSatisfied: false, lostRequiredCondition: true }];
    const result = calculateCapsuleAuditConditionAgreement(baseCapsule(), audit);
    expect(result.consistent).toBe(false);
    expect(result.contradictingFieldPaths).toEqual(["roleConditionCoverage"]);
  });
});
