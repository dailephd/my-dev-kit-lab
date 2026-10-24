import { realpath as realpathCallback } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { runMeasuredCommand } from "../../core/runMeasuredCommand.js";
import { buildMinimalHostEnv } from "./minimalHostEnv.js";

export type GitResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** True when the git executable could not be resolved or started. */
  unavailable: boolean;
  error?: string;
};

export type GitExecutionTarget = {
  /** Working directory (the sandbox project repository). */
  projectRoot: string;
  /** Directory receiving command artifacts; must be outside `projectRoot`. */
  evidenceRoot: string;
};

export type RunSandboxGitOptions = {
  stdin?: string;
  /** Short label for the evidence file names. */
  label?: string;
  timeoutMs?: number;
  /** Extra environment variables for this one invocation (for example fixed commit dates). */
  env?: Readonly<Record<string, string>>;
  /**
   * "pinned" (default) binds the command to the `.git` directory of its working directory (the project) with the
   * project as the work tree, so ambient discovery can never select another repository. "discovered" lets Git
   * discover the repository from the project directory (still bounded by a ceiling at the project's parent) and
   * exists only to verify the pin.
   */
  repositoryBinding?: "pinned" | "discovered";
};

export type RepositoryBindingCheck =
  | { ok: true }
  | { ok: false; unavailable: boolean; reason: string };

// Git (including Git for Windows) opens this as an empty config file; os.devNull (\\.\nul) is rejected by Git on Windows.
const NULL_CONFIG_PATH = process.platform === "win32" ? "NUL" : "/dev/null";
/** Variables that can redirect which repository, index or object store a Git command operates on. */
const REPOSITORY_REDIRECT_ENV = /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CEILING_DIRECTORIES|PREFIX|DISCOVERY_ACROSS_FILESYSTEM)$/i;
const DEFAULT_GIT_TIMEOUT_MS = 60_000;
const GIT_OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;

const sequenceByEvidenceRoot = new Map<string, number>();

function nextSequence(evidenceRoot: string): number {
  const next = (sequenceByEvidenceRoot.get(evidenceRoot) ?? 0) + 1;
  sequenceByEvidenceRoot.set(evidenceRoot, next);
  return next;
}

/**
 * Runs Git for a sandbox through the shared measured-command owner (structured arguments, shell:false,
 * bounded output, awaited tree termination, evidence files). The environment is isolated from the user's
 * and the system's Git configuration so hashes and diffs do not depend on the developer machine.
 */
export async function runSandboxGit(
  target: GitExecutionTarget,
  args: readonly string[],
  options: RunSandboxGitOptions = {}
): Promise<GitResult> {
  const redirecting = Object.keys(options.env ?? {}).find((key) => REPOSITORY_REDIRECT_ENV.test(key));
  if (redirecting !== undefined) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      unavailable: false,
      error: `sandbox git refuses an environment override that can redirect the repository (${redirecting}).`
    };
  }
  const label = (options.label ?? args[0] ?? "git").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
  const commandId = `git-${String(nextSequence(target.evidenceRoot)).padStart(4, "0")}-${label}`;
  const env = buildMinimalHostEnv(process.env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: NULL_CONFIG_PATH,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    HOME: target.evidenceRoot,
    USERPROFILE: target.evidenceRoot,
    ...options.env,
    // The sandbox project sits below other directories that may be Git repositories. Never let discovery walk
    // above it, and (unless verifying) never rely on discovery at all. The pin is relative to the project working
    // directory on purpose: Git for Windows rejects an absolute GIT_DIR of roughly 245 characters or more
    // ("'$GIT_DIR' too big") although the repository itself works at those lengths.
    GIT_CEILING_DIRECTORIES: path.dirname(target.projectRoot),
    ...(options.repositoryBinding === "discovered"
      ? {}
      : { GIT_DIR: ".git", GIT_WORK_TREE: "." })
  });
  const result = await runMeasuredCommand({
    commandId,
    executable: "git",
    // Initialization creates .git paths before repository-local configuration exists.
    // Keep long-path support command-local so even that first invocation is covered.
    args: ["-c", "core.quotepath=false", "-c", "core.autocrlf=false", "-c", "core.longpaths=true", "-c", "core.fsmonitor=false", ...args],
    cwd: target.projectRoot,
    outDir: path.join(target.evidenceRoot, "git"),
    env,
    inheritParentEnv: false,
    stdinText: options.stdin,
    timeoutMs: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
    stdoutMaxBytes: GIT_OUTPUT_LIMIT_BYTES,
    stderrMaxBytes: GIT_OUTPUT_LIMIT_BYTES,
    terminateProcessTree: true
  });
  const unavailable = result.resolvedCommand?.resolutionKind === "unavailable";
  return {
    ok: result.ok,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut === true,
    unavailable,
    error: result.error
  };
}

/** Bounded single-line excerpt of Git diagnostics for error messages. */
export function excerptGitFailure(result: GitResult): string {
  const text = (result.stderr || result.stdout || result.error || "no output").trim().replace(/\s+/g, " ");
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

function samePhysicalPath(left: string, right: string): boolean {
  const caseFold = process.platform === "win32" || process.platform === "darwin";
  const a = path.normalize(left);
  const b = path.normalize(right);
  return caseFold ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// The native variant resolves Windows 8.3 short names and reports the on-disk case, matching what Git prints.
const realpathNative = promisify(realpathCallback.native);

async function physical(candidate: string): Promise<string> {
  return realpathNative(path.resolve(candidate));
}

/**
 * Proves that Git, discovering from the sandbox project (bounded by a ceiling at its parent), resolves to the
 * project's own physically contained `.git` directory and to the project as work tree. Exit status of
 * `git init` is not evidence of this; on some hosts `init` succeeds while discovery selects an ancestor.
 */
export async function verifySandboxRepositoryBinding(target: GitExecutionTarget): Promise<RepositoryBindingCheck> {
  const fail = (reason: string, unavailable = false): RepositoryBindingCheck => ({ ok: false, unavailable, reason });
  const gitEntry = path.join(target.projectRoot, ".git");
  let stats;
  try {
    stats = await lstat(gitEntry);
  } catch {
    return fail("the sandbox project has no .git entry after initialization.");
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return fail("the sandbox .git entry is not a real local directory.");
  }
  let expectedRoot: string;
  try {
    expectedRoot = await physical(target.projectRoot);
    if (!samePhysicalPath(await physical(gitEntry), path.join(expectedRoot, ".git"))) {
      return fail("the sandbox .git directory is not physically contained in the sandbox project.");
    }
  } catch (error) {
    return fail(`the sandbox repository paths could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = await runSandboxGit(target, ["rev-parse", "--absolute-git-dir", "--show-toplevel"], {
    label: "verify-root",
    repositoryBinding: "discovered"
  });
  if (result.unavailable) return fail("the git executable is not available.", true);
  if (!result.ok) {
    return fail(`git does not recognize the new sandbox repository from its project directory: ${excerptGitFailure(result)}`);
  }
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length !== 2) return fail("git repository discovery returned an unexpected shape.");
  try {
    const [discoveredGitDir, discoveredTopLevel] = await Promise.all([physical(lines[0] as string), physical(lines[1] as string)]);
    if (!samePhysicalPath(discoveredGitDir, path.join(expectedRoot, ".git"))) {
      return fail("git discovered a repository administration directory other than the sandbox project's own .git.");
    }
    if (!samePhysicalPath(discoveredTopLevel, expectedRoot)) {
      return fail("git discovered a work tree other than the sandbox project.");
    }
  } catch (error) {
    return fail(`the discovered repository paths could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ok: true };
}
