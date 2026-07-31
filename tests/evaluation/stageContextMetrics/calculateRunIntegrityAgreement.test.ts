import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calculateEligibilityFinalArtifactAgreement,
  calculateExpectedActualJudgeAgreement,
  calculateJudgeCorrectionAgreement,
  calculateJudgeFinalEligibilityAgreement,
  calculateLifecycleIntegrityAgreement,
  calculateReadinessExpectedJudgeAgreement,
  calculateReadinessPromptAgreement,
  evaluateRunIntegrity
} from "../../../src/evaluation/stageContextMetrics/calculateRunIntegrityAgreement.js";
import type { OrchestratorRunIntegrityEvidenceV1 } from "../../../src/evaluation/upstreamArtifacts/index.js";

const READY_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.3/run-integrity/ready-pass-final-pass.json";
const REFRESH_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.3/run-integrity/refresh-required-need-context.json";

function loadEvidence(path: string): OrchestratorRunIntegrityEvidenceV1 {
  return JSON.parse(readFileSync(path, "utf8")) as OrchestratorRunIntegrityEvidenceV1;
}

describe("Batch 3 positive case: ready/PASS/final-PASS chain (section 29.1)", () => {
  const evidence = loadEvidence(READY_PATH);

  it("every component reports agreement and the end-to-end summary is full agreement", () => {
    const result = evaluateRunIntegrity(evidence, "implementation", "agreement");
    expect(result.readinessPrompt.outcome).toBe("agreement");
    expect(result.readinessExpectedJudge.outcome).toBe("agreement");
    expect(result.expectedActualJudge.outcome).toBe("agreement");
    expect(result.judgeCorrection.outcome).toBe("agreement");
    expect(result.judgeFinalEligibility.outcome).toBe("agreement");
    expect(result.eligibilityFinalArtifact.outcome).toBe("agreement");
    expect(result.lifecycleIntegrity.outcome).toBe("agreement");
    expect(result.endToEndSummary.category).toBe("full-agreement");
    expect(result.endToEndSummary.contradictingComponents).toEqual([]);
  });
});

describe("Batch 3 positive case: refresh-required/NEED_CONTEXT chain (section 29.2)", () => {
  const evidence = loadEvidence(REFRESH_PATH);

  it("agreement is reported and absence of a final report is not treated as a failure", () => {
    const result = evaluateRunIntegrity(evidence, "implementation", "agreement");
    expect(result.readinessPrompt.outcome).toBe("agreement");
    expect(result.readinessExpectedJudge.outcome).toBe("agreement");
    expect(result.expectedActualJudge.outcome).toBe("agreement");
    expect(result.judgeCorrection.outcome).toBe("agreement");
    expect(result.eligibilityFinalArtifact.outcome).toBe("agreement");
    expect(result.eligibilityFinalArtifact.finalArtifactPresent).toBe(false);
    expect(result.eligibilityFinalArtifact.contradictions).toEqual([]);
  });

  it("no normal PASS chain is reported", () => {
    const result = evaluateRunIntegrity(evidence, "implementation");
    expect(result.expectedActualJudge.authoredJudgeVerdict).toBe("NEED_CONTEXT");
    expect(result.eligibilityFinalArtifact.finalArtifactVerdict).toBeNull();
  });
});

describe("Batch 3 negative cases (section 30)", () => {
  it("1. NEED_CONTEXT expected, PASS parsed", () => {
    const evidence = loadEvidence(REFRESH_PATH);
    evidence.judgeIntegrity!.authoredJudgeVerdict = "PASS";
    const result = calculateExpectedActualJudgeAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions[0].code).toBe("AUTHORED_PASS_CONTRADICTS_EXPECTED_NEED_CONTEXT");
  });

  it("2. NEED_CONTEXT followed by a PASS final report", () => {
    const evidence = loadEvidence(REFRESH_PATH);
    evidence.finalReportEligibility!.eligible = false;
    evidence.finalArtifactPresent = true;
    evidence.finalArtifactVerdict = "PASS";
    const result = calculateEligibilityFinalArtifactAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions.map((c) => c.code)).toContain("NEED_CONTEXT_FOLLOWED_BY_FINAL_PASS");
  });

  it("3. NEEDS_CORRECTION followed by final-report creation", () => {
    const evidence = loadEvidence(READY_PATH);
    evidence.judgeIntegrity!.authoredJudgeVerdict = "DESIGN_INCOMPLETE";
    evidence.finalReportEligibility!.eligible = false;
    evidence.finalArtifactPresent = true;
    evidence.finalArtifactVerdict = "PASS";
    const result = calculateEligibilityFinalArtifactAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions.map((c) => c.code)).toContain("INELIGIBLE_WITH_FINAL_PASS");
  });

  it("4. BLOCKED followed by final-report creation", () => {
    const evidence = loadEvidence(READY_PATH);
    evidence.judgeIntegrity!.authoredJudgeVerdict = "BLOCKED";
    evidence.finalReportEligibility!.eligible = false;
    evidence.finalArtifactPresent = true;
    evidence.finalArtifactVerdict = "PASS";
    const result = calculateEligibilityFinalArtifactAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
  });

  it("5. Refresh-required readiness with a normal prompt", () => {
    const evidence = loadEvidence(REFRESH_PATH);
    evidence.gate.blockedStageNames = [];
    const result = calculateReadinessPromptAgreement(evidence, "implementation");
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions[0].code).toBe("REFRESH_REQUIRED_BUT_PROMPT_NORMAL");
  });

  it("6. Ready state with refresh-only prompt", () => {
    const evidence = loadEvidence(READY_PATH);
    evidence.gate.blockedStageNames = ["implementation"];
    const result = calculateReadinessPromptAgreement(evidence, "implementation");
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions[0].code).toBe("READY_BUT_PROMPT_NOT_NORMAL");
  });

  it("8. Expected judge PASS but parsed NEED_CONTEXT", () => {
    const evidence = loadEvidence(READY_PATH);
    evidence.judgeIntegrity!.authoredJudgeVerdict = "NEED_CONTEXT";
    evidence.judgeIntegrity!.judgeVerdictMatchesExpected = false;
    const result = calculateExpectedActualJudgeAgreement(evidence);
    // Not the PASS/NEED_CONTEXT contradiction direction (that is specifically authored PASS
    // vs expected NEED_CONTEXT); a NEED_CONTEXT authored against an expected PASS is instead
    // surfaced by readinessExpectedJudge/judgeFinalEligibility, not fabricated as agreement
    // here.
    expect(evidence.judgeIntegrity!.judgeVerdictMatchesExpected).toBe(false);
    expect(result.authoredJudgeVerdict).toBe("NEED_CONTEXT");
  });

  it("9. Unknown judge verdict", () => {
    const evidence = loadEvidence(READY_PATH);
    evidence.judgeIntegrity!.judgeVerdictParseStatus = "unknown-verdict";
    evidence.judgeIntegrity!.authoredJudgeVerdict = null;
    const result = calculateExpectedActualJudgeAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions[0].code).toBe("JUDGE_VERDICT_UNKNOWN");
  });

  it("10. Malformed judge evidence (missing-verdict)", () => {
    const evidence = loadEvidence(READY_PATH);
    evidence.judgeIntegrity!.judgeVerdictParseStatus = "missing-verdict";
    evidence.judgeIntegrity!.authoredJudgeVerdict = null;
    const result = calculateExpectedActualJudgeAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions[0].code).toBe("JUDGE_VERDICT_MISSING");
  });

  it("11. Missing judge with final-report eligibility true", () => {
    const evidence = loadEvidence(READY_PATH);
    evidence.judgeIntegrity!.judgeArtifactPresent = false;
    evidence.judgeIntegrity!.judgeVerdictParseStatus = "missing-artifact";
    evidence.judgeIntegrity!.authoredJudgeVerdict = null;
    evidence.judgeIntegrity!.judgeVerdictAccepted = false;
    // finalReportEligible left (inconsistently) true to prove the contradiction fires.
    const result = calculateJudgeFinalEligibilityAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions.map((c) => c.code)).toEqual(
      expect.arrayContaining(["ELIGIBLE_WITH_NON_PASS_JUDGE", "ELIGIBLE_WITH_MALFORMED_OR_MISSING_JUDGE", "ELIGIBLE_WITH_UNACCEPTED_JUDGE"])
    );
  });

  it("12. Corrective judge verdict with no correction route", () => {
    const evidence = loadEvidence(READY_PATH);
    evidence.judgeIntegrity!.authoredJudgeVerdict = "DESIGN_INCOMPLETE";
    evidence.judgeIntegrity!.correctionRequired = true;
    evidence.judgeIntegrity!.acceptedCorrectionRoute = null;
    const result = calculateJudgeCorrectionAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions[0].code).toBe("CORRECTIVE_VERDICT_WITHOUT_ROUTE");
  });

  it("13. PASS judge verdict with an active correction route", () => {
    const evidence = loadEvidence(READY_PATH);
    evidence.judgeIntegrity!.acceptedCorrectionRoute = {
      verdict: "PASS",
      recommendedStage: "implementation",
      routedStage: "implementation",
      routeStatus: "correction_required",
      warnings: [],
      errors: [],
      isBlocked: false,
      strictFail: false
    };
    const result = calculateJudgeCorrectionAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions[0].code).toBe("PASS_WITH_ACTIVE_CORRECTION_ROUTE");
  });

  it("14. Correction route targeting the wrong structured destination", () => {
    const evidence = loadEvidence(REFRESH_PATH);
    evidence.judgeIntegrity!.acceptedCorrectionStage = "implementation";
    evidence.judgeIntegrity!.acceptedCorrectionRoute!.routedStage = "verification";
    const result = calculateJudgeCorrectionAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions[0].code).toBe("CORRECTION_DESTINATION_MISMATCH");
  });

  it("15. Final-report eligibility false but final artifact present", () => {
    const evidence = loadEvidence(REFRESH_PATH);
    evidence.finalArtifactPresent = true;
    evidence.finalArtifactVerdict = "NEED_CONTEXT";
    const result = calculateEligibilityFinalArtifactAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions.map((c) => c.code)).toContain("INELIGIBLE_BUT_ARTIFACT_PRESENT");
  });

  it("16. Final artifact present with malformed final verdict", () => {
    const evidence = loadEvidence(READY_PATH) as unknown as Record<string, unknown>;
    delete evidence["finalArtifactVerdict"];
    const result = calculateEligibilityFinalArtifactAgreement(evidence as unknown as OrchestratorRunIntegrityEvidenceV1);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions.map((c) => c.code)).toContain("FINAL_ARTIFACT_MALFORMED_VERDICT");
  });

  it("17. Refresh-only stage completed through artifact presence", () => {
    const evidence = loadEvidence(REFRESH_PATH);
    evidence.lifecycle = [
      { artifactFile: "artifacts/implementation.txt", stageName: "implementation", fileExists: true, manualRecord: null, resolvedState: "complete" }
    ];
    const result = calculateLifecycleIntegrityAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions[0].code).toBe("MANUAL_MARK_COMPLETE_BYPASS_SUCCEEDED");
    expect(result.entries[0].completionBasis).toBe("artifact-presence-only");
  });

  it("18. Manual mark-complete bypass attempt", () => {
    const evidence = loadEvidence(REFRESH_PATH);
    evidence.lifecycle = [
      {
        artifactFile: "artifacts/implementation.txt",
        stageName: "implementation",
        fileExists: true,
        manualRecord: { state: "complete", updatedAt: "2026-07-31T00:00:00.000Z", source: "cli" },
        resolvedState: "complete"
      }
    ];
    const result = calculateLifecycleIntegrityAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
    expect(result.entries[0].bypassSucceeded).toBe(true);
    expect(result.entries[0].completionBasis).toBe("manual-record");
  });

  it("a correctly rejected manual mark-complete attempt is not itself a contradiction", () => {
    const evidence = loadEvidence(REFRESH_PATH);
    evidence.lifecycle = [
      {
        artifactFile: "artifacts/implementation.txt",
        stageName: "implementation",
        fileExists: true,
        manualRecord: { state: "complete", updatedAt: "2026-07-31T00:00:00.000Z", source: "cli" },
        resolvedState: "blocked"
      }
    ];
    const result = calculateLifecycleIntegrityAgreement(evidence);
    expect(result.outcome).toBe("agreement");
    expect(result.entries[0].markCompleteRejected).toBe(true);
    expect(result.entries[0].bypassSucceeded).toBe(false);
  });

  it("19. Integrity gate failed but final-report stage marked complete", () => {
    const evidence = loadEvidence(REFRESH_PATH);
    evidence.lifecycle = [{ artifactFile: "artifacts/final-report.txt", stageName: "final-report", fileExists: true, manualRecord: null, resolvedState: "complete" }];
    const result = calculateLifecycleIntegrityAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
    expect(result.entries[0].bypassSucceeded).toBe(true);
  });

  it("20. Legacy or partial artifact with unavailable run-integrity evidence", () => {
    const evidence = loadEvidence(READY_PATH);
    delete evidence.judgeIntegrity;
    delete evidence.finalReportEligibility;
    const result = evaluateRunIntegrity(evidence, "implementation");
    expect(result.expectedActualJudge.availability).toBe("unavailable");
    expect(result.expectedActualJudge.outcome).toBe("insufficient-evidence");
    expect(result.judgeCorrection.outcome).toBe("insufficient-evidence");
    expect(result.judgeFinalEligibility.outcome).toBe("insufficient-evidence");
    expect(result.eligibilityFinalArtifact.outcome).toBe("insufficient-evidence");
  });
});

describe("readiness/expected-judge invariant check", () => {
  it("detects a tampered fixture where contextReady and expectedJudgeVerdict disagree", () => {
    const evidence = loadEvidence(READY_PATH);
    evidence.gate.contextReady = false;
    const result = calculateReadinessExpectedJudgeAgreement(evidence);
    expect(result.outcome).toBe("contradiction");
    expect(result.contradictions[0].code).toBe("CONTEXT_NOT_READY_BUT_EXPECTED_NOT_NEED_CONTEXT");
  });
});
