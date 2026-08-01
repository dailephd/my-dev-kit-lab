// v0.4.5 Batch 5: bounded report model for one context-integrity ecosystem evaluation (one
// frozen fixture -- failed-run or corrected-replay -- evaluated once through the existing
// Batch 1-4 pipeline). This is additive alongside ContextStrategyComparisonV043ReportV1, not
// a replacement: that model reports N-strategy x M-repeat-run experiment comparisons: this
// model reports one fixture's already-calculated Batch 2/3/4 results. Reuses the existing
// bounded-list, availability, and detail-limit conventions rather than inventing new ones.
//
// No composite score, grade, ranking, or winner exists anywhere in this file. Every field
// here is either a bounded pass-through of an already-computed Batch 1-4 result or a bounded
// list wrapper around one.
import type { V043BoundedReportListV1, V043ReportAvailability } from "./contextStrategyComparisonV043ReportModel.js";
import type { AgreementOutcomeV1 } from "../../evaluation/stageContextMetrics/producerReadinessMetricTypes.js";

export type ContextIntegrityFixtureKind = "failed-run" | "corrected-replay" | "other";

export interface ContextIntegrityReportContradictionV1 {
  code: string;
  fieldPath: string;
  expected: string | null;
  observed: string | null;
  reason: string;
}

export interface ContextIntegrityReportAgreementV1 {
  availability: "available" | "unavailable" | "not-applicable";
  outcome: AgreementOutcomeV1;
  contradictions: V043BoundedReportListV1<ContextIntegrityReportContradictionV1>;
  reason: string | null;
}

// --- section 1: producer identity and evidence -----------------------------------------

export interface ContextIntegrityReportProducerIdentityV1 {
  toolName: string | null;
  toolVersion: string | null;
  role: string | null;
  projectRoot: string | null;
  indexPath: string | null;
  roleAdequacyStatus: string | null;
}

// --- sections 2-3: allocation and spillover ----------------------------------------------

export interface ContextIntegrityReportPerGroupAllocationV1 {
  groupId: string;
  availability: V043ReportAvailability;
  required: boolean | null;
  reservation: number | null;
  initiallySelectedCount: number | null;
  unusedReservationContributed: number | null;
  borrowedCapacity: number | null;
  requiredOmittedCount: number | null;
  optionalOmittedCount: number | null;
  adequacyAffected: boolean | null;
}

export interface ContextIntegrityReportAllocationV1 {
  availability: V043ReportAvailability;
  groupCount: number;
  totalRequiredOmitted: number | null;
  totalOptionalOmitted: number | null;
  aggregateCapacityUsed: number | null;
  aggregateCapacityRemaining: number | null;
  groupsWithRequiredOmission: string[];
  groupsWithOptionalOnlyOmission: string[];
  perGroup: V043BoundedReportListV1<ContextIntegrityReportPerGroupAllocationV1>;
}

export interface ContextIntegrityReportSpilloverV1 {
  availability: V043ReportAvailability;
  groupsContributing: string[];
  groupsBorrowing: string[];
  totalContributed: number | null;
  totalBorrowed: number | null;
  contributionCoversBorrowing: boolean | null;
  reason: string | null;
}

// --- section 4/5: truncation classification and required-vs-optional omission ------------

export interface ContextIntegrityReportTruncationV1 {
  availability: V043ReportAvailability;
  state: string;
  requiredEvidenceLost: boolean | null;
  requiredOmittedTotal: number | null;
  optionalOmittedTotal: number | null;
  lostRequiredConditionIds: string[];
  contradictions: V043BoundedReportListV1<ContextIntegrityReportContradictionV1>;
}

// --- sections 6-7: condition coverage, witness, last-witness-loss ------------------------

export interface ContextIntegrityReportConditionWitnessV1 {
  conditionId: string;
  required: boolean;
  coverageState: string;
  retainedWitnessCount: number;
  retainedWitnessIds: V043BoundedReportListV1<string>;
  adequateWitnessRemains: boolean;
  lossReason: string | null;
  evidenceGroupIds: string[];
}

export interface ContextIntegrityReportConditionCoverageV1 {
  availability: V043ReportAvailability;
  requiredConditionsTotal: number | null;
  requiredConditionsSatisfied: number | null;
  requiredConditionsMissing: string[];
  requiredConditionsLost: string[];
  lastWitnessLossCount: number | null;
  witnessEvidence: V043BoundedReportListV1<ContextIntegrityReportConditionWitnessV1>;
  reason: string | null;
}

// --- sections 8-11: producer/capsule-audit/supplemental/readiness agreement -------------

export interface ContextIntegrityReportSupplementalAgreementV1 {
  availability: "available" | "unavailable" | "not-applicable";
  contradictingFields: string[];
  upstreamProducerParityPreserved: boolean | null;
}

// --- section 17: end-to-end -----------------------------------------------------------

export interface ContextIntegrityReportEndToEndV1 {
  category: "full-agreement" | "contradiction-present" | "insufficient-evidence" | "unsupported-legacy-evidence";
  componentOutcomes: Record<string, AgreementOutcomeV1>;
  contradictingComponents: string[];
}

// --- section 18-19: fixture identity, provenance, hash verification --------------------

export interface ContextIntegrityReportFixtureArtifactV1 {
  fixtureRelativePath: string;
  role: string;
  derived: boolean;
  byteExact: boolean;
  provenanceOnly: boolean;
}

export interface ContextIntegrityReportFixtureV1 {
  fixtureId: string;
  kind: ContextIntegrityFixtureKind;
  description: string;
  myDevKitCommit: string | null;
  orchestratorCommit: string | null;
  targetRepositoryIdentity: string | null;
  activeIndexIdentity: string | null;
  manifestSchemaVersion: string;
  trackedArtifactCount: number;
  derivedArtifactCount: number;
  byteExactArtifactCount: number;
  artifacts: V043BoundedReportListV1<ContextIntegrityReportFixtureArtifactV1>;
  hashVerification: {
    ok: boolean;
    checkedCount: number;
    issues: V043BoundedReportListV1<{ code: string; fixtureRelativePath: string; message: string }>;
  };
  // Explicit, never-omitted limitation statement (section 21). Empty string for fixtures
  // that are not a corrected replay (e.g. the failed-run fixture, which needs none).
  correctedReplayLimitation: string;
}

// --- section 20: determinism -------------------------------------------------------------

export interface ContextIntegrityReportDeterminismV1 {
  availability: "available" | "unavailable" | "not-applicable";
  repeatCount: number;
  deterministic: boolean | null;
  baselineSha256: string | null;
  mismatchRunNumbers: number[];
  reason: string | null;
}

// --- section 21: target/fixture immutability ----------------------------------------------

export interface ContextIntegrityReportImmutabilityV1 {
  fixtureSelfImmutable: boolean | null;
  fixtureImmutabilityReason: string | null;
}

export interface ContextIntegrityReportLimitationsV1 {
  unavailableSections: string[];
  notes: string[];
}

export interface ContextIntegrityReportV1 {
  schemaVersion: "1.0.0";
  detailLimit: number;
  fixture: ContextIntegrityReportFixtureV1;
  producerIdentity: ContextIntegrityReportProducerIdentityV1;
  allocation: ContextIntegrityReportAllocationV1;
  spillover: ContextIntegrityReportSpilloverV1;
  truncation: ContextIntegrityReportTruncationV1;
  conditionCoverage: ContextIntegrityReportConditionCoverageV1;
  producerConditionAgreement: ContextIntegrityReportAgreementV1;
  requiredEvidenceLossAgreement: ContextIntegrityReportAgreementV1;
  capsuleAuditAgreement: { availability: V043ReportAvailability; consistent: boolean | null; contradictingFieldPaths: string[] };
  supplementalRawAgreement: ContextIntegrityReportSupplementalAgreementV1 | null;
  producerReadinessAgreement: ContextIntegrityReportAgreementV1;
  readinessPromptAgreement: ContextIntegrityReportAgreementV1;
  readinessExpectedJudgeAgreement: ContextIntegrityReportAgreementV1;
  expectedActualJudgeAgreement: ContextIntegrityReportAgreementV1;
  judgeCorrectionAgreement: ContextIntegrityReportAgreementV1;
  judgeFinalEligibilityAgreement: ContextIntegrityReportAgreementV1;
  eligibilityFinalArtifactAgreement: ContextIntegrityReportAgreementV1;
  lifecycleIntegrityAgreement: ContextIntegrityReportAgreementV1;
  endToEnd: ContextIntegrityReportEndToEndV1 | null;
  determinism: ContextIntegrityReportDeterminismV1;
  immutability: ContextIntegrityReportImmutabilityV1;
  limitations: ContextIntegrityReportLimitationsV1;
}
