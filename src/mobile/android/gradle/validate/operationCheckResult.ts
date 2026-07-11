import type { CommandExecutionResult } from "../../../../securityValidation/types.js";
import type { MobileConfidence } from "../../../types.js";
import type { AndroidCheckResult, AndroidCheckStatus } from "../../validation/checkResult.js";
import type { GradleCommandPlan } from "./planner.js";
import type { TargetMutationReport } from "./targetMutation.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — per-operation Gradle validation check-result construction
// (agents.txt Batch 4 section 7.26).
//
// Status semantics differ slightly by operation:
//   - wrapper-version: nonzero/spawn-failure -> "error" (this is the
//     simplest possible invocation; a failure here is an orchestration
//     problem, not a build/environment nuance).
//   - tasks: nonzero/spawn-failure -> "inconclusive" (configuration or
//     environment prevented task discovery, not a security-relevant
//     failure).
//   - assemble-debug / unit-test-debug / lint-debug: spawn-failure ->
//     "inconclusive" (environment incomplete); nonzero exit with a real
//     process result -> "failed" (a genuine build/test/lint failure is
//     validation evidence, never a fabricated SecurityFinding — section
//     7.27).
// A timed-out operation is always "inconclusive", never "passed" or
// silently "error" (section 7.22).
// ---------------------------------------------------------------------------

const MAX_OUTPUT_SUMMARY_LENGTH = 4000;

function boundedSummary(text: string): { summary: string; truncated: boolean } {
  if (text.length <= MAX_OUTPUT_SUMMARY_LENGTH) return { summary: text, truncated: false };
  return { summary: text.slice(0, MAX_OUTPUT_SUMMARY_LENGTH), truncated: true };
}

function statusForResult(operationId: GradleCommandPlan["operationId"], result: CommandExecutionResult): AndroidCheckStatus {
  if (result.timedOut) return "inconclusive";
  if (result.exitCode === null) {
    return operationId === "wrapper-version" ? "error" : "inconclusive";
  }
  if (result.exitCode === 0) return "passed";
  if (operationId === "wrapper-version") return "error";
  if (operationId === "tasks") return "inconclusive";
  return "failed";
}

function confidenceForStatus(status: AndroidCheckStatus): MobileConfidence {
  switch (status) {
    case "passed":
    case "failed":
      return "high";
    case "inconclusive":
      return "medium";
    default:
      return "unknown";
  }
}

export function buildGradleOperationCheckResult(
  plan: GradleCommandPlan,
  result: CommandExecutionResult,
  mutation: TargetMutationReport
): AndroidCheckResult {
  const status = statusForResult(plan.operationId, result);
  const confidence = confidenceForStatus(status);
  const stdoutBound = boundedSummary(result.stdout);
  const stderrBound = boundedSummary(result.stderr);

  const warnings: string[] = [];
  if (result.timedOut) warnings.push(`Operation timed out after ${plan.timeoutMs}ms.`);
  if (result.exitCode === null && !result.timedOut) warnings.push("Command could not be spawned or resolved (see stderr evidence).");
  if (stdoutBound.truncated) warnings.push("stdout was truncated for this result.");
  if (stderrBound.truncated) warnings.push("stderr was truncated for this result.");
  if (!mutation.comparable) warnings.push(`Target mutation evidence unavailable: ${mutation.reason ?? "unknown reason"}`);
  if (mutation.unexpectedChanges.length > 0) {
    warnings.push(`Unexpected target change(s) observed after this operation: ${mutation.unexpectedChanges.join(", ")}`);
  }

  const boundedCommand: CommandExecutionResult = {
    ...result,
    stdout: stdoutBound.summary,
    stderr: stderrBound.summary,
  };

  return {
    id: `android-gradle-${plan.operationId}`,
    category: "android-gradle",
    title: `Gradle operation: ${plan.operationId}`,
    status,
    requirementLevel: "optional",
    ran: true,
    skipped: false,
    evidence: [
      `exitCode=${result.exitCode ?? "null"}`,
      `durationMs=${result.durationMs}`,
      `expectedGeneratedPaths=${plan.expectedGeneratedPaths.join(",") || "(none)"}`,
      ...mutation.expectedGeneratedChanges.map((p) => `generatedOutput=${p}`),
    ],
    findings: [],
    warnings,
    errors: result.exitCode === null && !result.timedOut ? [stderrBound.summary || "Command could not be spawned or resolved."] : [],
    durationMs: result.durationMs,
    command: boundedCommand,
    sourcePaths: [plan.wrapperExecutablePath],
    confidence,
    environmentRequirements: plan.environmentLimitations,
    targetModificationObserved: mutation.comparable ? mutation.unexpectedChanges.length > 0 : undefined,
  };
}
