import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readJsonArtifactFile } from "../../../src/evaluation/upstreamArtifacts/readJsonArtifact.js";

const ARTIFACT_KIND = "my-dev-kit-context-capsule-v1" as const;
const VALID_FIXTURE = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";
const MALFORMED_FIXTURE = "tests/fixtures/upstream-artifacts/invalid/malformed-json.txt";
const NON_OBJECT_FIXTURE = "tests/fixtures/upstream-artifacts/invalid/non-object-root.json";

describe("readJsonArtifactFile", () => {
  it("succeeds for an existing valid object file", async () => {
    const result = await readJsonArtifactFile(ARTIFACT_KIND, VALID_FIXTURE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.schemaVersion).toBe("1.0.0");
    }
  });

  it("returns FILE_NOT_FOUND for a missing file", async () => {
    const result = await readJsonArtifactFile(ARTIFACT_KIND, "tests/fixtures/upstream-artifacts/does-not-exist.json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FILE_NOT_FOUND");
  });

  it("returns MALFORMED_JSON for malformed JSON", async () => {
    const result = await readJsonArtifactFile(ARTIFACT_KIND, MALFORMED_FIXTURE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MALFORMED_JSON");
  });

  it("returns NON_OBJECT_ROOT for an array root", async () => {
    const result = await readJsonArtifactFile(ARTIFACT_KIND, NON_OBJECT_FIXTURE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NON_OBJECT_ROOT");
  });

  it("does not clone the returned object across repeated reads", async () => {
    const first = await readJsonArtifactFile(ARTIFACT_KIND, VALID_FIXTURE);
    const second = await readJsonArtifactFile(ARTIFACT_KIND, VALID_FIXTURE);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value).not.toBe(second.value);
      expect(first.value).toEqual(second.value);
    }
  });

  it("resolves the source path to an absolute path", async () => {
    const result = await readJsonArtifactFile(ARTIFACT_KIND, VALID_FIXTURE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(path.isAbsolute(result.sourcePath)).toBe(true);
    }
  });

  it("does not create a file", async () => {
    const { existsSync } = await import("node:fs");
    const before = existsSync("tests/fixtures/upstream-artifacts/does-not-exist.json");
    await readJsonArtifactFile(ARTIFACT_KIND, "tests/fixtures/upstream-artifacts/does-not-exist.json");
    const after = existsSync("tests/fixtures/upstream-artifacts/does-not-exist.json");
    expect(before).toBe(false);
    expect(after).toBe(false);
  });

  it("does not inspect a directory (a directory path yields a filesystem error, not a directory listing)", async () => {
    const result = await readJsonArtifactFile(ARTIFACT_KIND, "tests/fixtures/upstream-artifacts");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["UNREADABLE_FILE", "FILE_NOT_FOUND"]).toContain(result.code);
  });

  it("returns UNREADABLE_FILE for a non-ENOENT filesystem error", async () => {
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        readFile: vi.fn().mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }))
      };
    });
    const { readJsonArtifactFile: readJsonArtifactFileMocked } = await import(
      "../../../src/evaluation/upstreamArtifacts/readJsonArtifact.js"
    );
    const result = await readJsonArtifactFileMocked(ARTIFACT_KIND, VALID_FIXTURE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNREADABLE_FILE");
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });
});
