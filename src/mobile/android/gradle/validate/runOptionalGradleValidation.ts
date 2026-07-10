import fs from "node:fs";
import path from "node:path";
import type { AndroidDetectionResult } from "../../detection.js";
import type { AndroidCheckResult } from "../../validation/checkResult.js";
import { GRADLE_OPERATIONS, type GradleOperationId } from "./operations.js";
import { buildGradleCommandPlan } from "./planner.js";
import { createRealGradleCommandExecutor, type GradleCommandExecutor } from "./executor.js";
import { buildGradleOperationCheckResult } from "./operationCheckResult.js";
import { buildTargetMutationReport, captureTargetSnapshot } from "./targetMutation.js";
import { isGradleTaskAvailable, parseGradleTaskNames } from "./taskListParser.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — optional Gradle validation orchestrator (agents.txt Batch
// 4 sections 7.17, 7.20, 7.24, 7.26).
//
// Static metadata collection (readAndroidGradleMetadata.ts) never calls this
// module. This orchestrator only ever runs a Gradle command when
// `enabled: true` is passed explicitly — every other code path returns a
// "not-run" result without touching the filesystem beyond a target
// git-status snapshot. Task-gated operations (assemble/test/lint) are
// skipped, not attempted, unless task availability was already discovered
// via the "tasks" operation earlier in the same call (or the caller opts in
// via allowWithoutTaskDiscovery).
// ---------------------------------------------------------------------------

const TASK_GATED_OPERATIONS = new Set<GradleOperationId>(["assemble-debug", "unit-test-debug", "lint-debug"]);

export type RunOptionalGradleValidationOptions = {
  enabled: boolean;
  targetRoot: string;
  detection: AndroidDetectionResult;
  operationIds: GradleOperationId[];
  executor?: GradleCommandExecutor;
  allowWithoutTaskDiscovery?: boolean;
  platform?: NodeJS.Platform;
};

function notRunResult(operationId: GradleOperationId): AndroidCheckResult {
  return {
    id: `android-gradle-${operationId}`,
    category: "android-gradle",
    title: `Gradle operation: ${operationId}`,
    status: "not-run",
    requirementLevel: "optional",
    ran: false,
    skipped: false,
    evidence: [],
    findings: [],
    warnings: [],
    errors: [],
    sourcePaths: [],
    confidence: "unknown",
    environmentRequirements: [],
  };
}

function skippedResult(operationId: GradleOperationId, reason: string, missingCapability: string): AndroidCheckResult {
  return {
    id: `android-gradle-${operationId}`,
    category: "android-gradle",
    title: `Gradle operation: ${operationId}`,
    status: "skipped",
    requirementLevel: "optional",
    ran: false,
    skipped: true,
    skipInfo: {
      checkId: `android-gradle-${operationId}`,
      reason,
      requirementLevel: "optional",
      missingCapability,
      verdictImpact: "optional Gradle validation evidence is unavailable for this operation",
      recommendedNextAction: "Re-run with the required precondition satisfied, or accept reduced evidence.",
    },
    evidence: [],
    findings: [],
    warnings: [],
    errors: [],
    sourcePaths: [],
    confidence: "unknown",
    environmentRequirements: [],
  };
}

function hasGitDirectory(targetRoot: string): boolean {
  try {
    return fs.existsSync(path.join(targetRoot, ".git"));
  } catch {
    return false;
  }
}

export async function runOptionalGradleValidation(options: RunOptionalGradleValidationOptions): Promise<AndroidCheckResult[]> {
  if (!options.enabled) {
    return options.operationIds.map((id) => notRunResult(id));
  }

  const executor = options.executor ?? createRealGradleCommandExecutor();
  const platform = options.platform ?? process.platform;
  const resolvedRoot = path.resolve(options.targetRoot);
  const hasGit = hasGitDirectory(resolvedRoot);

  let discoveredTaskNames: Set<string> | undefined;
  const results: AndroidCheckResult[] = [];

  for (const operationId of options.operationIds) {
    if (TASK_GATED_OPERATIONS.has(operationId)) {
      if (!discoveredTaskNames && !options.allowWithoutTaskDiscovery) {
        results.push(
          skippedResult(
            operationId,
            "Task availability was not discovered (the 'tasks' operation did not run successfully first) and allowWithoutTaskDiscovery was not set.",
            "gradle-task-discovery"
          )
        );
        continue;
      }
      const gradleTaskName = GRADLE_OPERATIONS[operationId].gradleTaskName!;
      if (discoveredTaskNames && !isGradleTaskAvailable(discoveredTaskNames, gradleTaskName)) {
        results.push(skippedResult(operationId, `Task "${gradleTaskName}" is not available in this project.`, "gradle-task"));
        continue;
      }
    }

    const plan = buildGradleCommandPlan(operationId, resolvedRoot, options.detection, platform);
    if (plan.rejected) {
      results.push(skippedResult(operationId, plan.reason, "gradle-wrapper"));
      continue;
    }

    const before = captureTargetSnapshot(resolvedRoot, hasGit);
    const commandResult = await executor(plan);
    const after = captureTargetSnapshot(resolvedRoot, hasGit);
    const mutation = buildTargetMutationReport(before, after);

    const checkResult = buildGradleOperationCheckResult(plan, commandResult, mutation);
    results.push(checkResult);

    if (operationId === "tasks" && checkResult.status === "passed") {
      discoveredTaskNames = parseGradleTaskNames(commandResult.stdout);
    }
  }

  return results;
}
