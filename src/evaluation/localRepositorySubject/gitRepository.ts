import { execFile } from "node:child_process";
import { realpath as nativeRealpath } from "node:fs";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { LocalRepositorySubjectRepositoryError } from "./types.js";
import type { LocalRepositoryIdentity } from "./types.js";

// Native realpath expands Windows short (8.3) names so the selected path and Git's reported root compare equal.
const realpath = promisify(nativeRealpath.native);
const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const CHECK_IGNORE_CHUNK_SIZE = 5000;
const FULL_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

type GitResult = { exitCode: number; stdout: string };

function gitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // A subject repository must be inspected on its own terms, never through an inherited git context.
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"]) delete env[key];
  env.GIT_OPTIONAL_LOCKS = "0";
  return env;
}

/**
 * Runs git with a structured argument array (no shell). Resolves with the exit code for ordinary non-zero exits so
 * callers can classify them; rejects only when git cannot be started. Raw stderr is never surfaced.
 */
function runGit(cwd: string, args: readonly string[], input?: string): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...args],
      { cwd, env: gitEnvironment(), encoding: "utf8", maxBuffer: GIT_MAX_BUFFER_BYTES, windowsHide: true },
      (error, stdout) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException & { code?: string | number }).code;
          if (typeof code === "number") {
            resolve({ exitCode: code, stdout: String(stdout ?? "") });
            return;
          }
          if (code === "ENOENT") {
            reject(new LocalRepositorySubjectRepositoryError("GIT_UNAVAILABLE", "the git executable is not available."));
            return;
          }
          if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            resolve({ exitCode: 0, stdout: String(stdout ?? "") });
            return;
          }
          reject(new LocalRepositorySubjectRepositoryError("GIT_UNAVAILABLE", "the git executable could not be run."));
          return;
        }
        resolve({ exitCode: 0, stdout: String(stdout ?? "") });
      }
    );
    // When the process cannot be started (for example a working directory beyond the Windows path limit), Node can
    // still emit an error on the never-connected stdio sockets; without listeners that becomes an uncaught exception
    // instead of the classified rejection above.
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on("error", () => undefined);
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

function normalizeForComparison(value: string): string {
  const slashed = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? slashed.toLowerCase() : slashed;
}

/** Resolves the selected path to its physical directory, rejecting missing or non-directory paths. */
export async function resolveSelectedRepositoryPath(selectedPath: string): Promise<string> {
  if (typeof selectedPath !== "string" || selectedPath.trim().length === 0) {
    throw new LocalRepositorySubjectRepositoryError("REPOSITORY_PATH_INVALID", "the repository path must be a non-empty string.");
  }
  let physical: string;
  try {
    physical = await realpath(selectedPath);
    if (!(await stat(physical)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new LocalRepositorySubjectRepositoryError("REPOSITORY_PATH_INVALID", "the repository path does not exist or is not a directory.");
  }
  return physical;
}

/**
 * Reads Git-backed identity for the selected path. The selected path must be the exact worktree root. Only
 * read-only Git commands are issued. Dirty state is reduced to a boolean; status output is discarded.
 */
export async function readRepositoryIdentity(
  selectedPath: string
): Promise<{ repositoryRoot: string; identity: LocalRepositoryIdentity }> {
  const repositoryRoot = await resolveSelectedRepositoryPath(selectedPath);

  const topLevel = await runGit(repositoryRoot, ["rev-parse", "--show-toplevel"]);
  if (topLevel.exitCode !== 0 || topLevel.stdout.trim().length === 0) {
    throw new LocalRepositorySubjectRepositoryError("NOT_A_GIT_REPOSITORY", "the selected path is not inside a usable Git worktree.");
  }
  let gitRoot: string;
  try {
    gitRoot = await realpath(topLevel.stdout.trim());
  } catch {
    throw new LocalRepositorySubjectRepositoryError("NOT_A_GIT_REPOSITORY", "the Git worktree root could not be resolved.");
  }
  if (normalizeForComparison(gitRoot) !== normalizeForComparison(repositoryRoot)) {
    throw new LocalRepositorySubjectRepositoryError(
      "NOT_WORKTREE_ROOT",
      "the selected path is inside a Git worktree but is not the worktree root."
    );
  }

  const head = await runGit(repositoryRoot, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  const commit = head.stdout.trim();
  if (head.exitCode !== 0 || !FULL_SHA_PATTERN.test(commit)) {
    throw new LocalRepositorySubjectRepositoryError("NO_HEAD_COMMIT", "the repository has no resolvable HEAD commit.");
  }

  const symbolic = await runGit(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = symbolic.exitCode === 0 && symbolic.stdout.trim().length > 0 ? symbolic.stdout.trim() : null;

  const status = await runGit(repositoryRoot, ["status", "--porcelain=v1", "-z"]);
  if (status.exitCode !== 0) {
    throw new LocalRepositorySubjectRepositoryError("NOT_A_GIT_REPOSITORY", "the working tree state could not be read.");
  }

  return { repositoryRoot, identity: { commit, branch, workingTreeDirty: status.stdout.length > 0 } };
}

/**
 * Returns the subset of repository-relative paths that Git itself reports as ignored. No independent ignore
 * parsing exists here. Tracked files are never reported ignored by Git; `--no-index` is intentionally not used.
 */
export async function classifyGitIgnoredPaths(repositoryRoot: string, relativePaths: readonly string[]): Promise<Set<string>> {
  const ignored = new Set<string>();
  for (let start = 0; start < relativePaths.length; start += CHECK_IGNORE_CHUNK_SIZE) {
    const chunk = relativePaths.slice(start, start + CHECK_IGNORE_CHUNK_SIZE);
    const result = await runGit(repositoryRoot, ["check-ignore", "--stdin", "-z"], chunk.map((entry) => `${entry}\0`).join(""));
    if (result.exitCode === 1) continue;
    if (result.exitCode !== 0) {
      throw new LocalRepositorySubjectRepositoryError("GIT_CHECK_IGNORE_FAILED", "git could not classify ignored files.");
    }
    for (const entry of result.stdout.split("\0")) {
      if (entry.length > 0) ignored.add(entry);
    }
  }
  return ignored;
}
