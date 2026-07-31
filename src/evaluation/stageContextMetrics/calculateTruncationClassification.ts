// v0.4.4 Batch 2: truncation-cause classification, derived only from the frozen my-dev-kit
// TruncationRecord fields (limit, used, available, requiredEvidenceLost) already preserved
// by the existing v0.4.3 readers. The lab classifies using authoritative producer evidence
// only -- it never reimplements the allocator that decided what to keep or drop.
import type { ContextCapsule, RetrievalAuditRecord, TruncationRecord } from "../upstreamArtifacts/index.js";
import type { ConditionAwareTruncationClassificationV1, TruncationClassificationV1, TruncationCauseV1 } from "./producerReadinessMetricTypes.js";

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

// v0.4.5 Batch 2: condition-aware truncation classification. Distinguishes the seven states
// required by the Batch 2 plan using only explicit upstream evidence (truncation.truncated,
// truncation.requiredEvidenceLost, ContextCapsule.groupTruncation's required/optional omitted
// counts, and roleConditionCoverage's lostRequiredCondition/lossReason). Never independently
// decides that a condition lost its last witness from a raw file count.
export function classifyConditionAwareTruncation(
  artifact: ContextCapsule | RetrievalAuditRecord,
  sourceArtifact: "context-capsule" | "retrieval-audit-record",
  sourceInstance: string
): ConditionAwareTruncationClassificationV1 {
  const requiredEvidenceLost = artifact.truncation.requiredEvidenceLost;
  const roleConditionCoverage = artifact.roleConditionCoverage;
  const groupTruncation = "groupTruncation" in artifact ? artifact.groupTruncation : undefined;

  const lostConditions = roleConditionCoverage?.filter((c) => c.lostRequiredCondition) ?? undefined;
  const lostRequiredConditionIds = lostConditions?.map((c) => c.conditionId) ?? [];

  const groupsWithBothOmissionFields = groupTruncation?.filter(
    (g) => g.requiredOmittedCount !== undefined && g.optionalOmittedCount !== undefined
  );
  const requiredOmittedTotal =
    groupsWithBothOmissionFields !== undefined && groupsWithBothOmissionFields.length === (groupTruncation?.length ?? -1) && groupTruncation!.length > 0
      ? groupsWithBothOmissionFields.reduce((sum, g) => sum + (g.requiredOmittedCount ?? 0), 0)
      : null;
  const optionalOmittedTotal =
    groupsWithBothOmissionFields !== undefined && groupsWithBothOmissionFields.length === (groupTruncation?.length ?? -1) && groupTruncation!.length > 0
      ? groupsWithBothOmissionFields.reduce((sum, g) => sum + (g.optionalOmittedCount ?? 0), 0)
      : null;

  const base = {
    sourceArtifact,
    sourceInstance,
    requiredEvidenceLost: requiredEvidenceLost ?? null,
    requiredOmittedTotal,
    optionalOmittedTotal,
    lostRequiredConditionIds
  };

  const hasAnyCurrentDiagnostics = requiredEvidenceLost !== undefined || roleConditionCoverage !== undefined || requiredOmittedTotal !== null;

  if (!hasAnyCurrentDiagnostics) {
    return {
      ...base,
      availability: "unavailable",
      state: "unsupported-legacy-diagnostics",
      contradictionCodes: [],
      reason: "No v1.10.3/v1.10.4 truncation or condition-coverage diagnostics were supplied (legacy schema-major-1 evidence)."
    };
  }

  const contradictionCodes: string[] = [];
  if (requiredEvidenceLost === false && lostRequiredConditionIds.length > 0) {
    contradictionCodes.push("REQUIRED_EVIDENCE_LOST_FALSE_BUT_CONDITION_LOSS_REPORTED");
  }
  if (
    requiredEvidenceLost === true &&
    roleConditionCoverage !== undefined &&
    lostRequiredConditionIds.length === 0 &&
    roleConditionCoverage.filter((c) => c.required).every((c) => c.conditionSatisfied) &&
    (requiredOmittedTotal === null || requiredOmittedTotal === 0)
  ) {
    contradictionCodes.push("REQUIRED_EVIDENCE_LOST_TRUE_BUT_ALL_REQUIRED_CONDITIONS_RETAINED");
  }

  if (contradictionCodes.length > 0) {
    return {
      ...base,
      availability: "available",
      state: "contradictory-producer-evidence",
      contradictionCodes,
      reason: "Producer evidence is internally contradictory; both sides are retained rather than resolved by the lab."
    };
  }

  if (lostRequiredConditionIds.length > 0) {
    return {
      ...base,
      availability: "available",
      state: "required-condition-or-last-witness-loss",
      contradictionCodes: [],
      reason: `Explicit lostRequiredCondition evidence exists for: ${lostRequiredConditionIds.join(", ")}.`
    };
  }

  if (requiredEvidenceLost === true || (requiredOmittedTotal !== null && requiredOmittedTotal > 0)) {
    return {
      ...base,
      availability: "available",
      state: "required-evidence-loss",
      contradictionCodes: [],
      reason: "Required evidence loss is explicitly reported without condition-level detail."
    };
  }

  if (requiredEvidenceLost === undefined && artifact.truncation.truncated) {
    return {
      ...base,
      availability: "available",
      state: "unknown-criticality",
      contradictionCodes: [],
      reason: "General truncation occurred but the rollup requiredEvidenceLost field is absent, so required-versus-optional criticality cannot be determined."
    };
  }

  if (artifact.truncation.truncated) {
    return {
      ...base,
      availability: "available",
      state: "optional-only-truncation",
      contradictionCodes: [],
      reason: "Truncation occurred but no required evidence loss or condition loss was reported."
    };
  }

  return {
    ...base,
    availability: "available",
    state: "no-truncation",
    contradictionCodes: [],
    reason: null
  };
}
