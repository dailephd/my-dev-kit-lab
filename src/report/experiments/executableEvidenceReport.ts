import type { V043BoundedReportListV1 } from "./contextStrategyComparisonV043ReportModel.js";
import { V043_REPORT_DETAIL_LIMIT } from "./contextStrategyComparisonV043ReportModel.js";
import { sanitizeAuditText } from "../../audits/report/sanitizeAuditText.js";
import { redactPreview } from "../../securityValidation/attackScenarios/exploitEvidence.js";
import { validateAssessment } from "../../evaluation/executableEvidence/evaluateEvidence.js";
import { validateQualification } from "../../evaluation/executableEvidence/importNativeEvidence.js";
import { validateCertificationAssessmentBinding } from "../../evaluation/executableEvidence/certifyBundle.js";
import type { LabCertificationRecordV1, LabEvidenceAssessmentV1, LabEvidenceQualificationV1 } from "../../evaluation/executableEvidence/types.js";

export function buildExecutableEvidenceReport(input: { assessment: LabEvidenceAssessmentV1; qualification?: LabEvidenceQualificationV1; certification?: LabCertificationRecordV1 }) {
  validateAssessment(input.assessment); if (input.qualification) validateQualification(input.qualification); if (input.certification) validateCertificationAssessmentBinding(input.certification, input.assessment);
  const safe = (value: string) => sanitizeAuditText(redactPreview(value, 200), 200).slice(0, 240);
  const items = input.assessment.requirements.slice(0, V043_REPORT_DETAIL_LIMIT).map(r => ({ ...r, reason: safe(r.reason), requirementId: safe(r.requirementId) }));
  const requirements: V043BoundedReportListV1<(typeof items)[number]> = { totalCount: input.assessment.requirements.length, displayedCount: items.length, omittedCount: input.assessment.requirements.length - items.length, items };
  let remaining = V043_REPORT_DETAIL_LIMIT - items.length;
  const bounded = <T>(values: T[]) => { const selected = values.slice(0, remaining); remaining -= selected.length; return selected; };
  const packages = input.certification?.bundleArtifactIdentities ?? []; const contracts = input.certification?.canonicalBundle.contracts ?? [];
  const limitations = [...(input.qualification?.limitations ?? []), ...(input.certification?.limitations ?? [])];
  const exactPackageArtifacts = bounded(packages); const contractReferences = bounded(contracts); const displayedLimitations = bounded(limitations).map(safe);
  const references = input.certification?.nativeEvidenceRefs ?? []; const nativeEvidenceRefs = bounded(references);
  return { schemaVersion: "1.0.0" as const, reportKind: "lab-executable-evidence-v1", planSha256: input.assessment.planSha256, consumerSupportSha256: input.assessment.consumerSupportSha256, satisfied: input.assessment.satisfied, blockingRequirementIds: [...input.assessment.blockingRequirementIds], requirements, nativeArtifact: input.qualification?.canonicalEnvelope.nativeArtifact ?? references[0] ?? null, availability: input.qualification ? "available" : references.length ? "referenced" : "unavailable", nativeOutcome: input.qualification?.nativeOutcome ?? null, completeness: input.qualification?.completeness ?? null, provenance: input.qualification?.provenance ?? null, certificationStatus: input.certification?.certificationStatus ?? null, exactPackageArtifacts, contractReferences, nativeEvidenceRefs, limitations: displayedLimitations, omittedDetails: { nativeReferences: references.length - nativeEvidenceRefs.length, packages: packages.length - exactPackageArtifacts.length, contracts: contracts.length - contractReferences.length, limitations: limitations.length - displayedLimitations.length } };
}
export function renderExecutableEvidenceText(report: ReturnType<typeof buildExecutableEvidenceReport>): string {
  return [`Executable evidence: ${report.satisfied ? "satisfied" : "required evidence unmet"}`, `Plan SHA-256: ${report.planSha256}`, `Consumer support SHA-256: ${report.consumerSupportSha256}`, `Native artifact SHA-256: ${report.nativeArtifact?.integrity?.sha256 ?? "unavailable"}`, `Native availability: ${report.availability}`, `Native outcome: ${report.nativeOutcome ?? "unavailable"}`, `Certification: ${report.certificationStatus ?? "not evaluated"}`, `Blocking requirement IDs: ${JSON.stringify(report.blockingRequirementIds)}`, ...report.requirements.items.map(r => `${JSON.stringify(r.requirementId)}: ${r.status} - ${r.reason}`), `Displayed ${report.requirements.displayedCount}/${report.requirements.totalCount}; omitted ${report.requirements.omittedCount}`, ...report.nativeEvidenceRefs.map(r => `Native reference: ${JSON.stringify(r)}`), ...report.exactPackageArtifacts.map(p => `Exact package: ${JSON.stringify(p)}`), ...report.contractReferences.map(c => `Contract: ${JSON.stringify(c)}`), `Omitted reference/limitation details: ${JSON.stringify(report.omittedDetails)}`, ...report.limitations.map(l => `Limitation: ${l}`), ""].join("\n");
}
