import { isDeepStrictEqual } from "node:util";
import type { ContextCapsule, JsonValue, RetrievalAuditRecord, WorkflowInstructionPacket } from "../upstreamArtifacts/index.js";
import type {
  ExpectedMyDevKitContextArtifactStateV1,
  ExpectedTargetImmutabilityStateV1,
  ExpectedWorkflowInstructionPacketStateV1
} from "../stageContextExpectations/index.js";
import type { StageContextStateComparisonV1 } from "./types.js";

function compareValue(
  sourceArtifact: StageContextStateComparisonV1["sourceArtifact"],
  sourceInstance: string,
  expectationFieldPath: string,
  artifactFieldPath: string,
  expected: JsonValue,
  actual: JsonValue,
  matched: boolean
): StageContextStateComparisonV1 {
  return {
    sourceArtifact,
    sourceInstance,
    expectationFieldPath,
    artifactFieldPath,
    availability: "available",
    expected,
    actual,
    matched,
    reason: null
  };
}

function unavailableComparison(
  sourceArtifact: StageContextStateComparisonV1["sourceArtifact"],
  sourceInstance: string,
  expectationFieldPath: string,
  expected: JsonValue,
  reason: string
): StageContextStateComparisonV1 {
  return {
    sourceArtifact,
    sourceInstance,
    expectationFieldPath,
    artifactFieldPath: null,
    availability: "unavailable",
    expected,
    actual: null,
    matched: null,
    reason
  };
}

export function compareExpectedContextCapsuleState(
  expected: ExpectedMyDevKitContextArtifactStateV1 | undefined,
  artifact: ContextCapsule,
  sourceInstance: string
): StageContextStateComparisonV1[] {
  if (expected === undefined) return [];
  const comparisons: StageContextStateComparisonV1[] = [];
  const SA = "context-capsule" as const;

  if (expected.contextAdequacyStatus !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "contextAdequacyStatus",
        "contextAdequacy.status",
        expected.contextAdequacyStatus,
        artifact.contextAdequacy.status,
        artifact.contextAdequacy.status === expected.contextAdequacyStatus
      )
    );
  }
  if (expected.roleAdequacyStatus !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "roleAdequacyStatus",
        "roleAdequacy.status",
        expected.roleAdequacyStatus,
        artifact.roleAdequacy.status,
        artifact.roleAdequacy.status === expected.roleAdequacyStatus
      )
    );
  }
  if (expected.freshnessState !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "freshnessState",
        "freshness.state",
        expected.freshnessState,
        artifact.freshness.state,
        artifact.freshness.state === expected.freshnessState
      )
    );
  }
  if (expected.truncated !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "truncated",
        "truncation.truncated",
        expected.truncated,
        artifact.truncation.truncated,
        artifact.truncation.truncated === expected.truncated
      )
    );
  }
  if (expected.fullFileFallbackUsed !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "fullFileFallbackUsed",
        "fullFileFallback.used",
        expected.fullFileFallbackUsed,
        artifact.fullFileFallback.used,
        artifact.fullFileFallback.used === expected.fullFileFallbackUsed
      )
    );
  }
  if (expected.unresolvedItemIds !== undefined) {
    comparisons.push(
      unavailableComparison(
        SA,
        sourceInstance,
        "unresolvedItemIds",
        expected.unresolvedItemIds,
        "ContextCapsule unresolvedItems do not expose stable item IDs."
      )
    );
  }
  if (expected.warningCount !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "warningCount",
        "warnings.length",
        expected.warningCount,
        artifact.warnings.length,
        artifact.warnings.length === expected.warningCount
      )
    );
  }

  return comparisons;
}

export function compareExpectedRetrievalAuditState(
  expected: ExpectedMyDevKitContextArtifactStateV1 | undefined,
  artifact: RetrievalAuditRecord,
  sourceInstance: string
): StageContextStateComparisonV1[] {
  if (expected === undefined) return [];
  const comparisons: StageContextStateComparisonV1[] = [];
  const SA = "retrieval-audit-record" as const;

  if (expected.contextAdequacyStatus !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "contextAdequacyStatus",
        "contextAdequacy.status",
        expected.contextAdequacyStatus,
        artifact.contextAdequacy.status,
        artifact.contextAdequacy.status === expected.contextAdequacyStatus
      )
    );
  }
  if (expected.roleAdequacyStatus !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "roleAdequacyStatus",
        "roleAdequacy.status",
        expected.roleAdequacyStatus,
        artifact.roleAdequacy.status,
        artifact.roleAdequacy.status === expected.roleAdequacyStatus
      )
    );
  }
  if (expected.freshnessState !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "freshnessState",
        "freshness.state",
        expected.freshnessState,
        artifact.freshness.state,
        artifact.freshness.state === expected.freshnessState
      )
    );
  }
  if (expected.truncated !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "truncated",
        "truncation.truncated",
        expected.truncated,
        artifact.truncation.truncated,
        artifact.truncation.truncated === expected.truncated
      )
    );
  }
  if (expected.fullFileFallbackUsed !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "fullFileFallbackUsed",
        "fullFileFallback.used",
        expected.fullFileFallbackUsed,
        artifact.fullFileFallback.used,
        artifact.fullFileFallback.used === expected.fullFileFallbackUsed
      )
    );
  }
  if (expected.unresolvedItemIds !== undefined) {
    comparisons.push(
      unavailableComparison(
        SA,
        sourceInstance,
        "unresolvedItemIds",
        expected.unresolvedItemIds,
        "RetrievalAuditRecord does not serialize unresolved item IDs."
      )
    );
  }
  if (expected.warningCount !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "warningCount",
        "warnings.length",
        expected.warningCount,
        artifact.warnings.length,
        artifact.warnings.length === expected.warningCount
      )
    );
  }

  return comparisons;
}

export function compareExpectedWorkflowInstructionPacketState(
  expected: ExpectedWorkflowInstructionPacketStateV1 | undefined,
  artifact: WorkflowInstructionPacket,
  sourceInstance: string
): StageContextStateComparisonV1[] {
  if (expected === undefined) return [];
  const comparisons: StageContextStateComparisonV1[] = [];
  const SA = "workflow-instruction-packet" as const;

  if (expected.adequacyStatus !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "adequacyStatus",
        "adequacy.status",
        expected.adequacyStatus,
        artifact.adequacy.status,
        artifact.adequacy.status === expected.adequacyStatus
      )
    );
  }
  if (expected.truncated !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "truncated",
        "truncation.truncated",
        expected.truncated,
        artifact.truncation.truncated,
        artifact.truncation.truncated === expected.truncated
      )
    );
  }
  if (expected.unresolvedReferences !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "unresolvedReferences",
        "unresolvedReferences",
        expected.unresolvedReferences,
        artifact.unresolvedReferences,
        isDeepStrictEqual(artifact.unresolvedReferences, expected.unresolvedReferences)
      )
    );
  }
  if (expected.warningCount !== undefined) {
    comparisons.push(
      compareValue(
        SA,
        sourceInstance,
        "warningCount",
        "warnings.length",
        expected.warningCount,
        artifact.warnings.length,
        artifact.warnings.length === expected.warningCount
      )
    );
  }

  return comparisons;
}

export function compareExpectedTargetImmutabilityState(
  expected: ExpectedTargetImmutabilityStateV1 | undefined
): StageContextStateComparisonV1[] {
  if (expected === undefined) return [];
  return [
    {
      sourceArtifact: "target-immutability",
      sourceInstance: "target",
      expectationFieldPath: "expectedStates.targetImmutability.newMutationCount",
      artifactFieldPath: null,
      availability: "unavailable",
      expected: expected.newMutationCount,
      actual: null,
      matched: null,
      reason: "Target immutability is implemented in Batch 6 and is unavailable in Batch 5."
    }
  ];
}
