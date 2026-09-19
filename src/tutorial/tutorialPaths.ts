import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../core/pathSafety.js";
import type { TutorialRunPaths } from "./types.js";

/**
 * Output ownership for a tutorial run.
 *
 * A run owns exactly one directory tree. The inspected/source repository that
 * supplied the target contract is never an output location: `targetRoot` is a
 * run-owned disposable working copy that only the trusted prepare command
 * populates.
 */

export const TUTORIAL_WORKSPACE_DIR_NAME = "tutorials";

export type BuildTutorialRunPathsOptions = {
  /** Writable lab workspace root; used only when `outDir` is omitted. */
  workspaceRoot: string;
  /** Base for resolving a relative explicit `outDir`. */
  invocationCwd: string;
  scenarioId: string;
  runId: string;
  /** Explicit --out. Absolute is used as-is; relative resolves against invocationCwd. */
  outDir?: string;
};

/**
 * Generates a collision-resistant run id that is also a safe single path
 * segment (matches the tutorial id pattern).
 */
export function generateTutorialRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "z").toLowerCase();
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

export function buildTutorialRunPaths(options: BuildTutorialRunPathsOptions): TutorialRunPaths {
  const runRoot = resolveRunRoot(options);
  return {
    runRoot,
    targetRoot: path.join(runRoot, "target"),
    artifactsRoot: path.join(runRoot, "artifacts"),
    screenshotsRoot: path.join(runRoot, "screenshots"),
    logsRoot: path.join(runRoot, "logs"),
    temporaryRoot: path.join(runRoot, "temporary")
  };
}

function resolveRunRoot(options: BuildTutorialRunPathsOptions): string {
  if (options.outDir !== undefined && options.outDir.trim().length > 0) {
    // An explicit --out is honored exactly as given. It is deliberately NOT
    // relocated beneath workspaceRoot: the caller chose the location.
    return path.isAbsolute(options.outDir)
      ? path.resolve(options.outDir)
      : path.resolve(options.invocationCwd, options.outDir);
  }
  return path.join(
    path.resolve(options.workspaceRoot),
    TUTORIAL_WORKSPACE_DIR_NAME,
    options.scenarioId,
    options.runId
  );
}

/**
 * Creates the full run layout up front so every later stage writes into a
 * directory that already exists, and so the layout is stable even for a run that
 * fails early.
 */
export async function createTutorialRunDirectories(paths: TutorialRunPaths): Promise<void> {
  await mkdir(paths.runRoot, { recursive: true });
  for (const directory of [
    paths.artifactsRoot,
    paths.screenshotsRoot,
    paths.logsRoot,
    paths.temporaryRoot
  ]) {
    await mkdir(directory, { recursive: true });
  }
}

/**
 * Resolves a scenario-declared file path beneath the run-owned target root.
 *
 * Uses path-semantics containment (`resolveWithinRoot`), not string-prefix
 * matching, so a sibling directory such as `<root>-other` is correctly treated
 * as outside. Absolute paths are rejected outright even when they happen to
 * point inside the root, because a scenario has no business naming absolute
 * locations on the host.
 */
export function resolveTargetFilePath(targetRoot: string, suppliedPath: string): string {
  if (typeof suppliedPath !== "string" || suppliedPath.trim().length === 0) {
    throw new Error("File assertion path must be a non-empty path relative to targetRoot.");
  }
  if (path.isAbsolute(suppliedPath) || path.win32.isAbsolute(suppliedPath) || path.posix.isAbsolute(suppliedPath)) {
    throw new Error(`File assertion path must be relative to targetRoot; received absolute path: ${suppliedPath}`);
  }
  // Catches a Windows drive-qualified relative form such as "C:file" that is
  // not absolute by either isAbsolute check but still escapes the root.
  if (/^[A-Za-z]:/.test(suppliedPath)) {
    throw new Error(`File assertion path must not be drive-qualified: ${suppliedPath}`);
  }

  try {
    return resolveWithinRoot(targetRoot, suppliedPath);
  } catch {
    throw new Error(`File assertion path escapes targetRoot: ${suppliedPath}`);
  }
}
