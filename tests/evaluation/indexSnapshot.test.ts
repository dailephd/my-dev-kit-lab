import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureIndexSnapshot,
  compareCodeUnits,
  interpretToolVersionOutput,
  INDEX_SNAPSHOT_SCHEMA_VERSION,
  interpretIndexManifest,
  interpretSymbolIndexFiles,
  resolveIndexedFilePath,
} from "../../src/evaluation/indexSnapshot.js";
import { capture, cleanupTempDirs, command, makeFixture, writeIndex, type Fixture } from "./indexSnapshotTestHelpers.js";

afterEach(cleanupTempDirs);

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("captureIndexSnapshot", () => {
  // TST-B1-001, TST-B1-002
  it("captures a complete bounded snapshot of exactly the files the index lists", async () => {
    const fixture = makeFixture({ "src/unlisted.ts": "export const notIndexed = true;\n", "docs/notes.ts": "outside roots\n" });
    writeIndex(fixture, ["src/a.ts", "src/nested/b.ts", "tests/a.test.ts"]);

    const snapshot = await capture(fixture);

    expect(snapshot.schemaVersion).toBe(INDEX_SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.status).toBe("complete");
    expect(snapshot.unavailable).toBeNull();
    expect(snapshot.files.map((file) => file.path)).toEqual(["src/a.ts", "src/nested/b.ts", "tests/a.test.ts"]);
    expect(snapshot.indexedFileCount).toBe(3);
    expect(snapshot.unresolvedFileCount).toBe(0);
    expect(snapshot.manifest).toEqual({
      path: "manifest.json",
      artifactKind: "my-dev-kit-v1-manifest",
      schemaVersion: "1.0.0",
      createdAt: "2026-01-01T00:00:00.000Z",
      symbolIndexPath: "symbol-index.json",
      symbolIndexSchemaVersion: "2",
    });
    expect(snapshot.indexCommand).toEqual({ commandString: "node fake-kit.js", executable: "node", args: ["fake-kit.js", "index", "--json"] });
    expect(snapshot.artifacts).toEqual([
      { path: "manifest.json", sizeBytes: expect.any(Number) },
      { path: "symbol-index.json", sizeBytes: expect.any(Number) },
    ]);
    expect(snapshot.artifactsTruncated).toBe(false);
  });

  // TST-B1-003
  it("produces identical sorted output regardless of the index's listing order", async () => {
    const fixture = makeFixture();
    writeIndex(fixture, ["src/a.ts", "src/nested/b.ts", "tests/a.test.ts"]);
    const forward = await capture(fixture);
    writeIndex(fixture, ["tests/a.test.ts", "src/nested/b.ts", "src/a.ts"]);
    const reversed = await capture(fixture);

    expect(reversed).toEqual(forward);
    expect(forward.files.map((file) => file.path)).toEqual(["src/a.ts", "src/nested/b.ts", "tests/a.test.ts"]);
    expect(["b", "B", "a", "_"].sort(compareCodeUnits)).toEqual(["B", "_", "a", "b"]);
  });

  // TST-B1-004
  it("records SHA-256 content hashes that are stable and change with the file bytes", async () => {
    const fixture = makeFixture({ "src/a.ts": "aaaa" });
    writeIndex(fixture, ["src/a.ts"]);
    const first = await capture(fixture);
    const again = await capture(fixture);

    expect(first.files[0].sha256).toBe(sha256("aaaa"));
    expect(first.files[0].sizeBytes).toBe(4);
    expect(again.files[0].sha256).toBe(first.files[0].sha256);

    writeFileSync(path.join(fixture.targetRoot, "src/a.ts"), "bbbb"); // same size, different bytes
    const changed = await capture(fixture);
    expect(changed.files[0].sha256).toBe(sha256("bbbb"));
    expect(changed.files[0].sha256).not.toBe(first.files[0].sha256);
  });

  // TST-B1-005
  it("keeps modified timestamps as ISO metadata that never decides content identity", async () => {
    const fixture = makeFixture({ "src/a.ts": "same bytes" });
    writeIndex(fixture, ["src/a.ts"]);
    const before = await capture(fixture);
    utimesSync(path.join(fixture.targetRoot, "src/a.ts"), new Date("2020-01-02T03:04:05.000Z"), new Date("2020-01-02T03:04:05.000Z"));
    const touched = await capture(fixture);

    expect(touched.files[0].modifiedAt).toBe("2020-01-02T03:04:05.000Z");
    expect(before.files[0].modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(touched.files[0].modifiedAt).not.toBe(before.files[0].modifiedAt);
    expect(touched.files[0].sha256).toBe(before.files[0].sha256);
  });

  // TST-B1-006
  it("normalizes separators and refuses paths that escape the target or the source roots", async () => {
    const fixture = makeFixture({ "docs/notes.ts": "outside source roots\n" });
    writeFileSync(path.join(path.dirname(fixture.targetRoot), "outside.ts"), "outside target\n");
    writeIndex(fixture, [
      "src\\nested\\b.ts",
      "../outside.ts",
      "src/../../outside.ts",
      "/etc/passwd",
      "C:\\Windows\\win.ini",
      "docs/notes.ts",
      "src/a.ts",
    ]);

    const snapshot = await capture(fixture);

    expect(snapshot.status).toBe("partial");
    expect(snapshot.files.map((file) => file.path)).toEqual(["src/a.ts", "src/nested/b.ts"]);
    expect(snapshot.indexedFileCount).toBe(7);
    expect(snapshot.unresolvedFileCount).toBe(5);
    expect(Object.fromEntries(snapshot.unresolvedFiles.map((entry) => [entry.path, entry.reason]))).toEqual({
      "../outside.ts": "outside-target-or-source-roots",
      "src/../../outside.ts": "outside-target-or-source-roots",
      "/etc/passwd": "invalid-path",
      "C:\\Windows\\win.ini": "invalid-path",
      "docs/notes.ts": "outside-target-or-source-roots",
    });
    expect(JSON.stringify(snapshot)).not.toContain(fixture.targetRoot.replace(/\\/g, "\\\\"));
  });

  it("does not read through a symlink that leaves the target", async () => {
    const fixture = makeFixture();
    const outside = path.join(path.dirname(fixture.targetRoot), "outside-secret.ts");
    writeFileSync(outside, "outside\n");
    try {
      symlinkSync(outside, path.join(fixture.targetRoot, "src/link.ts"), "file");
    } catch {
      return; // creating symlinks needs elevated rights on some Windows setups
    }
    writeIndex(fixture, ["src/a.ts", "src/link.ts"]);

    const snapshot = await capture(fixture);

    expect(snapshot.status).toBe("partial");
    expect(snapshot.files.map((file) => file.path)).toEqual(["src/a.ts"]);
    expect(snapshot.unresolvedFiles).toEqual([{ path: "src/link.ts", reason: "outside-target-or-source-roots" }]);
  });

  it("reports listed files that are missing or not regular files instead of dropping or guessing them", async () => {
    const fixture = makeFixture();
    mkdirSync(path.join(fixture.targetRoot, "src/dir.ts"));
    writeIndex(fixture, ["src/a.ts", "src/gone.ts", "src/dir.ts"]);

    const snapshot = await capture(fixture);

    expect(snapshot.status).toBe("partial");
    expect(snapshot.files.map((file) => file.path)).toEqual(["src/a.ts"]);
    expect(snapshot.unresolvedFiles).toEqual([
      { path: "src/dir.ts", reason: "not-a-file" },
      { path: "src/gone.ts", reason: "missing" },
    ]);
  });

  // TST-B1-007
  it("persists no source contents, context, or command output bodies", async () => {
    const fixture = makeFixture({ "src/a.ts": "const UNIQUE_SOURCE_MARKER = 'do-not-persist';\n" });
    writeIndex(fixture, ["src/a.ts"]);

    const text = JSON.stringify(await capture(fixture));

    expect(text).not.toContain("UNIQUE_SOURCE_MARKER");
    expect(text).not.toContain("SECRET-STDOUT-BODY");
    expect(text).not.toContain("SECRET-STDERR-BODY");
  });

  // TST-B1-008
  it("represents absent optional metadata explicitly instead of fabricating it", async () => {
    const fixture = makeFixture();
    writeIndex(fixture, ["src/a.ts"]);
    const snapshot = await captureWithout(fixture, "createdAt");

    expect(snapshot.status).toBe("complete");
    expect(snapshot.manifest?.createdAt).toBeNull();
    expect(snapshot.tool).toEqual({
      name: "my-dev-kit",
      version: null,
      availability: "unavailable",
      reason: expect.stringContaining("do not expose the tool version"),
    });
  });

  // TST-B1-009
  describe("uninterpretable required contract", () => {
    const cases: Array<{ name: string; code: string; arrange: (fixture: Fixture) => void }> = [
      { name: "missing manifest", code: "manifest-missing", arrange: () => undefined },
      {
        name: "manifest that is not JSON",
        code: "manifest-unreadable",
        arrange: (f) => writeFileSync(path.join(f.indexDir, "manifest.json"), "{not json"),
      },
      {
        name: "unsupported manifest kind (stub manifest)",
        code: "manifest-unsupported",
        arrange: (f) => writeFileSync(path.join(f.indexDir, "manifest.json"), JSON.stringify({ ok: true, fake: true })),
      },
      {
        name: "unsupported manifest major version",
        code: "manifest-unsupported",
        arrange: (f) => writeIndex(f, ["src/a.ts"], { manifest: { version: "2.0.0" } }),
      },
      {
        name: "manifest without a symbol index artifact",
        code: "manifest-unsupported",
        arrange: (f) => writeIndex(f, ["src/a.ts"], { manifest: { artifacts: {} } }),
      },
      {
        name: "symbol index path that escapes the index directory",
        code: "manifest-unsupported",
        arrange: (f) => writeIndex(f, ["src/a.ts"], { manifest: { artifacts: { symbolIndex: "../symbol-index.json" } } }),
      },
      {
        name: "manifest for different source roots",
        code: "manifest-target-mismatch",
        arrange: (f) => writeIndex(f, ["src/a.ts"], { manifest: { sourceRoots: ["src"] } }),
      },
      {
        name: "manifest for a different project root",
        code: "manifest-target-mismatch",
        arrange: (f) => writeIndex(f, ["src/a.ts"], { manifest: { projectRoot: path.join(os.tmpdir(), "somewhere-else") } }),
      },
      {
        name: "missing symbol index",
        code: "symbol-index-missing",
        arrange: (f) => {
          writeIndex(f, ["src/a.ts"], { manifest: { artifacts: { symbolIndex: "absent.json" } } });
        },
      },
      {
        name: "symbol index that is not JSON",
        code: "symbol-index-unreadable",
        arrange: (f) => {
          writeIndex(f, ["src/a.ts"]);
          writeFileSync(path.join(f.indexDir, "symbol-index.json"), "nope");
        },
      },
      {
        name: "symbol index without a files list",
        code: "symbol-index-unsupported",
        arrange: (f) => writeIndex(f, ["src/a.ts"], { symbolIndex: { files: "many" } }),
      },
      {
        name: "symbol index with duplicate paths",
        code: "symbol-index-unsupported",
        arrange: (f) => writeIndex(f, ["src/a.ts", "src/a.ts"]),
      },
      {
        name: "file count that disagrees with the listed files",
        code: "indexed-file-count-mismatch",
        arrange: (f) => writeIndex(f, ["src/a.ts"], { manifest: { summary: { fileCount: 5 } } }),
      },
    ];

    it.each(cases)("yields an explicit unavailable snapshot for $name", async ({ code, arrange }) => {
      const fixture = makeFixture();
      arrange(fixture);

      const snapshot = await capture(fixture);

      expect(snapshot.status).toBe("unavailable");
      expect(snapshot.unavailable?.code).toBe(code);
      expect(snapshot.unavailable?.message).toBeTruthy();
      expect(snapshot.files).toEqual([]);
      expect(snapshot.indexedFileCount).toBe(0);
      expect(snapshot.artifacts).toEqual([]);
    });

    it("does not throw when the index directory itself is absent", async () => {
      const fixture = makeFixture();
      const snapshot = await captureIndexSnapshot({
        indexDir: path.join(fixture.indexDir, "does-not-exist"),
        targetRoot: fixture.targetRoot,
        sourceRoots: fixture.sourceRoots,
        command,
      });
      expect(snapshot.status).toBe("unavailable");
      expect(snapshot.unavailable?.code).toBe("manifest-missing");
    });
  });
});

async function captureWithout(fixture: Fixture, field: string) {
  const manifestPath = path.join(fixture.indexDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  delete manifest[field];
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return capture(fixture);
}

describe("resolveIndexedFilePath", () => {
  const target = path.resolve(os.tmpdir(), "resolve-target");

  it.each([
    ["src/a.ts", "src/a.ts"],
    ["src\\nested\\b.ts", "src/nested/b.ts"],
    ["./src/a.ts", "src/a.ts"],
    ["src//a.ts", "src/a.ts"],
  ])("normalizes %s to %s", (listed, expected) => {
    expect(resolveIndexedFilePath(target, ["src"], listed)).toEqual({ ok: true, relativePath: expected });
  });

  it.each([
    ["../x.ts", "outside-target-or-source-roots"],
    ["src/../../x.ts", "outside-target-or-source-roots"],
    ["other/x.ts", "outside-target-or-source-roots"],
    ["/abs/x.ts", "invalid-path"],
    ["C:\\x.ts", "invalid-path"],
    ["c:/x.ts", "invalid-path"],
    ["", "invalid-path"],
    ["src/a\0.ts", "invalid-path"],
  ])("rejects %s", (listed, reason) => {
    expect(resolveIndexedFilePath(target, ["src"], listed)).toEqual({ ok: false, reason });
  });
});

describe("interpret helpers", () => {
  it("interpretIndexManifest requires a supported artifact kind, version, and matching source roots", () => {
    const valid = {
      artifactKind: "my-dev-kit-v1-manifest",
      version: "1.0.0",
      projectRoot: "/p",
      sourceRoots: ["src"],
      artifacts: { symbolIndex: "symbol-index.json" },
    };
    expect(interpretIndexManifest(valid, { sourceRoots: ["src"] }).ok).toBe(true);
    expect(interpretIndexManifest(null, { sourceRoots: ["src"] }).ok).toBe(false);
    expect(interpretIndexManifest({ ...valid, sourceRoots: ["src", "tests"] }, { sourceRoots: ["src"] })).toMatchObject({
      ok: false,
      code: "manifest-target-mismatch",
    });
  });

  it("interpretSymbolIndexFiles trusts only a consistent, duplicate-free file list", () => {
    expect(interpretSymbolIndexFiles({ schemaVersion: "2", fileCount: 1, files: [{ path: "a.ts" }] }, 1)).toEqual({
      ok: true,
      schemaVersion: "2",
      paths: ["a.ts"],
    });
    expect(interpretSymbolIndexFiles({ schemaVersion: "2", files: [{ path: "a.ts" }] }, 2)).toMatchObject({
      ok: false,
      code: "indexed-file-count-mismatch",
    });
    expect(interpretSymbolIndexFiles({ files: [] }, null)).toMatchObject({ ok: false, code: "symbol-index-unsupported" });
  });
});

describe("interpretToolVersionOutput", () => {
  // TST-B2-020
  it("uses the first non-empty output line verbatim, without requiring semver", () => {
    expect(interpretToolVersionOutput({ ok: true, exitCode: 0, stdout: "\n  1.12.4  \nextra banner\n" })).toEqual({
      name: "my-dev-kit",
      version: "1.12.4",
      availability: "available",
      reason: null,
    });
    expect(interpretToolVersionOutput({ ok: true, exitCode: 0, stdout: "custom-kit build 7" }).version).toBe("custom-kit build 7");
  });

  // TST-B2-021
  it.each([
    ["a failed probe", { ok: false, exitCode: 1, stdout: "", error: "Unsupported" }, "did not succeed"],
    ["a probe with no output", { ok: true, exitCode: 0, stdout: " \n\n" }, "no output"],
    ["an unprintable value", { ok: true, exitCode: 0, stdout: "1.0\u0007.0" }, "non-printable"],
    ["an oversized value", { ok: true, exitCode: 0, stdout: "v".repeat(500) }, "longer than"],
  ])("is explicitly unavailable for %s", (_name, probe, reason) => {
    const tool = interpretToolVersionOutput(probe);
    expect(tool.version).toBeNull();
    expect(tool.availability).toBe("unavailable");
    expect(tool.reason).toContain(reason);
  });
});
