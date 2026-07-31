// v0.4.5 Batch 4: the frozen failed-run ecosystem fixture, evaluated end to end through the
// real Batch 1 readers, Batch 3 run-integrity reader, and the existing
// evaluateProducerReadinessBridge. This proves the preserved my-dev-kit v1.11.0 Batch 1
// failure fails the v0.4.5 context-integrity evaluation for the expected reasons (section 16).
import { describe, expect, it } from "vitest";
import { loadContextIntegrityFixture } from "../../../src/evaluation/ecosystemFixtures/loadContextIntegrityFixture.js";
import { evaluateProducerReadinessBridge } from "../../../src/evaluation/stageContextMetrics/evaluateProducerReadinessBridge.js";
import type { StageContextExpectationFixtureV1 } from "../../../src/evaluation/stageContextExpectations/index.js";

const FIXTURE_ROOT = "tests/fixtures/ecosystem/context-integrity/v0.4.5/failed-run";
const MANIFEST_PATH = "tests/fixtures/ecosystem/context-integrity/v0.4.5/manifests/failed-run-manifest.json";

function baseExpectations(): StageContextExpectationFixtureV1 {
  return {
    schemaVersion: "1.0.0",
    caseId: "CASE-V045-B4-FAILED-RUN",
    title: "frozen failed-run ecosystem fixture",
    description: "d",
    expectedEvidence: [],
    expectedStates: {},
    warnings: [],
    producerReadinessExpectations: {}
  };
}

describe("frozen failed-run fixture: loading and hash verification", () => {
  it("loads without issues and verifies every tracked hash", async () => {
    const result = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.hashVerification?.ok).toBe(true);
    expect(result.hashVerification!.checkedCount).toBe(result.manifest!.artifacts.length);
  });

  it("parses the real pre-v1.10.4 producer evidence without field loss", async () => {
    const result = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    expect(result.implementationCapsule?.tool.version).toBe("1.10.3");
    expect(result.implementationCapsule?.roleAdequacy.status).toBe("context insufficient and more retrieval required");
    expect(result.implementationCapsule?.roleConditionCoverage).toBeUndefined();
    expect(result.implementationAudit).not.toBeNull();
  });

  it("parses the derived run-integrity evidence and preserves the derivation note as an unknown additive field", async () => {
    const result = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    expect(result.runIntegrityEvidence?.gate.expectedJudgeVerdict).toBe("NEED_CONTEXT");
    expect((result.runIntegrityEvidence as unknown as Record<string, unknown>)["_derivationNote"]).toContain("LAB-DERIVED");
  });
});

describe("frozen failed-run fixture: end-to-end context-integrity evaluation (section 16)", () => {
  it("producer: reports insufficient adequacy driven by real bounded-allocation omission", async () => {
    const { implementationCapsule } = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    const contractsGroup = implementationCapsule!.groupTruncation.find((g) => g.groupId === "implementation-contracts");
    const compatGroup = implementationCapsule!.groupTruncation.find((g) => g.groupId === "implementation-compatibility-surfaces");
    expect(contractsGroup?.requiredOmittedCount).toBe(8);
    expect(compatGroup?.requiredOmittedCount).toBe(21);
    expect(implementationCapsule!.truncation.records.every((r) => r.requiredEvidenceLost)).toBe(true);
  });

  it("orchestrator: canonical readiness is refresh-required, implementation is blocked, expected verdict is NEED_CONTEXT", async () => {
    const { runIntegrityEvidence } = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    expect(runIntegrityEvidence!.gate.readinessClassification).toBe("refresh-required");
    expect(runIntegrityEvidence!.gate.blockedStageNames).toContain("implementation");
    expect(runIntegrityEvidence!.gate.expectedJudgeVerdict).toBe("NEED_CONTEXT");
  });

  it("judge: the real authored PASS contradicts the expected NEED_CONTEXT verdict", async () => {
    const { runIntegrityEvidence } = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    expect(runIntegrityEvidence!.judgeIntegrity?.authoredJudgeVerdict).toBe("PASS");
    expect(runIntegrityEvidence!.judgeIntegrity?.judgeVerdictMatchesExpected).toBe(false);
    expect(runIntegrityEvidence!.judgeIntegrity?.blockingCodes).toContain("JUDGE_VERDICT_CONTRADICTS_RUN_INTEGRITY");
  });

  it("correction: the route returns to the structured refresh destination, not normal continuation", async () => {
    const { runIntegrityEvidence } = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    expect(runIntegrityEvidence!.judgeIntegrity?.acceptedCorrectionStage).toBe("implementation");
    expect(runIntegrityEvidence!.judgeIntegrity?.acceptedCorrectionRoute?.routedStage).toBe("implementation");
  });

  it("final report: eligibility is false despite a present PASS final artifact (the historical bug)", async () => {
    const { runIntegrityEvidence } = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    expect(runIntegrityEvidence!.finalReportEligibility?.eligible).toBe(false);
    expect(runIntegrityEvidence!.finalArtifactPresent).toBe(true);
    expect(runIntegrityEvidence!.finalArtifactVerdict).toBe("PASS");
  });

  it("full chain through evaluateProducerReadinessBridge: end-to-end contradiction-present, never full agreement", async () => {
    const { implementationCapsule, implementationAudit, runIntegrityEvidence } = await loadContextIntegrityFixture(FIXTURE_ROOT, MANIFEST_PATH);
    const result = evaluateProducerReadinessBridge({
      implementation: { role: "implementation", contextCapsule: implementationCapsule!, retrievalAuditRecord: implementationAudit! },
      runIntegrityEvidence: runIntegrityEvidence!,
      expectations: baseExpectations()
    });

    // Producer/readiness: legacy evidence (no roleConditionCoverage) is honestly unsupported,
    // never fabricated as agreement.
    expect(result.implementation!.producerConditionAgreement.outcome).toBe("unsupported-legacy-evidence");

    const evaluation = result.runIntegrityEvaluation!;
    expect(evaluation.expectedActualJudge.outcome).toBe("contradiction");
    expect(evaluation.expectedActualJudge.contradictions.map((c) => c.code)).toContain("JUDGE_VERDICT_CONTRADICTS_RUN_INTEGRITY");
    // NEED_CONTEXT followed by a PASS final report (the required v0.4.5 failure detection).
    expect(evaluation.eligibilityFinalArtifact.outcome).toBe("contradiction");
    expect(evaluation.eligibilityFinalArtifact.contradictions.map((c) => c.code)).toContain("NEED_CONTEXT_FOLLOWED_BY_FINAL_PASS");
    // Lifecycle: both the implementation and final-report stages resolved "complete" despite
    // being gate-blocked/ineligible -- the real historical bypass.
    expect(evaluation.lifecycleIntegrity.outcome).toBe("contradiction");
    expect(evaluation.lifecycleIntegrity.contradictions.map((c) => c.code)).toEqual([
      "MANUAL_MARK_COMPLETE_BYPASS_SUCCEEDED",
      "MANUAL_MARK_COMPLETE_BYPASS_SUCCEEDED"
    ]);

    expect(evaluation.endToEndSummary.category).toBe("contradiction-present");
    expect(evaluation.endToEndSummary.contradictingComponents).toEqual(
      expect.arrayContaining(["expectedActualJudge", "eligibilityFinalArtifact", "lifecycleIntegrity"])
    );
    // No lab-owned replacement verdict: both the real authored PASS and the real expected
    // NEED_CONTEXT are retained side by side, never resolved into a single new verdict.
    expect(evaluation.expectedActualJudge.authoredJudgeVerdict).toBe("PASS");
    expect(evaluation.expectedActualJudge.expectedJudgeVerdict).toBe("NEED_CONTEXT");
  });
});
