import type { CommandExecutionResult } from "../../../../securityValidation/types.js";
import { runSecurityCommand } from "../../../../securityValidation/commandRunner.js";
import type { GradleCommandPlan } from "./planner.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — Gradle command execution (agents.txt Batch 4 section
// 7.21).
//
// Reuses the existing bounded, argument-array (no shell interpolation)
// process runner from src/securityValidation/commandRunner.ts rather than
// creating a second process owner — its CommandExecutionResult return type
// is exactly what AndroidCheckResult.command already expects (Batch 1).
// GradleCommandExecutor is injectable so tests never need a real Gradle
// wrapper, Java, or Android SDK (agents.txt section 12.9).
// ---------------------------------------------------------------------------

export type GradleCommandExecutor = (plan: GradleCommandPlan) => Promise<CommandExecutionResult>;

export function createRealGradleCommandExecutor(): GradleCommandExecutor {
  return (plan) =>
    runSecurityCommand({
      command: plan.wrapperExecutablePath,
      args: plan.args,
      cwd: plan.cwd,
      timeoutMs: plan.timeoutMs,
    });
}
