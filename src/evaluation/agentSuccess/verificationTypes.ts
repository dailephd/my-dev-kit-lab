/**
 * Local AgentSuccess verification vocabulary. These statuses describe one trusted check only; they are not
 * ExperimentRunStatus values and are never used to judge an agent's answer text.
 */
export type VerificationStatus = "passed" | "failed" | "timeout" | "error";

export type VerificationCheckClass = "task" | "regression";

export type VerificationPhase = "baseline" | "post-edit";

export const VERIFICATION_OUTPUT_LIMIT_BYTES = 1_048_576;

export type VerificationCheckResult = {
  checkId: string;
  class: VerificationCheckClass;
  executable: "node";
  args: string[];
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: VerificationStatus;
  exitCode: number | null;
  /** Evidence files under the sandbox evidence root (outside the project copy). */
  stdoutPath: string;
  stderrPath: string;
  timedOut: boolean;
  outputLimit: { stream: "stdout" | "stderr"; limitBytes: number } | null;
  /** Spawn, timeout or output-limit description; null when the process ran to a normal exit. */
  processError: string | null;
  failureReason: string | null;
};

export type VerificationPhaseResult = {
  phase: VerificationPhase;
  /** Contract order. */
  taskResults: VerificationCheckResult[];
  regressionResults: VerificationCheckResult[];
};

export type BaselineInvalidReason =
  | "NO_CHECKS"
  | "ALL_TASK_CHECKS_PASSED"
  | "REGRESSION_CHECK_FAILED"
  | "CHECK_NOT_EVALUABLE";

/** Whether the unmodified benchmark can be used to evaluate an implementation. Invalid is never an agent failure. */
export type BaselineAssessment = {
  evaluable: boolean;
  reasons: BaselineInvalidReason[];
};
