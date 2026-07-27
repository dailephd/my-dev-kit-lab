import { describe, expect, it } from "vitest";
import {
  calculateInvalidReady,
  calculateReadinessAgreementMetrics,
  calculateReadinessDecisionAgreement,
  calculateReadinessStructuralAgreement,
  calculateValidBlocked
} from "../../../src/evaluation/stageContextMetrics/calculateReadinessAgreement.js";
import type { OrchestratorContextReadinessResultV1, SupplementalContextDocumentV1 } from "../../../src/evaluation/upstreamArtifacts/index.js";
import type { ProducerReadinessReadinessExpectationV1 } from "../../../src/evaluation/stageContextExpectations/index.js";

function readiness(overrides: Partial<OrchestratorContextReadinessResultV1> = {}): OrchestratorContextReadinessResultV1 {
  return {
    schemaVersion: "1.0.0",
    kind: "implementation",
    role: "implementation",
    decision: "ready",
    classification: "ready",
    stageId: "stage.feature.implementation",
    packetPath: "artifacts/implementation-context-packet.txt",
    reportPath: "reports/implementation-context-retrieval-report.txt",
    issues: [],
    warnings: [],
    blockingIssueCodes: [],
    affectedResponsibilityIds: [],
    evaluatedFreshness: "fresh",
    evaluatedAdequacy: "sufficient",
    requiredEvidenceTruncated: "no",
    readyWithAssumptions: false,
    provenanceSummary: "s",
    indexIdentity: "Z:/repo/canonical",
    ...overrides
  };
}

function expectation(overrides: Partial<ProducerReadinessReadinessExpectationV1> = {}): ProducerReadinessReadinessExpectationV1 {
  return { expectationId: "READY-001", kind: "implementation", notes: [], ...overrides };
}

describe("calculateReadinessDecisionAgreement", () => {
  // TST-B2-036
  it("expected ready and observed ready agree", () => {
    const result = calculateReadinessDecisionAgreement(readiness({ decision: "ready" }), expectation({ allowedDecisions: ["ready"] }));
    expect(result).toMatchObject({ availability: "available", decisionAgreement: true });
  });

  // TST-B2-037
  it("expected blocked and observed blocked with matching issue code produce valid blocked", () => {
    const rr = readiness({ decision: "refresh-required", blockingIssueCodes: ["CONTEXT_PACKET_TEMPLATE"] });
    const exp = expectation({ allowedDecisions: ["refresh-required"], expectedIssueCodes: ["CONTEXT_PACKET_TEMPLATE"] });
    expect(calculateReadinessDecisionAgreement(rr, exp)).toMatchObject({ decisionAgreement: true, issueCodesAgreement: true });
    expect(calculateValidBlocked(rr, exp)).toMatchObject({ availability: "available", validBlocked: true, validRefreshRequired: true });
  });

  // TST-B2-038
  it("refresh-required stays distinct from a generic blocked expectation", () => {
    const rr = readiness({ decision: "refresh-required" });
    const exp = expectation({ allowedDecisions: ["refresh-required"] });
    const result = calculateValidBlocked(rr, exp);
    expect(result.observedDecision).toBe("refresh-required");
    expect(result.validRefreshRequired).toBe(true);
  });

  // TST-B2-039
  it("observed ready against explicit blocking expectations produces invalid ready", () => {
    const rr = readiness({ decision: "ready" });
    const exp = expectation({ allowedDecisions: ["refresh-required"], expectedIssueCodes: ["CONTEXT_PACKET_TEMPLATE"] });
    const result = calculateInvalidReady(rr, exp);
    expect(result).toMatchObject({ availability: "available", invalidReady: true, missingExpectedIssueCodes: ["CONTEXT_PACKET_TEMPLATE"] });
  });

  // TST-B2-040
  it("observed blocked with the wrong issue code does not produce valid blocked", () => {
    const rr = readiness({ decision: "refresh-required", blockingIssueCodes: ["CONTEXT_PACKET_MALFORMED"] });
    const exp = expectation({ allowedDecisions: ["refresh-required"], expectedIssueCodes: ["CONTEXT_PACKET_TEMPLATE"] });
    expect(calculateValidBlocked(rr, exp).validBlocked).toBe(false);
  });

  // TST-B2-041
  it("missing readiness input reports unavailable", () => {
    expect(calculateReadinessDecisionAgreement(undefined, expectation()).availability).toBe("unavailable");
    expect(calculateInvalidReady(undefined, expectation()).availability).toBe("unavailable");
    expect(calculateValidBlocked(undefined, expectation()).availability).toBe("unavailable");
  });

  // TST-B2-042
  it("no readiness expectation reports not applicable", () => {
    expect(calculateReadinessDecisionAgreement(readiness(), undefined).availability).toBe("not-applicable");
    expect(calculateInvalidReady(readiness(), undefined).availability).toBe("not-applicable");
    expect(calculateValidBlocked(readiness(), undefined).availability).toBe("not-applicable");
  });

  // TST-B2-044
  it("issue-code order and primary issue are preserved where meaningful", () => {
    const rr = readiness({
      blockingIssueCodes: ["A", "B"],
      primaryIssue: {
        code: "A",
        severity: "error",
        message: "m",
        priority: 1,
        correctiveAction: "c",
        evidenceTarget: "e",
        stageId: "stage.feature.implementation",
        contextKind: "implementation"
      }
    });
    const exp = expectation({ expectedPrimaryIssueCode: "A" });
    const result = calculateReadinessDecisionAgreement(rr, exp);
    expect(result.observedIssueCodes).toEqual(["A", "B"]);
    expect(result.primaryIssueAgreement).toBe(true);
  });

  // TST-B2-045: this suite calls only calculateReadinessDecisionAgreement/calculateInvalidReady/
  // calculateValidBlocked -- pure functions over already-observed OrchestratorContextReadinessResultV1
  // input, never calling orchestrator code. Cross-checked by
  // supplementalContextIndependenceRegression.test.ts at the import level.
});

describe("calculateReadinessStructuralAgreement", () => {
  // TST-B2-043
  it("readiness identity contradiction is reported separately from decision disagreement", () => {
    const rr = readiness({ indexIdentity: "Z:/repo/other" });
    const doc: SupplementalContextDocumentV1 = {
      documentKind: "implementation-context-packet",
      role: "implementation",
      schemaVersion: "1.0.0",
      schemaMajor: 1,
      status: "populated",
      repositoryScope: "single-repository",
      freshness: "fresh",
      adequacy: "sufficient",
      requiredEvidenceTruncated: "no",
      contextCapsuleSchemaVersion: "1.0.0",
      retrievalAuditSchemaVersion: "1.0.0",
      toolName: "my-dev-kit",
      toolVersion: "1.10.2",
      indexIdentity: "Z:/repo/canonical",
      rawMetadata: {},
      sections: {},
      sectionOrder: [],
      metadataOrder: [],
      warnings: []
    };
    const structural = calculateReadinessStructuralAgreement(rr, doc, undefined);
    const identity = structural.find((s) => s.field === "canonicalRepositoryIdentity")!;
    expect(identity.agreement).toBe(false);
    // Decision-level agreement is a separate calculation and is unaffected by the identity mismatch.
    const decision = calculateReadinessDecisionAgreement(rr, expectation({ allowedDecisions: ["ready"] }));
    expect(decision.decisionAgreement).toBe(true);
  });

  it("aggregate helper composes structural, decision, invalid-ready, and valid-blocked results", () => {
    const rr = readiness();
    const result = calculateReadinessAgreementMetrics(rr, expectation({ allowedDecisions: ["ready"] }), undefined, undefined);
    expect(result.decisionAgreement.availability).toBe("available");
    expect(result.structuralAgreement.length).toBeGreaterThan(0);
  });
});
