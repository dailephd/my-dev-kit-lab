import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot, verifyDirectoryWithinRoot } from "../../../core/pathSafety.js";

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
 * Workspace-relative runtime location; never relative to package resources.
 */
export const DEFAULT_INCREMENTAL_CHANGE_STALENESS_RUNTIME_ROOT_RELATIVE = "runtime/incremental-change-staleness";

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
  /** Immutable resource root owning canonical benchmarks. */
  repoRoot: string;
  /** Separate caller-owned boundary. Legacy direct helpers retain repository containment when omitted;
   * both production lifecycles explicitly provide their run-owned root. */
  runtimeBoundary?: string;
  /** Absolute runtime root the caller owns (e.g. a temp dir in tests, or the default runtime root in normal use). */
  runRoot: string;
  scenarioId: string;
  treatmentId: T;
  benchmarkProjectId: string;
  /** Canonical benchmark project root, relative to `repoRoot` (e.g. "benchmarks/projects/task-analytics-large-mixed"). */
  canonicalProjectRootRelative: string;
};

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** A checkout may use its established generated directories; an installed package may not. */
export function assertIncrementalRuntimeLocation(sourceRoot: string, directory: string): void {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(directory);
  if (isWithin(source, destination)) {
    const first = path.relative(source, destination).split(path.sep)[0];
    const installed = source.split(path.sep).some((part) => part.toLowerCase() === "node_modules");
    if (installed || !existsSync(path.join(source, ".git")) ||
        ![".my-dev-kit-context", ".my-dev-kit-workflow", "lab-output", "reports", "tmp", "temp"].includes(first)) {
      throw new Error("Runtime workspace unsafely overlaps immutable package or canonical benchmark resources.");
    }
  } else if (isWithin(destination, source)) {
    throw new Error("Runtime workspace unsafely overlaps immutable package resources.");
  }
}

export function assertAbsoluteRuntimePath(value: unknown): asserts value is string {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0") || path.resolve(value) !== path.normalize(value)) {
    throw new Error("Incremental runtime requires an absolute writableWorkspaceRoot.");
  }
}

/** Verify the complete existing ancestor chain, including ancestors of the authorized boundary. */
export async function verifyRuntimeDirectory(directory: string): Promise<string> {
  assertAbsoluteRuntimePath(directory);
  return verifyDirectoryWithinRoot(path.parse(directory).root, directory);
}

/** Keep the complete native file ID: Windows file IDs can exceed Number's safe integer range. */
export type RuntimeDirectoryIdentity = { root: string; dev: bigint; ino: bigint };
function usableDirectoryIdentity(identity: RuntimeDirectoryIdentity): boolean {
  return typeof identity.dev === "bigint" && identity.dev > 0n &&
    typeof identity.ino === "bigint" && identity.ino > 0n;
}
export async function captureRuntimeDirectoryIdentity(directory: string): Promise<RuntimeDirectoryIdentity> {
  const root = await verifyRuntimeDirectory(directory);
  const info = await lstat(directory, { bigint: true });
  const identity = { root, dev: info.dev, ino: info.ino };
  if (!info.isDirectory() || info.isSymbolicLink() || !usableDirectoryIdentity(identity)) {
    throw new Error("Unavailable or ambiguous runtime directory identity.");
  }
  return identity;
}
export function matchesRuntimeDirectoryIdentity(expected: RuntimeDirectoryIdentity, actual: RuntimeDirectoryIdentity): boolean {
  return usableDirectoryIdentity(expected) && usableDirectoryIdentity(actual) &&
    expected.root === actual.root && expected.dev === actual.dev && expected.ino === actual.ino;
}

/** Create one component at a time, checking before descending; never mkdir through a junction. */
export async function ensureRuntimeDirectory(boundary: string, directory: string): Promise<string> {
  assertAbsoluteRuntimePath(boundary);
  const destination = resolveWithinRoot(boundary, directory);
  let current = path.parse(destination).root;
  for (const segment of path.relative(current, destination).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { await lstat(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try { await mkdir(current); }
      catch (createError) { if ((createError as NodeJS.ErrnoException).code !== "EEXIST") throw createError; }
    }
    await verifyRuntimeDirectory(current);
  }
  return verifyRuntimeDirectory(destination);
}

function assertSafeRuntimeBoundary(repoRoot: string, runRoot: string, runtimeBoundary = repoRoot): string {
  assertAbsoluteRuntimePath(runtimeBoundary);
  assertAbsoluteRuntimePath(runRoot);
  const resolved = resolveWithinRoot(runtimeBoundary, runRoot);
  assertIncrementalRuntimeLocation(repoRoot, resolved);
  return resolved;
}

function assertDisposableRootDoesNotOverlapCanonical(targetRoot: string, canonicalProjectRoot: string): void {
  if (isWithin(canonicalProjectRoot, targetRoot) || isWithin(targetRoot, canonicalProjectRoot)) {
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
  const resolvedRunRoot = assertSafeRuntimeBoundary(resolvedRepoRoot, options.runRoot, options.runtimeBoundary);
  const canonicalProjectRoot = resolveWithinRoot(resolvedRepoRoot, canonicalProjectRootRelative);
  const expectedCanonical = resolveWithinRoot(path.join(resolvedRepoRoot, "benchmarks", "projects"), benchmarkProjectId);
  if (canonicalProjectRoot !== expectedCanonical || path.basename(expectedCanonical) !== benchmarkProjectId) {
    throw new Error("Canonical project must be the approved bundled benchmark project, not an imported path.");
  }
  const targetRoot = resolveWithinRoot(resolvedRunRoot, path.join(scenarioId, treatmentId));

  assertDisposableRootDoesNotOverlapCanonical(targetRoot, canonicalProjectRoot);

  if (!existsSync(canonicalProjectRoot)) {
    throw new Error(`Canonical benchmark project root does not exist: ${canonicalProjectRoot}.`);
  }
  if (existsSync(targetRoot)) {
    throw new Error(`Disposable treatment target already exists; refusing to overwrite: ${targetRoot}.`);
  }

  await verifyRuntimeDirectory(canonicalProjectRoot);
  await assertCopyTree(canonicalProjectRoot);
  await ensureRuntimeDirectory(options.runtimeBoundary ?? resolvedRepoRoot, path.dirname(targetRoot));
  await cp(canonicalProjectRoot, targetRoot, { recursive: true, errorOnExist: true, force: false, dereference: false });

  const target = {
    scenarioId,
    treatmentId,
    benchmarkProjectId,
    canonicalProjectRoot,
    targetRoot
  };
  const boundary = options.runtimeBoundary ?? resolvedRepoRoot;
  targetIdentities.set(target, { ...await captureRuntimeDirectoryIdentity(targetRoot),
    boundary: await captureRuntimeDirectoryIdentity(boundary) });
  return target;
}

type TargetDirectoryIdentity = RuntimeDirectoryIdentity;
const targetIdentities = new WeakMap<object, TargetDirectoryIdentity & { boundary: TargetDirectoryIdentity }>();

async function assertCopyTree(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    const info = await lstat(filename);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error(`Unsafe canonical source entry: ${filename}`);
    if (info.isDirectory()) await assertCopyTree(filename);
  }
}

export async function verifyDisposableTreatmentTarget(target: Pick<DisposableTreatmentTargetV1, "targetRoot">): Promise<void> {
  const identity = targetIdentities.get(target);
  const current = await captureRuntimeDirectoryIdentity(target.targetRoot);
  if (!identity || !matchesRuntimeDirectoryIdentity(identity, current)) {
    throw new Error("Unverified disposable target identity.");
  }
  if (!matchesRuntimeDirectoryIdentity(identity.boundary, await captureRuntimeDirectoryIdentity(identity.boundary.root))) {
    throw new Error("Unverified disposable runtime boundary identity.");
  }
}

/**
 * Removes one disposable treatment target directory. Only ever deletes a
 * path that resolves inside the caller-owned `runRoot`; refuses to touch
 * anything else, including a canonical benchmark project. Idempotent: a
 * missing target is a successful no-op.
 */
export async function removeDisposableTreatmentTarget(target: Pick<DisposableTreatmentTargetV1, "targetRoot">, repoRoot: string, runRoot: string, runtimeBoundary = repoRoot): Promise<void> {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedRunRoot = assertSafeRuntimeBoundary(resolvedRepoRoot, runRoot, runtimeBoundary);
  // Re-derive containment from the caller-owned root rather than trusting the descriptor blindly.
  const containedTargetRoot = resolveWithinRoot(resolvedRunRoot, path.resolve(target.targetRoot));
  if (containedTargetRoot === resolvedRunRoot) throw new Error("Refusing to remove shared runtime boundary.");
  await verifyRuntimeDirectory(path.dirname(containedTargetRoot));
  try { await lstat(containedTargetRoot); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  await verifyDisposableTreatmentTarget(target);
  await rm(containedTargetRoot, { recursive: true, force: true });
  targetIdentities.delete(target);
}

/**
 * Removes the entire caller-owned runtime root (both treatment copies for
 * every scenario created under it). Requires a distinct contained child of
 * the caller's runtime boundary, disjoint from immutable source resources.
 */
export async function removeIncrementalChangeStalenessRuntimeRoot(runtimeBoundary: string, runRoot: string, sourceRoot = runtimeBoundary): Promise<void> {
  const resolvedRunRoot = assertSafeRuntimeBoundary(sourceRoot, runRoot, runtimeBoundary);
  if (resolvedRunRoot === path.resolve(runtimeBoundary)) throw new Error("Refusing to remove shared runtime boundary.");
  try { await verifyRuntimeDirectory(resolvedRunRoot); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
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
  await verifyDisposableTreatmentTarget(target);
  await verifyRuntimeDirectory(path.dirname(resolved));
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
