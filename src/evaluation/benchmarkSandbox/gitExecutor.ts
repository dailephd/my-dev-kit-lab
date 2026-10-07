import path from "node:path";
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
};

// Git (including Git for Windows) opens this as an empty config file; os.devNull (\\.\nul) is rejected by Git on Windows.
const NULL_CONFIG_PATH = process.platform === "win32" ? "NUL" : "/dev/null";
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
  const label = (options.label ?? args[0] ?? "git").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
  const commandId = `git-${String(nextSequence(target.evidenceRoot)).padStart(4, "0")}-${label}`;
  const env = buildMinimalHostEnv(process.env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: NULL_CONFIG_PATH,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    HOME: target.evidenceRoot,
    USERPROFILE: target.evidenceRoot,
    ...options.env
  });
  const result = await runMeasuredCommand({
    commandId,
    executable: "git",
    args: ["-c", "core.quotepath=false", "-c", "core.autocrlf=false", "-c", "core.fsmonitor=false", ...args],
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
