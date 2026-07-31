// v0.4.5 Batch 4 (section 18): the corrected-replay ecosystem fixture, evaluated end to end.
// Proves the same request shape passes cleanly once evaluated against the exact validated
// local my-dev-kit v1.10.4 / my-dev-kit-orchestrator v1.2.3 producer and run-integrity
// contracts.
import { describe, expect, it } from "vitest";
import { loadContextIntegrityFixture } from "../../../src/evaluation/ecosystemFixtures/loadContextIntegrityFixture.js";
import { evaluateProducerReadinessBridge } from "../../../src/evaluation/stageContextMetrics/evaluateProducerReadinessBridge.js";
import type { StageContextExpectationFixtureV1 } from "../../../src/evaluation/stageContextExpectations/index.js";

const FIXTURE_ROOT = "tests/fixtures/ecosystem/context-integrity/v0.4.5/corrected-replay";
const MANIFEST_PATH = "tests/fixtures/ecosystem/context-integrity/v0.4.5/manifests/corrected-replay-manifest.json";

function baseExpectations(): StageContextExpectationFixtureV1 {
  return {
    schemaVersion: "1.0.0",
    caseId: "CASE-V045-B4-CORRECTED-REPLAY",
    title: "corrected-replay ecosystem fixture",
    description: "d",
    expectedEvidence: [],
    expectedStates: {},
    warnings: [],
    producerReadinessExpectations: {}
  };
}

describe("corrected-replay fixture: loading and hash verification", () => {
  it("loads without issues and verifies every tracked hash", async () => {
    const result = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    expect(result.issues).toEqual([]);
    expect(result.hashVerification?.ok).toBe(true);
  });

  it("uses the same request/target/index identity as the failed-run fixture", async () => {
    const result = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    expect(result.implementationCapsule?.index.projectRoot).toBe("Z:/Users/newuser/Projects/my-dev-kit-v1");
    expect(result.implementationCapsule?.request.originalQuery).toContain("android-compose-semantic.json");
    expect(result.runIntegrityEvidence?.runFolder).toContain("20260730T113740-implement-my-dev-kit-v1-11-0-b");
  });
});

describe("corrected-replay fixture: expected result (section 18)", () => {
  it("producer: required conditions retain adequate witnesses, requiredEvidenceLost is false", async () => {
    const { implementationCapsule } = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    expect(implementationCapsule?.roleConditionCoverage?.every((c) => c.conditionSatisfied)).toBe(true);
    expect(implementationCapsule?.roleConditionCoverage?.every((c) => !c.lostRequiredCondition)).toBe(true);
    expect(implementationCapsule?.truncation.requiredEvidenceLost).toBe(false);
    const contractsGroup = implementationCapsule!.groupTruncation.find((g) => g.groupId === "implementation-contracts");
    expect(contractsGroup?.requiredOmittedCount).toBe(0);
    // Optional truncation may legitimately remain without becoming required loss.
    expect(contractsGroup?.optionalOmittedCount).toBeGreaterThan(0);
    expect(implementationCapsule?.roleAdequacy.status).toBe("context sufficient with listed assumptions");
  });

  it("orchestrator: readiness is ready, expected judge verdict is PASS", async () => {
    const { runIntegrityEvidence } = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    expect(runIntegrityEvidence?.gate.readinessClassification).toBe("ready");
    expect(runIntegrityEvidence?.gate.blockedStageNames).toEqual([]);
    expect(runIntegrityEvidence?.gate.expectedJudgeVerdict).toBe("PASS");
  });

  it("judge: parsed PASS, valid, matches expected, no correction route", async () => {
    const { runIntegrityEvidence } = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    expect(runIntegrityEvidence?.judgeIntegrity?.authoredJudgeVerdict).toBe("PASS");
    expect(runIntegrityEvidence?.judgeIntegrity?.judgeVerdictMatchesExpected).toBe(true);
    expect(runIntegrityEvidence?.judgeIntegrity?.acceptedCorrectionRoute).toBeNull();
  });

  it("final report: eligible, present, PASS", async () => {
    const { runIntegrityEvidence } = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    expect(runIntegrityEvidence?.finalReportEligibility?.eligible).toBe(true);
    expect(runIntegrityEvidence?.finalArtifactPresent).toBe(true);
    expect(runIntegrityEvidence?.finalArtifactVerdict).toBe("PASS");
  });

  it("full chain through evaluateProducerReadinessBridge: full agreement, no contradiction", async () => {
    const { implementationCapsule, implementationAudit, runIntegrityEvidence } = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    const result = evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: implementationCapsule!, retrievalAuditRecord: implementationAudit! },
      readiness: runIntegrityEvidence!.gate.implementationContext,
      runIntegrityEvidence: runIntegrityEvidence!,
      expectations: baseExpectations()
    });

    expect(result.implementation!.producerConditionAgreement.outcome).toBe("agreement");
    expect(result.implementation!.capsuleAuditConditionAgreement.consistent).toBe(true);

    const evaluation = result.runIntegrityEvaluation!;
    expect(evaluation.readinessPrompt.outcome).toBe("agreement");
    expect(evaluation.readinessExpectedJudge.outcome).toBe("agreement");
    expect(evaluation.expectedActualJudge.outcome).toBe("agreement");
    expect(evaluation.judgeCorrection.outcome).toBe("agreement");
    expect(evaluation.judgeFinalEligibility.outcome).toBe("agreement");
    expect(evaluation.eligibilityFinalArtifact.outcome).toBe("agreement");
    expect(evaluation.lifecycleIntegrity.outcome).toBe("agreement");
    expect(evaluation.endToEndSummary.category).toBe("full-agreement");
    expect(evaluation.endToEndSummary.contradictingComponents).toEqual([]);
  });
});
