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
