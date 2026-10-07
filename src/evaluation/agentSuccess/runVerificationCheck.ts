import path from "node:path";
import { runMeasuredCommand } from "../../core/runMeasuredCommand.js";
import { buildMinimalHostEnv, type BenchmarkSandbox } from "../benchmarkSandbox/index.js";
import type { AgentSuccessTaskV1, VerificationCheckDefinition } from "./taskTypes.js";
import {
  VERIFICATION_OUTPUT_LIMIT_BYTES,
  type VerificationCheckClass,
  type VerificationCheckResult,
  type VerificationPhase,
  type VerificationPhaseResult,
  type VerificationStatus
} from "./verificationTypes.js";

export type RunVerificationCheckOptions = {
  sandbox: BenchmarkSandbox;
  check: VerificationCheckDefinition;
  checkClass: VerificationCheckClass;
  phase: VerificationPhase;
  /** Test seam; production uses the 1 MiB V1 limit. */
  outputLimitBytes?: number;
};

function failureReasonFor(status: VerificationStatus, processError: string | null, exitCode: number | null): string | null {
  if (status === "passed") return null;
  if (status === "failed") return `the check exited with code ${exitCode}.`;
  return processError ?? "the check could not be evaluated.";
}

/**
 * Runs one trusted check: `node` (the running Node binary) with the contract's structured arguments, in the
 * sandbox project directory, with no shell, a clean environment (plus CI=1 and NO_COLOR=1), bounded
 * stdout/stderr, a timeout, and whole-process-tree termination. Evidence files land beside the project copy.
 */
export async function runVerificationCheck(options: RunVerificationCheckOptions): Promise<VerificationCheckResult> {
  const { sandbox, check, checkClass, phase } = options;
  const limit = options.outputLimitBytes ?? VERIFICATION_OUTPUT_LIMIT_BYTES;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const measured = await runMeasuredCommand({
      commandId: `${checkClass}-${check.id}`,
      executable: process.execPath,
      args: check.args,
      cwd: sandbox.projectRoot,
      outDir: path.join(sandbox.evidenceRoot, "verification", phase),
      env: buildMinimalHostEnv(process.env, { CI: "1", NO_COLOR: "1" }),
      inheritParentEnv: false,
      resolveCommand: false,
      timeoutMs: check.timeoutMs,
      stdoutMaxBytes: limit,
      stderrMaxBytes: limit,
      terminateProcessTree: true
    });
    const timedOut = measured.timedOut === true;
    const outputLimit = measured.outputLimit ?? null;
    const status: VerificationStatus = timedOut
      ? "timeout"
      : outputLimit !== null || (measured.exitCode === null && !measured.ok)
        ? "error"
        : measured.exitCode === 0
          ? "passed"
          : "failed";
    const processError = status === "failed" || status === "passed" ? null : (measured.error ?? null);
    return {
      checkId: check.id,
      class: checkClass,
      executable: "node",
      args: [...check.args],
      startedAt: measured.startedAt,
      endedAt: measured.endedAt,
      durationMs: measured.durationMs,
      status,
      exitCode: measured.exitCode,
      stdoutPath: measured.stdoutPath,
      stderrPath: measured.stderrPath,
      timedOut,
      outputLimit,
      processError,
      failureReason: failureReasonFor(status, processError, measured.exitCode)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      checkId: check.id,
      class: checkClass,
      executable: "node",
      args: [...check.args],
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      status: "error",
      exitCode: null,
      stdoutPath: "",
      stderrPath: "",
      timedOut: false,
      outputLimit: null,
      processError: message,
      failureReason: message
    };
  }
}

/**
 * Runs every task check and then every regression check in contract order. It never short-circuits and
 * never derives a success flag: the caller receives separate raw evidence for each class.
 */
export async function runVerificationChecks(options: {
  sandbox: BenchmarkSandbox;
  task: Pick<AgentSuccessTaskV1, "taskChecks" | "regressionChecks">;
  phase: VerificationPhase;
  outputLimitBytes?: number;
}): Promise<VerificationPhaseResult> {
  const taskResults: VerificationCheckResult[] = [];
  for (const check of options.task.taskChecks) {
    taskResults.push(
      await runVerificationCheck({ sandbox: options.sandbox, check, checkClass: "task", phase: options.phase, outputLimitBytes: options.outputLimitBytes })
    );
  }
  const regressionResults: VerificationCheckResult[] = [];
  for (const check of options.task.regressionChecks) {
    regressionResults.push(
      await runVerificationCheck({ sandbox: options.sandbox, check, checkClass: "regression", phase: options.phase, outputLimitBytes: options.outputLimitBytes })
    );
  }
  return { phase: options.phase, taskResults, regressionResults };
}
