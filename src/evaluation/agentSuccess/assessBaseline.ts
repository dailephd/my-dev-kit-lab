import type { BaselineAssessment, BaselineInvalidReason, VerificationPhaseResult } from "./verificationTypes.js";

/**
 * Decides whether the unmodified benchmark can evaluate an implementation.
 *
 * Evaluable exactly when at least one task check fails (there is something to fix) and every regression
 * check passes (there is nothing already broken), and no check was unable to produce a verdict. A check
 * that timed out or errored is "not evaluable" rather than "failed": an indeterminate check cannot prove
 * the task is unsolved. An invalid baseline is a benchmark defect, never an agent failure.
 */
export function assessBaseline(baseline: Pick<VerificationPhaseResult, "taskResults" | "regressionResults">): BaselineAssessment {
  const reasons: BaselineInvalidReason[] = [];
  const all = [...baseline.taskResults, ...baseline.regressionResults];
  if (baseline.taskResults.length === 0 || baseline.regressionResults.length === 0) reasons.push("NO_CHECKS");
  if (all.some((result) => result.status === "timeout" || result.status === "error")) reasons.push("CHECK_NOT_EVALUABLE");
  if (baseline.taskResults.length > 0 && !baseline.taskResults.some((result) => result.status === "failed")) {
    if (!reasons.includes("CHECK_NOT_EVALUABLE")) reasons.push("ALL_TASK_CHECKS_PASSED");
  }
  if (baseline.regressionResults.some((result) => result.status === "failed")) reasons.push("REGRESSION_CHECK_FAILED");
  return { evaluable: reasons.length === 0, reasons };
}
