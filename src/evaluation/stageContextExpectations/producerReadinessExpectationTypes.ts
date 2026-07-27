// v0.4.4 Batch 2: additive, optional expectation facets covering the producer/readiness
// evidence Batch 1 preserves (selected owners, allocation/truncation evidence on the raw
// my-dev-kit artifacts, orchestrator readiness, and responsibility criticality). These are
// a separate axis from StageContextExpectationItemV1/expectedEvidence -- they are the
// deterministic lab oracle for Batch 2 metrics, not evidence-match expectations. Fully
// optional so every existing v0.4.3 StageContextExpectationFixtureV1 remains valid and
// unchanged (schema major stays 1).

export type ProducerReadinessOwnerInclusion = "required" | "allowed" | "forbidden";

export interface ProducerReadinessOwnerExpectationV1 {
  expectationId: string;
  inclusion: ProducerReadinessOwnerInclusion;
  sourceArtifact: "context-capsule" | "retrieval-audit-record";
  // Canonical owner identity as preserved by the frozen producer's EvidenceItemRef.id.
  ownerId: string;
  notes: string[];
}

export interface ProducerReadinessAllocationExpectationV1 {
  expectationId: string;
  // The evidence-group identity (EvidenceGroup.id / TruncationRecord.affectedGroup) this
  // expectation is the oracle for.
  groupId: string;
  expectedCapacity?: number | null;
  expectedUsedReservation?: number | null;
  expectedRequiredEvidenceIds?: string[];
  expectedOmitted?: boolean;
  notes: string[];
}

export type ProducerReadinessExpectedDecision = "not-required" | "ready" | "refresh-required";

export interface ProducerReadinessReadinessExpectationV1 {
  expectationId: string;
  kind: "implementation" | "test";
  allowedDecisions?: ProducerReadinessExpectedDecision[];
  expectedClassification?: string;
  expectedIssueCodes?: string[];
  expectedPrimaryIssueCode?: string;
  notApplicable?: boolean;
  notes: string[];
}

export type ProducerReadinessExpectedCriticality = "critical" | "noncritical";

export interface ProducerReadinessCriticalityExpectationV1 {
  expectationId: string;
  responsibilityId: string;
  expectedCriticality: ProducerReadinessExpectedCriticality;
  applicable: boolean;
  requiresFullMapping: boolean;
  notes: string[];
}

export interface ProducerReadinessExpectationsV1 {
  ownerExpectations?: ProducerReadinessOwnerExpectationV1[];
  allocationExpectations?: ProducerReadinessAllocationExpectationV1[];
  readinessExpectations?: ProducerReadinessReadinessExpectationV1[];
  criticalityExpectations?: ProducerReadinessCriticalityExpectationV1[];
}
