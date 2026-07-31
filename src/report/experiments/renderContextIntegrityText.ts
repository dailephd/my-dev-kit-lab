// v0.4.5 Batch 5: deterministic, bounded, neutral text rendering of ContextIntegrityReportV1.
// Never prints full prompt/judge/final-report prose or complete capsule/audit JSON -- only
// bounded identifiers, counts, and already-calculated agreement states.
import type { ContextIntegrityReportAgreementV1, ContextIntegrityReportV1 } from "./contextIntegrityReportModel.js";

function line(label: string, value: unknown): string {
  return `  ${label}: ${value === null || value === undefined ? "(unavailable)" : String(value)}`;
}

function renderAgreement(label: string, agreement: ContextIntegrityReportAgreementV1): string {
  const lines = [`${label}: ${agreement.outcome} (availability: ${agreement.availability})`];
  if (agreement.reason) lines.push(`  reason: ${agreement.reason}`);
  if (agreement.contradictions.totalCount > 0) {
    lines.push(`  contradictions (${agreement.contradictions.displayedCount} of ${agreement.contradictions.totalCount}, omitted ${agreement.contradictions.omittedCount}):`);
    for (const c of agreement.contradictions.items) {
      lines.push(`    - [${c.code}] ${c.fieldPath}: expected=${c.expected ?? "(n/a)"} observed=${c.observed ?? "(n/a)"} -- ${c.reason}`);
    }
  }
  return lines.join("\n");
}

export function renderContextIntegrityText(report: ContextIntegrityReportV1): string {
  const sections: string[] = [];

  sections.push(
    [
      "=== 1. Context-integrity summary ===",
      line("Fixture ID", report.fixture.fixtureId),
      line("Fixture kind", report.fixture.kind),
      line("End-to-end category", report.endToEnd?.category ?? "(unavailable)"),
      line("Contradicting components", report.endToEnd ? report.endToEnd.contradictingComponents.join(", ") || "(none)" : "(unavailable)")
    ].join("\n")
  );

  sections.push(
    [
      "=== 2. Fixture and provenance ===",
      line("Description", report.fixture.description),
      line("my-dev-kit commit", report.fixture.myDevKitCommit),
      line("orchestrator commit", report.fixture.orchestratorCommit),
      line("Target repository identity", report.fixture.targetRepositoryIdentity),
      line("Active index identity", report.fixture.activeIndexIdentity),
      line("Manifest schema version", report.fixture.manifestSchemaVersion),
      line("Tracked artifacts", report.fixture.trackedArtifactCount),
      line("Derived artifacts", report.fixture.derivedArtifactCount),
      line("Byte-exact artifacts", report.fixture.byteExactArtifactCount),
      line("Hash verification", `${report.fixture.hashVerification.ok ? "PASS" : "FAIL"} (${report.fixture.hashVerification.checkedCount} checked)`),
      ...(report.fixture.correctedReplayLimitation ? [`  LIMITATION: ${report.fixture.correctedReplayLimitation}`] : [])
    ].join("\n")
  );

  sections.push(
    [
      "=== 3. Producer allocation and omissions ===",
      line("Producer tool", `${report.producerIdentity.toolName ?? "(unavailable)"} ${report.producerIdentity.toolVersion ?? ""}`.trim()),
      line("Role adequacy status", report.producerIdentity.roleAdequacyStatus),
      line("Allocation availability", report.allocation.availability),
      line("Groups evaluated", report.allocation.groupCount),
      line("Total required omitted", report.allocation.totalRequiredOmitted),
      line("Total optional omitted", report.allocation.totalOptionalOmitted),
      line("Groups with required omission", report.allocation.groupsWithRequiredOmission.join(", ") || "(none)"),
      line("Groups with optional-only omission", report.allocation.groupsWithOptionalOnlyOmission.join(", ") || "(none)"),
      line("Spillover availability", report.spillover.availability),
      line("Groups contributing capacity", report.spillover.groupsContributing.join(", ") || "(none)"),
      line("Groups borrowing capacity", report.spillover.groupsBorrowing.join(", ") || "(none)"),
      line("Truncation state", report.truncation.state),
      line("requiredEvidenceLost", report.truncation.requiredEvidenceLost)
    ].join("\n")
  );

  sections.push(
    [
      "=== 4. Condition coverage ===",
      line("Availability", report.conditionCoverage.availability),
      line("Required conditions total", report.conditionCoverage.requiredConditionsTotal),
      line("Required conditions satisfied", report.conditionCoverage.requiredConditionsSatisfied),
      line("Required conditions missing", report.conditionCoverage.requiredConditionsMissing.join(", ") || "(none)"),
      line("Required conditions lost", report.conditionCoverage.requiredConditionsLost.join(", ") || "(none)"),
      line("Last-witness-loss count", report.conditionCoverage.lastWitnessLossCount)
    ].join("\n")
  );

  sections.push(
    [
      "=== 5. Producer/readiness agreement ===",
      renderAgreement("Producer-condition agreement", report.producerConditionAgreement),
      renderAgreement("requiredEvidenceLost agreement", report.requiredEvidenceLossAgreement),
      renderAgreement("Producer/readiness relationship", report.producerReadinessAgreement)
    ].join("\n")
  );

  sections.push(
    [
      "=== 6. Prompt and judge agreement ===",
      "Note: the orchestrator does not expose a literal upstream promptMode field. stageMayRenderNormalPrompt (a boolean derived from structured blocked-stage evidence) is the bounded substitute used here.",
      renderAgreement("Readiness/prompt agreement", report.readinessPromptAgreement),
      renderAgreement("Readiness/expected-judge agreement", report.readinessExpectedJudgeAgreement),
      renderAgreement("Expected/actual-judge agreement", report.expectedActualJudgeAgreement)
    ].join("\n")
  );

  sections.push(
    [
      "=== 7. Correction and final-report agreement ===",
      renderAgreement("Judge/correction agreement", report.judgeCorrectionAgreement),
      renderAgreement("Judge/final-eligibility agreement", report.judgeFinalEligibilityAgreement),
      renderAgreement("Eligibility/final-artifact agreement", report.eligibilityFinalArtifactAgreement)
    ].join("\n")
  );

  sections.push(["=== 8. Lifecycle integrity ===", renderAgreement("Lifecycle-integrity agreement", report.lifecycleIntegrityAgreement)].join("\n"));

  sections.push(
    [
      "=== 9. Determinism and immutability ===",
      line("Determinism availability", report.determinism.availability),
      line("Repeat count", report.determinism.repeatCount),
      line("Deterministic", report.determinism.deterministic),
      line("Fixture self-immutable", report.immutability.fixtureSelfImmutable),
      line("Fixture immutability reason", report.immutability.fixtureImmutabilityReason)
    ].join("\n")
  );

  const allContradictionCounts = [
    report.producerConditionAgreement,
    report.requiredEvidenceLossAgreement,
    report.producerReadinessAgreement,
    report.readinessPromptAgreement,
    report.readinessExpectedJudgeAgreement,
    report.expectedActualJudgeAgreement,
    report.judgeCorrectionAgreement,
    report.judgeFinalEligibilityAgreement,
    report.eligibilityFinalArtifactAgreement,
    report.lifecycleIntegrityAgreement
  ].reduce((sum, a) => sum + a.contradictions.totalCount, 0);

  sections.push(
    [
      "=== 10. Contradictions and unavailable evidence ===",
      line("Total contradiction count across all components", allContradictionCounts),
      line("Unavailable sections", report.limitations.unavailableSections.join(", ") || "(none)")
    ].join("\n")
  );

  sections.push(["=== 11. Limitations ===", ...(report.limitations.notes.length > 0 ? report.limitations.notes.map((n) => `  - ${n}`) : ["  (none)"])].join("\n"));

  return sections.join("\n\n") + "\n";
}
