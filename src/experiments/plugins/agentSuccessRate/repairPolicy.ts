import type { AgentSuccessMetricId } from "./analysisTypes.js";
import type { AgentSuccessFailureCategory, AgentSuccessTreatmentEvidenceV1 } from "./executionTypes.js";
import type { AgentSuccessMetricV1 } from "./types.js";

/**
 * Pure repair policy: decides how one evaluated attempt ended and whether a repair may follow. It performs no
 * filesystem, subprocess or provider work and reads only normalized execution evidence plus already-calculated metrics.
 */

/** Categories for which a completed provider attempt produced an evaluable implementation failure. */
export const AGENT_SUCCESS_REPAIR_ELIGIBLE_CATEGORIES: readonly AgentSuccessFailureCategory[] = [
  "patch-malformed",
  "patch-policy-rejected",
  "patch-check-failed",
  "patch-apply-failed",
  "task-check-failed",
  "regression-failed",
  "required-behavior-unsatisfied"
];

export type AgentSuccessAttemptMetricsView = Partial<Record<AgentSuccessMetricId, AgentSuccessMetricV1>>;

export type AgentSuccessAttemptClassification = {
  category: AgentSuccessFailureCategory;
  repairEligible: boolean;
  /** The attempt's task-success verdict; null when it could not be determined. */
  taskSuccess: boolean | null;
};

function booleanValue(metric: AgentSuccessMetricV1 | undefined): boolean | null {
  return metric !== undefined && metric.availability === "available" && typeof metric.value === "boolean" ? metric.value : null;
}

/** Classifies an attempt. Infrastructure and provider-health outcomes are never eligible, regardless of task success. */
export function classifyAgentSuccessAttempt(evidence: AgentSuccessTreatmentEvidenceV1, metrics: AgentSuccessAttemptMetricsView): AgentSuccessAttemptClassification {
  const taskSuccess = booleanValue(metrics.taskSuccess);
  const result = (category: AgentSuccessFailureCategory): AgentSuccessAttemptClassification => ({
    category,
    repairEligible: AGENT_SUCCESS_REPAIR_ELIGIBLE_CATEGORIES.includes(category),
    taskSuccess
  });
  const real = evidence.realAgent;

  if (evidence.availability === "infrastructure-failure") return result("infrastructure-failure");
  if (evidence.availability === "baseline-invalid" || evidence.baselineAssessment === null || !evidence.baselineAssessment.evaluable) return result("baseline-invalid");
  if (real === undefined) return result("evidence-incomplete");
  if (real.context.availability === "unavailable" && !real.providerInvoked) return result("context-unavailable");
  if (!real.providerInvoked) return result("provider-not-invoked");
  switch (real.providerStatus) {
    case "agent-unavailable":
      return result("provider-unavailable");
    case "agent-limit-reached":
      return result("provider-limit-reached");
    case "timeout":
      return result("provider-timeout");
    case "completed":
      break;
    default:
      return result("provider-failed");
  }
  if (!real.finalAnswerAvailable || !evidence.patch.attempted) return result("provider-empty-answer");
  if (!evidence.cleanup.removed || (real.cwdCleanup.attempted && !real.cwdCleanup.removed)) return result("cleanup-failed");
  if (evidence.protectedIntegrity.status === "unproven") return result("integrity-unproven");
  if (evidence.availability !== "complete") return result("evidence-incomplete");

  switch (evidence.patch.outcome) {
    case "parse-failure":
      return result("patch-malformed");
    case "policy-rejection":
      return result("patch-policy-rejected");
    case "git-check-failure":
      return result("patch-check-failed");
    case "git-apply-failure":
      return result("patch-apply-failed");
    case "success":
      break;
    default:
      return result("evidence-incomplete");
  }
  if (evidence.protectedIntegrity.status === "mutated") return result("integrity-mutated");
  if (taskSuccess === true) return result("none");
  if (taskSuccess === null) return result("evidence-incomplete");
  if (booleanValue(metrics.taskChecksPassed) === false) return result("task-check-failed");
  if (booleanValue(metrics.regressionSafe) === false) return result("regression-failed");
  if (booleanValue(metrics.requiredFactsSatisfied) === false) return result("required-behavior-unsatisfied");
  return result("task-check-failed");
}

/** A repair runs only after an eligible failure, and only while the allowance and the hard total bound both remain. */
export function shouldRepairAgentSuccessAttempt(args: { classification: AgentSuccessAttemptClassification; attemptsExecuted: number; repairAttemptsAllowed: number }): boolean {
  return args.classification.repairEligible && args.classification.taskSuccess === false && args.attemptsExecuted <= args.repairAttemptsAllowed && args.attemptsExecuted < 3;
}
