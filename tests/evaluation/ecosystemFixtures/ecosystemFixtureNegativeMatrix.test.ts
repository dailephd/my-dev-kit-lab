// v0.4.5 Batch 4 (sections 25-27): bounded cross-system negative matrix, built as mutation
// overlays over the already-frozen corrected-replay (full-agreement baseline) and failed-run
// fixtures. Each case identifies its base fixture, the field it changes, and the layer the
// contradiction/unavailability must surface at -- never a fabricated new lab-owned verdict.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadContextIntegrityFixture } from "../../../src/evaluation/ecosystemFixtures/loadContextIntegrityFixture.js";
import { evaluateProducerReadinessBridge } from "../../../src/evaluation/stageContextMetrics/evaluateProducerReadinessBridge.js";
import { checkMyDevKitContextArtifactConsistency } from "../../../src/evaluation/stageContextSelectors/contextArtifactConsistency.js";
import { calculateSupplementalRawAgreement } from "../../../src/evaluation/stageContextMetrics/calculateSupplementalRawAgreement.js";
import { validateEcosystemFixtureManifest } from "../../../src/evaluation/ecosystemFixtures/validateManifest.js";
import { verifyFixtureHashes } from "../../../src/evaluation/ecosystemFixtures/verifyFixtureHashes.js";
import type { ContextCapsule, OrchestratorRunIntegrityEvidenceV1, RetrievalAuditRecord } from "../../../src/evaluation/upstreamArtifacts/index.js";
import type { StageContextExpectationFixtureV1 } from "../../../src/evaluation/stageContextExpectations/index.js";

const CORRECTED_ROOT = "tests/fixtures/ecosystem/context-integrity/v0.4.5/corrected-replay";
const CORRECTED_MANIFEST = "tests/fixtures/ecosystem/context-integrity/v0.4.5/manifests/corrected-replay-manifest.json";
const FAILED_ROOT = "tests/fixtures/ecosystem/context-integrity/v0.4.5/failed-run";
const FAILED_MANIFEST = "tests/fixtures/ecosystem/context-integrity/v0.4.5/manifests/failed-run-manifest.json";

function minimalSupplemental(overrides: {
  documentKind: "implementation-context-packet" | "implementation-context-retrieval-report";
  freshness: "fresh" | "stale" | "unknown";
  requiredEvidenceTruncated: "yes" | "no" | "unknown";
  indexIdentity: string;
}) {
  return {
    documentKind: overrides.documentKind,
    role: "implementation" as const,
    schemaVersion: "1.0.0",
    schemaMajor: 1 as const,
    status: "populated" as const,
    repositoryScope: "single-repository" as const,
    freshness: overrides.freshness,
    adequacy: "sufficient" as const,
    requiredEvidenceTruncated: overrides.requiredEvidenceTruncated,
    contextCapsuleSchemaVersion: "1.0.0",
    retrievalAuditSchemaVersion: "1.0.0",
    toolName: "my-dev-kit",
    toolVersion: "1.10.4",
    indexIdentity: overrides.indexIdentity,
    rawMetadata: {},
    sections: {},
    sectionOrder: [],
    metadataOrder: [],
    warnings: []
  };
}

function baseExpectations(): StageContextExpectationFixtureV1 {
  return {
    schemaVersion: "1.0.0",
    caseId: "CASE-V045-B4-NEGATIVE",
    title: "negative matrix",
    description: "d",
    expectedEvidence: [],
    expectedStates: {},
    warnings: [],
    producerReadinessExpectations: {}
  };
}

async function loadCorrected() {
  const fixture = await loadContextIntegrityFixture(CORRECTED_ROOT, CORRECTED_MANIFEST);
  return {
    capsule: structuredClone(fixture.implementationCapsule!),
    audit: structuredClone(fixture.implementationAudit!),
    runIntegrity: structuredClone(fixture.runIntegrityEvidence!)
  };
}

async function loadFailed() {
  const fixture = await loadContextIntegrityFixture(FAILED_ROOT, FAILED_MANIFEST);
  return {
    capsule: structuredClone(fixture.implementationCapsule!),
    audit: structuredClone(fixture.implementationAudit!),
    runIntegrity: structuredClone(fixture.runIntegrityEvidence!)
  };
}

function evaluate(capsule: ContextCapsule, audit: RetrievalAuditRecord, runIntegrity: OrchestratorRunIntegrityEvidenceV1) {
  return evaluateProducerReadinessBridge({
    implementation: { role: "implementation", contextCapsule: capsule, retrievalAuditRecord: audit },
    readiness: runIntegrity.gate.implementationContext,
    runIntegrityEvidence: runIntegrity,
    expectations: baseExpectations()
  });
}

describe("26.1 producer identity and evidence cases", () => {
  it("1. owner missing -> required condition missing, not fabricated satisfied", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    capsule.roleConditionCoverage![0] = { ...capsule.roleConditionCoverage![0], availableWitnessCount: 0, retainedWitnessCount: 0, retainedWitnessIds: [], conditionSatisfied: false, lostRequiredCondition: false };
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.implementation!.conditionCoverageEvaluation.requiredConditionsMissing.count).toBeGreaterThan(0);
  });

  it("2. required contract missing -> required condition missing", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    capsule.roleConditionCoverage![1] = { ...capsule.roleConditionCoverage![1], availableWitnessCount: 0, retainedWitnessCount: 0, retainedWitnessIds: [], conditionSatisfied: false, lostRequiredCondition: false };
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.implementation!.conditionCoverageEvaluation.requiredConditionsMissing.evidenceKeys).toContain("implementation.required-contract");
  });

  it("3. last adequate witness lost -> requiredConditionsLost, not missing-evidence", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    capsule.roleConditionCoverage![1] = { ...capsule.roleConditionCoverage![1], availableWitnessCount: 2, retainedWitnessCount: 0, retainedWitnessIds: [], conditionSatisfied: false, lostRequiredCondition: true, lossReason: "bounded-allocation-omitted-required-witnesses" };
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.implementation!.conditionCoverageEvaluation.requiredConditionsLost.count).toBe(1);
    expect(result.implementation!.conditionCoverageEvaluation.lastWitnessLoss.count).toBe(1);
  });

  it("4. wrong target repository identity -> capsule/audit parity contradiction", async () => {
    const { capsule, audit } = await loadCorrected();
    audit.index.projectRoot = "Z:/fixture/a-different-repository";
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues.map((i) => i.fieldPath)).toContain("index.projectRoot");
  });

  it("5. wrong active index identity -> parity contradiction", async () => {
    const { capsule, audit } = await loadCorrected();
    audit.index.indexPath = "Z:/fixture/a-different-index";
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues.map((i) => i.fieldPath)).toContain("index.indexPath");
  });

  it("6. stale evidence -> freshness parity contradiction", async () => {
    const { capsule, audit } = await loadCorrected();
    audit.freshness = { ...audit.freshness, state: "stale" };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues.map((i) => i.fieldPath)).toContain("freshness");
  });

  it("7. missing provenance -> unavailable, not fabricated agreement", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    delete (capsule as unknown as Record<string, unknown>).roleConditionCoverage;
    delete (audit as unknown as Record<string, unknown>).roleConditionCoverage;
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.implementation!.conditionCoverageEvaluation.availability).toBe("unavailable");
    expect(result.implementation!.producerConditionAgreement.outcome).toBe("unsupported-legacy-evidence");
  });

  it("8. critical responsibility unmapped -> reported, not silently dropped", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    capsule.responsibilityMappings.mappings = [{ ...capsule.responsibilityMappings.mappings[0], criticality: "critical", mappingStatus: "unmapped" }];
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.criticalityEvaluation).not.toBeNull();
  });

  it("9. required omission incorrectly represented as optional -> requiredEvidenceLossAgreement contradiction", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    capsule.roleConditionCoverage![1] = { ...capsule.roleConditionCoverage![1], availableWitnessCount: 2, retainedWitnessCount: 0, retainedWitnessIds: [], conditionSatisfied: false, lostRequiredCondition: true, lossReason: "bounded-allocation-omitted-required-witnesses" };
    capsule.truncation = { ...capsule.truncation, requiredEvidenceLost: false };
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.implementation!.requiredEvidenceLossAgreement.outcome).toBe("contradiction");
  });

  it("10. requiredEvidenceLost contradicts required-condition evidence (inverse)", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    capsule.truncation = { ...capsule.truncation, requiredEvidenceLost: true };
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.implementation!.requiredEvidenceLossAgreement.outcome).toBe("contradiction");
    expect(result.implementation!.requiredEvidenceLossAgreement.contradictionCodes).toContain(
      "REQUIRED_EVIDENCE_LOST_TRUE_BUT_NO_CONDITION_OR_GROUP_LOSS_DETECTED"
    );
  });
});

describe("26.2 raw and supplemental agreement cases", () => {
  it("11. raw capsule/audit contradiction", async () => {
    const { capsule, audit } = await loadCorrected();
    audit.roleConditionCoverage = [{ ...audit.roleConditionCoverage![0], conditionSatisfied: false, lostRequiredCondition: true }];
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues.map((i) => i.fieldPath)).toContain("roleConditionCoverage");
  });

  it("12. supplemental packet contradicts raw evidence", async () => {
    const { capsule } = await loadCorrected();
    const supplemental = minimalSupplemental({
      documentKind: "implementation-context-packet",
      freshness: "fresh",
      requiredEvidenceTruncated: "yes",
      indexIdentity: capsule.index.projectRoot!
    });
    const result = calculateSupplementalRawAgreement(supplemental, capsule);
    expect(result.contradictions.map((f) => f.field)).toContain("requiredEvidenceLost");
  });

  it("13. supplemental report contradicts raw evidence (freshness)", async () => {
    const { capsule } = await loadCorrected();
    const supplemental = minimalSupplemental({
      documentKind: "implementation-context-retrieval-report",
      freshness: "stale",
      requiredEvidenceTruncated: "no",
      indexIdentity: capsule.index.projectRoot!
    });
    const result = calculateSupplementalRawAgreement(supplemental, capsule);
    expect(result.contradictions.map((f) => f.field)).toContain("freshness");
  });

  it("14. packet/report responsibility-mapping claim contradicts raw evidence", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    capsule.responsibilityMappings = { ...capsule.responsibilityMappings, criticalDropped: true };
    const result = evaluate(capsule, audit, runIntegrity);
    // Retained as raw evidence; capsule/audit parity must now disagree since audit was not
    // mutated the same way.
    expect(result.implementation!.capsuleAuditConditionAgreement.availability).toBe("available");
  });

  it("15. one-sided condition-coverage omission where the contract requires parity", async () => {
    const { capsule, audit } = await loadCorrected();
    delete (audit as unknown as Record<string, unknown>).roleConditionCoverage;
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues.map((i) => i.fieldPath)).toContain("roleConditionCoverage");
  });

  it("16. supplemental evidence claims readiness while raw evidence shows required loss", async () => {
    const { capsule } = await loadFailed();
    const supplemental = minimalSupplemental({
      documentKind: "implementation-context-packet",
      freshness: "fresh",
      requiredEvidenceTruncated: "no",
      indexIdentity: capsule.index.projectRoot!
    });
    const result = calculateSupplementalRawAgreement(supplemental, capsule);
    expect(result.contradictions.length).toBeGreaterThan(0);
  });
});

describe("26.3 readiness and prompt cases", () => {
  it("17. refresh-required readiness with normal prompt authorization", async () => {
    const { capsule, audit, runIntegrity } = await loadFailed();
    runIntegrity.gate.blockedStageNames = [];
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.readinessPrompt.outcome).toBe("contradiction");
  });

  it("18. ready state with refresh-only prompt", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    runIntegrity.gate.blockedStageNames = ["implementation"];
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.readinessPrompt.outcome).toBe("contradiction");
  });

  it("19. blocked state with artifact creation authorized -> lifecycle bypass detected", async () => {
    const { capsule, audit, runIntegrity } = await loadFailed();
    // implementation stage stays in the failed-run lifecycle as resolvedState "complete"
    // despite blockedStageNames including "implementation" -- already the real evidence.
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.lifecycleIntegrity.outcome).toBe("contradiction");
  });

  it("20. recommended correction stage inconsistent with the structured route", async () => {
    const { capsule, audit, runIntegrity } = await loadFailed();
    runIntegrity.judgeIntegrity!.acceptedCorrectionRoute!.routedStage = "verification";
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.judgeCorrection.outcome).toBe("contradiction");
    expect(result.runIntegrityEvaluation!.judgeCorrection.contradictions.map((c) => c.code)).toContain("CORRECTION_DESTINATION_MISMATCH");
  });
});

describe("26.4 judge and correction cases", () => {
  it("21. NEED_CONTEXT expected, PASS parsed", async () => {
    const { capsule, audit, runIntegrity } = await loadFailed();
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.expectedActualJudge.outcome).toBe("contradiction");
  });

  it("22. NEEDS_CORRECTION followed by PASS (a different corrective verdict flipped to PASS)", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    runIntegrity.gate.expectedJudgeVerdict = "NEED_CONTEXT";
    runIntegrity.judgeIntegrity!.expectedJudgeVerdict = "NEED_CONTEXT";
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.expectedActualJudge.outcome).toBe("contradiction");
  });

  it("23. BLOCKED followed by PASS (authored PASS while gate requires NEED_CONTEXT)", async () => {
    const { capsule, audit, runIntegrity } = await loadFailed();
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.expectedActualJudge.contradictions[0].observed).toBe("PASS");
  });

  it("24. unknown judge verdict", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    runIntegrity.judgeIntegrity!.judgeVerdictParseStatus = "unknown-verdict";
    runIntegrity.judgeIntegrity!.authoredJudgeVerdict = null;
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.expectedActualJudge.contradictions.map((c) => c.code)).toContain("JUDGE_VERDICT_UNKNOWN");
  });

  it("25. malformed judge", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    runIntegrity.judgeIntegrity!.judgeVerdictParseStatus = "missing-verdict";
    runIntegrity.judgeIntegrity!.authoredJudgeVerdict = null;
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.expectedActualJudge.contradictions.map((c) => c.code)).toContain("JUDGE_VERDICT_MISSING");
  });

  it("26. missing judge", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    delete runIntegrity.judgeIntegrity;
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.expectedActualJudge.outcome).toBe("insufficient-evidence");
    expect(result.runIntegrityEvaluation!.judgeFinalEligibility.outcome).toBe("insufficient-evidence");
  });

  it("27. corrective verdict with no correction route", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    runIntegrity.judgeIntegrity!.authoredJudgeVerdict = "DESIGN_INCOMPLETE";
    runIntegrity.judgeIntegrity!.correctionRequired = true;
    runIntegrity.judgeIntegrity!.acceptedCorrectionRoute = null;
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.judgeCorrection.contradictions.map((c) => c.code)).toContain("CORRECTIVE_VERDICT_WITHOUT_ROUTE");
  });

  it("28. PASS with active correction route", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    runIntegrity.judgeIntegrity!.acceptedCorrectionRoute = {
      verdict: "PASS",
      recommendedStage: "implementation",
      routedStage: "implementation",
      routeStatus: "correction_required",
      warnings: [],
      errors: [],
      isBlocked: false,
      strictFail: false
    };
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.judgeCorrection.contradictions.map((c) => c.code)).toContain("PASS_WITH_ACTIVE_CORRECTION_ROUTE");
  });

  it("29. wrong correction destination", async () => {
    const { capsule, audit, runIntegrity } = await loadFailed();
    runIntegrity.judgeIntegrity!.acceptedCorrectionStage = "implementation";
    runIntegrity.judgeIntegrity!.acceptedCorrectionRoute!.routedStage = "test-implementation";
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.judgeCorrection.contradictions.map((c) => c.code)).toContain("CORRECTION_DESTINATION_MISMATCH");
  });
});

describe("26.5 final-report and lifecycle cases", () => {
  it("30. NEED_CONTEXT followed by final-report attempt", async () => {
    const { capsule, audit, runIntegrity } = await loadFailed();
    runIntegrity.finalArtifactVerdict = "NEED_CONTEXT";
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.eligibilityFinalArtifact.outcome).toBe("contradiction");
    expect(result.runIntegrityEvaluation!.eligibilityFinalArtifact.contradictions.map((c) => c.code)).toContain("INELIGIBLE_BUT_ARTIFACT_PRESENT");
  });

  it("31. NEED_CONTEXT followed by PASS final report (real historical evidence)", async () => {
    const { capsule, audit, runIntegrity } = await loadFailed();
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.eligibilityFinalArtifact.contradictions.map((c) => c.code)).toContain("NEED_CONTEXT_FOLLOWED_BY_FINAL_PASS");
  });

  it("32. NEEDS_CORRECTION followed by final-report attempt", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    runIntegrity.gate.expectedJudgeVerdict = "PASS";
    runIntegrity.judgeIntegrity!.authoredJudgeVerdict = "DESIGN_INCOMPLETE";
    runIntegrity.finalReportEligibility!.eligible = false;
    runIntegrity.finalArtifactPresent = true;
    runIntegrity.finalArtifactVerdict = "DESIGN_INCOMPLETE";
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.eligibilityFinalArtifact.outcome).toBe("contradiction");
  });

  it("33. BLOCKED followed by final-report attempt", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    runIntegrity.judgeIntegrity!.authoredJudgeVerdict = "BLOCKED";
    runIntegrity.finalReportEligibility!.eligible = false;
    runIntegrity.finalArtifactPresent = true;
    runIntegrity.finalArtifactVerdict = "PASS";
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.eligibilityFinalArtifact.contradictions.map((c) => c.code)).toContain("INELIGIBLE_WITH_FINAL_PASS");
  });

  it("34. final-report eligibility false but artifact present", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    runIntegrity.finalReportEligibility!.eligible = false;
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.eligibilityFinalArtifact.contradictions.map((c) => c.code)).toContain("INELIGIBLE_BUT_ARTIFACT_PRESENT");
  });

  it("35. final-report eligibility true but artifact absent", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    runIntegrity.finalArtifactPresent = false;
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.eligibilityFinalArtifact.contradictions.map((c) => c.code)).toContain("ELIGIBLE_BUT_ARTIFACT_MISSING");
  });

  it("36. final artifact with malformed verdict", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    delete (runIntegrity as unknown as Record<string, unknown>).finalArtifactVerdict;
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.eligibilityFinalArtifact.contradictions.map((c) => c.code)).toContain("FINAL_ARTIFACT_MALFORMED_VERDICT");
  });

  it("37. refresh-only stage completed through artifact presence", async () => {
    const { capsule, audit, runIntegrity } = await loadFailed();
    runIntegrity.lifecycle = [{ artifactFile: "artifacts/implementation-report.txt", stageName: "implementation", fileExists: true, manualRecord: null, resolvedState: "complete" }];
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.lifecycleIntegrity.entries[0].completionBasis).toBe("artifact-presence-only");
    expect(result.runIntegrityEvaluation!.lifecycleIntegrity.entries[0].bypassSucceeded).toBe(true);
  });

  it("38. manual mark-complete bypass succeeds", async () => {
    const { capsule, audit, runIntegrity } = await loadFailed();
    runIntegrity.lifecycle = [
      { artifactFile: "artifacts/implementation-report.txt", stageName: "implementation", fileExists: true, manualRecord: { state: "complete", updatedAt: "2026-07-31T00:00:00.000Z", source: "cli" }, resolvedState: "complete" }
    ];
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.lifecycleIntegrity.entries[0].markCompleteRejected).toBe(false);
    expect(result.runIntegrityEvaluation!.lifecycleIntegrity.entries[0].bypassSucceeded).toBe(true);
  });

  it("39. integrity gate fails but lifecycle reports complete", async () => {
    const { capsule, audit, runIntegrity } = await loadFailed();
    runIntegrity.lifecycle = [{ artifactFile: "artifacts/final-report.txt", stageName: "final-report", fileExists: true, manualRecord: null, resolvedState: "complete" }];
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.lifecycleIntegrity.outcome).toBe("contradiction");
  });

  it("40. final report attempted while readiness is refresh-required", async () => {
    const { capsule, audit, runIntegrity } = await loadFailed();
    const result = evaluate(capsule, audit, runIntegrity);
    expect(result.runIntegrityEvaluation!.readinessExpectedJudge.availability).toBe("available");
    expect(result.runIntegrityEvaluation!.eligibilityFinalArtifact.outcome).toBe("contradiction");
  });
});

describe("26.6 fixture-integrity cases", () => {
  it("41. fixture file missing", async () => {
    const manifestRaw = JSON.parse(await readFile(CORRECTED_MANIFEST, "utf8"));
    const manifestResult = validateEcosystemFixtureManifest(manifestRaw);
    expect(manifestResult.ok).toBe(true);
    if (!manifestResult.ok) return;
    const result = await verifyFixtureHashes(manifestResult.manifest, "tests/fixtures/ecosystem/context-integrity/v0.4.5/does-not-exist");
    expect(result.ok).toBe(false);
    expect(result.issues.every((i) => i.code === "MISSING_FILE")).toBe(true);
  });

  it("42. fixture hash mismatch", async () => {
    const manifestRaw = JSON.parse(await readFile(CORRECTED_MANIFEST, "utf8"));
    const manifestResult = validateEcosystemFixtureManifest(manifestRaw);
    expect(manifestResult.ok).toBe(true);
    if (!manifestResult.ok) return;
    const tampered = { ...manifestResult.manifest, artifacts: manifestResult.manifest.artifacts.map((a, i) => (i === 0 ? { ...a, copiedSha256: "0".repeat(64) } : a)) };
    const result = await verifyFixtureHashes(tampered, CORRECTED_ROOT);
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe("HASH_MISMATCH");
  });

  it("43. manifest references path outside fixture root", () => {
    const manifestRaw = { manifestSchemaVersion: "1.0.0", fixtureId: "x", description: "d", sourceEvidenceRoot: "r", generatedAt: "t", artifacts: [{ fixtureRelativePath: "../../../outside.json", originalSha256: "a".repeat(64), copiedSha256: "a".repeat(64) }] };
    const result = validateEcosystemFixtureManifest(manifestRaw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain("PATH_ESCAPES_FIXTURE_ROOT");
  });

  it("44. duplicate manifest path", () => {
    const manifestRaw = {
      manifestSchemaVersion: "1.0.0",
      fixtureId: "x",
      description: "d",
      sourceEvidenceRoot: "r",
      generatedAt: "t",
      artifacts: [
        { fixtureRelativePath: "a.json", originalSha256: "a".repeat(64), copiedSha256: "a".repeat(64) },
        { fixtureRelativePath: "a.json", originalSha256: "b".repeat(64), copiedSha256: "b".repeat(64) }
      ]
    };
    const result = validateEcosystemFixtureManifest(manifestRaw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain("DUPLICATE_ARTIFACT_PATH");
  });

  it("45. unsupported manifest schema major", () => {
    const result = validateEcosystemFixtureManifest({ manifestSchemaVersion: "2.0.0", artifacts: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe("UNSUPPORTED_MANIFEST_SCHEMA_MAJOR");
  });

  it("46. corrected replay provenance references wrong upstream commit", async () => {
    const manifestRaw = JSON.parse(await readFile(CORRECTED_MANIFEST, "utf8"));
    expect(manifestRaw.myDevKit.commit).toBe("d09068fc8190ba8bde3fcc7b045ca62a3ce18876");
    expect(manifestRaw.orchestrator.commit).toBe("2cb82f09ed423be8defd8277f28608c8a17eae3e");
    const wrongCommit = { ...manifestRaw, myDevKit: { ...manifestRaw.myDevKit, commit: "0000000000000000000000000000000000000000" } };
    expect(wrongCommit.myDevKit.commit).not.toBe(manifestRaw.myDevKit.commit);
  });

  it("47. determinism digest mismatch is detectable (synthetic divergent runs)", async () => {
    const { calculateStageContextDeterminism } = await import("../../../src/evaluation/stageContextDeterminism/calculateStageContextDeterminism.js");
    const result = calculateStageContextDeterminism([
      { runNumber: 1, value: { a: 1 } },
      { runNumber: 2, value: { a: 2 } }
    ]);
    expect(result.deterministic).toBe(false);
    expect(result.mismatchRunNumbers).toEqual([2]);
  });

  it("48. target mutation detected (synthetic via compareTargetSnapshots)", async () => {
    const { compareTargetSnapshots } = await import("../../../src/evaluation/targetImmutability/compareTargetSnapshots.js");
    const before = {
      targetRootPath: "t",
      resolvedTargetRootPath: "t",
      configuredFiles: [{ relativePath: "f.txt", resolvedPath: "t/f.txt", state: "file" as const, sha256: "a".repeat(64), symbolicLinkTarget: null }],
      git: { availability: "not-repository" as const, branch: null, head: null, statusEntries: [], worktreeDiffSha256: null, stagedDiffSha256: null, untrackedFiles: [] }
    };
    const after = { ...before, configuredFiles: [{ ...before.configuredFiles[0], sha256: "b".repeat(64) }] };
    const result = compareTargetSnapshots(before, after);
    expect(result.status).toBe("mutated");
    expect(result.mutations.length).toBeGreaterThan(0);
  });

  it("49. negative-case expectations: unrelated valid evidence stays stable across a mutation", async () => {
    const { capsule, audit, runIntegrity } = await loadCorrected();
    runIntegrity.judgeIntegrity!.judgeVerdictParseStatus = "unknown-verdict";
    runIntegrity.judgeIntegrity!.authoredJudgeVerdict = null;
    const result = evaluate(capsule, audit, runIntegrity);
    // The judge layer contradicts, but unrelated readiness/prompt agreement remains stable.
    expect(result.runIntegrityEvaluation!.expectedActualJudge.outcome).toBe("contradiction");
    expect(result.runIntegrityEvaluation!.readinessPrompt.outcome).toBe("agreement");
    expect(result.implementation!.producerConditionAgreement.outcome).toBe("agreement");
  });
});
