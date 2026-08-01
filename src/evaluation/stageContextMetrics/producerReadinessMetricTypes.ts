// v0.4.4 Batch 2: owner, allocation, truncation-cause, supplemental/raw agreement,
// readiness-agreement, and criticality-overlay metric result shapes. Reuses the existing
// v0.4.3 metric-availability model (StageContextMetricAvailability / RatioMetricV1 /
// CountMetricV1) rather than inventing a parallel one. No composite score, grade, rank, or
// winner field exists anywhere in this file.
import type { StageContextCountMetricV1, StageContextMetricAvailability, StageContextRatioMetricV1 } from "./types.js";
import type { ContextReadinessDecision } from "../upstreamArtifacts/index.js";

// ---- Owner metrics ----------------------------------------------------------------

export interface SelectedOwnerEvidenceV1 {
  ownerId: string;
  sourceArtifact: "context-capsule" | "retrieval-audit-record";
  sourceInstance: string;
  itemKind: string;
  path: string | null;
  symbolId: string | null;
  sourceFieldPath: string;
}

export interface OwnerMetricsV1 {
  selectedOwnerEvidence: SelectedOwnerEvidenceV1[];
  expectedOwnerPresent: StageContextRatioMetricV1;
  forbiddenOwnerPresent: StageContextRatioMetricV1;
  falsePositiveCount: StageContextCountMetricV1;
  falseNegativeCount: StageContextCountMetricV1;
}

// ---- Allocation metrics ------------------------------------------------------------

export interface AllocationCapacityFactV1 {
  groupId: string;
  sourceArtifact: "context-capsule" | "retrieval-audit-record";
  sourceInstance: string;
  value: number | null;
  unit: "items";
  availability: StageContextMetricAvailability;
  reason: string | null;
}

export interface RequiredEvidenceOmittedEntryV1 {
  evidenceKey: string;
  groupId: string | null;
  truncationReported: boolean;
  sourceArtifact: string;
}

export interface AllocationMetricsV1 {
  requiredGroupCapacity: AllocationCapacityFactV1[];
  usedReservation: AllocationCapacityFactV1[];
  borrowedCapacity: AllocationCapacityFactV1[];
  unusedCapacity: AllocationCapacityFactV1[];
  requiredEvidenceOmitted: StageContextCountMetricV1;
  requiredEvidenceOmittedEntries: RequiredEvidenceOmittedEntryV1[];
}

// ---- Truncation classification -----------------------------------------------------

export type TruncationCauseV1 = "avoidable" | "genuine-hard-limit" | "unresolved" | "none";

export interface TruncationClassificationV1 {
  groupId: string;
  sourceArtifact: "context-capsule" | "retrieval-audit-record";
  sourceInstance: string;
  cause: TruncationCauseV1;
  availability: StageContextMetricAvailability;
  reason: string | null;
  omittedRequiredEvidenceIds: string[];
  limit: number | null;
  used: number | null;
  available: number | null;
}

export interface TruncationMetricsV1 {
  classifications: TruncationClassificationV1[];
}

// ---- Supplemental/raw agreement -----------------------------------------------------

export interface SupplementalRawFieldAgreementV1 {
  field: string;
  rawValue: string | boolean | null;
  supplementalValue: string | boolean | null;
  agreement: boolean | null;
  availability: StageContextMetricAvailability;
  reason: string | null;
}

export interface SupplementalRawAgreementV1 {
  fields: SupplementalRawFieldAgreementV1[];
  contradictions: SupplementalRawFieldAgreementV1[];
  // Preserved verbatim from the frozen my-dev-kit producer-parity contract (Batch 1); the
  // lab never recomputes it. Null when no raw pair was supplied.
  upstreamProducerParityPreserved: boolean | null;
}

// ---- Readiness agreement ------------------------------------------------------------

export interface ReadinessStructuralAgreementV1 {
  field: string;
  expectedValue: string | null;
  observedValue: string | null;
  agreement: boolean | null;
  availability: StageContextMetricAvailability;
  reason: string | null;
}

export interface ReadinessDecisionAgreementV1 {
  availability: StageContextMetricAvailability;
  observedDecision: ContextReadinessDecision | null;
  allowedDecisions: ContextReadinessDecision[] | null;
  decisionAgreement: boolean | null;
  observedClassification: string | null;
  expectedClassification: string | null;
  classificationAgreement: boolean | null;
  observedIssueCodes: string[];
  expectedIssueCodes: string[] | null;
  issueCodesAgreement: boolean | null;
  observedPrimaryIssueCode: string | null;
  expectedPrimaryIssueCode: string | null;
  primaryIssueAgreement: boolean | null;
  reason: string | null;
}

export interface InvalidReadyResultV1 {
  availability: StageContextMetricAvailability;
  invalidReady: boolean | null;
  observedDecision: ContextReadinessDecision | null;
  expectedBlockingDecision: boolean;
  missingExpectedIssueCodes: string[];
  reason: string | null;
}

export interface ValidBlockedResultV1 {
  availability: StageContextMetricAvailability;
  validBlocked: boolean | null;
  validRefreshRequired: boolean | null;
  observedDecision: ContextReadinessDecision | null;
  reason: string | null;
}

export interface ReadinessAgreementMetricsV1 {
  structuralAgreement: ReadinessStructuralAgreementV1[];
  decisionAgreement: ReadinessDecisionAgreementV1;
  invalidReady: InvalidReadyResultV1;
  validBlocked: ValidBlockedResultV1;
}

// ---- Criticality metrics ------------------------------------------------------------

export interface CriticalityOverlayEntryV1 {
  responsibilityId: string;
  expectedCriticality: "critical" | "noncritical" | null;
  observedCriticality: "critical" | "noncritical" | null;
  agreement: boolean | null;
  availability: StageContextMetricAvailability;
  reason: string | null;
}

export interface CriticalityMetricsV1 {
  overlayAgreement: CriticalityOverlayEntryV1[];
  missingCriticalityResponsibilityIds: string[];
  conflictingCriticalityResponsibilityIds: string[];
  unexpectedCriticalityResponsibilityIds: string[];
  mappedCriticalCompleteness: StageContextRatioMetricV1;
  fullyMappedCriticalIds: string[];
  partiallyMappedCriticalIds: string[];
  unmappedCriticalIds: string[];
  missingMappingEvidenceCriticalIds: string[];
}

// ---- v0.4.5 Batch 2: per-group/aggregate allocation and spillover evidence -----------
// Sourced from ContextCapsule.groupTruncation (Batch 1 mirror of the v1.10.3/v1.10.4
// producer's required-first allocator diagnostics). RetrievalAuditRecord has no
// groupTruncation field, so this evidence is context-capsule-only.

export interface PerGroupAllocationEvidenceV1 {
  groupId: string;
  sourceArtifact: "context-capsule";
  sourceInstance: string;
  availability: StageContextMetricAvailability;
  required: boolean | null;
  reservation: number | null;
  initiallySelectedCount: number | null;
  unusedReservationContributed: number | null;
  borrowedCapacity: number | null;
  governingHardBound: number | null;
  requiredOmittedCount: number | null;
  optionalOmittedCount: number | null;
  droppedCount: number | null;
  droppedEvidenceIds: string[];
  adequacyAffected: boolean | null;
  aggregateCapacityUsed: number | null;
  aggregateCapacityRemaining: number | null;
  reason: string | null;
}

// Each total is independently null when any contributing group lacks that specific field
// (legacy/partial evidence); `partial` is true whenever at least one total could not be
// computed for every group while at least one other total could.
export interface AggregateAllocationEvidenceV1 {
  availability: StageContextMetricAvailability;
  groupCount: number;
  totalReservation: number | null;
  totalInitiallySelected: number | null;
  totalUnusedReservationContributed: number | null;
  totalBorrowedCapacity: number | null;
  totalRequiredOmitted: number | null;
  totalOptionalOmitted: number | null;
  totalDropped: number | null;
  groupsContributingUnusedReservation: string[];
  groupsBorrowingCapacity: string[];
  groupsWithRequiredOmission: string[];
  groupsWithOptionalOnlyOmission: string[];
  groupsWithAdequacyAffected: string[];
  partial: boolean;
  reason: string | null;
}

// Purely descriptive. `contributionCoversBorrowing` is informational only -- it is never
// treated as a violated invariant when false, because donated reservation may legitimately
// go unborrowed and no upstream contract proves sum(unusedReservationContributed) ==
// sum(borrowedCapacity) must hold.
export interface SpilloverDiagnosticsV1 {
  availability: StageContextMetricAvailability;
  groupsContributing: string[];
  groupsBorrowing: string[];
  totalContributed: number | null;
  totalBorrowed: number | null;
  contributionCoversBorrowing: boolean | null;
  reason: string | null;
}

export interface GroupAllocationMetricsV1 {
  perGroup: PerGroupAllocationEvidenceV1[];
  aggregate: AggregateAllocationEvidenceV1;
  spillover: SpilloverDiagnosticsV1;
}

// ---- v0.4.5 Batch 2: condition-aware truncation classification -----------------------

export type ConditionAwareTruncationStateV1 =
  | "no-truncation"
  | "optional-only-truncation"
  | "required-evidence-loss"
  | "required-condition-or-last-witness-loss"
  | "unknown-criticality"
  | "unsupported-legacy-diagnostics"
  | "contradictory-producer-evidence";

export interface ConditionAwareTruncationClassificationV1 {
  sourceArtifact: "context-capsule" | "retrieval-audit-record";
  sourceInstance: string;
  availability: StageContextMetricAvailability;
  state: ConditionAwareTruncationStateV1;
  requiredEvidenceLost: boolean | null;
  requiredOmittedTotal: number | null;
  optionalOmittedTotal: number | null;
  lostRequiredConditionIds: string[];
  contradictionCodes: string[];
  reason: string | null;
}

// ---- v0.4.5 Batch 2: condition-coverage metrics --------------------------------------

export type ConditionCoverageStateV1 = "satisfied" | "missing-evidence" | "lost-to-allocation";

export interface ConditionWitnessEvidenceV1 {
  conditionId: string;
  role: string;
  required: boolean;
  witnessPolicy: string;
  requiredWitnessCount: number;
  availableWitnessCount: number;
  retainedWitnessCount: number;
  retainedWitnessIds: string[];
  adequateWitnessRemains: boolean;
  coverageState: ConditionCoverageStateV1;
  lossReason: string | null;
  evidenceGroupIds: string[];
}

export interface ConditionToGroupMappingV1 {
  conditionId: string;
  required: boolean;
  evidenceGroupIds: string[];
  mapped: boolean;
  unknownGroupIds: string[];
}

export interface ConditionCoverageMetricsV1 {
  availability: StageContextMetricAvailability;
  requiredConditionsTotal: StageContextCountMetricV1;
  requiredConditionsSatisfied: StageContextCountMetricV1;
  requiredConditionsMissing: StageContextCountMetricV1;
  requiredConditionsLost: StageContextCountMetricV1;
  optionalConditionsTotal: StageContextCountMetricV1;
  optionalConditionsSatisfied: StageContextCountMetricV1;
  optionalConditionsMissing: StageContextCountMetricV1;
  witnessEvidence: ConditionWitnessEvidenceV1[];
  lastWitnessLoss: StageContextCountMetricV1;
  conditionToGroupMapping: ConditionToGroupMappingV1[];
  reason: string | null;
}

// ---- v0.4.5 Batch 2: producer/condition and producer/readiness agreement -------------
// These compare producer-supplied verdicts against producer-supplied evidence (or supplied
// orchestrator readiness). They report agreement/contradiction/insufficient-evidence; they
// never replace, recompute, or override the upstream verdict.

export type AgreementOutcomeV1 = "agreement" | "contradiction" | "insufficient-evidence" | "unsupported-legacy-evidence" | "not-applicable";

export interface ProducerConditionAgreementV1 {
  availability: StageContextMetricAvailability;
  outcome: AgreementOutcomeV1;
  observedRoleAdequacyStatus: string | null;
  contradictionCodes: string[];
  reason: string | null;
}

export interface RequiredEvidenceLossAgreementV1 {
  availability: StageContextMetricAvailability;
  outcome: AgreementOutcomeV1;
  requiredEvidenceLost: boolean | null;
  explicitConditionLossDetected: boolean | null;
  requiredOmittedCount: number | null;
  contradictionCodes: string[];
  reason: string | null;
}

export interface ProducerReadinessRelationshipV1 {
  availability: StageContextMetricAvailability;
  outcome: AgreementOutcomeV1;
  observedRoleAdequacyStatus: string | null;
  observedReadinessDecision: string | null;
  contradictionCodes: string[];
  reason: string | null;
}

export interface CapsuleAuditConditionAgreementV1 {
  availability: StageContextMetricAvailability;
  consistent: boolean | null;
  contradictingFieldPaths: string[];
  reason: string | null;
}
