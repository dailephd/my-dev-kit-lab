// v0.4.4 Batch 2: readiness/raw-evidence agreement. Readiness stays observed consumer
// output (Batch 1) -- this module only compares it against an explicit fixture-declared
// expectation. It never calls, imports, or reimplements contextReadiness.ts.
import {
  checkSupplementalReadinessIdentityConsistency,
  type ContextAdequacyStatus,
  type OrchestratorContextReadinessResultV1,
  type SupplementalContextDocumentV1
} from "../upstreamArtifacts/index.js";
import type { ProducerReadinessReadinessExpectationV1 } from "../stageContextExpectations/index.js";
import type {
  AgreementOutcomeV1,
  InvalidReadyResultV1,
  ProducerConditionAgreementV1,
  ProducerReadinessRelationshipV1,
  ReadinessAgreementMetricsV1,
  ReadinessDecisionAgreementV1,
  ReadinessStructuralAgreementV1,
  ValidBlockedResultV1
} from "./producerReadinessMetricTypes.js";

const READINESS_ADEQUATE_STATUSES: readonly ContextAdequacyStatus[] = [
  "context sufficient for implementation",
  "context sufficient with listed assumptions"
];

function unavailableStructural(field: string, reason: string): ReadinessStructuralAgreementV1 {
  return { field, expectedValue: null, observedValue: null, agreement: null, availability: "unavailable", reason };
}

export function calculateReadinessStructuralAgreement(
  readiness: OrchestratorContextReadinessResultV1 | undefined,
  supplementalPacket: SupplementalContextDocumentV1 | undefined,
  packetSourcePath: string | undefined
): ReadinessStructuralAgreementV1[] {
  const results: ReadinessStructuralAgreementV1[] = [];

  if (readiness === undefined) {
    results.push(unavailableStructural("canonicalRepositoryIdentity", "No readiness result was supplied."));
    results.push(unavailableStructural("packetPath", "No readiness result was supplied."));
    return results;
  }

  if (supplementalPacket === undefined) {
    results.push(unavailableStructural("canonicalRepositoryIdentity", "No supplemental document was supplied to compare against readiness."));
  } else {
    const diagnostic = checkSupplementalReadinessIdentityConsistency(supplementalPacket, readiness);
    results.push({
      field: "canonicalRepositoryIdentity",
      expectedValue: supplementalPacket.indexIdentity,
      observedValue: readiness.indexIdentity ?? null,
      agreement: diagnostic === null,
      availability: readiness.indexIdentity === undefined ? "unavailable" : "available",
      reason: readiness.indexIdentity === undefined ? "The readiness result does not declare indexIdentity." : diagnostic?.message ?? null
    });
  }

  if (packetSourcePath === undefined) {
    results.push(unavailableStructural("packetPath", "No packet source path was supplied to compare against readiness.packetPath."));
  } else {
    results.push({
      field: "packetPath",
      expectedValue: packetSourcePath,
      observedValue: readiness.packetPath,
      agreement: packetSourcePath === readiness.packetPath,
      availability: "available",
      reason: null
    });
  }

  return results;
}

export function calculateReadinessDecisionAgreement(
  readiness: OrchestratorContextReadinessResultV1 | undefined,
  expectation: ProducerReadinessReadinessExpectationV1 | undefined
): ReadinessDecisionAgreementV1 {
  if (expectation === undefined) {
    return {
      availability: "not-applicable",
      observedDecision: readiness?.decision ?? null,
      allowedDecisions: null,
      decisionAgreement: null,
      observedClassification: readiness?.classification ?? null,
      expectedClassification: null,
      classificationAgreement: null,
      observedIssueCodes: readiness?.blockingIssueCodes ?? [],
      expectedIssueCodes: null,
      issueCodesAgreement: null,
      observedPrimaryIssueCode: readiness?.primaryIssue?.code ?? null,
      expectedPrimaryIssueCode: null,
      primaryIssueAgreement: null,
      reason: "The expectation fixture declares no readiness expectation."
    };
  }
  if (readiness === undefined) {
    return {
      availability: "unavailable",
      observedDecision: null,
      allowedDecisions: expectation.allowedDecisions ?? null,
      decisionAgreement: null,
      observedClassification: null,
      expectedClassification: expectation.expectedClassification ?? null,
      classificationAgreement: null,
      observedIssueCodes: [],
      expectedIssueCodes: expectation.expectedIssueCodes ?? null,
      issueCodesAgreement: null,
      observedPrimaryIssueCode: null,
      expectedPrimaryIssueCode: expectation.expectedPrimaryIssueCode ?? null,
      primaryIssueAgreement: null,
      reason: "No readiness result was supplied."
    };
  }

  const decisionAgreement =
    expectation.allowedDecisions === undefined ? null : expectation.allowedDecisions.includes(readiness.decision);
  const classificationAgreement =
    expectation.expectedClassification === undefined ? null : expectation.expectedClassification === readiness.classification;
  const issueCodesAgreement =
    expectation.expectedIssueCodes === undefined
      ? null
      : expectation.expectedIssueCodes.length === readiness.blockingIssueCodes.length &&
        expectation.expectedIssueCodes.every((code) => readiness.blockingIssueCodes.includes(code));
  const primaryIssueAgreement =
    expectation.expectedPrimaryIssueCode === undefined
      ? null
      : expectation.expectedPrimaryIssueCode === (readiness.primaryIssue?.code ?? null);

  return {
    availability: "available",
    observedDecision: readiness.decision,
    allowedDecisions: expectation.allowedDecisions ?? null,
    decisionAgreement,
    observedClassification: readiness.classification,
    expectedClassification: expectation.expectedClassification ?? null,
    classificationAgreement,
    observedIssueCodes: readiness.blockingIssueCodes,
    expectedIssueCodes: expectation.expectedIssueCodes ?? null,
    issueCodesAgreement,
    observedPrimaryIssueCode: readiness.primaryIssue?.code ?? null,
    expectedPrimaryIssueCode: expectation.expectedPrimaryIssueCode ?? null,
    primaryIssueAgreement,
    reason: null
  };
}

export function calculateInvalidReady(
  readiness: OrchestratorContextReadinessResultV1 | undefined,
  expectation: ProducerReadinessReadinessExpectationV1 | undefined
): InvalidReadyResultV1 {
  if (readiness === undefined) {
    return { availability: "unavailable", invalidReady: null, observedDecision: null, expectedBlockingDecision: false, missingExpectedIssueCodes: [], reason: "No readiness result was supplied." };
  }
  if (expectation === undefined) {
    return { availability: "not-applicable", invalidReady: null, observedDecision: readiness.decision, expectedBlockingDecision: false, missingExpectedIssueCodes: [], reason: "The expectation fixture declares no readiness expectation." };
  }

  const expectsBlocking =
    (expectation.allowedDecisions !== undefined &&
      !expectation.allowedDecisions.includes("ready") &&
      (expectation.allowedDecisions.includes("refresh-required") || expectation.allowedDecisions.length > 0)) ||
    (expectation.expectedIssueCodes !== undefined && expectation.expectedIssueCodes.length > 0);

  if (!expectsBlocking) {
    return { availability: "not-applicable", invalidReady: null, observedDecision: readiness.decision, expectedBlockingDecision: false, missingExpectedIssueCodes: [], reason: "The expectation fixture does not require blocked or refresh-required behavior." };
  }

  if (readiness.decision !== "ready") {
    return { availability: "available", invalidReady: false, observedDecision: readiness.decision, expectedBlockingDecision: true, missingExpectedIssueCodes: [], reason: null };
  }

  const expectedCodes = expectation.expectedIssueCodes ?? [];
  const missing = expectedCodes.filter((code) => !readiness.blockingIssueCodes.includes(code));

  return { availability: "available", invalidReady: true, observedDecision: readiness.decision, expectedBlockingDecision: true, missingExpectedIssueCodes: missing, reason: null };
}

export function calculateValidBlocked(
  readiness: OrchestratorContextReadinessResultV1 | undefined,
  expectation: ProducerReadinessReadinessExpectationV1 | undefined
): ValidBlockedResultV1 {
  if (readiness === undefined) {
    return { availability: "unavailable", validBlocked: null, validRefreshRequired: null, observedDecision: null, reason: "No readiness result was supplied." };
  }
  if (expectation === undefined) {
    return { availability: "not-applicable", validBlocked: null, validRefreshRequired: null, observedDecision: readiness.decision, reason: "The expectation fixture declares no readiness expectation." };
  }
  if (readiness.decision !== "refresh-required") {
    return { availability: "available", validBlocked: false, validRefreshRequired: false, observedDecision: readiness.decision, reason: null };
  }

  const allowsRefreshRequired = expectation.allowedDecisions === undefined || expectation.allowedDecisions.includes("refresh-required");
  const issueCodesMatch =
    expectation.expectedIssueCodes === undefined ||
    expectation.expectedIssueCodes.every((code) => readiness.blockingIssueCodes.includes(code));
  const primaryMatches =
    expectation.expectedPrimaryIssueCode === undefined || expectation.expectedPrimaryIssueCode === (readiness.primaryIssue?.code ?? null);

  const valid = allowsRefreshRequired && issueCodesMatch && primaryMatches;
  return { availability: "available", validBlocked: valid, validRefreshRequired: valid, observedDecision: readiness.decision, reason: null };
}

// v0.4.5 Batch 2 (section 18): compares producer role adequacy (as already reconciled with
// condition-coverage evidence by calculateProducerConditionAgreement) against the supplied
// orchestrator readiness decision already accepted by the v0.4.4 bridge. This never decides
// what readiness "should" have been -- it only reports the observed relationship.
export function calculateProducerReadinessRelationship(
  roleAdequacyStatus: ContextAdequacyStatus | undefined,
  producerConditionAgreement: ProducerConditionAgreementV1,
  readiness: OrchestratorContextReadinessResultV1 | undefined
): ProducerReadinessRelationshipV1 {
  if (roleAdequacyStatus === undefined || readiness === undefined) {
    return {
      availability: "unavailable",
      outcome: "insufficient-evidence",
      observedRoleAdequacyStatus: roleAdequacyStatus ?? null,
      observedReadinessDecision: readiness?.decision ?? null,
      contradictionCodes: [],
      reason:
        roleAdequacyStatus === undefined && readiness === undefined
          ? "Neither roleAdequacy.status nor a readiness result was supplied."
          : roleAdequacyStatus === undefined
            ? "No roleAdequacy.status was supplied."
            : "No readiness result was supplied."
    };
  }

  if (producerConditionAgreement.outcome === "contradiction") {
    return {
      availability: "available",
      outcome: "insufficient-evidence",
      observedRoleAdequacyStatus: roleAdequacyStatus,
      observedReadinessDecision: readiness.decision,
      contradictionCodes: [],
      reason: "Producer role-adequacy already contradicts its own condition-coverage evidence; the readiness relationship cannot be attributed to either side."
    };
  }
  if (producerConditionAgreement.outcome === "unsupported-legacy-evidence" || producerConditionAgreement.outcome === "insufficient-evidence") {
    return {
      availability: "unavailable",
      outcome: producerConditionAgreement.outcome,
      observedRoleAdequacyStatus: roleAdequacyStatus,
      observedReadinessDecision: readiness.decision,
      contradictionCodes: [],
      reason: producerConditionAgreement.reason
    };
  }

  const producerAdequate = READINESS_ADEQUATE_STATUSES.includes(roleAdequacyStatus);
  const readinessReady = readiness.decision === "ready";

  const contradictionCodes: string[] = [];
  if (producerAdequate && !readinessReady) contradictionCodes.push("PRODUCER_ADEQUATE_BUT_READINESS_NOT_READY");
  if (!producerAdequate && readinessReady) contradictionCodes.push("PRODUCER_INADEQUATE_BUT_READINESS_READY");

  const outcome: AgreementOutcomeV1 = contradictionCodes.length > 0 ? "contradiction" : "agreement";

  return {
    availability: "available",
    outcome,
    observedRoleAdequacyStatus: roleAdequacyStatus,
    observedReadinessDecision: readiness.decision,
    contradictionCodes,
    reason: outcome === "contradiction" ? "Producer role adequacy and supplied orchestrator readiness disagree; both sides are retained without a lab-owned verdict." : null
  };
}

export function calculateReadinessAgreementMetrics(
  readiness: OrchestratorContextReadinessResultV1 | undefined,
  expectation: ProducerReadinessReadinessExpectationV1 | undefined,
  supplementalPacket: SupplementalContextDocumentV1 | undefined,
  packetSourcePath: string | undefined
): ReadinessAgreementMetricsV1 {
  return {
    structuralAgreement: calculateReadinessStructuralAgreement(readiness, supplementalPacket, packetSourcePath),
    decisionAgreement: calculateReadinessDecisionAgreement(readiness, expectation),
    invalidReady: calculateInvalidReady(readiness, expectation),
    validBlocked: calculateValidBlocked(readiness, expectation)
  };
}
