import { existsSync } from "node:fs";
import { cp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";

/**
 * The two primary v0.6.2 treatment identities, already frozen by the planned
 * plugin design. Batch 2 uses them only to name independent disposable
 * target copies; it never builds a treatment index or runs retrieval.
 */
export const INCREMENTAL_CHANGE_STALENESS_TREATMENT_IDS = ["stale-index", "full-refresh"] as const;
export type IncrementalChangeStalenessTreatmentId = (typeof INCREMENTAL_CHANGE_STALENESS_TREATMENT_IDS)[number];

/**
 * The four v0.6.3 internal lifecycle treatment identities in their fixed order
 * (never alphabetical). The released v0.6.2 public constant above is unchanged;
 * this set is used only by the internal v0.6.3 lifecycle.
 */
export const INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS = [
  "stale-index",
  "changed-files-refresh",
  "affected-neighborhood-refresh",
  "full-refresh"
] as const;
export type IncrementalChangeStalenessV2TreatmentId = (typeof INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS)[number];

/** Treatment ID and treatment intent are separate runtime evidence. */
export const INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_INTENTS = {
  "stale-index": "my-dev-kit-no-refresh",
  "changed-files-refresh": "my-dev-kit-changed-files-refresh",
  "affected-neighborhood-refresh": "my-dev-kit-affected-neighborhood-refresh",
  "full-refresh": "my-dev-kit-full-refresh"
} as const satisfies Record<IncrementalChangeStalenessV2TreatmentId, string>;
export type IncrementalChangeStalenessV2TreatmentIntent =
  (typeof INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_INTENTS)[IncrementalChangeStalenessV2TreatmentId];

/**
 * Default project-relative, gitignored runtime location for disposable
 * treatment targets. Callers may pass a different `runRoot`, but it must
 * still resolve inside `repoRoot` (see `createDisposableTreatmentTarget`).
 */
export const DEFAULT_INCREMENTAL_CHANGE_STALENESS_RUNTIME_ROOT_RELATIVE = ".my-dev-kit-context/runtime/incremental-change-staleness";

/** Defaults to the released v0.6.2 treatment set; the v0.6.3 lifecycle widens it to the four-treatment set. */
export type DisposableTreatmentTargetV1<T extends IncrementalChangeStalenessV2TreatmentId = IncrementalChangeStalenessTreatmentId> = {
  scenarioId: string;
  treatmentId: T;
  benchmarkProjectId: string;
  /** Absolute path to the immutable canonical benchmark project this copy was created from. */
  canonicalProjectRoot: string;
  /** Absolute path to this disposable copy's own project root. */
  targetRoot: string;
};

export type CreateDisposableTreatmentTargetOptions<T extends IncrementalChangeStalenessV2TreatmentId = IncrementalChangeStalenessTreatmentId> = {
  /** Repository root; both `runRoot` and the canonical project root must resolve inside it. */
  repoRoot: string;
  /** Absolute runtime root the caller owns (e.g. a temp dir in tests, or the default runtime root in normal use). */
  runRoot: string;
  scenarioId: string;
  treatmentId: T;
  benchmarkProjectId: string;
  /** Canonical benchmark project root, relative to `repoRoot` (e.g. "benchmarks/projects/task-analytics-large-mixed"). */
  canonicalProjectRootRelative: string;
};

function assertSafeRuntimeBoundary(repoRoot: string, runRoot: string): string {
  // runRoot itself must live inside the repository; this also rejects a
  // caller-supplied runRoot that points outside the my-dev-kit-lab worktree.
  return resolveWithinRoot(repoRoot, path.resolve(runRoot));
}

function assertDisposableRootDoesNotOverlapCanonical(targetRoot: string, canonicalProjectRoot: string): void {
  const relativeFromCanonical = path.relative(canonicalProjectRoot, targetRoot);
  const targetIsInsideCanonical = relativeFromCanonical !== "" && !relativeFromCanonical.startsWith("..") && !path.isAbsolute(relativeFromCanonical);
  const relativeFromTarget = path.relative(targetRoot, canonicalProjectRoot);
  const canonicalIsInsideTarget = relativeFromTarget !== "" && !relativeFromTarget.startsWith("..") && !path.isAbsolute(relativeFromTarget);
  if (targetRoot === canonicalProjectRoot || targetIsInsideCanonical || canonicalIsInsideTarget) {
    throw new Error(`Disposable treatment target root ${targetRoot} unsafely overlaps the canonical benchmark project root ${canonicalProjectRoot}.`);
  }
}

/**
 * Creates one independent disposable copy of a canonical benchmark project
 * for one scenario/treatment pair. Always copies the whole benchmark
 * project (not just the changed file), since later index/retrieval
 * execution requires a coherent project. Never overwrites an existing
 * destination and never allows the destination to overlap the canonical
 * project tree.
 */
export async function createDisposableTreatmentTarget<T extends IncrementalChangeStalenessV2TreatmentId = IncrementalChangeStalenessTreatmentId>(
  options: CreateDisposableTreatmentTargetOptions<T>
): Promise<DisposableTreatmentTargetV1<T>> {
  const { repoRoot, scenarioId, treatmentId, benchmarkProjectId, canonicalProjectRootRelative } = options;

  if (!(INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS as readonly string[]).includes(treatmentId)) {
    throw new Error(`Unknown treatment id: ${treatmentId}. Expected one of ${INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS.join(", ")}.`);
  }
  if (typeof scenarioId !== "string" || scenarioId.length === 0) {
    throw new Error("scenarioId must be a nonempty string.");
  }

  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedRunRoot = assertSafeRuntimeBoundary(resolvedRepoRoot, options.runRoot);
  const canonicalProjectRoot = resolveWithinRoot(resolvedRepoRoot, canonicalProjectRootRelative);
  const targetRoot = resolveWithinRoot(resolvedRunRoot, path.join(scenarioId, treatmentId));

  assertDisposableRootDoesNotOverlapCanonical(targetRoot, canonicalProjectRoot);

  if (!existsSync(canonicalProjectRoot)) {
    throw new Error(`Canonical benchmark project root does not exist: ${canonicalProjectRoot}.`);
  }
  if (existsSync(targetRoot)) {
    throw new Error(`Disposable treatment target already exists; refusing to overwrite: ${targetRoot}.`);
  }

  await cp(canonicalProjectRoot, targetRoot, { recursive: true, errorOnExist: true, force: false });

  return {
    scenarioId,
    treatmentId,
    benchmarkProjectId,
    canonicalProjectRoot,
    targetRoot
  };
}

/**
 * Removes one disposable treatment target directory. Only ever deletes a
 * path that resolves inside the caller-owned `runRoot`; refuses to touch
 * anything else, including a canonical benchmark project. Idempotent: a
 * missing target is a successful no-op.
 */
export async function removeDisposableTreatmentTarget(target: Pick<DisposableTreatmentTargetV1, "targetRoot">, repoRoot: string, runRoot: string): Promise<void> {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedRunRoot = assertSafeRuntimeBoundary(resolvedRepoRoot, runRoot);
  // Re-derive containment from the caller-owned root rather than trusting the descriptor blindly.
  const containedTargetRoot = resolveWithinRoot(resolvedRunRoot, path.resolve(target.targetRoot));
  await rm(containedTargetRoot, { recursive: true, force: true });
}

/**
 * Removes the entire caller-owned runtime root (both treatment copies for
 * every scenario created under it). Refuses to operate unless `runRoot`
 * resolves inside `repoRoot`, and never touches anything outside it.
 */
export async function removeIncrementalChangeStalenessRuntimeRoot(repoRoot: string, runRoot: string): Promise<void> {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedRunRoot = assertSafeRuntimeBoundary(resolvedRepoRoot, runRoot);
  await rm(resolvedRunRoot, { recursive: true, force: true });
}

/**
 * Resolves a target-relative path inside a disposable treatment target,
 * rejecting both textual path traversal and symlink escape: the resolved
 * real path (once the file exists) must still be contained by the real
 * path of the treatment root.
 */
export async function resolveWithinDisposableTarget(target: Pick<DisposableTreatmentTargetV1, "targetRoot">, relativePath: string): Promise<string> {
  const resolved = resolveWithinRoot(target.targetRoot, relativePath);
  if (!existsSync(resolved)) {
    return resolved;
  }
  const [realResolved, realRoot] = await Promise.all([realpath(resolved), realpath(target.targetRoot)]);
  const relativeFromRoot = path.relative(realRoot, realResolved);
  if (relativeFromRoot === ".." || relativeFromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeFromRoot)) {
    throw new Error(`Resolved path escapes the disposable treatment root via a symbolic link: ${relativePath}`);
  }
  return resolved;
}
