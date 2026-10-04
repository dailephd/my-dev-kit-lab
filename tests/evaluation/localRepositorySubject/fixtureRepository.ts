import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Runs git in a fixture repository with a clean environment and no signing or global identity dependence. */
export function git(cwd: string, ...args: string[]): string {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"]) delete env[key];
  return execFileSync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
}

export function makeTempDir(prefix = "lrs-fixture-"): string {
  return realpathSync.native(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function removeTempDir(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}

/** Creates an initialized fixture Git repository (branch `main`, no commits yet) at an existing empty directory. */
export function initRepository(root: string): void {
  git(root, "init", "-q", "-b", "main");
}

export function writeRepositoryFile(root: string, relativePath: string, content: string | Buffer = "export const value = 1;\n"): void {
  const absolute = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

export function commitAll(root: string, message = "fixture commit"): string {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
  return git(root, "rev-parse", "HEAD").trim();
}

export type SymlinkResult = { ok: true } | { ok: false; reason: string };

/** Attempts to create a symlink; reports why it could not instead of failing the test run. */
export function tryCreateSymlink(target: string, linkPath: string, type: "file" | "dir"): SymlinkResult {
  try {
    mkdirSync(path.dirname(linkPath), { recursive: true });
    symlinkSync(target, linkPath, type === "dir" && process.platform === "win32" ? "junction" : type);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `symlink creation unavailable: ${(error as NodeJS.ErrnoException).code ?? "unknown error"}` };
  }
}

export function minimalCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "case-one",
    title: "Find the value",
    sourceRoots: ["src"],
    query: "Where is the value defined?",
    expectedFiles: ["src/main.ts"],
    expectedSymbols: ["value"],
    rawIncludeGlobs: ["src/**/*.ts"],
    ...overrides,
  };
}

export function minimalConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0",
    subjectId: "fixture-subject",
    cases: [minimalCase()],
    ...overrides,
  };
}

/** A committed fixture repository with `src/main.ts` and `src/util/helper.ts`. */
export function createCommittedRepository(root: string): string {
  initRepository(root);
  writeRepositoryFile(root, "src/main.ts", "export const value = 1;\n");
  writeRepositoryFile(root, "src/util/helper.ts", "export const helper = 2;\n");
  return commitAll(root);
}
