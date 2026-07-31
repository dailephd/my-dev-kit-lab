// v0.4.5 Batch 2: condition-coverage metrics, read directly from the frozen my-dev-kit
// v1.10.4 RoleConditionCoverage evidence (Batch 1 mirror). The lab never recomputes
// witness adequacy, never fabricates retained-witness identifiers from counts, and never
// treats an absent roleConditionCoverage field as an evaluated-empty result.
import type { RoleConditionCoverage } from "../upstreamArtifacts/index.js";
import type { StageContextCountMetricV1 } from "./types.js";
import type {
  ConditionCoverageMetricsV1,
  ConditionCoverageStateV1,
  ConditionToGroupMappingV1,
  ConditionWitnessEvidenceV1
} from "./producerReadinessMetricTypes.js";

function unavailableCoverageMetrics(reason: string): ConditionCoverageMetricsV1 {
  const unavailableCount: StageContextCountMetricV1 = { availability: "unavailable", count: null, evidenceKeys: [], reason };
  return {
    availability: "unavailable",
    requiredConditionsTotal: unavailableCount,
    requiredConditionsSatisfied: unavailableCount,
    requiredConditionsMissing: unavailableCount,
    requiredConditionsLost: unavailableCount,
    optionalConditionsTotal: unavailableCount,
    optionalConditionsSatisfied: unavailableCount,
    optionalConditionsMissing: unavailableCount,
    witnessEvidence: [],
    lastWitnessLoss: unavailableCount,
    conditionToGroupMapping: [],
    reason
  };
}

function countMetric(ids: string[]): StageContextCountMetricV1 {
  return { availability: "available", count: ids.length, evidenceKeys: ids, reason: null };
}

function coverageState(condition: RoleConditionCoverage): ConditionCoverageStateV1 {
  if (condition.conditionSatisfied) return "satisfied";
  if (condition.lostRequiredCondition) return "lost-to-allocation";
  return "missing-evidence";
}

export function calculateConditionCoverageMetrics(
  roleConditionCoverage: readonly RoleConditionCoverage[] | undefined,
  availableEvidenceGroupIds: readonly string[] | undefined
): ConditionCoverageMetricsV1 {
  if (roleConditionCoverage === undefined) {
    return unavailableCoverageMetrics(
      "No roleConditionCoverage evidence was supplied (legacy schema-major-1 artifact, or the producer did not emit condition-level diagnostics)."
    );
  }

  const required = roleConditionCoverage.filter((c) => c.required);
  const optional = roleConditionCoverage.filter((c) => !c.required);

  const requiredSatisfied = required.filter((c) => c.conditionSatisfied);
  const requiredLost = required.filter((c) => c.lostRequiredCondition);
  const requiredMissing = required.filter((c) => !c.conditionSatisfied && !c.lostRequiredCondition);

  const optionalSatisfied = optional.filter((c) => c.conditionSatisfied);
  const optionalMissing = optional.filter((c) => !c.conditionSatisfied);

  const witnessEvidence: ConditionWitnessEvidenceV1[] = roleConditionCoverage.map((c) => ({
    conditionId: c.conditionId,
    role: c.role,
    required: c.required,
    witnessPolicy: c.witnessPolicy,
    requiredWitnessCount: c.requiredWitnessCount,
    availableWitnessCount: c.availableWitnessCount,
    retainedWitnessCount: c.retainedWitnessCount,
    retainedWitnessIds: c.retainedWitnessIds,
    adequateWitnessRemains: c.conditionSatisfied,
    coverageState: coverageState(c),
    lossReason: c.lossReason,
    evidenceGroupIds: c.evidenceGroupIds
  }));

  const conditionToGroupMapping: ConditionToGroupMappingV1[] = roleConditionCoverage.map((c) => ({
    conditionId: c.conditionId,
    required: c.required,
    evidenceGroupIds: c.evidenceGroupIds,
    mapped: c.evidenceGroupIds.length > 0,
    unknownGroupIds: availableEvidenceGroupIds === undefined ? [] : c.evidenceGroupIds.filter((id) => !availableEvidenceGroupIds.includes(id))
  }));

  return {
    availability: "available",
    requiredConditionsTotal: countMetric(required.map((c) => c.conditionId)),
    requiredConditionsSatisfied: countMetric(requiredSatisfied.map((c) => c.conditionId)),
    requiredConditionsMissing: countMetric(requiredMissing.map((c) => c.conditionId)),
    requiredConditionsLost: countMetric(requiredLost.map((c) => c.conditionId)),
    optionalConditionsTotal: countMetric(optional.map((c) => c.conditionId)),
    optionalConditionsSatisfied: countMetric(optionalSatisfied.map((c) => c.conditionId)),
    optionalConditionsMissing: countMetric(optionalMissing.map((c) => c.conditionId)),
    witnessEvidence,
    lastWitnessLoss: countMetric(requiredLost.map((c) => c.conditionId)),
    conditionToGroupMapping,
    reason: null
  };
}
