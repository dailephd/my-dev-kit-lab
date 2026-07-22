import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  V043TargetFileSnapshotState,
  V043TargetFileSnapshotV1,
  V043TargetGitSnapshotV1,
  V043TargetImmutabilityConfigV1,
  V043TargetSnapshotErrorCode,
  V043TargetSnapshotFailure,
  V043TargetSnapshotResult,
  V043TargetUntrackedFileSnapshotV1
} from "./types.js";

const execFileAsync = promisify(execFile);

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function stripTrailingLineTerminator(text: string): string {
  return text.replace(/\r?\n$/, "");
}

function splitLines(text: string): string[] {
  const stripped = stripTrailingLineTerminator(text);
  return stripped.length > 0 ? stripped.split(/\r?\n/) : [];
}

function isInsideRoot(resolvedRoot: string, candidate: string): boolean {
  const relative = path.relative(resolvedRoot, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

interface PathEntrySnapshot {
  state: V043TargetFileSnapshotState;
  sha256: string | null;
  symbolicLinkTarget: string | null;
}

async function snapshotPathEntry(resolvedPath: string): Promise<PathEntrySnapshot> {
  let stats;
  try {
    stats = await lstat(resolvedPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { state: "missing", sha256: null, symbolicLinkTarget: null };
    }
    throw error;
  }
  if (stats.isSymbolicLink()) {
    const target = await readlink(resolvedPath);
    return { state: "symbolic-link", sha256: null, symbolicLinkTarget: target };
  }
  if (stats.isDirectory()) {
    return { state: "directory", sha256: null, symbolicLinkTarget: null };
  }
  if (stats.isFile()) {
    const contents = await readFile(resolvedPath);
    return { state: "file", sha256: sha256Hex(contents), symbolicLinkTarget: null };
  }
  return { state: "other", sha256: null, symbolicLinkTarget: null };
}

type GitRunResult = { ok: true; stdout: string } | { ok: false; unavailable: boolean; message: string };

async function runGit(resolvedRoot: string, args: string[]): Promise<GitRunResult> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", resolvedRoot, ...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 64
    });
    return { ok: true, stdout };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return { ok: false, unavailable: true, message: "git executable was not found." };
    }
    return { ok: false, unavailable: false, message: (error as Error).message };
  }
}

async function runRequiredGit(
  resolvedRoot: string,
  args: string[],
  targetRootPath: string
): Promise<{ ok: true; stdout: string } | V043TargetSnapshotFailure> {
  const result = await runGit(resolvedRoot, args);
  if (result.ok) return result;
  const code: V043TargetSnapshotErrorCode = result.unavailable ? "GIT_COMMAND_UNAVAILABLE" : "GIT_COMMAND_FAILED";
  const message = result.unavailable
    ? "The git executable is not available."
    : `git ${args.join(" ")} failed: ${result.message}`;
  return { ok: false, code, targetRootPath, message };
}

export async function captureTargetSnapshot(config: V043TargetImmutabilityConfigV1): Promise<V043TargetSnapshotResult> {
  const resolvedTargetRootPath = path.resolve(config.targetRootPath);

  let rootStats;
  try {
    rootStats = await lstat(resolvedTargetRootPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        code: "TARGET_ROOT_NOT_FOUND",
        targetRootPath: config.targetRootPath,
        message: `Target root was not found at "${resolvedTargetRootPath}".`
      };
    }
    return {
      ok: false,
      code: "TARGET_ROOT_UNREADABLE",
      targetRootPath: config.targetRootPath,
      message: `Target root at "${resolvedTargetRootPath}" could not be read: ${(error as Error).message}`
    };
  }
  if (!rootStats.isDirectory()) {
    return {
      ok: false,
      code: "TARGET_ROOT_NOT_DIRECTORY",
      targetRootPath: config.targetRootPath,
      message: `Target root at "${resolvedTargetRootPath}" is not a directory.`
    };
  }

  const configuredFiles: V043TargetFileSnapshotV1[] = [];
  for (const relativePath of config.relativeFilePaths) {
    const resolvedPath = path.resolve(resolvedTargetRootPath, relativePath);
    if (!isInsideRoot(resolvedTargetRootPath, resolvedPath)) {
      return {
        ok: false,
        code: "CONFIGURED_FILE_READ_FAILED",
        targetRootPath: config.targetRootPath,
        message: `Configured file "${relativePath}" resolves outside the target root.`,
        fieldPath: relativePath
      };
    }
    try {
      const entry = await snapshotPathEntry(resolvedPath);
      configuredFiles.push({
        relativePath,
        resolvedPath,
        state: entry.state,
        sha256: entry.sha256,
        symbolicLinkTarget: entry.symbolicLinkTarget
      });
    } catch (error) {
      return {
        ok: false,
        code: "CONFIGURED_FILE_READ_FAILED",
        targetRootPath: config.targetRootPath,
        message: `Configured file "${relativePath}" could not be read: ${(error as Error).message}`,
        fieldPath: relativePath
      };
    }
  }

  const isRepoOutcome = await runGit(resolvedTargetRootPath, ["rev-parse", "--is-inside-work-tree"]);
  if (!isRepoOutcome.ok) {
    if (isRepoOutcome.unavailable) {
      return {
        ok: false,
        code: "GIT_COMMAND_UNAVAILABLE",
        targetRootPath: config.targetRootPath,
        message: "The git executable is not available."
      };
    }
    const git: V043TargetGitSnapshotV1 = {
      availability: "not-repository",
      branch: null,
      head: null,
      statusEntries: [],
      worktreeDiffSha256: null,
      stagedDiffSha256: null,
      untrackedFiles: []
    };
    return {
      ok: true,
      snapshot: { targetRootPath: config.targetRootPath, resolvedTargetRootPath, configuredFiles, git }
    };
  }

  const branchOutcome = await runRequiredGit(resolvedTargetRootPath, ["branch", "--show-current"], config.targetRootPath);
  if (!branchOutcome.ok) return branchOutcome;
  const branch = stripTrailingLineTerminator(branchOutcome.stdout);

  const headOutcome = await runRequiredGit(resolvedTargetRootPath, ["rev-parse", "HEAD"], config.targetRootPath);
  if (!headOutcome.ok) return headOutcome;
  const head = stripTrailingLineTerminator(headOutcome.stdout);

  const statusOutcome = await runRequiredGit(
    resolvedTargetRootPath,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    config.targetRootPath
  );
  if (!statusOutcome.ok) return statusOutcome;
  const statusEntries = splitLines(statusOutcome.stdout);

  const worktreeDiffOutcome = await runRequiredGit(
    resolvedTargetRootPath,
    ["diff", "--binary", "--no-ext-diff"],
    config.targetRootPath
  );
  if (!worktreeDiffOutcome.ok) return worktreeDiffOutcome;
  const worktreeDiffSha256 = sha256Hex(Buffer.from(worktreeDiffOutcome.stdout, "utf8"));

  const stagedDiffOutcome = await runRequiredGit(
    resolvedTargetRootPath,
    ["diff", "--cached", "--binary", "--no-ext-diff"],
    config.targetRootPath
  );
  if (!stagedDiffOutcome.ok) return stagedDiffOutcome;
  const stagedDiffSha256 = sha256Hex(Buffer.from(stagedDiffOutcome.stdout, "utf8"));

  const untrackedOutcome = await runRequiredGit(
    resolvedTargetRootPath,
    ["ls-files", "--others", "--exclude-standard"],
    config.targetRootPath
  );
  if (!untrackedOutcome.ok) return untrackedOutcome;
  const untrackedPaths = splitLines(untrackedOutcome.stdout);

  const untrackedFiles: V043TargetUntrackedFileSnapshotV1[] = [];
  for (const untrackedRelativePath of untrackedPaths) {
    const resolvedPath = path.resolve(resolvedTargetRootPath, untrackedRelativePath);
    const entry = await snapshotPathEntry(resolvedPath);
    const state = entry.state === "directory" ? "other" : entry.state;
    untrackedFiles.push({
      path: untrackedRelativePath,
      state,
      sha256: entry.sha256,
      symbolicLinkTarget: entry.symbolicLinkTarget
    });
  }

  const git: V043TargetGitSnapshotV1 = {
    availability: "available",
    branch,
    head,
    statusEntries,
    worktreeDiffSha256,
    stagedDiffSha256,
    untrackedFiles
  };

  return {
    ok: true,
    snapshot: { targetRootPath: config.targetRootPath, resolvedTargetRootPath, configuredFiles, git }
  };
}
