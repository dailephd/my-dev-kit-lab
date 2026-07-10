// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — allowlisted optional Gradle validation operations
// (agents.txt Batch 4 section 7.17).
//
// This is the ONLY place operation-to-argument mappings are defined. The
// planner (planner.ts) rejects any operation id not in ALLOWLISTED_OPERATION_IDS
// before a command is ever constructed — arbitrary task strings are never
// accepted from a caller.
// ---------------------------------------------------------------------------

export const ALLOWLISTED_OPERATION_IDS = ["wrapper-version", "tasks", "assemble-debug", "unit-test-debug", "lint-debug"] as const;
export type GradleOperationId = (typeof ALLOWLISTED_OPERATION_IDS)[number];

export function isAllowlistedOperationId(value: string): value is GradleOperationId {
  return (ALLOWLISTED_OPERATION_IDS as readonly string[]).includes(value);
}

export type GradleOperationDefinition = {
  id: GradleOperationId;
  gradleTaskName?: string;
  args: string[];
  timeoutMs: number;
  mayCreateBuildOutputs: boolean;
  description: string;
};

// Conservative, bounded timeouts (agents.txt section 7.22). No retries, no
// unbounded execution — a timed-out operation is terminated and reported
// inconclusive/error, never passed.
const SHORT_TIMEOUT_MS = 30_000;
const MODERATE_TIMEOUT_MS = 120_000;
const LONG_TIMEOUT_MS = 600_000;

// Safety flags applied to every operation: --no-daemon avoids leaving a
// background Gradle daemon running after this process exits, --console=plain
// keeps output parseable, and --offline prevents this batch from
// intentionally triggering network access (agents.txt section 7.18) — the
// tradeoff is that operations needing uncached dependencies will fail or
// report inconclusive rather than silently downloading them.
const SAFETY_FLAGS = ["--no-daemon", "--console=plain"];
const OFFLINE_SAFETY_FLAGS = [...SAFETY_FLAGS, "--offline"];

export const GRADLE_OPERATIONS: Record<GradleOperationId, GradleOperationDefinition> = {
  "wrapper-version": {
    id: "wrapper-version",
    args: ["--version"],
    timeoutMs: SHORT_TIMEOUT_MS,
    mayCreateBuildOutputs: true, // Gradle creates/updates .gradle/ on first invocation.
    description: "Reports the Gradle version the wrapper would use, without building anything.",
  },
  tasks: {
    id: "tasks",
    gradleTaskName: "tasks",
    args: ["tasks", "--all", ...OFFLINE_SAFETY_FLAGS],
    timeoutMs: MODERATE_TIMEOUT_MS,
    mayCreateBuildOutputs: true,
    description: "Lists available Gradle tasks so later operations can be skipped safely when unavailable.",
  },
  "assemble-debug": {
    id: "assemble-debug",
    gradleTaskName: "assembleDebug",
    args: ["assembleDebug", ...OFFLINE_SAFETY_FLAGS],
    timeoutMs: LONG_TIMEOUT_MS,
    mayCreateBuildOutputs: true,
    description: "Assembles the debug variant (no signing, no release build, no publishing).",
  },
  "unit-test-debug": {
    id: "unit-test-debug",
    gradleTaskName: "testDebugUnitTest",
    args: ["testDebugUnitTest", ...OFFLINE_SAFETY_FLAGS],
    timeoutMs: LONG_TIMEOUT_MS,
    mayCreateBuildOutputs: true,
    description: "Runs local (non-instrumented) debug unit tests.",
  },
  "lint-debug": {
    id: "lint-debug",
    gradleTaskName: "lintDebug",
    args: ["lintDebug", ...OFFLINE_SAFETY_FLAGS],
    timeoutMs: LONG_TIMEOUT_MS,
    mayCreateBuildOutputs: true,
    description: "Runs Android Lint for the debug variant. Lint output is not parsed into security findings in this batch.",
  },
};
