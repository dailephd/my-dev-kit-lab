import { constants as fsConstants } from "node:fs";
import { copyFile, lstat, mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../core/pathSafety.js";
import { BenchmarkSandboxError } from "./errors.js";
import { excerptGitFailure, runSandboxGit, type GitExecutionTarget, type GitResult } from "./gitExecutor.js";
import {
  BENCHMARK_SANDBOX_EXCLUDED_NAMES,
  isSameOrInside,
  resolvePhysicalPath,
  SANDBOX_ID_PATTERN
} from "./pathPolicy.js";
import { digestTreeSnapshot, scanProjectTree, snapshotProjectTree } from "./treeSnapshot.js";
import {
  BENCHMARK_SANDBOX_BASELINE_BRANCH,
  BENCHMARK_SANDBOX_OWNER_MARKER_FILE,
  BENCHMARK_SANDBOX_SCHEMA_VERSION,
  type BenchmarkSandbox,
  type BenchmarkSandboxOwnerMarker,
  type CreateBenchmarkSandboxOptions
} from "./types.js";

const BASELINE_COMMIT_MESSAGE = "benchmark sandbox baseline";
/** Fixed dates make the baseline commit id a pure function of the copied content, so repeated runs agree. */
const BASELINE_COMMIT_DATE_ENV = Object.freeze({ GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" });

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function resolveCanonicalProjectRoot(canonicalProjectRoot: string): Promise<string> {
  let stats;
  try {
    stats = await lstat(path.resolve(canonicalProjectRoot));
  } catch {
    throw new BenchmarkSandboxError("CANONICAL_ROOT_INVALID", "the canonical project root does not exist.");
  }
  if (stats.isSymbolicLink() || !(await stat(path.resolve(canonicalProjectRoot))).isDirectory()) {
    throw new BenchmarkSandboxError("CANONICAL_ROOT_INVALID", "the canonical project root must be a real directory.");
  }
  return realpath(path.resolve(canonicalProjectRoot));
}

async function mustGit(
  target: GitExecutionTarget,
  args: readonly string[],
  label: string,
  env?: Readonly<Record<string, string>>
): Promise<GitResult> {
  const result = await runSandboxGit(target, args, { label, env });
  if (result.unavailable) {
    throw new BenchmarkSandboxError("GIT_UNAVAILABLE", "the git executable is not available.");
  }
  if (!result.ok) {
    throw new BenchmarkSandboxError("GIT_FAILED", `git ${args[0] ?? ""} failed: ${excerptGitFailure(result)}`);
  }
  return result;
}

/**
 * Creates one independent, Git-backed disposable copy of a controlled benchmark project inside the
 * caller-supplied runtime root. Nothing is ever written to the canonical project, and the runtime root is
 * never defaulted. Order: validate -> scan source (reject links) -> copy -> manifest -> fresh Git baseline.
 * Any failure after the sandbox directory exists removes that (owned) directory before rethrowing.
 */
export async function createBenchmarkSandbox(options: CreateBenchmarkSandboxOptions): Promise<BenchmarkSandbox> {
  if (!SANDBOX_ID_PATTERN.test(options.sandboxId)) {
    throw new BenchmarkSandboxError("INVALID_SANDBOX_ID", `sandbox id must match ${SANDBOX_ID_PATTERN.source}.`);
  }
  const canonicalProjectRoot = await resolveCanonicalProjectRoot(options.canonicalProjectRoot);
  const runtimeRoot = path.resolve(options.runtimeRoot);
  const physicalRuntimeRoot = await resolvePhysicalPath(runtimeRoot);
  if (isSameOrInside(canonicalProjectRoot, physicalRuntimeRoot) || isSameOrInside(physicalRuntimeRoot, canonicalProjectRoot)) {
    throw new BenchmarkSandboxError("RUNTIME_OVERLAP", "the runtime root and the canonical project must not overlap.");
  }
  const sandboxRoot = resolveWithinRoot(runtimeRoot, options.sandboxId);
  if (await pathExists(sandboxRoot)) {
    throw new BenchmarkSandboxError("SANDBOX_EXISTS", "refusing to overwrite an existing sandbox directory.");
  }

  // Reject links and unsupported entries before anything is created under the runtime root.
  const sourceFiles = await scanProjectTree(canonicalProjectRoot, BENCHMARK_SANDBOX_EXCLUDED_NAMES);
  if (sourceFiles.length === 0) {
    throw new BenchmarkSandboxError("EMPTY_PROJECT", "the canonical project has no copyable files.");
  }

  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(sandboxRoot);
  try {
    const marker: BenchmarkSandboxOwnerMarker = {
      schemaVersion: BENCHMARK_SANDBOX_SCHEMA_VERSION,
      sandboxId: options.sandboxId,
      runtimeRoot,
      canonicalProjectRoot
    };
    await writeFile(path.join(sandboxRoot, BENCHMARK_SANDBOX_OWNER_MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    const projectRoot = path.join(sandboxRoot, "project");
    const evidenceRoot = path.join(sandboxRoot, "evidence");
    await mkdir(projectRoot);
    await mkdir(evidenceRoot);

    for (const relativePath of sourceFiles) {
      const segments = relativePath.split("/");
      const destination = path.join(projectRoot, ...segments);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(canonicalProjectRoot, ...segments), destination, fsConstants.COPYFILE_EXCL);
    }

    const manifest = await snapshotProjectTree(projectRoot, { excludedNames: [".git"] });
    if (manifest.length !== sourceFiles.length || manifest.some((entry, index) => entry.path !== sourceFiles[index])) {
      throw new BenchmarkSandboxError("COPY_MISMATCH", "the copied tree does not match the scanned source file list.");
    }

    const git: GitExecutionTarget = { projectRoot, evidenceRoot };
    await mustGit(git, ["init", "-q", `--initial-branch=${BENCHMARK_SANDBOX_BASELINE_BRANCH}`], "init");
    await mustGit(git, ["config", "user.name", "my-dev-kit-lab sandbox"], "config-name");
    await mustGit(git, ["config", "user.email", "sandbox@my-dev-kit-lab.invalid"], "config-email");
    await mustGit(git, ["config", "commit.gpgsign", "false"], "config-gpg");
    await mustGit(git, ["config", "core.autocrlf", "false"], "config-autocrlf");
    await mustGit(git, ["config", "core.longpaths", "true"], "config-longpaths");
    await mustGit(git, ["config", "core.symlinks", "false"], "config-symlinks");
    await mustGit(git, ["add", "-A", "--force"], "add");
    await mustGit(git, ["commit", "-q", "--no-verify", "-m", BASELINE_COMMIT_MESSAGE], "commit", BASELINE_COMMIT_DATE_ENV);
    const commit = (await mustGit(git, ["rev-parse", "HEAD"], "rev-parse")).stdout.trim();
    const status = await mustGit(git, ["status", "--porcelain"], "status");
    if (status.stdout.trim() !== "") {
      throw new BenchmarkSandboxError("BASELINE_NOT_CLEAN", "git status is not clean after the baseline commit.");
    }

    return {
      schemaVersion: BENCHMARK_SANDBOX_SCHEMA_VERSION,
      sandboxId: options.sandboxId,
      sandboxRoot,
      projectRoot,
      evidenceRoot,
      runtimeRoot,
      canonicalProjectRoot,
      baseline: { commit, fileCount: manifest.length, digest: digestTreeSnapshot(manifest), manifest }
    };
  } catch (error) {
    // Only this call's own directory exists at this point; removal cannot touch anything else.
    await rm(sandboxRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    if (error instanceof BenchmarkSandboxError) throw error;
    throw new BenchmarkSandboxError("COPY_FAILED", error instanceof Error ? error.message : String(error));
  }
}
