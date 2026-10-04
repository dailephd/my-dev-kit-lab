import { mkdtempSync, rmSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Records every path the module under test reads, while still delegating to the real implementation.
const readPaths: string[] = [];
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    readFile: (async (...callArgs: Parameters<typeof original.readFile>) => {
      readPaths.push(String(callArgs[0]));
      return original.readFile(...callArgs);
    }) as typeof original.readFile,
  };
});

import { captureTargetSnapshot } from "../../../src/evaluation/targetImmutability/captureTargetSnapshot.js";
import { compareTargetSnapshots } from "../../../src/evaluation/targetImmutability/compareTargetSnapshots.js";
import { commitAll, git, initRepository, writeRepositoryFile } from "../localRepositorySubject/fixtureRepository.js";

const BOUND = 50;
let root: string;

beforeEach(() => {
  readPaths.length = 0;
  root = mkdtempSync(path.join(os.tmpdir(), "lrs-snap-"));
  initRepository(root);
  writeRepositoryFile(root, ".gitignore", "ignored/\nsecret-ignored.ts\n");
  writeRepositoryFile(root, "src/tracked.ts", "export const t = 1;\n");
  commitAll(root);
  writeRepositoryFile(root, "src/untracked-small.ts", "export const s = 1;\n");
  writeRepositoryFile(root, "src/untracked-large.ts", "L".repeat(BOUND + 25));
  writeRepositoryFile(root, "secret-ignored.ts", "IGNORED_CONTENT_MARKER");
  writeRepositoryFile(root, "ignored/inner.ts", "IGNORED_DIR_CONTENT_MARKER");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const SAFE = { externalLocalSafe: { maxHashedFileBytes: BOUND } };
const config = (files: string[] = ["src/tracked.ts"]) => ({ targetRootPath: root, relativeFilePaths: files });

async function capture(files?: string[], options?: typeof SAFE) {
  const result = await captureTargetSnapshot(config(files), options);
  if (!result.ok) throw new Error(`snapshot failed: ${result.code}`);
  return result.snapshot;
}

describe("RSP-014 external-local safe snapshot mode", () => {
  it("never reads oversized or ignored contents but still hashes small files and records metadata", async () => {
    const snapshot = await capture(["src/tracked.ts", "src/untracked-large.ts"], SAFE);
    const reads = readPaths.map((entry) => entry.replace(/\\/g, "/"));
    expect(reads.some((entry) => entry.endsWith("src/untracked-small.ts"))).toBe(true);
    expect(reads.some((entry) => entry.endsWith("src/tracked.ts"))).toBe(true);
    expect(reads.some((entry) => entry.endsWith("src/untracked-large.ts"))).toBe(false);
    expect(reads.some((entry) => entry.includes("secret-ignored.ts") || entry.includes("ignored/inner.ts"))).toBe(false);

    const large = snapshot.git.untrackedFiles.find((entry) => entry.path === "src/untracked-large.ts");
    expect(large?.sha256).toBeNull();
    expect(large?.state).toBe("file");
    expect(large?.contentFingerprint).toEqual({ sizeBytes: BOUND + 25, mtimeMs: expect.any(Number) });
    const small = snapshot.git.untrackedFiles.find((entry) => entry.path === "src/untracked-small.ts");
    expect(small?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(small?.contentFingerprint).toBeUndefined();

    const configuredLarge = snapshot.configuredFiles.find((entry) => entry.relativePath === "src/untracked-large.ts");
    expect(configuredLarge?.sha256).toBeNull();
    expect(configuredLarge?.contentFingerprint?.sizeBytes).toBe(BOUND + 25);
    expect(snapshot.git.ignoredPaths).toEqual(["ignored/inner.ts", "secret-ignored.ts"]);
    expect(JSON.stringify(snapshot)).not.toContain("IGNORED_CONTENT_MARKER");
  });

  it("keeps the legacy snapshot shape and behavior when no options are given", async () => {
    const snapshot = await capture(["src/tracked.ts"]);
    expect(snapshot.git.ignoredPaths).toBeUndefined();
    expect("ignoredPaths" in snapshot.git).toBe(false);
    for (const entry of snapshot.git.untrackedFiles) {
      expect("contentFingerprint" in entry).toBe(false);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // The legacy path hashes the large file; it also still never lists ignored paths.
    expect(readPaths.some((entry) => entry.replace(/\\/g, "/").endsWith("src/untracked-large.ts"))).toBe(true);
    expect(snapshot.git.untrackedFiles.map((entry) => entry.path)).toEqual(["src/untracked-large.ts", "src/untracked-small.ts"]);
  });

  it("compares identical safe snapshots as unchanged and detects ignored-space additions and deletions", async () => {
    const before = await capture(undefined, SAFE);
    expect(compareTargetSnapshots(before, await capture(undefined, SAFE)).status).toBe("unchanged");

    writeRepositoryFile(root, "ignored/created.ts", "x");
    const added = compareTargetSnapshots(before, await capture(undefined, SAFE));
    expect(added.status).toBe("mutated");
    expect(added.mutations.map((mutation) => mutation.kind)).toEqual(["git-ignored-paths"]);

    rmSync(path.join(root, "ignored", "inner.ts"));
    rmSync(path.join(root, "ignored", "created.ts"));
    const removed = compareTargetSnapshots(before, await capture(undefined, SAFE));
    expect(removed.mutations.map((mutation) => mutation.kind)).toEqual(["git-ignored-paths"]);
  });

  it("detects a change to an oversized untracked file by size without reading it", async () => {
    const before = await capture(undefined, SAFE);
    writeFileSync(path.join(root, "src", "untracked-large.ts"), "M".repeat(BOUND + 60));
    readPaths.length = 0;
    const after = await capture(undefined, SAFE);
    expect(readPaths.some((entry) => entry.replace(/\\/g, "/").endsWith("src/untracked-large.ts"))).toBe(false);
    const comparison = compareTargetSnapshots(before, after);
    expect(comparison.status).toBe("mutated");
    expect(comparison.mutations.map((mutation) => mutation.id)).toContain("git.untracked:src/untracked-large.ts");
  });

  it("detects a same-size rewrite of an oversized file through its modification time", async () => {
    const target = path.join(root, "src", "untracked-large.ts");
    const before = await capture(undefined, SAFE);
    writeFileSync(target, "N".repeat(BOUND + 25));
    const future = new Date(Date.now() + 60_000);
    utimesSync(target, future, future);
    const comparison = compareTargetSnapshots(before, await capture(undefined, SAFE));
    expect(comparison.mutations.map((mutation) => mutation.id)).toContain("git.untracked:src/untracked-large.ts");
  });

  it("still detects tracked edits, staged changes and untracked additions in safe mode", async () => {
    const before = await capture(undefined, SAFE);
    writeRepositoryFile(root, "src/tracked.ts", "export const t = 2;\n");
    git(root, "add", "src/tracked.ts");
    writeRepositoryFile(root, "src/added.ts", "export const a = 1;\n");
    const kinds = compareTargetSnapshots(before, await capture(undefined, SAFE)).mutations.map((mutation) => mutation.kind);
    expect(kinds).toEqual(expect.arrayContaining(["git-status", "git-staged-diff", "git-untracked-file", "configured-file"]));
  });

  it("treats a snapshot without ignored paths and one with them as different, but two legacy snapshots as equal", async () => {
    const legacyBefore = await capture();
    expect(compareTargetSnapshots(legacyBefore, await capture()).status).toBe("unchanged");
    const safe = await capture(undefined, SAFE);
    expect(compareTargetSnapshots(legacyBefore, safe).mutations.map((mutation) => mutation.kind)).toContain("git-ignored-paths");
  });

  it("handles ignored paths with unusual characters exactly", async () => {
    mkdirSync(path.join(root, "ignored", "dir with space"), { recursive: true });
    writeFileSync(path.join(root, "ignored", "dir with space", "ü file.ts"), "x");
    const snapshot = await capture(undefined, SAFE);
    expect(snapshot.git.ignoredPaths).toContain("ignored/dir with space/ü file.ts");
  });
});
