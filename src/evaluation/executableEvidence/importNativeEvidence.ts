import { assertEvidence, closed, digest, LabEvidenceError, literal, strings, text, validateEco00Envelope, validateEco00Environment, validateEco00NativeReference } from "./eco00ContractValidation.js";
import { canonicalEvidenceJson, evidenceDigest, evidenceRootIdentity, readEvidenceBytes, sha256, validateSubjectBinding } from "./identity.js";
import { adaptNativeEvidence } from "./nativeAdapters.js";
import { verificationPlanSha256 } from "./verificationPlan.js";
import type { LabEvidenceImportRequestV1, LabEvidenceImportResultV1, LabEvidenceQualificationV1 } from "./types.js";

export const LAB_EVIDENCE_SCHEMA_IDENTITIES = Object.freeze({ plan: "lab-executable-evidence-plan-v1", qualification: "lab-executable-evidence-qualification-v1", assessment: "lab-executable-evidence-assessment-v1", certification: "lab-executable-evidence-certification-v1" });
export function qualificationIdentity(record: Omit<LabEvidenceQualificationV1, "qualificationId"> | LabEvidenceQualificationV1): string {
  const { qualifiedAtOrNull: _time, ...content } = record;
  const { qualificationId: _id, ...identity } = content as typeof content & { qualificationId?: string };
  return evidenceDigest(identity);
}
export function validateQualification(value: unknown): asserts value is LabEvidenceQualificationV1 {
  canonicalEvidenceJson(value); const v = closed(value, ["schemaVersion", "qualificationId", "canonicalEnvelope", "planSha256", "subjectBinding", "environmentBinding", "nativeArtifactSha256", "captureOrigin", "invocationOrNull", "nativeOutcome", "completeness", "provenance", "limitations", "qualifiedAtOrNull"]);
  literal(v.schemaVersion, ["1.0.0"]); digest(v.qualificationId); validateEco00Envelope(v.canonicalEnvelope); digest(v.planSha256); validateSubjectBinding(v.subjectBinding); if (v.environmentBinding !== null) validateEco00Environment(v.environmentBinding); digest(v.nativeArtifactSha256);
  literal(v.captureOrigin, ["direct-capture", "passive-import"]); literal(v.nativeOutcome, ["passed", "failed", "indeterminate", "unavailable"]); literal(v.completeness, ["complete", "partial", "unknown"]); literal(v.provenance, ["independently-corroborated", "caller-declared", "unverified"]); strings(v.limitations, 0, 2000, false); v.limitations.forEach(r => text(r, 240));
  if (v.qualifiedAtOrNull !== null) text(v.qualifiedAtOrNull);
  if (v.invocationOrNull !== null) { const i = closed(v.invocationOrNull, ["checkId", "profileId", "executableSha256", "testFile", "exitCode", "timedOut", "outputLimit", "cleanup", "targetMutation", "disposableExecution", "networkPolicy"]); text(i.checkId); literal(i.profileId, ["node-test-tap-v1"]); digest(i.executableSha256); text(i.testFile); assertEvidence(i.exitCode === null || typeof i.exitCode === "number" && Number.isSafeInteger(i.exitCode)); [i.timedOut, i.outputLimit, i.disposableExecution].forEach(b => literal(b, [true, false])); literal(i.cleanup, ["confirmed", "failed", "not-required"]); literal(i.targetMutation, ["unchanged", "changed", "unknown"]); literal(i.networkPolicy, ["not-enforced"]); }
  if (v.captureOrigin === "passive-import") assertEvidence(v.invocationOrNull === null && v.provenance !== "independently-corroborated", "UNVERIFIED_ORIGIN");
  if (v.captureOrigin === "direct-capture") assertEvidence(v.invocationOrNull !== null, "MISSING_INVOCATION");
  assertEvidence(v.canonicalEnvelope.nativeArtifact.integrity?.sha256 === v.nativeArtifactSha256 && evidenceDigest(v.canonicalEnvelope.subject) === evidenceDigest(v.subjectBinding.subject), "INTEGRITY_MISMATCH");
  assertEvidence(v.qualificationId === qualificationIdentity(value as LabEvidenceQualificationV1), "QUALIFICATION_IDENTITY_MISMATCH");
}
export async function readExecutableEvidence(request: LabEvidenceImportRequestV1): Promise<LabEvidenceImportResultV1> {
  try {
    closed(request, ["plan", "authorizedEvidenceRoot", "expectedRootIdentity", "reference", "expectedSha256", "subjectBinding", "capabilityId", "freshness", "provenance"]);
    const planSha256 = verificationPlanSha256(request.plan); text(request.authorizedEvidenceRoot); digest(request.expectedRootIdentity); digest(request.expectedSha256); validateEco00NativeReference(request.reference); validateSubjectBinding(request.subjectBinding); text(request.capabilityId); literal(request.provenance, ["caller-declared", "unverified"]);
    assertEvidence(await evidenceRootIdentity(request.authorizedEvidenceRoot) === request.expectedRootIdentity, "ROOT_IDENTITY_MISMATCH");
    assertEvidence(request.reference.locator.kind === "path", "UNSUPPORTED_LOCATOR");
    const bytes = await readEvidenceBytes(request.authorizedEvidenceRoot, request.reference.locator.value, 8388608, request.expectedRootIdentity); const actual = sha256(bytes);
    assertEvidence(actual === request.expectedSha256 && request.reference.integrity?.sha256 === actual, "DIGEST_MISMATCH");
    assertEvidence(evidenceDigest(request.plan.subject) === evidenceDigest(request.subjectBinding.subject), "INVALID_REQUEST", "Plan and subject declaration disagree");
    const adapter = adaptNativeEvidence(bytes, request.reference, request.subjectBinding);
    assertEvidence(adapter.availability !== "unsupported", "UNSUPPORTED_NATIVE_SCHEMA"); assertEvidence(adapter.availability !== "invalid", "INVALID_NATIVE_SHAPE", adapter.limitations.join("; "));
    const selected = request.plan.requirements.filter(r => r.capabilityId === request.capabilityId && r.applicability === "applicable");
    assertEvidence(selected.length > 0, "INVALID_REQUEST", "No applicable selected requirement accepts this capability");
    for (const requirement of selected.filter(r => r.criticality === "critical")) { assertEvidence(requirement.acceptedArtifactKinds.includes(request.reference.artifactKind) && requirement.acceptedSchemaVersions.includes(request.reference.artifactSchemaVersion!), "UNSUPPORTED_NATIVE_SCHEMA"); assertEvidence(requirement.requiredCapabilities.every(c => adapter.capabilities.includes(c)), "MISSING_MANDATORY_CAPABILITY"); }
    const content: Omit<LabEvidenceQualificationV1, "qualificationId"> = { schemaVersion: "1.0.0", canonicalEnvelope: { schemaVersion: "1.0.0", evidenceId: actual, capabilityId: request.capabilityId, subject: request.plan.subject, nativeArtifact: request.reference, freshness: request.freshness, ...(request.subjectBinding.environment.canonicalECO00EnvironmentOrNull ? { environment: request.subjectBinding.environment.canonicalECO00EnvironmentOrNull } : {}) }, planSha256, subjectBinding: request.subjectBinding, environmentBinding: request.subjectBinding.environment.canonicalECO00EnvironmentOrNull, nativeArtifactSha256: actual, captureOrigin: "passive-import", invocationOrNull: null, nativeOutcome: adapter.nativeOutcome, completeness: adapter.completeness, provenance: request.provenance, limitations: [...adapter.limitations, "Historical producer and subject origin are caller declarations; a matching digest is not origin attestation"], qualifiedAtOrNull: null };
    const qualification = { ...content, qualificationId: qualificationIdentity(content) }; validateQualification(qualification);
    return { ok: true, qualification, adapter, nativeBytes: bytes };
  } catch (error) {
    const code = error instanceof LabEvidenceError ? error.code : (error as NodeJS.ErrnoException).code === "ENOENT" ? "MISSING" : "UNREADABLE";
    const allowed = ["MISSING", "UNREADABLE", "OUTSIDE_AUTHORIZED_ROOT", "UNSUPPORTED_LOCATOR", "OVERSIZED", "CHANGED_DURING_READ", "DIGEST_MISMATCH", "INVALID_NATIVE_SHAPE", "UNSUPPORTED_NATIVE_SCHEMA", "MISSING_MANDATORY_CAPABILITY", "ROOT_IDENTITY_MISMATCH"];
    return { ok: false, code: (allowed.includes(code) ? code : "INVALID_REQUEST") as Extract<LabEvidenceImportResultV1, { ok: false }>["code"], reason: (error instanceof Error ? error.message : "Evidence unavailable").slice(0, 240) };
  }
}
