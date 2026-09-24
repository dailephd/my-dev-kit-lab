import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assessIndexFreshness,
  classifyIndexFreshness,
  INDEX_FRESHNESS_SCHEMA_VERSION,
} from "../../src/evaluation/indexFreshness.js";
import type { IndexSnapshotV1 } from "../../src/evaluation/indexSnapshot.js";
import { capture, cleanupTempDirs, makeFixture, writeIndex, type Fixture } from "./indexSnapshotTestHelpers.js";

afterEach(cleanupTempDirs);

const LISTED = ["src/a.ts", "src/nested/b.ts", "tests/a.test.ts"];

async function baseline(files: Record<string, string> = {}, listed = LISTED): Promise<{ fixture: Fixture; snapshot: IndexSnapshotV1 }> {
  const fixture = makeFixture(files);
  writeIndex(fixture, listed);
  return { fixture, snapshot: await capture(fixture) };
}

const assess = (fixture: Fixture, snapshot: IndexSnapshotV1 | null, now?: () => Date) =>
  assessIndexFreshness({ snapshot, targetRoot: fixture.targetRoot, sourceRoots: fixture.sourceRoots, now });

const file = (fixture: Fixture, relative: string) => path.join(fixture.targetRoot, relative);

function hashTree(root: string): Record<string, { sha: string; mtimeMs: number }> {
  const result: Record<string, { sha: string; mtimeMs: number }> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else result[path.relative(root, full).replace(/\\/g, "/")] = { sha: createHash("sha256").update(readFileSync(full)).digest("hex"), mtimeMs: statSync(full).mtimeMs };
    }
  };
  walk(root);
  return result;
}

describe("assessIndexFreshness", () => {
  // TST-B2-001
  it("is fresh when every file of a complete snapshot still matches its content hash", async () => {
    const { fixture, snapshot } = await baseline();
    const result = await assess(fixture, snapshot, () => new Date("2026-02-03T04:05:06.000Z"));

    expect(result).toEqual({
      schemaVersion: INDEX_FRESHNESS_SCHEMA_VERSION,
      status: "fresh",
      assessedAt: "2026-02-03T04:05:06.000Z",
      baselineSnapshotStatus: "complete",
      indexedFileCount: 3,
      comparableFileCount: 3,
      unchangedFileCount: 3,
      changedFileCount: 0,
      missingFileCount: 0,
      unresolvedFileCount: 0,
      changes: [],
      changesTruncated: false,
      unresolved: [],
      unresolvedTruncated: false,
      warnings: [],
    });
  });

  // TST-B2-002
  it("is stale, not partially stale, when one indexed file of a complete snapshot changed", async () => {
    const { fixture, snapshot } = await baseline();
    writeFileSync(file(fixture, "src/a.ts"), "export const a = 999;\n");

    const result = await assess(fixture, snapshot);

    expect(result.status).toBe("stale");
    expect(result.changedFileCount).toBe(1);
    expect(result.unchangedFileCount).toBe(2);
    expect(result.changes).toEqual([
      {
        path: "src/a.ts",
        changeType: "modified",
        baselineSha256: snapshot.files[0].sha256,
        baselineSizeBytes: snapshot.files[0].sizeBytes,
        baselineModifiedAt: snapshot.files[0].modifiedAt,
        currentSha256: createHash("sha256").update("export const a = 999;\n").digest("hex"),
        currentSizeBytes: 22,
        currentModifiedAt: expect.stringMatching(/^\d{4}-/),
      },
    ]);
  });

  // TST-B2-003
  it("is stale with a missing change when an indexed file is deleted", async () => {
    const { fixture, snapshot } = await baseline();
    rmSync(file(fixture, "src/nested/b.ts"));

    const result = await assess(fixture, snapshot);

    expect(result.status).toBe("stale");
    expect(result.missingFileCount).toBe(1);
    expect(result.changedFileCount).toBe(0);
    expect(result.comparableFileCount).toBe(2);
    expect(result.changes).toEqual([
      expect.objectContaining({ path: "src/nested/b.ts", changeType: "missing", currentSha256: null, currentSizeBytes: null, currentModifiedAt: null }),
    ]);
  });

  // TST-B2-004
  it("stays fresh when only the modified time changed", async () => {
    const { fixture, snapshot } = await baseline();
    utimesSync(file(fixture, "src/a.ts"), new Date("2001-01-01T00:00:00Z"), new Date("2001-01-01T00:00:00Z"));

    const result = await assess(fixture, snapshot);

    expect(result.status).toBe("fresh");
    expect(result.changes).toEqual([]);
  });

  // TST-B2-005
  it("is stale when the content changed but the size did not", async () => {
    const { fixture, snapshot } = await baseline({ "src/a.ts": "aaaa" });
    writeFileSync(file(fixture, "src/a.ts"), "bbbb");

    const result = await assess(fixture, snapshot);

    expect(result.status).toBe("stale");
    expect(result.changes[0].baselineSizeBytes).toBe(result.changes[0].currentSizeBytes);
  });

  // TST-B2-006
  it("is unknown for a partial snapshot with no confirmed change", async () => {
    const { fixture, snapshot } = await baseline({}, [...LISTED, "src/never-there.ts"]);
    expect(snapshot.status).toBe("partial");

    const result = await assess(fixture, snapshot);

    expect(result.status).toBe("unknown");
    expect(result.baselineSnapshotStatus).toBe("partial");
    expect(result.unchangedFileCount).toBe(3);
    expect(result.unresolved).toEqual([expect.objectContaining({ path: "src/never-there.ts", reasonCode: "snapshot-file-unresolved" })]);
  });

  // TST-B2-007
  it("is partially stale for a partial snapshot with a confirmed change", async () => {
    const { fixture, snapshot } = await baseline({}, [...LISTED, "src/never-there.ts"]);
    writeFileSync(file(fixture, "src/a.ts"), "changed");

    const result = await assess(fixture, snapshot);

    expect(result.status).toBe("partially-stale");
    expect(result.changedFileCount).toBe(1);
    expect(result.unresolvedFileCount).toBe(1);
  });

  // TST-B2-008
  it("is unknown when the snapshot is unavailable or absent", async () => {
    const fixture = makeFixture();
    const unavailable = await capture(fixture); // no manifest was written
    expect(unavailable.status).toBe("unavailable");

    for (const snapshot of [unavailable, null]) {
      const result = await assess(fixture, snapshot);
      expect(result.status).toBe("unknown");
      expect(result.baselineSnapshotStatus).toBe("unavailable");
      expect(result.indexedFileCount).toBe(0);
      expect(result.unresolved).toEqual([expect.objectContaining({ path: null, reasonCode: "snapshot-unavailable" })]);
    }
  });

  // TST-B2-009
  it("is unknown, never modified, when a current indexed file cannot be read as a file", async () => {
    const { fixture, snapshot } = await baseline();
    rmSync(file(fixture, "src/a.ts"));
    mkdirSync(file(fixture, "src/a.ts")); // now a directory: exists but is unreadable as a file

    const result = await assess(fixture, snapshot);

    expect(result.status).toBe("unknown");
    expect(result.changes).toEqual([]);
    expect(result.unresolved).toEqual([expect.objectContaining({ path: "src/a.ts", reasonCode: "file-read-failed" })]);
    expect(result.comparableFileCount).toBe(2);
  });

  // TST-B2-010
  it("is partially stale when a confirmed change coexists with an unresolved comparison", async () => {
    const { fixture, snapshot } = await baseline();
    rmSync(file(fixture, "src/a.ts"));
    mkdirSync(file(fixture, "src/a.ts"));
    writeFileSync(file(fixture, "src/nested/b.ts"), "changed");

    const result = await assess(fixture, snapshot);

    expect(result.status).toBe("partially-stale");
    expect(result.changedFileCount).toBe(1);
    expect(result.unresolvedFileCount).toBe(1);
  });

  it("treats an unsafe baseline path or unsupported entry as unresolved, never as a change", async () => {
    const { fixture, snapshot } = await baseline();
    const tampered: IndexSnapshotV1 = {
      ...snapshot,
      indexedFileCount: 5,
      files: [
        ...snapshot.files,
        { ...snapshot.files[0], path: "../outside.ts" },
        { ...snapshot.files[0], path: "src/a.ts", sha256: "not-a-hash" },
      ],
    };

    const result = await assess(fixture, tampered);

    expect(result.status).toBe("unknown");
    expect(result.changes).toEqual([]);
    expect(result.unresolved.map((entry) => [entry.path, entry.reasonCode])).toEqual([
      ["../outside.ts", "unsafe-path"],
      ["src/a.ts", "unsupported-snapshot-entry"],
    ]);
  });

  it("does not follow a symlink that leaves the target", async (context) => {
    const { fixture, snapshot } = await baseline();
    const outside = path.join(path.dirname(fixture.targetRoot), "outside.ts");
    writeFileSync(outside, "outside\n");
    rmSync(file(fixture, "src/a.ts"));
    try {
      symlinkSync(outside, file(fixture, "src/a.ts"), "file");
    } catch {
      // Environment-unavailable (symlinks need elevated rights on some Windows hosts): reported as
      // skipped so this host is never counted as having proven the boundary.
      context.skip("symlink creation unavailable on this host; the symlink boundary was not exercised");
    }

    const result = await assess(fixture, snapshot);

    expect(result.status).toBe("unknown");
    expect(result.unresolved).toEqual([expect.objectContaining({ path: "src/a.ts", reasonCode: "unsafe-path" })]);
    expect(result.changes).toEqual([]);
  });

  // TST-B2-011
  it("ignores files that exist now but are not in the snapshot", async () => {
    const { fixture, snapshot } = await baseline();
    writeFileSync(file(fixture, "src/brand-new.ts"), "export const fresh = true;\n");
    writeFileSync(file(fixture, "tests/another.py"), "print('x')\n");

    const result = await assess(fixture, snapshot);

    expect(result.status).toBe("fresh");
    expect(result.indexedFileCount).toBe(3);
    expect(JSON.stringify(result)).not.toContain("brand-new");
  });

  // TST-B2-012
  it("orders changes and unresolved evidence deterministically by path", async () => {
    const { fixture, snapshot } = await baseline();
    for (const relative of ["tests/a.test.ts", "src/nested/b.ts", "src/a.ts"]) {
      writeFileSync(file(fixture, relative), `changed ${relative}`);
    }
    const forward = await assess(fixture, snapshot);
    const reversed = await assess(fixture, { ...snapshot, files: [...snapshot.files].reverse() });

    expect(forward.changes.map((change) => change.path)).toEqual(["src/a.ts", "src/nested/b.ts", "tests/a.test.ts"]);
    expect({ ...reversed, assessedAt: "" }).toEqual({ ...forward, assessedAt: "" });
  });

  it("truncates long change lists explicitly while counting every change", async () => {
    const files: Record<string, string> = {};
    const listed: string[] = [];
    for (let index = 0; index < 120; index += 1) {
      const relative = `src/gen/f${String(index).padStart(3, "0")}.ts`;
      files[relative] = `v1 ${index}`;
      listed.push(relative);
    }
    const { fixture, snapshot } = await baseline(files, listed);
    for (const relative of listed) writeFileSync(file(fixture, relative), "v2");

    const result = await assess(fixture, snapshot);

    expect(result.status).toBe("stale");
    expect(result.changedFileCount).toBe(120);
    expect(result.changes).toHaveLength(100);
    expect(result.changesTruncated).toBe(true);
    expect(result.warnings).toEqual(["Change list truncated to 100 of 120 entries."]);
  });

  // TST-B2-013
  it("never modifies the target: no bytes, names, or timestamps change", async () => {
    const { fixture, snapshot } = await baseline();
    writeFileSync(file(fixture, "src/a.ts"), "changed for assessment");
    const before = hashTree(fixture.targetRoot);

    await assess(fixture, snapshot);
    await assess(fixture, snapshot);

    expect(hashTree(fixture.targetRoot)).toEqual(before);
    expect(existsSync(path.join(fixture.targetRoot, ".git"))).toBe(false);
  });

  // TST-B2-018
  it("persists no file contents", async () => {
    const { fixture, snapshot } = await baseline({ "src/a.ts": "const UNIQUE_BEFORE = 'do-not-persist';\n" });
    writeFileSync(file(fixture, "src/a.ts"), "const UNIQUE_AFTER = 'do-not-persist-either';\n");

    const text = JSON.stringify(await assess(fixture, snapshot));

    expect(text).not.toContain("UNIQUE_BEFORE");
    expect(text).not.toContain("UNIQUE_AFTER");
    expect(text).not.toContain("SECRET-STDOUT-BODY");
  });
});

describe("classifyIndexFreshness decision table", () => {
  it.each([
    ["complete", 0, 0, "fresh"],
    ["complete", 1, 0, "stale"],
    ["complete", 0, 1, "unknown"],
    ["complete", 1, 1, "partially-stale"],
    ["partial", 0, 0, "unknown"],
    ["partial", 2, 0, "partially-stale"],
    ["partial", 0, 3, "unknown"],
    ["unavailable", 0, 1, "unknown"],
    ["unavailable", 5, 0, "unknown"],
  ] as const)("%s snapshot, %i changes, %i unresolved => %s", (baselineSnapshotStatus, confirmedChangeCount, unresolvedCount, expected) => {
    expect(classifyIndexFreshness({ baselineSnapshotStatus, confirmedChangeCount, unresolvedCount })).toBe(expected);
  });
});
