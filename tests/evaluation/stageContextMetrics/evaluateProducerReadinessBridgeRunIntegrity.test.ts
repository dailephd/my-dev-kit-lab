// v0.4.5 Batch 3: run-integrity evidence exercised through the full
// evaluateProducerReadinessBridge integration seam (section 31.2 / 29-30).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateProducerReadinessBridge } from "../../../src/evaluation/stageContextMetrics/evaluateProducerReadinessBridge.js";
import type { OrchestratorRunIntegrityEvidenceV1 } from "../../../src/evaluation/upstreamArtifacts/index.js";
import type { StageContextExpectationFixtureV1 } from "../../../src/evaluation/stageContextExpectations/index.js";

const READY_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.3/run-integrity/ready-pass-final-pass.json";
const REFRESH_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.3/run-integrity/refresh-required-need-context.json";

function loadEvidence(path: string): OrchestratorRunIntegrityEvidenceV1 {
  return JSON.parse(readFileSync(path, "utf8")) as OrchestratorRunIntegrityEvidenceV1;
}

function baseExpectations(): StageContextExpectationFixtureV1 {
  return {
    schemaVersion: "1.0.0",
    caseId: "CASE-V045-B3-RUN-INTEGRITY",
    title: "run-integrity bridge integration",
    description: "d",
    expectedEvidence: [],
    expectedStates: {},
    warnings: [],
    producerReadinessExpectations: {}
  };
}

describe("Batch 3 positive case: ready/PASS/final-PASS chain through the bridge (section 29.1)", () => {
  it("every run-integrity component reports agreement and no contradiction is reported", () => {
    const evidence = loadEvidence(READY_PATH);
    const result = evaluateProducerReadinessBridge({ runIntegrityEvidence: evidence, expectations: baseExpectations() });
    expect(result.status).toBe("evaluated");
    const evaluation = result.runIntegrityEvaluation!;
    // No producer capsule/readiness input was supplied in this run-integrity-only case, so
    // the producerReadiness component is honestly insufficient-evidence rather than
    // fabricated agreement -- every other component still agrees and nothing contradicts.
    expect(evaluation.endToEndSummary.category).toBe("insufficient-evidence");
    expect(evaluation.endToEndSummary.contradictingComponents).toEqual([]);
    expect(evaluation.readinessPrompt.outcome).toBe("agreement");
    expect(evaluation.readinessExpectedJudge.outcome).toBe("agreement");
    expect(evaluation.expectedActualJudge.outcome).toBe("agreement");
    expect(evaluation.judgeCorrection.outcome).toBe("agreement");
    expect(evaluation.judgeFinalEligibility.outcome).toBe("agreement");
    expect(evaluation.eligibilityFinalArtifact.outcome).toBe("agreement");
    expect(evaluation.lifecycleIntegrity.outcome).toBe("agreement");
  });
});

describe("Batch 3 positive case: refresh-required/NEED_CONTEXT chain through the bridge (section 29.2)", () => {
  it("agreement is reported and absence of a final report is not a failure", () => {
    const evidence = loadEvidence(REFRESH_PATH);
    const result = evaluateProducerReadinessBridge({ runIntegrityEvidence: evidence, expectations: baseExpectations() });
    const evaluation = result.runIntegrityEvaluation!;
    expect(evaluation.eligibilityFinalArtifact.outcome).toBe("agreement");
    expect(evaluation.eligibilityFinalArtifact.finalArtifactPresent).toBe(false);
    expect(evaluation.endToEndSummary.contradictingComponents).toEqual([]);
  });
});

describe("Batch 3 negative case: NEED_CONTEXT followed by an authored PASS, through the bridge", () => {
  it("reports a contradiction rather than a normal PASS chain", () => {
    const evidence = loadEvidence(REFRESH_PATH);
    evidence.judgeIntegrity!.authoredJudgeVerdict = "PASS";
    const result = evaluateProducerReadinessBridge({ runIntegrityEvidence: evidence, expectations: baseExpectations() });
    const evaluation = result.runIntegrityEvaluation!;
    expect(evaluation.expectedActualJudge.outcome).toBe("contradiction");
    expect(evaluation.endToEndSummary.category).toBe("contradiction-present");
    expect(evaluation.endToEndSummary.contradictingComponents).toContain("expectedActualJudge");
  });
});

describe("Batch 3 negative case: NEED_CONTEXT followed by a PASS final report, through the bridge", () => {
  it("reports an integrity contradiction (the required v0.4.5 failure detection)", () => {
    const evidence = loadEvidence(REFRESH_PATH);
    evidence.finalArtifactPresent = true;
    evidence.finalArtifactVerdict = "PASS";
    const result = evaluateProducerReadinessBridge({ runIntegrityEvidence: evidence, expectations: baseExpectations() });
    const evaluation = result.runIntegrityEvaluation!;
    expect(evaluation.eligibilityFinalArtifact.outcome).toBe("contradiction");
    expect(evaluation.eligibilityFinalArtifact.contradictions.map((c) => c.code)).toContain("NEED_CONTEXT_FOLLOWED_BY_FINAL_PASS");
    expect(evaluation.endToEndSummary.category).toBe("contradiction-present");
  });
});

describe("Batch 3 negative case: manual mark-complete bypass, through the bridge", () => {
  it("reports a lifecycle-integrity contradiction", () => {
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
    const result = evaluateProducerReadinessBridge({ runIntegrityEvidence: evidence, expectations: baseExpectations() });
    const evaluation = result.runIntegrityEvaluation!;
    expect(evaluation.lifecycleIntegrity.outcome).toBe("contradiction");
    expect(evaluation.lifecycleIntegrity.contradictions[0].code).toBe("MANUAL_MARK_COMPLETE_BYPASS_SUCCEEDED");
    expect(evaluation.endToEndSummary.contradictingComponents).toContain("lifecycleIntegrity");
  });
});

describe("Batch 3 negative case: missing judge combined with final-report state, through the bridge", () => {
  it("reports insufficient evidence rather than treating a missing judge as PASS", () => {
    const evidence = loadEvidence(READY_PATH);
    delete evidence.judgeIntegrity;
    const result = evaluateProducerReadinessBridge({ runIntegrityEvidence: evidence, expectations: baseExpectations() });
    const evaluation = result.runIntegrityEvaluation!;
    expect(evaluation.expectedActualJudge.outcome).toBe("insufficient-evidence");
    expect(evaluation.expectedActualJudge.authoredJudgeVerdict).toBeNull();
    expect(evaluation.judgeFinalEligibility.outcome).toBe("insufficient-evidence");
  });
});

describe("Batch 3: no runIntegrityEvidence supplied", () => {
  it("leaves runIntegrityEvaluation null rather than fabricating agreement", () => {
    const result = evaluateProducerReadinessBridge({ readiness: undefined, expectations: baseExpectations(), implementation: undefined });
    // No inputs at all -> not-applicable status; runIntegrityEvaluation stays null either way.
    expect(result.runIntegrityEvaluation).toBeNull();
  });
});
