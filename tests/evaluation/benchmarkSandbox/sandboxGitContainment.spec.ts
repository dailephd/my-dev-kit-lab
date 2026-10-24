import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Wraps the real executor so individual tests can simulate a mislocated or partial `git init`, and records every
// call so tests can prove which commands were (not) issued. Verification inside the executor module is not wrapped.
vi.mock("../../../src/evaluation/benchmarkSandbox/gitExecutor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/evaluation/benchmarkSandbox/gitExecutor.js")>();
  return { ...actual, runSandboxGit: vi.fn(actual.runSandboxGit) };
});

import {
  BenchmarkSandboxError,
  buildMinimalHostEnv,
  createBenchmarkSandbox,
  runSandboxGit,
  snapshotProjectTree
} from "../../../src/evaluation/benchmarkSandbox/index.js";
import { BENCHMARK_SANDBOX_BASELINE_BRANCH } from "../../../src/evaluation/benchmarkSandbox/types.js";
import { verifySandboxRepositoryBinding } from "../../../src/evaluation/benchmarkSandbox/gitExecutor.js";
import {
  initCanonicalGitRepository,
  makeCanonicalFixture,
  makeTempDir,
  trackSandbox,
  useSandboxTestCleanup,
  writeProjectFiles
} from "./sandboxTestHelpers.js";

useSandboxTestCleanup();

// vi.mock replaces the module for every import of it, so the unwrapped executor must be loaded explicitly.
const { runSandboxGit: realRunSandboxGit } = await vi.importActual<typeof import("../../../src/evaluation/benchmarkSandbox/gitExecutor.js")>(
  "../../../src/evaluation/benchmarkSandbox/gitExecutor.js"
);
const SNAPSHOT_ALL = { excludedNames: [] as string[] };
const mockedRun = vi.mocked(runSandboxGit);
const SIX_KEYS = {
  "user.name": "my-dev-kit-lab sandbox",
  "user.email": "sandbox@my-dev-kit-lab.invalid",
  "commit.gpgsign": "false",
  "core.autocrlf": "false",
  "core.longpaths": "true",
  "core.symlinks": "false"
} as const;

afterEach(() => {
  mockedRun.mockReset();
  mockedRun.mockImplementation(realRunSandboxGit);
});

function sha256(file: string): string {
  return existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : "absent";
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

/** Byte-level identity of a protected repository: config, HEAD, index, refs, and loose-object inventory. */
function fingerprint(repositoryRoot: string): Record<string, string | number> {
  const gitDir = path.join(repositoryRoot, ".git");
  const refs = listFiles(path.join(gitDir, "refs")).sort().map((file) => `${path.relative(gitDir, file)}:${sha256(file)}`);
  const objects = listFiles(path.join(gitDir, "objects")).filter((file) => !/[\\/](info|pack)[\\/]/.test(file));
  return {
    config: sha256(path.join(gitDir, "config")),
    head: sha256(path.join(gitDir, "HEAD")),
    index: sha256(path.join(gitDir, "index")),
    packedRefs: sha256(path.join(gitDir, "packed-refs")),
    refs: createHash("sha256").update(refs.join("\n")).digest("hex"),
    looseObjects: objects.length
  };
}

/** A disposable repository that is an ancestor of the sandbox runtime root, so a wrong-root write is observable. */
function makeTripwire(): string {
  const root = makeTempDir("lab-tripwire-");
  writeProjectFiles(root, { "tripwire-seed.txt": "seed\n" });
  initCanonicalGitRepository(root);
  return root;
}

/** Runtime root below `base` such that `<runtimeRoot>/<sandboxId>/project` is exactly `projectLength` characters. */
function runtimeRootForProjectLength(base: string, sandboxId: string, projectLength: number): string {
  const wanted = projectLength - path.join(sandboxId, "project").length - 1;
  let current = base;
  while (current.length < wanted) {
    const need = wanted - current.length - 1;
    if (need < 1) throw new Error(`cannot build a runtime root of ${wanted} characters below ${base}`);
    current = path.join(current, "p".repeat(need > 120 ? 100 : need));
  }
  if (current.length !== wanted) throw new Error(`runtime root base is already longer than ${wanted} characters`);
  return current;
}

let lastErrorDetail = "";

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    lastErrorDetail = error instanceof Error ? error.message : String(error);
    return error instanceof BenchmarkSandboxError ? error.code : `unexpected:${String(error)}`;
  }
}

function gitCalls(): string[] {
  return mockedRun.mock.calls.map((call) => String(call[1][0]));
}

describe("benchmark sandbox Git repository containment", () => {
  it("creates a normal sandbox whose six keys live only in its own config, with one deterministic baseline commit", async () => {
    const tripwire = makeTripwire();
    const before = fingerprint(tripwire);
    const canonical = makeCanonicalFixture();
    const canonicalBefore = await snapshotProjectTree(canonical, SNAPSHOT_ALL);
    const runtimeRoot = path.join(tripwire, "runtime");
    const sandbox = await createBenchmarkSandbox({ canonicalProjectRoot: canonical, runtimeRoot, sandboxId: "contained" });
    trackSandbox(runtimeRoot, "contained");

    const sandboxConfig = readFileSync(path.join(sandbox.projectRoot, ".git", "config"), "utf8");
    for (const [key, value] of Object.entries(SIX_KEYS)) {
      const result = await runSandboxGit(sandbox, ["config", "--local", "--get", key], { label: "t-key" });
      expect(result.stdout.trim()).toBe(value);
    }
    expect(sandboxConfig).toContain("symlinks = false");
    expect((await runSandboxGit(sandbox, ["rev-list", "--count", "HEAD"], { label: "t-count" })).stdout.trim()).toBe("1");
    expect((await runSandboxGit(sandbox, ["status", "--porcelain"], { label: "t-status" })).stdout).toBe("");
    expect((await runSandboxGit(sandbox, ["symbolic-ref", "--short", "HEAD"], { label: "t-branch" })).stdout.trim()).toBe(BENCHMARK_SANDBOX_BASELINE_BRANCH);
    expect(await snapshotProjectTree(canonical, SNAPSHOT_ALL)).toEqual(canonicalBefore);
    expect(fingerprint(tripwire)).toEqual(before);
  });

  it("verifies the repository before the first config, add, or commit", async () => {
    const tripwire = makeTripwire();
    const runtimeRoot = path.join(tripwire, "runtime");
    const sandbox = await createBenchmarkSandbox({ canonicalProjectRoot: makeCanonicalFixture(), runtimeRoot, sandboxId: "ordered" });
    trackSandbox(runtimeRoot, "ordered");
    const commands = gitCalls();
    expect(commands[0]).toBe("init");
    expect(commands.slice(1, 7).every((name) => name === "config")).toBe(true);
    const telemetry = readdirSync(path.join(sandbox.evidenceRoot, "git")).filter((name) => name.endsWith(".telemetry.json")).sort();
    expect(telemetry[0]).toMatch(/-init\./);
    expect(telemetry[1]).toMatch(/-verify-root\./);
    expect(telemetry[2]).toMatch(/-config-name\./);
  });

  it("fails closed, before any config, when init exits 0 but creates no repository (parent repository reachable)", async () => {
    const tripwire = makeTripwire();
    const before = fingerprint(tripwire);
    const canonical = makeCanonicalFixture();
    const canonicalBefore = await snapshotProjectTree(canonical, SNAPSHOT_ALL);
    const sibling = path.join(tripwire, "keep.txt");
    writeFileSync(sibling, "unrelated\n");
    mockedRun.mockImplementation(async (target, args, options) => {
      if (args[0] === "init") return { ok: true, exitCode: 0, stdout: "", stderr: "", timedOut: false, unavailable: false };
      return realRunSandboxGit(target, args, options);
    });
    const runtimeRoot = path.join(tripwire, "runtime");
    const failure = await createBenchmarkSandbox({ canonicalProjectRoot: canonical, runtimeRoot, sandboxId: "no-repo" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BenchmarkSandboxError);
    expect((failure as BenchmarkSandboxError).code).toBe("GIT_REPOSITORY_MISMATCH");
    expect(gitCalls()).toEqual(["init"]);
    expect(existsSync(path.join(runtimeRoot, "no-repo"))).toBe(false);
    expect(readFileSync(sibling, "utf8")).toBe("unrelated\n");
    expect(await snapshotProjectTree(canonical, SNAPSHOT_ALL)).toEqual(canonicalBefore);
    expect(fingerprint(tripwire)).toEqual(before);
  });

  it("fails closed when init leaves an unusable .git so that Git would fall through to the ancestor", async () => {
    const tripwire = makeTripwire();
    const before = fingerprint(tripwire);
    mockedRun.mockImplementation(async (target, args, options) => {
      if (args[0] === "init") {
        mkdirSync(path.join(target.projectRoot, ".git"));
        return { ok: true, exitCode: 0, stdout: "", stderr: "", timedOut: false, unavailable: false };
      }
      return realRunSandboxGit(target, args, options);
    });
    const runtimeRoot = path.join(tripwire, "runtime");
    expect(await codeOf(createBenchmarkSandbox({ canonicalProjectRoot: makeCanonicalFixture(), runtimeRoot, sandboxId: "empty-git" }))).toBe("GIT_REPOSITORY_MISMATCH");
    expect(gitCalls()).toEqual(["init"]);
    expect(existsSync(path.join(runtimeRoot, "empty-git"))).toBe(false);
    expect(fingerprint(tripwire)).toEqual(before);
  });

  it("rejects a .git file that redirects to another repository", async () => {
    const tripwire = makeTripwire();
    const before = fingerprint(tripwire);
    mockedRun.mockImplementation(async (target, args, options) => {
      if (args[0] === "init") {
        writeFileSync(path.join(target.projectRoot, ".git"), `gitdir: ${path.join(tripwire, ".git")}\n`);
        return { ok: true, exitCode: 0, stdout: "", stderr: "", timedOut: false, unavailable: false };
      }
      return realRunSandboxGit(target, args, options);
    });
    const runtimeRoot = path.join(tripwire, "runtime");
    expect(await codeOf(createBenchmarkSandbox({ canonicalProjectRoot: makeCanonicalFixture(), runtimeRoot, sandboxId: "redirected" }))).toBe("GIT_REPOSITORY_MISMATCH");
    expect(gitCalls()).toEqual(["init"]);
    expect(fingerprint(tripwire)).toEqual(before);
  });

  it("rejects a .git directory that is a link to another repository's administration directory", async () => {
    const tripwire = makeTripwire();
    const before = fingerprint(tripwire);
    mockedRun.mockImplementation(async (target, args, options) => {
      if (args[0] === "init") {
        await symlink(path.join(tripwire, ".git"), path.join(target.projectRoot, ".git"), process.platform === "win32" ? "junction" : "dir");
        return { ok: true, exitCode: 0, stdout: "", stderr: "", timedOut: false, unavailable: false };
      }
      return realRunSandboxGit(target, args, options);
    });
    const runtimeRoot = path.join(tripwire, "runtime");
    expect(await codeOf(createBenchmarkSandbox({ canonicalProjectRoot: makeCanonicalFixture(), runtimeRoot, sandboxId: "linked" }))).toBe("GIT_REPOSITORY_MISMATCH");
    expect(gitCalls()).toEqual(["init"]);
    expect(fingerprint(tripwire)).toEqual(before);
  });

  it("aborts and cleans only its own sandbox when a later command fails", async () => {
    const tripwire = makeTripwire();
    const before = fingerprint(tripwire);
    const sibling = path.join(tripwire, "keep.txt");
    writeFileSync(sibling, "unrelated\n");
    mockedRun.mockImplementation(async (target, args, options) => {
      if (args.includes("user.email")) return { ok: false, exitCode: 1, stdout: "", stderr: "simulated failure", timedOut: false, unavailable: false };
      return realRunSandboxGit(target, args, options);
    });
    const runtimeRoot = path.join(tripwire, "runtime");
    expect(await codeOf(createBenchmarkSandbox({ canonicalProjectRoot: makeCanonicalFixture(), runtimeRoot, sandboxId: "late-failure" }))).toBe("GIT_FAILED");
    expect(gitCalls()).not.toContain("add");
    expect(gitCalls()).not.toContain("commit");
    expect(existsSync(path.join(runtimeRoot, "late-failure"))).toBe(false);
    expect(readFileSync(sibling, "utf8")).toBe("unrelated\n");
    expect(fingerprint(tripwire)).toEqual(before);
  });

  it("reports a specific diagnostic for the verification failure", async () => {
    const tripwire = makeTripwire();
    mockedRun.mockImplementation(async (target, args, options) =>
      args[0] === "init"
        ? { ok: true, exitCode: 0, stdout: "", stderr: "", timedOut: false, unavailable: false }
        : realRunSandboxGit(target, args, options)
    );
    const failure = await createBenchmarkSandbox({
      canonicalProjectRoot: makeCanonicalFixture(),
      runtimeRoot: path.join(tripwire, "runtime"),
      sandboxId: "diagnostic"
    }).catch((error: unknown) => error as BenchmarkSandboxError);
    expect((failure as BenchmarkSandboxError).message).toMatch(/GIT_REPOSITORY_MISMATCH/);
    expect((failure as BenchmarkSandboxError).message).toMatch(/no \.git entry/);
  });

  it("ignores injected GIT_DIR, GIT_WORK_TREE and config hints from the parent environment", async () => {
    const tripwire = makeTripwire();
    const before = fingerprint(tripwire);
    const injected: Record<string, string> = {
      GIT_DIR: path.join(tripwire, ".git"),
      GIT_WORK_TREE: tripwire,
      GIT_INDEX_FILE: path.join(tripwire, ".git", "index"),
      GIT_CEILING_DIRECTORIES: path.parse(tripwire).root,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.symlinks",
      GIT_CONFIG_VALUE_0: "true"
    };
    const saved = Object.fromEntries(Object.keys(injected).map((key) => [key, process.env[key]]));
    Object.assign(process.env, injected);
    try {
      expect(Object.keys(buildMinimalHostEnv(process.env, {})).filter((key) => key.startsWith("GIT_"))).toEqual([]);
      const runtimeRoot = path.join(tripwire, "runtime");
      const sandbox = await createBenchmarkSandbox({ canonicalProjectRoot: makeCanonicalFixture(), runtimeRoot, sandboxId: "injected" });
      trackSandbox(runtimeRoot, "injected");
      expect((await runSandboxGit(sandbox, ["config", "--local", "--get", "core.symlinks"], { label: "t-sym" })).stdout.trim()).toBe("false");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    expect(fingerprint(tripwire)).toEqual(before);
  });

  it("refuses a per-call environment override that could redirect the repository, without starting Git", async () => {
    const tripwire = makeTripwire();
    const before = fingerprint(tripwire);
    const runtimeRoot = path.join(tripwire, "runtime");
    const sandbox = await createBenchmarkSandbox({ canonicalProjectRoot: makeCanonicalFixture(), runtimeRoot, sandboxId: "override" });
    trackSandbox(runtimeRoot, "override");
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "git_dir", "GIT_INDEX_FILE", "GIT_CEILING_DIRECTORIES"]) {
      const result = await realRunSandboxGit(sandbox, ["config", "user.name", "x"], { label: "t-override", env: { [key]: tripwire } });
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBeNull();
      expect(result.error).toMatch(/redirect/);
    }
    expect((await runSandboxGit(sandbox, ["config", "--local", "--get", "user.name"], { label: "t-name" })).stdout.trim()).toBe(SIX_KEYS["user.name"]);
    expect(fingerprint(tripwire)).toEqual(before);
  });

  it("pins later commands to the sandbox repository even when a parent repository exists", async () => {
    const tripwire = makeTripwire();
    const before = fingerprint(tripwire);
    const runtimeRoot = path.join(tripwire, "runtime");
    const sandbox = await createBenchmarkSandbox({ canonicalProjectRoot: makeCanonicalFixture(), runtimeRoot, sandboxId: "pinned" });
    trackSandbox(runtimeRoot, "pinned");
    writeFileSync(path.join(sandbox.projectRoot, "extra.txt"), "x\n");
    await runSandboxGit(sandbox, ["add", "-A", "--force"], { label: "t-add" });
    await runSandboxGit(sandbox, ["config", "core.autocrlf", "false"], { label: "t-config" });
    expect((await runSandboxGit(sandbox, ["diff", "--cached", "--name-only"], { label: "t-cached" })).stdout.trim()).toBe("extra.txt");
    expect(fingerprint(tripwire)).toEqual(before);
    expect(statSync(path.join(sandbox.projectRoot, ".git")).isDirectory()).toBe(true);
  });
});

describe("verifySandboxRepositoryBinding", () => {
  it("accepts a freshly initialized sandbox repository", async () => {
    const tripwire = makeTripwire();
    const runtimeRoot = path.join(tripwire, "runtime");
    const sandbox = await createBenchmarkSandbox({ canonicalProjectRoot: makeCanonicalFixture(), runtimeRoot, sandboxId: "verified" });
    trackSandbox(runtimeRoot, "verified");
    expect(await verifySandboxRepositoryBinding(sandbox)).toEqual({ ok: true });
  });

  it("rejects a project directory inside another repository that has no repository of its own", async () => {
    const tripwire = makeTripwire();
    const projectRoot = path.join(tripwire, "plain-project");
    const evidenceRoot = path.join(tripwire, "plain-evidence");
    mkdirSync(projectRoot);
    mkdirSync(evidenceRoot);
    const check = await verifySandboxRepositoryBinding({ projectRoot, evidenceRoot });
    expect(check.ok).toBe(false);
  });
});

describe("benchmark sandbox Git containment at the observed Windows path-length boundary", () => {
  const windowsOnly = process.platform === "win32" ? it : it.skip;

  async function attempt(length: number): Promise<{
    tripwire: string;
    before: Record<string, string | number>;
    runtimeRoot: string;
    outcome: string;
    detail: string;
    sandboxId: string;
  }> {
    const tripwire = makeTripwire();
    const before = fingerprint(tripwire);
    const sandboxId = `len${length}`;
    const runtimeRoot = runtimeRootForProjectLength(tripwire, sandboxId, length);
    expect(path.join(runtimeRoot, sandboxId, "project").length).toBe(length);
    const outcome = (await codeOf(createBenchmarkSandbox({ canonicalProjectRoot: makeCanonicalFixture(), runtimeRoot, sandboxId }))) ?? "created";
    if (outcome === "created") trackSandbox(runtimeRoot, sandboxId);
    return { tripwire, before, runtimeRoot, outcome, detail: outcome === "created" ? "" : lastErrorDetail, sandboxId };
  }

  windowsOnly("completes locally at 246 characters and leaves the ancestor untouched", async () => {
    const result = await attempt(246);
    expect(result.outcome, result.detail).toBe("created");
    expect(fingerprint(result.tripwire)).toEqual(result.before);
    const config = readFileSync(path.join(result.runtimeRoot, result.sandboxId, "project", ".git", "config"), "utf8");
    expect(config).toContain("symlinks = false");
  });

  windowsOnly("at 247 characters either proves the sandbox binding or fails closed, never touching the ancestor", async () => {
    const result = await attempt(247);
    expect(["created", "GIT_REPOSITORY_MISMATCH", "GIT_FAILED"]).toContain(result.outcome);
    if (result.outcome === "created") {
      const config = readFileSync(path.join(result.runtimeRoot, result.sandboxId, "project", ".git", "config"), "utf8");
      expect(config).toContain("symlinks = false");
    } else {
      expect(existsSync(path.join(result.runtimeRoot, result.sandboxId))).toBe(false);
    }
    expect(fingerprint(result.tripwire)).toEqual(result.before);
  });

  windowsOnly("at 248 characters fails without issuing config, add, or commit and leaves the ancestor untouched", async () => {
    mockedRun.mockClear();
    const result = await attempt(248);
    expect(["GIT_FAILED", "GIT_REPOSITORY_MISMATCH"]).toContain(result.outcome);
    const commands = gitCalls();
    expect(commands).toEqual(["init"]);
    expect(existsSync(path.join(result.runtimeRoot, result.sandboxId))).toBe(false);
    expect(fingerprint(result.tripwire)).toEqual(result.before);
  });
});
