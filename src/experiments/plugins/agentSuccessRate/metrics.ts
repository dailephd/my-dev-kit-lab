import type { ExperimentMetric } from "../../types.js";
import type { AgentSuccessMetricId, AgentSuccessRateAnalysisV1, AgentSuccessTreatmentAnalysisV1 } from "./analysisTypes.js";
import type { AgentSuccessMetricUnit, AgentSuccessMetricV1, Tri } from "./types.js";

const PREFIX = "agent-success-rate";

/** Typed metric constructors. An absent measurement is never represented as zero. */
export function availableMetric(id: string, value: number | boolean, unit: AgentSuccessMetricUnit): AgentSuccessMetricV1 {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return unavailableMetric(id, unit, "the computed value was not finite.");
  }
  return { id, availability: "available", value, unit, reason: null };
}

export function unavailableMetric(id: string, unit: AgentSuccessMetricUnit, reason: string): AgentSuccessMetricV1 {
  return { id, availability: "unavailable", value: null, unit, reason: reason.trim() || "evidence is unavailable." };
}

export function notApplicableMetric(id: string, unit: AgentSuccessMetricUnit, reason: string): AgentSuccessMetricV1 {
  return { id, availability: "not-applicable", value: null, unit, reason: reason.trim() || "not applicable." };
}

export function triMetric(id: string, value: Tri, unknownReason: string): AgentSuccessMetricV1 {
  return value === "unknown" ? unavailableMetric(id, "boolean", unknownReason) : availableMetric(id, value, "boolean");
}

/** ratio = numerator / denominator, or not-applicable when the denominator is zero. */
export function ratioMetric(id: string, numerator: number, denominator: number, zeroReason: string): AgentSuccessMetricV1 {
  return denominator === 0 ? notApplicableMetric(id, "ratio", zeroReason) : availableMetric(id, numerator / denominator, "ratio");
}

/** Structural check of the metric availability contract. Returns problems; empty means valid. */
export function validateAgentSuccessMetric(metric: AgentSuccessMetricV1): string[] {
  const problems: string[] = [];
  if (metric.availability === "available") {
    if (metric.value === null) problems.push(`${metric.id}: available metric has a null value.`);
    if (typeof metric.value === "number" && !Number.isFinite(metric.value)) problems.push(`${metric.id}: available metric is not finite.`);
    if (metric.reason !== null) problems.push(`${metric.id}: available metric must not carry a reason.`);
  } else {
    if (metric.value !== null) problems.push(`${metric.id}: ${metric.availability} metric must have a null value.`);
    if (typeof metric.reason !== "string" || metric.reason.trim() === "") problems.push(`${metric.id}: ${metric.availability} metric needs a reason.`);
  }
  return problems;
}

/** Flattening to the generic ExperimentMetric happens only here, for generic run/outcome compatibility. */
export function toExperimentMetric(metric: AgentSuccessMetricV1, scope: { caseId?: string; variantId?: string; name?: string }): ExperimentMetric {
  return {
    id: `${PREFIX}.${metric.id}`,
    name: scope.name ?? metric.id,
    value: metric.value,
    unit: metric.unit,
    description: metric.availability === "available" ? "available" : `${metric.availability}: ${metric.reason ?? ""}`,
    ...(scope.variantId === undefined ? {} : { variantId: scope.variantId }),
    ...(scope.caseId === undefined ? {} : { caseId: scope.caseId })
  };
}

export function toAgentSuccessOutcomeMetrics(analysis: AgentSuccessTreatmentAnalysisV1): ExperimentMetric[] {
  const scope = { caseId: analysis.caseId, variantId: analysis.treatmentId };
  const metrics = (Object.keys(analysis.metrics) as AgentSuccessMetricId[]).map((id) => toExperimentMetric(analysis.metrics[id], scope));
  const repair = analysis.repair;
  if (repair) {
    // Initial-attempt and final outcomes are separate measurements; attempt counts are plain counts.
    metrics.push(
      toExperimentMetric(repair.initialAttemptTaskSuccess, scope),
      toExperimentMetric(repair.finalTaskSuccess, scope),
      toExperimentMetric(repair.repairSucceeded, scope),
      toExperimentMetric(availableMetric("attemptCount", repair.attemptCount, "count"), scope),
      toExperimentMetric(availableMetric("repairAttemptCount", repair.repairAttemptCount, "count"), scope),
      toExperimentMetric(repair.totalProviderDurationMs, scope),
      toExperimentMetric(repair.totalProviderTokens, scope),
      toExperimentMetric(repair.totalEvaluationDurationMs, scope)
    );
  }
  return metrics;
}

export function toAgentSuccessRunMetrics(analysis: AgentSuccessRateAnalysisV1): ExperimentMetric[] {
  const metrics: ExperimentMetric[] = [];
  for (const aggregate of analysis.aggregates) {
    const scope = { variantId: aggregate.treatmentId };
    metrics.push(
      toExperimentMetric(availableMetric("evaluableCaseCount", aggregate.evaluableCaseCount, "count"), scope),
      toExperimentMetric(availableMetric("successfulCaseCount", aggregate.successfulCaseCount, "count"), scope),
      toExperimentMetric(aggregate.taskSuccessRate, scope),
      toExperimentMetric(aggregate.initialAttemptSuccessRate, scope)
    );
    for (const mean of Object.values(aggregate.means)) metrics.push(toExperimentMetric(mean.metric, scope));
    const repair = aggregate.repair;
    if (repair) {
      metrics.push(
        toExperimentMetric(availableMetric("initialAttemptSuccessfulCount", repair.initialAttemptSuccessfulCount, "count"), scope),
        toExperimentMetric(repair.finalTaskSuccessRate, scope),
        toExperimentMetric(availableMetric("finalSuccessfulCount", repair.finalSuccessfulCount, "count"), scope),
        toExperimentMetric(availableMetric("repairAttemptedCaseCount", repair.repairAttemptedCaseCount, "count"), scope),
        toExperimentMetric(availableMetric("repairedCaseCount", repair.repairedCaseCount, "count"), scope),
        toExperimentMetric(repair.repairSuccessRate, scope),
        toExperimentMetric(repair.meanAttemptsPerEvaluableCase, scope)
      );
    }
  }
  return metrics;
}
