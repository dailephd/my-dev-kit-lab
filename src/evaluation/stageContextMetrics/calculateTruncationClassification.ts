// v0.4.4 Batch 2: truncation-cause classification, derived only from the frozen my-dev-kit
// TruncationRecord fields (limit, used, available, requiredEvidenceLost) already preserved
// by the existing v0.4.3 readers. The lab classifies using authoritative producer evidence
// only -- it never reimplements the allocator that decided what to keep or drop.
import type { TruncationRecord } from "../upstreamArtifacts/index.js";
import type { TruncationClassificationV1, TruncationCauseV1 } from "./producerReadinessMetricTypes.js";

export function classifyTruncationRecord(
  record: TruncationRecord,
  sourceArtifact: "context-capsule" | "retrieval-audit-record",
  sourceInstance: string
): TruncationClassificationV1 {
  const base = {
    groupId: record.affectedGroup,
    sourceArtifact,
    sourceInstance,
    limit: record.limit,
    used: record.used,
    available: record.available,
    omittedRequiredEvidenceIds: record.requiredEvidenceLost ? record.droppedEvidenceIds : []
  };

  if (!record.requiredEvidenceLost) {
    return {
      ...base,
      cause: "none" as TruncationCauseV1,
      availability: "available",
      reason: "No fixture-required evidence was reported lost for this group."
    };
  }

  if (record.limit === null) {
    return {
      ...base,
      cause: "unresolved" as TruncationCauseV1,
      availability: "available",
      reason: "Required evidence was lost but no hard limit is declared for this group, so avoidability cannot be proven either way."
    };
  }

  if (record.used < record.limit) {
    return {
      ...base,
      cause: "avoidable" as TruncationCauseV1,
      availability: "available",
      reason: `Required evidence was lost while used (${record.used}) remained below the declared limit (${record.limit}); compatible headroom existed under the hard limit.`
    };
  }

  return {
    ...base,
    cause: "genuine-hard-limit" as TruncationCauseV1,
    availability: "available",
    reason: `Required evidence was lost and used (${record.used}) reached or exceeded the declared limit (${record.limit}); no compatible headroom remained.`
  };
}

export function classifyTruncationRecords(
  records: readonly TruncationRecord[],
  sourceArtifact: "context-capsule" | "retrieval-audit-record",
  sourceInstance: string
): TruncationClassificationV1[] {
  return records.map((record) => classifyTruncationRecord(record, sourceArtifact, sourceInstance));
}
