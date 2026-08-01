// v0.4.5 Batch 2: producer/condition and capsule/audit condition agreement. These compare
// producer-supplied verdicts (roleAdequacy.status, truncation.requiredEvidenceLost) against
// producer-supplied condition-coverage evidence, and summarize capsule/audit structural
// agreement through the existing Batch 1 parity owner. They report agreement, contradiction,
// or insufficient evidence -- they never replace, recompute, or override the upstream verdict
// with a lab-owned adequacy or readiness policy.
import type { ContextAdequacyStatus, ContextCapsule, RetrievalAuditRecord } from "../upstreamArtifacts/index.js";
import { checkMyDevKitContextArtifactConsistency } from "../stageContextSelectors/contextArtifactConsistency.js";
import type {
  AgreementOutcomeV1,
  CapsuleAuditConditionAgreementV1,
  ConditionCoverageMetricsV1,
  ProducerConditionAgreementV1,
  RequiredEvidenceLossAgreementV1
} from "./producerReadinessMetricTypes.js";

const ADEQUATE_STATUSES: readonly ContextAdequacyStatus[] = [
  "context sufficient for implementation",
  "context sufficient with listed assumptions"
];
const INADEQUATE_STATUSES: readonly ContextAdequacyStatus[] = [
  "context insufficient and more retrieval required",
  "context conflict found and user or upstream stage decision required"
];

export function calculateProducerConditionAgreement(
  roleAdequacyStatus: ContextAdequacyStatus | undefined,
  conditionCoverage: ConditionCoverageMetricsV1
): ProducerConditionAgreementV1 {
  if (roleAdequacyStatus === undefined) {
    return {
      availability: "unavailable",
      outcome: "insufficient-evidence",
      observedRoleAdequacyStatus: null,
      contradictionCodes: [],
      reason: "No roleAdequacy.status was supplied."
    };
  }
  if (conditionCoverage.availability !== "available") {
    return {
      availability: "unavailable",
      outcome: "unsupported-legacy-evidence",
      observedRoleAdequacyStatus: roleAdequacyStatus,
      contradictionCodes: [],
      reason: conditionCoverage.reason ?? "No condition-coverage evidence was available to compare against roleAdequacy.status."
    };
  }

  const requiredTotal = conditionCoverage.requiredConditionsTotal.count ?? 0;
  const requiredSatisfied = conditionCoverage.requiredConditionsSatisfied.count ?? 0;
  const requiredLost = conditionCoverage.requiredConditionsLost.count ?? 0;
  const allRequiredSatisfied = requiredTotal > 0 && requiredSatisfied === requiredTotal;

  const producerSaysAdequate = ADEQUATE_STATUSES.includes(roleAdequacyStatus);
  const producerSaysInadequate = INADEQUATE_STATUSES.includes(roleAdequacyStatus);

  const contradictionCodes: string[] = [];
  if (producerSaysInadequate && allRequiredSatisfied && requiredLost === 0) {
    contradictionCodes.push("PRODUCER_INADEQUATE_BUT_ALL_REQUIRED_CONDITIONS_RETAINED");
  }
  if (producerSaysAdequate && requiredLost > 0) {
    contradictionCodes.push("PRODUCER_ADEQUATE_BUT_REQUIRED_CONDITION_LOST");
  }

  const outcome: AgreementOutcomeV1 = contradictionCodes.length > 0 ? "contradiction" : "agreement";

  return {
    availability: "available",
    outcome,
    observedRoleAdequacyStatus: roleAdequacyStatus,
    contradictionCodes,
    reason:
      outcome === "contradiction"
        ? "Producer role-adequacy status contradicts its own explicit condition-coverage evidence; both sides are retained."
        : null
  };
}

export function calculateRequiredEvidenceLossAgreement(
  requiredEvidenceLost: boolean | undefined,
  conditionCoverage: ConditionCoverageMetricsV1,
  requiredOmittedCount: number | null | undefined
): RequiredEvidenceLossAgreementV1 {
  if (requiredEvidenceLost === undefined) {
    return {
      availability: "unavailable",
      outcome: "insufficient-evidence",
      requiredEvidenceLost: null,
      explicitConditionLossDetected: null,
      requiredOmittedCount: requiredOmittedCount ?? null,
      contradictionCodes: [],
      reason: "No truncation.requiredEvidenceLost rollup was supplied."
    };
  }
  if (conditionCoverage.availability !== "available") {
    return {
      availability: "unavailable",
      outcome: "unsupported-legacy-evidence",
      requiredEvidenceLost,
      explicitConditionLossDetected: null,
      requiredOmittedCount: requiredOmittedCount ?? null,
      contradictionCodes: [],
      reason: conditionCoverage.reason ?? "No condition-coverage evidence was available to compare against requiredEvidenceLost."
    };
  }

  const explicitConditionLossDetected = (conditionCoverage.requiredConditionsLost.count ?? 0) > 0;

  const contradictionCodes: string[] = [];
  if (!requiredEvidenceLost && explicitConditionLossDetected) {
    contradictionCodes.push("REQUIRED_EVIDENCE_LOST_FALSE_BUT_CONDITION_LOSS_DETECTED");
  }
  if (requiredEvidenceLost && !explicitConditionLossDetected && (requiredOmittedCount ?? 0) === 0) {
    contradictionCodes.push("REQUIRED_EVIDENCE_LOST_TRUE_BUT_NO_CONDITION_OR_GROUP_LOSS_DETECTED");
  }

  const outcome: AgreementOutcomeV1 = contradictionCodes.length > 0 ? "contradiction" : "agreement";

  return {
    availability: "available",
    outcome,
    requiredEvidenceLost,
    explicitConditionLossDetected,
    requiredOmittedCount: requiredOmittedCount ?? null,
    contradictionCodes,
    reason: outcome === "contradiction" ? "truncation.requiredEvidenceLost contradicts explicit condition-loss/required-omission evidence; both sides are retained." : null
  };
}

const RELEVANT_CAPSULE_AUDIT_FIELDS = new Set(["roleConditionCoverage", "truncation", "roleAdequacy"]);

export function calculateCapsuleAuditConditionAgreement(
  capsule: ContextCapsule | undefined,
  audit: RetrievalAuditRecord | undefined
): CapsuleAuditConditionAgreementV1 {
  if (capsule === undefined || audit === undefined) {
    const reason =
      capsule === undefined && audit === undefined
        ? "Neither a context capsule nor a retrieval audit record was supplied."
        : capsule === undefined
          ? "No context capsule was supplied."
          : "No retrieval audit record was supplied.";
    return { availability: "unavailable", consistent: null, contradictingFieldPaths: [], reason };
  }

  const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
  const contradictingFieldPaths = result.issues.filter((issue) => RELEVANT_CAPSULE_AUDIT_FIELDS.has(issue.fieldPath)).map((issue) => issue.fieldPath);

  return {
    availability: "available",
    consistent: contradictingFieldPaths.length === 0,
    contradictingFieldPaths,
    reason: null
  };
}
