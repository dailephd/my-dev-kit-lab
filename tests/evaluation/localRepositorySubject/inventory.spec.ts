import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LOCAL_REPOSITORY_SUBJECT_MAX_FILE_BYTES,
  LOCAL_REPOSITORY_SUBJECT_SAFETY_POLICY_VERSION,
  buildLocalRepositorySubjectInventory,
  classifyGitIgnoredPaths,
  loadLocalRepositorySubject,
} from "../../../src/evaluation/localRepositorySubject/index.js";
import type { InventoryEntryStats, LocalRepositorySubjectFsIo } from "../../../src/evaluation/localRepositorySubject/index.js";
import {
  commitAll,
  createCommittedRepository,
  git,
  initRepository,
  makeTempDir,
  minimalCase,
  minimalConfig,
  removeTempDir,
  tryCreateSymlink,
  writeRepositoryFile,
} from "./fixtureRepository.js";

let root: string;
beforeEach(() => {
  root = makeTempDir();
});
afterEach(() => {
  removeTempDir(root);
});

const paths = (inventory: { eligibleFiles: { path: string }[] }) => inventory.eligibleFiles.map((file) => file.path);

describe("RSP-007 Git is the ignore authority", () => {
  beforeEach(() => {
    initRepository(root);
    writeRepositoryFile(root, ".gitignore", "*.generated.ts\nbuild/\n");
    writeRepositoryFile(root, "src/main.ts");
    writeRepositoryFile(root, "src/util/helper.ts");
    writeRepositoryFile(root, "src/force-tracked.generated.ts", "export const tracked = 1;\n");
    commitAll(root);
    // Added to the index despite matching an ignore pattern: Git treats tracked files as not ignored.
    git(root, "add", "-f", "src/force-tracked.generated.ts");
    git(root, "commit", "-q", "--allow-empty", "-m", "track forced file");
    writeRepositoryFile(root, "src/untracked-ignored.generated.ts", "export const ignored = 1;\n");
    writeRepositoryFile(root, "src/build/out.ts", "export const out = 1;\n");
    writeRepositoryFile(root, "src/build/deep/more.ts", "export const more = 1;\n");
  });

  it("keeps tracked source eligible and excludes ignored files and ignored directory contents", async () => {
    const inventory = await buildLocalRepositorySubjectInventory(root, ["src"], DEFAULT_LOCAL_REPOSITORY_SUBJECT_MAX_FILE_BYTES);
    expect(paths(inventory)).toEqual(["src/force-tracked.generated.ts", "src/main.ts", "src/util/helper.ts"]);
    expect([...inventory.ignoredFiles].sort()).toEqual([
      "src/build/deep/more.ts",
      "src/build/out.ts",
      "src/untracked-ignored.generated.ts",
    ]);
    expect(inventory.counts.gitIgnoredCount).toBe(3);
    expect(inventory.counts.eligibleFileCount).toBe(3);
  });

  it("classifyGitIgnoredPaths returns only what Git reports ignored", async () => {
    const ignored = await classifyGitIgnoredPaths(root, ["src/main.ts", "src/untracked-ignored.generated.ts", "src/force-tracked.generated.ts"]);
    expect([...ignored]).toEqual(["src/untracked-ignored.generated.ts"]);
    expect((await classifyGitIgnoredPaths(root, [])).size).toBe(0);
  });

  it("lets a broad rawIncludeGlobs coexist with ignored files without failing validation", async () => {
    const subject = await loadLocalRepositorySubject({
      config: minimalConfig({ cases: [minimalCase({ rawIncludeGlobs: ["**/*"] })] }),
      repositoryPath: root,
    });
    expect(subject.evaluationCases[0].rawIncludeGlobs).toEqual(["**/*"]);
    expect(subject.manifest.inventory.gitIgnoredCount).toBe(3);
    expect(subject.eligibleFiles).not.toContain("src/build/out.ts");
  });
});

describe("RSP-009 large-file policy is metadata-only and exact at the boundary", () => {
  it("exposes the frozen operational default and policy version", async () => {
    expect(DEFAULT_LOCAL_REPOSITORY_SUBJECT_MAX_FILE_BYTES).toBe(1_048_576);
    createCommittedRepository(root);
    const subject = await loadLocalRepositorySubject({ config: minimalConfig(), repositoryPath: root });
    expect(subject.manifest.safetyPolicy).toEqual({
      version: LOCAL_REPOSITORY_SUBJECT_SAFETY_POLICY_VERSION,
      maxFileBytes: 1_048_576,
      gitIgnoreAuthority: "git",
      symlinkPolicy: "excluded-not-followed",
    });
  });

  it("treats size <= threshold as eligible and size > threshold as oversized", async () => {
    initRepository(root);
    writeRepositoryFile(root, "src/below.ts", Buffer.alloc(99, "a"));
    writeRepositoryFile(root, "src/at.ts", Buffer.alloc(100, "a"));
    writeRepositoryFile(root, "src/above.ts", Buffer.alloc(101, "a"));
    commitAll(root);
    const inventory = await buildLocalRepositorySubjectInventory(root, ["src"], 100);
    expect(paths(inventory)).toEqual(["src/at.ts", "src/below.ts"]);
    expect([...inventory.oversizedFiles]).toEqual(["src/above.ts"]);
    expect(inventory.counts).toMatchObject({ eligibleFileCount: 2, eligibleByteCount: 199, oversizedCount: 1 });
  });

  it("honors the exact 1 MiB default boundary with a real file", async () => {
    initRepository(root);
    writeRepositoryFile(root, "src/at-limit.bin", Buffer.alloc(1_048_576, 1));
    writeRepositoryFile(root, "src/over-limit.bin", Buffer.alloc(1_048_577, 1));
    commitAll(root);
    const inventory = await buildLocalRepositorySubjectInventory(root, ["src"], DEFAULT_LOCAL_REPOSITORY_SUBJECT_MAX_FILE_BYTES);
    expect(paths(inventory)).toEqual(["src/at-limit.bin"]);
    expect([...inventory.oversizedFiles]).toEqual(["src/over-limit.bin"]);
  });

  it("classifies from metadata with an io that has no way to read file contents", async () => {
    initRepository(root);
    writeRepositoryFile(root, "placeholder.txt", "x");
    commitAll(root);
    const stat = (kind: "dir" | "file", size = 0): InventoryEntryStats => ({
      isSymbolicLink: () => false,
      isDirectory: () => kind === "dir",
      isFile: () => kind === "file",
      size,
    });
    const calls: string[] = [];
    const io: LocalRepositorySubjectFsIo = {
      readdir: async (directory) => {
        calls.push(`readdir:${path.basename(directory)}`);
        return ["small.ts", "huge.ts"];
      },
      lstat: async (entry) => {
        calls.push(`lstat:${path.basename(entry)}`);
        return path.basename(entry) === "huge.ts" ? stat("file", 5_000_000) : stat("file", 10);
      },
    };
    expect(Object.keys(io).sort()).toEqual(["lstat", "readdir"]);
    const inventory = await buildLocalRepositorySubjectInventory(root, ["."], 1000, io);
    expect(inventory.counts.oversizedCount).toBe(1);
    expect(inventory.counts.eligibleFileCount).toBe(1);
    expect(calls.every((call) => call.startsWith("lstat:") || call.startsWith("readdir:"))).toBe(true);
  });
});

describe("RSP-005 symlinks are never followed", () => {
  it("excludes and counts nested symlinks and never lets an outside target contribute files", async () => {
    initRepository(root);
    writeRepositoryFile(root, "src/main.ts");
    const outside = makeTempDir("lrs-outside-");
    try {
      writeFileSync(path.join(outside, "secret.ts"), "export const secret = 1;\n");
      mkdirSync(path.join(outside, "dir"));
      writeFileSync(path.join(outside, "dir", "inner.ts"), "x\n");
      const fileLink = tryCreateSymlink(path.join(outside, "secret.ts"), path.join(root, "src", "link-file.ts"), "file");
      const dirLink = tryCreateSymlink(path.join(outside, "dir"), path.join(root, "src", "link-dir"), "dir");
      const insideLink = tryCreateSymlink(path.join(root, "src", "main.ts"), path.join(root, "src", "link-inside.ts"), "file");
      if (!fileLink.ok || !dirLink.ok || !insideLink.ok) {
        console.warn(`skipping symlink inventory assertions: ${[fileLink, dirLink, insideLink].find((r) => !r.ok && "reason" in r)?.["reason" as never]}`);
        return;
      }
      commitAll(root);
      const inventory = await buildLocalRepositorySubjectInventory(root, ["src"], DEFAULT_LOCAL_REPOSITORY_SUBJECT_MAX_FILE_BYTES);
      expect(paths(inventory)).toEqual(["src/main.ts"]);
      expect(inventory.counts.symlinkCount).toBe(3);
    } finally {
      removeTempDir(outside);
    }
  });
});
