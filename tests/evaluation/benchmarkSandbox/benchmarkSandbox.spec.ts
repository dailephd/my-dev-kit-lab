import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { symlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BenchmarkSandboxError,
  createBenchmarkSandbox,
  removeBenchmarkSandbox,
  runSandboxGit,
  snapshotProjectTree,
  buildMinimalHostEnv
} from "../../../src/evaluation/benchmarkSandbox/index.js";
import {
  FIXTURE_FILES,
  initCanonicalGitRepository,
  makeCanonicalFixture,
  makeSandbox,
  makeTempDir,
  trackSandbox,
  useSandboxTestCleanup,
  writeProjectFiles
} from "./sandboxTestHelpers.js";

useSandboxTestCleanup();

const SNAPSHOT_ALL = { excludedNames: [] as string[] };

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof BenchmarkSandboxError ? error.code : `unexpected:${String(error)}`;
  }
}

async function makeLink(target: string, linkPath: string): Promise<void> {
  // A junction needs no privilege on Windows and is reported by lstat as a symbolic link.
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

describe("benchmark sandbox creation", () => {
  it("RSP-007 copies a benchmark project into the caller-supplied runtime root", async () => {
    const canonical = makeCanonicalFixture();
    const runtimeRoot = path.join(makeTempDir("lab-rt-"), "runtime");
    const sandbox = await makeSandbox(canonical, "copy1", runtimeRoot);

    expect(sandbox.runtimeRoot).toBe(runtimeRoot);
    expect(sandbox.sandboxRoot).toBe(path.join(runtimeRoot, "copy1"));
    expect(sandbox.projectRoot.startsWith(runtimeRoot)).toBe(true);
    expect(sandbox.evidenceRoot.startsWith(sandbox.projectRoot)).toBe(false);
    expect(existsSync(path.join(sandbox.sandboxRoot, "sandbox-owner.json"))).toBe(true);
    expect(sandbox.baseline.commit).toMatch(/^[0-9a-f]{40}$/);

    const copied = await snapshotProjectTree(sandbox.projectRoot, { excludedNames: [".git"] });
    const original = await snapshotProjectTree(canonical, SNAPSHOT_ALL);
    expect(copied).toEqual(original);
    expect(sandbox.baseline.fileCount).toBe(Object.keys(FIXTURE_FILES).length);
    expect([...sandbox.baseline.manifest]).toEqual(original);
  });

  it("RSP-007 copies a real controlled benchmark project without modifying it", async () => {
    const canonical = path.resolve("benchmarks", "projects", "todo-ts");
    const before = await snapshotProjectTree(canonical, SNAPSHOT_ALL);
    const sandbox = await makeSandbox(canonical, "real-todo");
    expect(sandbox.baseline.fileCount).toBe(before.length);
    expect(existsSync(path.join(sandbox.projectRoot, "node_modules"))).toBe(false);
    expect(await snapshotProjectTree(canonical, SNAPSHOT_ALL)).toEqual(before);
  });

  it("RSP-008 omits generated and internal directories at the root and at nested depth", async () => {
    const excluded = [
      ".git/canonical-marker",
      "node_modules/pkg/index.js",
      "dist/out.js",
      "build/out.js",
      "coverage/report.json",
      "lab-output/run.json",
      ".my-dev-kit-context/index.json",
      ".my-dev-kit-orchestrator/run.json",
      "pkg/node_modules/dep/index.js",
      "pkg/dist/bundle.js"
    ];
    const canonical = makeCanonicalFixture(Object.fromEntries([...excluded, "pkg/keep.txt"].map((file) => [file, `content of ${file}\n`])));
    const sandbox = await makeSandbox(canonical, "excluded");
    for (const file of excluded) {
      expect(existsSync(path.join(sandbox.projectRoot, ...file.split("/"))), file).toBe(false);
    }
    expect(sandbox.baseline.manifest.map((entry) => entry.path)).not.toContain("node_modules/pkg/index.js");
    expect(existsSync(path.join(sandbox.projectRoot, "pkg", "keep.txt"))).toBe(true);
    expect(sandbox.baseline.manifest.map((entry) => entry.path)).toContain("pkg/keep.txt");
  });

  it("RSP-009 rejects a source symlink before copying anything", async () => {
    const canonical = makeCanonicalFixture();
    const outside = makeTempDir("lab-outside-");
    writeFileSync(path.join(outside, "secret.txt"), "outside\n");
    await makeLink(outside, path.join(canonical, "linked"));
    const runtimeRoot = path.join(makeTempDir("lab-rt-"), "runtime");

    expect(await codeOf(createBenchmarkSandbox({ canonicalProjectRoot: canonical, runtimeRoot, sandboxId: "link1" }))).toBe("SYMLINK_REJECTED");
    expect(existsSync(path.join(runtimeRoot, "link1"))).toBe(false);
  });

  it("RSP-009 rejects a canonical root that is itself a link", async () => {
    const real = makeCanonicalFixture();
    const linkParent = makeTempDir("lab-linkroot-");
    const link = path.join(linkParent, "canonical-link");
    await makeLink(real, link);
    const runtimeRoot = path.join(makeTempDir("lab-rt-"), "runtime");
    expect(await codeOf(createBenchmarkSandbox({ canonicalProjectRoot: link, runtimeRoot, sandboxId: "link2" }))).toBe("CANONICAL_ROOT_INVALID");
  });

  it("RSP-010 rejects runtime roots that overlap the canonical project and invalid sandbox ids", async () => {
    const canonical = makeCanonicalFixture();
    const before = await snapshotProjectTree(canonical, SNAPSHOT_ALL);
    const inside = path.join(canonical, "runtime-sub");
    expect(await codeOf(createBenchmarkSandbox({ canonicalProjectRoot: canonical, runtimeRoot: inside, sandboxId: "x1" }))).toBe("RUNTIME_OVERLAP");
    expect(await codeOf(createBenchmarkSandbox({ canonicalProjectRoot: canonical, runtimeRoot: canonical, sandboxId: "x2" }))).toBe("RUNTIME_OVERLAP");
    expect(await codeOf(createBenchmarkSandbox({ canonicalProjectRoot: canonical, runtimeRoot: path.dirname(canonical), sandboxId: "x3" }))).toBe("RUNTIME_OVERLAP");
    expect(existsSync(inside)).toBe(false);
    for (const sandboxId of ["../escape", "a/b", "a\\b", "", ".hidden", "x".repeat(65), "bad id"]) {
      const runtimeRoot = path.join(makeTempDir("lab-rt-"), "runtime");
      expect(await codeOf(createBenchmarkSandbox({ canonicalProjectRoot: canonical, runtimeRoot, sandboxId })), sandboxId).toBe("INVALID_SANDBOX_ID");
    }
    expect(await snapshotProjectTree(canonical, SNAPSHOT_ALL)).toEqual(before);
  });

  it("RSP-010 refuses to overwrite an existing sandbox and rejects a missing or empty canonical project", async () => {
    const canonical = makeCanonicalFixture();
    const runtimeRoot = path.join(makeTempDir("lab-rt-"), "runtime");
    await makeSandbox(canonical, "dup", runtimeRoot);
    expect(await codeOf(createBenchmarkSandbox({ canonicalProjectRoot: canonical, runtimeRoot, sandboxId: "dup" }))).toBe("SANDBOX_EXISTS");
    expect(await codeOf(createBenchmarkSandbox({ canonicalProjectRoot: path.join(canonical, "nope"), runtimeRoot, sandboxId: "n1" }))).toBe("CANONICAL_ROOT_INVALID");
    const onlyExcluded = path.join(makeTempDir("lab-empty-"), "project");
    mkdirSync(path.join(onlyExcluded, "node_modules"), { recursive: true });
    writeFileSync(path.join(onlyExcluded, "node_modules", "x.js"), "x\n");
    expect(await codeOf(createBenchmarkSandbox({ canonicalProjectRoot: onlyExcluded, runtimeRoot, sandboxId: "n2" }))).toBe("EMPTY_PROJECT");
    expect(existsSync(path.join(runtimeRoot, "n2"))).toBe(false);
  });

  it("RSP-011 produces independent copies for separate treatments", async () => {
    const canonical = makeCanonicalFixture();
    const runtimeRoot = path.join(makeTempDir("lab-rt-"), "runtime");
    const first = await makeSandbox(canonical, "treatment-a", runtimeRoot);
    const second = await makeSandbox(canonical, "treatment-b", runtimeRoot);
    expect(first.projectRoot).not.toBe(second.projectRoot);
    // Same canonical content, fixed commit dates: the baseline identity is reproducible.
    expect(first.baseline.commit).toBe(second.baseline.commit);
    expect(first.baseline.digest).toBe(second.baseline.digest);
    const before = await snapshotProjectTree(canonical, SNAPSHOT_ALL);

    writeFileSync(path.join(first.projectRoot, "src", "math.cjs"), "changed in first only\n");
    writeFileSync(path.join(first.projectRoot, "added.txt"), "new\n");

    expect(readFileSync(path.join(second.projectRoot, "src", "math.cjs"), "utf8")).toBe(FIXTURE_FILES["src/math.cjs"]);
    expect(existsSync(path.join(second.projectRoot, "added.txt"))).toBe(false);
    expect(await snapshotProjectTree(canonical, SNAPSHOT_ALL)).toEqual(before);
  });

  it("RSP-012 creates a clean ephemeral Git baseline and never imports the canonical .git", async () => {
    const canonical = makeCanonicalFixture();
    const canonicalCommit = initCanonicalGitRepository(canonical);
    const sandbox = await makeSandbox(canonical, "git1");

    const status = await runSandboxGit(sandbox, ["status", "--porcelain"], { label: "t-status" });
    expect(status.ok).toBe(true);
    expect(status.stdout.trim()).toBe("");
    const count = await runSandboxGit(sandbox, ["rev-list", "--count", "HEAD"], { label: "t-count" });
    expect(count.stdout.trim()).toBe("1");
    const head = await runSandboxGit(sandbox, ["rev-parse", "HEAD"], { label: "t-head" });
    expect(head.stdout.trim()).toBe(sandbox.baseline.commit);
    expect(sandbox.baseline.commit).not.toBe(canonicalCommit);
    const author = await runSandboxGit(sandbox, ["log", "-1", "--format=%an"], { label: "t-author" });
    expect(author.stdout.trim()).toBe("my-dev-kit-lab sandbox");
    const canonicalObject = await runSandboxGit(sandbox, ["cat-file", "-e", canonicalCommit], { label: "t-canon" });
    expect(canonicalObject.ok).toBe(false);
    expect(existsSync(path.join(sandbox.projectRoot, ".git"))).toBe(true);
  });

  it("RSP-012 does not leak parent-environment secrets into Git or read the developer's Git config", () => {
    const env = buildMinimalHostEnv({ PATH: "p", Path: "p", API_KEY: "k", GITHUB_TOKEN: "t", TMP: "tmp", MY_SECRET: "s", HOME: "/home/x" } as NodeJS.ProcessEnv);
    expect(Object.keys(env).map((key) => key.toLowerCase())).not.toContain("api_key");
    expect(Object.keys(env).map((key) => key.toLowerCase())).not.toContain("github_token");
    expect(Object.keys(env).map((key) => key.toLowerCase())).not.toContain("home");
    expect(env.TMP).toBe("tmp");
  });
});

describe("benchmark sandbox cleanup and canonical protection", () => {
  it("RSP-013 removes an owned sandbox and leaves the runtime root", async () => {
    const canonical = makeCanonicalFixture();
    const runtimeRoot = path.join(makeTempDir("lab-rt-"), "runtime");
    const sandbox = await makeSandbox(canonical, "owned", runtimeRoot);
    expect(existsSync(sandbox.sandboxRoot)).toBe(true);

    const result = await removeBenchmarkSandbox({ runtimeRoot, sandboxId: "owned" });
    expect(result).toEqual({ removed: true, alreadyAbsent: false });
    expect(existsSync(sandbox.sandboxRoot)).toBe(false);
    expect(existsSync(runtimeRoot)).toBe(true);
    expect(await removeBenchmarkSandbox({ runtimeRoot, sandboxId: "owned" })).toEqual({ removed: true, alreadyAbsent: true });
  });

  it("RSP-014 refuses to remove unowned, mismatched, linked or invalid sandbox directories", async () => {
    const canonical = makeCanonicalFixture();
    const runtimeRoot = path.join(makeTempDir("lab-rt-"), "runtime");
    mkdirSync(path.join(runtimeRoot, "plain"), { recursive: true });
    writeFileSync(path.join(runtimeRoot, "plain", "keep.txt"), "keep\n");
    const refused = await removeBenchmarkSandbox({ runtimeRoot, sandboxId: "plain" });
    expect(refused.removed).toBe(false);
    expect(readFileSync(path.join(runtimeRoot, "plain", "keep.txt"), "utf8")).toBe("keep\n");

    const sandbox = await makeSandbox(canonical, "marked", runtimeRoot);
    const markerPath = path.join(sandbox.sandboxRoot, "sandbox-owner.json");
    const original = readFileSync(markerPath, "utf8");
    writeFileSync(markerPath, original.replace('"sandboxId": "marked"', '"sandboxId": "someone-else"'));
    expect((await removeBenchmarkSandbox({ runtimeRoot, sandboxId: "marked" })).removed).toBe(false);
    writeFileSync(markerPath, original.replace(JSON.stringify(runtimeRoot).slice(1, -1), JSON.stringify(path.join(runtimeRoot, "elsewhere")).slice(1, -1)));
    expect((await removeBenchmarkSandbox({ runtimeRoot, sandboxId: "marked" })).removed).toBe(false);
    writeFileSync(markerPath, "not json");
    expect((await removeBenchmarkSandbox({ runtimeRoot, sandboxId: "marked" })).removed).toBe(false);
    expect(existsSync(path.join(sandbox.projectRoot, "src", "math.cjs"))).toBe(true);
    writeFileSync(markerPath, original);

    const elsewhere = makeTempDir("lab-elsewhere-");
    writeFileSync(path.join(elsewhere, "sandbox-owner.json"), original.replace('"sandboxId": "marked"', '"sandboxId": "linked"'));
    writeFileSync(path.join(elsewhere, "payload.txt"), "payload\n");
    await makeLink(elsewhere, path.join(runtimeRoot, "linked"));
    const linked = await removeBenchmarkSandbox({ runtimeRoot, sandboxId: "linked" });
    expect(linked.removed).toBe(false);
    expect(readFileSync(path.join(elsewhere, "payload.txt"), "utf8")).toBe("payload\n");
    trackSandbox(runtimeRoot, "marked");

    for (const sandboxId of ["../marked", "a/b", ""]) {
      expect((await removeBenchmarkSandbox({ runtimeRoot, sandboxId })).removed, sandboxId).toBe(false);
    }
    expect((await removeBenchmarkSandbox({ runtimeRoot: path.join(runtimeRoot, "missing-root"), sandboxId: "marked" })).removed).toBe(false);
  });

  it("RSP-015 leaves the canonical source unchanged through creation, mutation, and cleanup", async () => {
    const canonical = makeCanonicalFixture();
    initCanonicalGitRepository(canonical);
    const before = await snapshotProjectTree(canonical, SNAPSHOT_ALL);
    const runtimeRoot = path.join(makeTempDir("lab-rt-"), "runtime");
    const sandbox = await makeSandbox(canonical, "canon", runtimeRoot);

    writeFileSync(path.join(sandbox.projectRoot, "src", "math.cjs"), "mutated\n");
    writeProjectFiles(sandbox.projectRoot, { "new/file.txt": "new\n" });
    expect(await snapshotProjectTree(canonical, SNAPSHOT_ALL)).toEqual(before);

    expect((await removeBenchmarkSandbox({ runtimeRoot, sandboxId: "canon" })).removed).toBe(true);
    expect(await snapshotProjectTree(canonical, SNAPSHOT_ALL)).toEqual(before);
  });
});
