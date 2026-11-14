import { assertEvidence, closed, digest, literal, strings, text, validateEco00Environment } from "./eco00ContractValidation.js";
import { canonicalEvidenceJson, evidenceDigest, normalizeEvidencePath, validateSubjectBinding } from "./identity.js";
import { validateQualification } from "./importNativeEvidence.js";
import { NATIVE_EVIDENCE_KINDS, validateAdapterResult } from "./nativeAdapters.js";
import { matchesSelectedCapture, verificationPlanSha256 } from "./verificationPlan.js";
import type { LabEvidenceAssessmentV1, LabEvidenceEvaluationRequestV1, LabEvidenceEvaluationResultV1, LabEvidenceRequirementV1, LabEvidenceStatus } from "./types.js";

export function validateAssessment(value: unknown): asserts value is LabEvidenceAssessmentV1 {
  canonicalEvidenceJson(value); const v = closed(value, ["schemaVersion", "planSha256", "consumerSupportSha256", "requirements", "blockingRequirementIds", "satisfied"]); literal(v.schemaVersion, ["1.0.0"]); digest(v.planSha256); digest(v.consumerSupportSha256); strings(v.blockingRequirementIds, 0, 200); literal(v.satisfied, [true, false]); assertEvidence(Array.isArray(v.requirements) && v.requirements.length <= 200); const ids: string[] = [];
  for (const item of v.requirements) { const r = closed(item, ["requirementId", "criticality", "applicability", "status", "reason", "qualificationId"]); text(r.requirementId); ids.push(r.requirementId); literal(r.criticality, ["critical", "noncritical"]); literal(r.applicability, ["applicable", "not-applicable"]); literal(r.status, ["satisfied", "failed", "unavailable", "incomplete", "incompatible", "stale", "indeterminate", "not-applicable"]); text(r.reason, 240); if (r.qualificationId !== null) digest(r.qualificationId); assertEvidence((r.applicability === "not-applicable") === (r.status === "not-applicable")); }
  assertEvidence(new Set(ids).size === ids.length); const expected = (v.requirements as LabEvidenceAssessmentV1["requirements"]).filter(r => r.criticality === "critical" && r.applicability === "applicable" && r.status !== "satisfied").map(r => r.requirementId); assertEvidence(evidenceDigest(expected) === evidenceDigest(v.blockingRequirementIds) && v.satisfied === (expected.length === 0), "ASSESSMENT_BLOCKER_MISMATCH");
}
export function evaluateExecutableEvidence(request: LabEvidenceEvaluationRequestV1): LabEvidenceEvaluationResultV1 {
  closed(request, ["plan", "qualifications", "adapters", "subjectBinding", "support"]); const planSha256 = verificationPlanSha256(request.plan); validateSubjectBinding(request.subjectBinding);
  assertEvidence(Array.isArray(request.qualifications) && request.qualifications.length <= 200 && Array.isArray(request.adapters) && request.adapters.length <= 200, "EVIDENCE_BOUND"); request.qualifications.forEach(validateQualification); request.adapters.forEach(validateAdapterResult);
  assertEvidence(new Set(request.qualifications.map(q => q.qualificationId)).size === request.qualifications.length, "DUPLICATE_QUALIFICATION");
  const support = closed(request.support, ["artifactSchemas", "capabilities", "requireIndependentProvenance", "requiredEnvironment"]); const schemas = closed(support.artifactSchemas, [], Object.keys(support.artifactSchemas as object)); Object.values(schemas).forEach(v => strings(v, 1)); strings(support.capabilities); literal(support.requireIndependentProvenance, [true, false]); if (support.requiredEnvironment !== null) validateEco00Environment(support.requiredEnvironment);
  const evaluate = (requirement: LabEvidenceRequirementV1): LabEvidenceAssessmentV1["requirements"][number] => {
    const result = (status: LabEvidenceStatus, reason: string, qualificationId: string | null = null) => ({ requirementId: requirement.requirementId, criticality: requirement.criticality, applicability: requirement.applicability, status, reason: reason.slice(0, 240), qualificationId });
    if (requirement.applicability === "not-applicable") return result("not-applicable", requirement.applicabilityReason!);
    if (requirement.requiredCapabilities.some(c => !request.support.capabilities.includes(c))) return result("incompatible", "Consumer does not support a required capability");
    const witnesses = request.qualifications.filter(q => q.canonicalEnvelope.capabilityId === requirement.capabilityId);
    if (!witnesses.length) return result("unavailable", "Required native witness is missing");
    const outcomes = witnesses.map(q => {
      const ref = q.canonicalEnvelope.nativeArtifact; const id = q.qualificationId; const adapter = request.adapters.find(a => evidenceDigest(a.nativeArtifact) === evidenceDigest(ref));
      if (!(NATIVE_EVIDENCE_KINDS as readonly string[]).includes(ref.artifactKind) || ref.artifactSchemaVersion !== "1.0.0") return result("incompatible", "Native kind or exact schema is not implemented by this pinned consumer", id);
      if (ref.locator.kind !== "path") return result("incompatible", "Initial evidence policy supports only contained local path references", id);
      try { normalizeEvidencePath(ref.locator.value); } catch { return result("incompatible", "Native reference has an unsafe or unsupported local path", id); }
      if (q.captureOrigin === "direct-capture" && q.planSha256 === planSha256 && !matchesSelectedCapture(request.plan, planSha256, q)) return result("incompatible", "Capture invocation does not match the selected disposable check", id);
      if (q.planSha256 === planSha256 && q.invocationOrNull && (q.invocationOrNull.exitCode !== 0 || q.invocationOrNull.timedOut || q.invocationOrNull.outputLimit || q.invocationOrNull.cleanup === "failed" || q.invocationOrNull.targetMutation !== "unchanged")) return result("failed", "Execution, cleanup, output bound or target integrity failed", id);
      if (!requirement.acceptedArtifactKinds.includes(ref.artifactKind) || !ref.artifactSchemaVersion || !requirement.acceptedSchemaVersions.includes(ref.artifactSchemaVersion) || !request.support.artifactSchemas[ref.artifactKind]?.includes(ref.artifactSchemaVersion)) return result("incompatible", "Native kind or exact schema is unsupported", id);
      if (!adapter) return result("unavailable", "Validated native adapter result is missing", id);
      if (adapter.availability === "unsupported" || requirement.requiredCapabilities.some(c => !adapter.capabilities.includes(c))) return result("incompatible", "Native evidence lacks mandatory capability", id);
      if (adapter.availability === "invalid") return result("incompatible", "Native evidence shape is invalid", id);
      if (adapter.availability !== "available") return result("unavailable", "Native evidence is unavailable", id);
      if (q.planSha256 !== planSha256) return result("incompatible", "Evidence belongs to a different frozen plan", id);
      if (q.nativeArtifactSha256 !== ref.integrity?.sha256) return result("incompatible", "Native integrity mismatch", id);
      if (q.subjectBinding.source.completeness !== "complete" || request.subjectBinding.source.completeness !== "complete" || !q.subjectBinding.source.sourceManifestSha256OrNull || !request.subjectBinding.source.sourceManifestSha256OrNull) return result("indeterminate", "Complete subject/input identity is unavailable", id);
      if (evidenceDigest(q.subjectBinding.subject) !== evidenceDigest(request.plan.subject) || evidenceDigest(q.subjectBinding.source) !== evidenceDigest(request.subjectBinding.source)) return result("incompatible", "Subject repository or selected source identity mismatch", id);
      if (request.support.requiredEnvironment && (!q.environmentBinding || evidenceDigest(q.environmentBinding) !== evidenceDigest(request.support.requiredEnvironment))) return result("incompatible", "Required environment identity mismatch", id);
      if (requirement.freshnessPolicy === "current" && q.canonicalEnvelope.freshness !== "current") return result(q.canonicalEnvelope.freshness === "unknown" ? "indeterminate" : "stale", "Native witness is not current", id);
      if (requirement.freshnessPolicy === "current" && adapter.nativeFreshness !== "current" && adapter.nativeFreshness !== "not-applicable") return result(adapter.nativeFreshness === "unknown" ? "indeterminate" : "stale", "Native producer freshness is not current", id);
      if (q.invocationOrNull && (q.invocationOrNull.exitCode !== 0 || q.invocationOrNull.timedOut || q.invocationOrNull.outputLimit || q.invocationOrNull.cleanup === "failed" || q.invocationOrNull.targetMutation !== "unchanged")) return result("failed", "Execution, cleanup, output bound or target integrity failed", id);
      if (q.nativeOutcome === "failed" || adapter.nativeOutcome === "failed") return result("failed", "Native producer reported failure", id);
      if (q.completeness !== "complete" || adapter.completeness !== "complete") return result("incomplete", "Required native predicate is incomplete or truncated", id);
      if (q.provenance === "unverified" || q.subjectBinding.provenance === "unverified" || request.subjectBinding.provenance === "unverified") return result("indeterminate", "Evidence or subject provenance is unverified", id);
      if (request.support.requireIndependentProvenance && (q.provenance !== "independently-corroborated" || q.subjectBinding.provenance !== "independently-corroborated")) return result("indeterminate", "Independent origin/source provenance is unproven", id);
      if (requirement.nativeSuccessRequired && (q.nativeOutcome !== "passed" || adapter.nativeOutcome !== "passed")) return result("indeterminate", "Required native success predicate is unproven", id);
      return result("satisfied", "All selected evidence predicates satisfied", id);
    });
    // A contradictory failed witness for the same selected predicate is never hidden by a pass.
    return outcomes.find(o => o.status === "failed") ?? outcomes.find(o => o.status === "satisfied") ?? outcomes[0];
  };
  const requirements = request.plan.requirements.map(evaluate); const blockingRequirementIds = requirements.filter(r => r.criticality === "critical" && r.applicability === "applicable" && r.status !== "satisfied").map(r => r.requirementId);
  const assessment: LabEvidenceAssessmentV1 = { schemaVersion: "1.0.0", planSha256, consumerSupportSha256: evidenceDigest(request.support), requirements, blockingRequirementIds, satisfied: blockingRequirementIds.length === 0 }; validateAssessment(assessment); return assessment;
}
