import { assertEvidence, closed, literal, strings, text, validateEco00Subject } from "./eco00ContractValidation.js";
import { canonicalEvidenceJson, evidenceDigest, normalizeEvidencePath, validateSelectedInputs } from "./identity.js";
import type { LabEvidenceQualificationV1, LabVerificationPlanV1 } from "./types.js";

export function validateVerificationPlan(value: unknown): asserts value is LabVerificationPlanV1 {
  canonicalEvidenceJson(value);
  const v = closed(value, ["schemaVersion", "planId", "policyVersion", "subject", "profileId", "selectedInputs", "requirements", "checks"]);
  literal(v.schemaVersion, ["1.0.0"]); text(v.planId); text(v.policyVersion); validateEco00Subject(v.subject); literal(v.profileId, ["cli-verification-v1", "local-app-verification-v1"]); validateSelectedInputs(v.selectedInputs);
  assertEvidence(Array.isArray(v.requirements) && v.requirements.length <= 200 && v.requirements.length > 0, "REQUIREMENT_BOUND"); const ids = new Set<string>();
  for (const entry of v.requirements) {
    const r = closed(entry, ["requirementId", "capabilityId", "criticality", "acceptedArtifactKinds", "acceptedSchemaVersions", "requiredCapabilities", "freshnessPolicy", "nativeSuccessRequired", "applicability"], ["applicabilityReason"]);
    text(r.requirementId); assertEvidence(!ids.has(r.requirementId), "DUPLICATE_REQUIREMENT_ID"); ids.add(r.requirementId); text(r.capabilityId); literal(r.criticality, ["critical", "noncritical"]); strings(r.acceptedArtifactKinds, 1); strings(r.acceptedSchemaVersions, 1); strings(r.requiredCapabilities); literal(r.freshnessPolicy, ["current", "not-applicable"]); literal(r.nativeSuccessRequired, [true, false]); literal(r.applicability, ["applicable", "not-applicable"]);
    if (r.applicabilityReason !== undefined) text(r.applicabilityReason, 240); if (r.applicability === "not-applicable") text(r.applicabilityReason, 240);
  }
  assertEvidence(Array.isArray(v.checks) && v.checks.length <= 64, "CHECK_BOUND"); const checks = new Set<string>();
  for (const entry of v.checks) { const c = closed(entry, ["checkId", "profileId", "testFile", "capabilityId"]); text(c.checkId); assertEvidence(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(c.checkId) && !checks.has(c.checkId), "INVALID_CHECK_ID"); checks.add(c.checkId); literal(c.profileId, ["node-test-tap-v1"]); const testFile = normalizeEvidencePath(c.testFile); assertEvidence(v.selectedInputs.paths.map(normalizeEvidencePath).includes(testFile), "TEST_INPUT_NOT_SELECTED"); text(c.capabilityId); assertEvidence(v.requirements.some(r => (r as { capabilityId: string }).capabilityId === c.capabilityId), "CHECK_CAPABILITY_NOT_REQUIRED"); }
  assertEvidence(new Set((v.checks as Array<{ capabilityId: string }>).map(c => c.capabilityId)).size === v.checks.length, "AMBIGUOUS_CHECK_CAPABILITY", "Each executable check must name a distinct selected capability");
}
export function verificationPlanSha256(plan: LabVerificationPlanV1): string {
  validateVerificationPlan(plan);
  return evidenceDigest({ ...plan, selectedInputs: { ...plan.selectedInputs, paths: plan.selectedInputs.paths.map(normalizeEvidencePath).sort(), exclusions: plan.selectedInputs.exclusions.map(normalizeEvidencePath).sort(), relevantIgnoredPaths: plan.selectedInputs.relevantIgnoredPaths.map(normalizeEvidencePath).sort() } });
}
/** Match a validated capture record to selected policy; this predicate grants no execution authority. */
export function matchesSelectedCapture(plan: LabVerificationPlanV1, planSha256: string, qualification: LabEvidenceQualificationV1): boolean {
  const invocation = qualification.invocationOrNull; const reference = qualification.canonicalEnvelope.nativeArtifact;
  return qualification.captureOrigin === "direct-capture" && qualification.planSha256 === planSha256 && invocation !== null && invocation.disposableExecution && reference.artifactKind === "node-test-tap-v1" && reference.artifactSchemaVersion === "1.0.0" && plan.checks.some(check => check.checkId === invocation.checkId && check.profileId === invocation.profileId && normalizeEvidencePath(check.testFile) === invocation.testFile && check.capabilityId === qualification.canonicalEnvelope.capabilityId);
}
