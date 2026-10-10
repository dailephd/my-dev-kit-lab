import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import {
  buildMinimalHostEnv,
  createBenchmarkSandbox,
  removeBenchmarkSandbox,
  runSandboxGit,
  snapshotProjectTree,
  type BenchmarkSandbox
} from "../../../src/evaluation/benchmarkSandbox/index.js";

const tempDirs: string[] = [];
const sandboxes: Array<{ runtimeRoot: string; sandboxId: string }> = [];

/** Registers cleanup of every temp directory and sandbox created through these helpers. */
export function useSandboxTestCleanup(): void {
  afterEach(async () => {
    for (const entry of sandboxes.splice(0)) {
      await removeBenchmarkSandbox(entry).catch(() => undefined);
    }
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined))
    );
  });
}

export function makeTempDir(prefix = "lab-sbx-"): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export function writeProjectFiles(root: string, files: Readonly<Record<string, string | Buffer>>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, ...relativePath.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

/** A tiny Node project: one task check that fails until src/math.cjs is fixed, one regression check that passes. */
export const FIXTURE_FILES: Readonly<Record<string, string>> = Object.freeze({
  "package.json": '{"name":"fixture","private":true}\n',
  "src/math.cjs": "module.exports.add = (a, b) => a - b;\n",
  "src/other.cjs": "module.exports.id = (x) => x;\n",
  "docs/readme.md": "# Fixture\n",
  "protected.txt": "do not touch\n",
  "tests/task.check.cjs":
    'const { add } = require("../src/math.cjs");\nif (add(1, 2) !== 3) { console.error("add failed"); process.exit(1); }\n',
  "tests/regression.check.cjs":
    'const { id } = require("../src/other.cjs");\nif (id(5) !== 5) { console.error("id failed"); process.exit(1); }\n'
});

export const FIX_PATCH = [
  "diff --git a/src/math.cjs b/src/math.cjs",
  "--- a/src/math.cjs",
  "+++ b/src/math.cjs",
  "@@ -1 +1 @@",
  "-module.exports.add = (a, b) => a - b;",
  "+module.exports.add = (a, b) => a + b;",
  ""
].join("\n");

export function newFilePatch(relativePath: string, content: string): string {
  const lines = content.split("\n").filter((line, index, all) => !(index === all.length - 1 && line === ""));
  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${relativePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    ""
  ].join("\n");
}

/** Creates a canonical fixture project in its own temp directory and returns its root. */
export function makeCanonicalFixture(extra: Readonly<Record<string, string | Buffer>> = {}): string {
  const root = path.join(makeTempDir("lab-canon-"), "project");
  mkdirSync(root, { recursive: true });
  writeProjectFiles(root, { ...FIXTURE_FILES, ...extra });
  return root;
}

export async function makeSandbox(canonicalProjectRoot: string, sandboxId = "sb1", runtimeRoot = path.join(makeTempDir("lab-rt-"), "runtime")): Promise<BenchmarkSandbox> {
  const sandbox = await createBenchmarkSandbox({ canonicalProjectRoot, runtimeRoot, sandboxId });
  sandboxes.push({ runtimeRoot, sandboxId });
  return sandbox;
}

export function trackSandbox(runtimeRoot: string, sandboxId: string): void {
  sandboxes.push({ runtimeRoot, sandboxId });
}

/** Initializes a real Git repository (with a commit) in a directory, isolated from the developer's Git config. */
export function initCanonicalGitRepository(root: string): string {
  const env = {
    ...buildMinimalHostEnv(process.env, {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      HOME: root,
      USERPROFILE: root
    })
  };
  const git = (...args: string[]): string => execFileSync("git", ["-c", "user.name=canonical", "-c", "user.email=canonical@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd: root, env, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "canonical history");
  return git("rev-parse", "HEAD").trim();
}

/** Working-tree + index + status evidence used to prove "the sandbox did not change". */
export async function captureSandboxState(sandbox: BenchmarkSandbox): Promise<{
  tree: Awaited<ReturnType<typeof snapshotProjectTree>>;
  status: string;
  cachedNames: string;
}> {
  const status = await runSandboxGit(sandbox, ["status", "--porcelain"], { label: "state-status" });
  const cached = await runSandboxGit(sandbox, ["diff", "--cached", "--name-only"], { label: "state-cached" });
  return {
    tree: await snapshotProjectTree(sandbox.projectRoot, { excludedNames: [".git"] }),
    status: status.stdout,
    cachedNames: cached.stdout
  };
}

export function baseTaskInput(): Record<string, unknown> {
  return {
    schemaVersion: "my-dev-kit-lab-agent-success-task-v1",
    id: "fixture-add-fix",
    title: "Fix add",
    benchmarkProject: "fixture",
    projectProfileRef: "fixture",
    taskLocality: "localized",
    query: "fix add",
    sourceRoots: ["src"],
    rawIncludeGlobs: ["src/**/*", "tests/**/*"],
    instruction: "Make add return the sum of its arguments.",
    expectedEditFiles: ["src/math.cjs"],
    allowedEditFiles: ["src/math.cjs", "src/other.cjs"],
    protectedFiles: ["protected.txt", "tests/task.check.cjs"],
    taskChecks: [{ id: "task-add", executable: "node", args: ["tests/task.check.cjs"], timeoutMs: 20000 }],
    regressionChecks: [{ id: "regression-id", executable: "node", args: ["tests/regression.check.cjs"], timeoutMs: 20000 }],
    behaviorFacts: [{ id: "fact-add", text: "add returns the sum", required: true, verificationCheckIds: ["task-add"] }]
  };
}
