import fs from "node:fs";
import path from "node:path";
import { resolveWithinRoot } from "../../../../core/pathSafety.js";
import type { AndroidDetectionResult } from "../../detection.js";
import { GRADLE_OPERATIONS, isAllowlistedOperationId, type GradleOperationId } from "./operations.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — deterministic Gradle command-plan builder
// (agents.txt Batch 4 section 7.19).
//
// The planner is the single choke point between a caller-requested operation
// id and an actual command: it rejects unknown ids, wrapper paths outside
// the target, and target layouts with no usable wrapper script for the
// current platform. It never accepts or forwards arbitrary task strings —
// arguments come only from operations.ts's fixed allowlist.
// ---------------------------------------------------------------------------

export type GradleCommandPlan = {
  rejected: false;
  operationId: GradleOperationId;
  wrapperExecutablePath: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  mayCreateBuildOutputs: boolean;
  expectedGeneratedPaths: string[];
  environmentLimitations: string[];
};

export type GradleCommandPlanRejection = { rejected: true; reason: string };
export type GradleCommandPlanResult = GradleCommandPlan | GradleCommandPlanRejection;

function wrapperScriptNameForPlatform(platform: NodeJS.Platform): string {
  return platform === "win32" ? "gradlew.bat" : "gradlew";
}

export function buildGradleCommandPlan(
  operationId: string,
  targetRoot: string,
  detection: AndroidDetectionResult,
  platform: NodeJS.Platform = process.platform
): GradleCommandPlanResult {
  if (!isAllowlistedOperationId(operationId)) {
    return { rejected: true, reason: `Unknown or unsupported Gradle operation id: "${operationId}". Only allowlisted operations may be planned.` };
  }

  const resolvedRoot = path.resolve(targetRoot);
  const wrapperScriptName = wrapperScriptNameForPlatform(platform);

  let wrapperExecutablePath: string;
  try {
    wrapperExecutablePath = resolveWithinRoot(resolvedRoot, wrapperScriptName);
  } catch {
    return { rejected: true, reason: `Wrapper path escapes the target root: ${wrapperScriptName}` };
  }

  if (!fs.existsSync(wrapperExecutablePath)) {
    return {
      rejected: true,
      reason: `No ${wrapperScriptName} was found at the target root. Optional Gradle validation requires a Gradle wrapper checked into the target for this platform.`,
    };
  }

  const definition = GRADLE_OPERATIONS[operationId];
  const expectedGeneratedPaths = definition.mayCreateBuildOutputs
    ? [".gradle/", "build/", ...detection.modules.map((m) => `${m.path}/build/`)]
    : [];

  const environmentLimitations = [
    "Requires a local or downloadable Gradle distribution matching the wrapper version — this planner does not verify one is available.",
    "Requires a Java runtime on PATH — this planner does not verify Java availability.",
  ];
  if (definition.args.includes("--offline")) {
    environmentLimitations.push("Runs with --offline; tasks needing uncached dependencies will fail or report inconclusive rather than downloading them.");
  }

  return {
    rejected: false,
    operationId,
    wrapperExecutablePath,
    args: definition.args,
    cwd: resolvedRoot,
    timeoutMs: definition.timeoutMs,
    mayCreateBuildOutputs: definition.mayCreateBuildOutputs,
    expectedGeneratedPaths,
    environmentLimitations,
  };
}
