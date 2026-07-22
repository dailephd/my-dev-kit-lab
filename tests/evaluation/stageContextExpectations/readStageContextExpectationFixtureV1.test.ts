import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readStageContextExpectationFixtureV1 } from "../../../src/evaluation/stageContextExpectations/readStageContextExpectationFixtureV1.js";
import { validateStageContextExpectationFixtureV1 } from "../../../src/evaluation/stageContextExpectations/validation.js";
import type { JsonObject } from "../../../src/evaluation/upstreamArtifacts/index.js";

const MINIMAL_PATH = "tests/fixtures/stage-context-expectations/minimal-v1.0.0.json";
const COMPLETE_PATH = "tests/fixtures/stage-context-expectations/complete-v1.0.0.json";
const FUTURE_MINOR_PATH = "tests/fixtures/stage-context-expectations/future-minor-v1.1.0-additive.json";
const MALFORMED_PATH = "tests/fixtures/stage-context-expectations/invalid/malformed-json.txt";
const NON_OBJECT_PATH = "tests/fixtures/stage-context-expectations/invalid/non-object-root.json";
const MISSING_PATH = "tests/fixtures/stage-context-expectations/does-not-exist.json";

describe("readStageContextExpectationFixtureV1", () => {
  it("EXP-001 minimal fixture succeeds", async () => {
    const result = await readStageContextExpectationFixtureV1(MINIMAL_PATH);
    expect(result.ok).toBe(true);
  });

  it("EXP-002 complete fixture succeeds", async () => {
    const result = await readStageContextExpectationFixtureV1(COMPLETE_PATH);
    expect(result.ok).toBe(true);
  });

  it("EXP-003 future-minor fixture succeeds", async () => {
    const result = await readStageContextExpectationFixtureV1(FUTURE_MINOR_PATH);
    expect(result.ok).toBe(true);
  });

  it("EXP-004 fixture and rawFixture are the same object", async () => {
    const result = await readStageContextExpectationFixtureV1(COMPLETE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixture).toBe(result.rawFixture);
  });

  it("EXP-005 unknown root additive field survives", async () => {
    const result = await readStageContextExpectationFixtureV1(FUTURE_MINOR_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.fixture as unknown as Record<string, unknown>).futureMinorRootField).toBe("preserved");
    }
  });

  it("EXP-006 unknown nested additive field survives", async () => {
    const result = await readStageContextExpectationFixtureV1(FUTURE_MINOR_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const firstItem = result.fixture.expectedEvidence[0] as unknown as Record<string, unknown>;
      expect(firstItem.futureMinorNestedField).toBe("preserved");
    }
  });

  it("EXP-007 missing file returns FILE_NOT_FOUND", async () => {
    const result = await readStageContextExpectationFixtureV1(MISSING_PATH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FILE_NOT_FOUND");
  });

  it("EXP-008 malformed JSON returns MALFORMED_JSON", async () => {
    const result = await readStageContextExpectationFixtureV1(MALFORMED_PATH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MALFORMED_JSON");
  });

  it("EXP-009 non-object root returns NON_OBJECT_ROOT", async () => {
    const result = await readStageContextExpectationFixtureV1(NON_OBJECT_PATH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NON_OBJECT_ROOT");
  });

  it("EXP-010 unsupported schema major returns UNSUPPORTED_SCHEMA_MAJOR", () => {
    const fixture = JSON.parse(readFileSync(COMPLETE_PATH, "utf8")) as JsonObject;
    (fixture as unknown as Record<string, unknown>).schemaVersion = "2.0.0";
    const result = validateStageContextExpectationFixtureV1(fixture, "in-memory-fixture.json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_SCHEMA_MAJOR");
  });

  it("EXP-011 invalid schema syntax returns INVALID_SCHEMA_VERSION", () => {
    const fixture = JSON.parse(readFileSync(COMPLETE_PATH, "utf8")) as JsonObject;
    (fixture as unknown as Record<string, unknown>).schemaVersion = "1.0";
    const result = validateStageContextExpectationFixtureV1(fixture, "in-memory-fixture.json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_SCHEMA_VERSION");
  });

  it("EXP-012 resolved sourcePath is absolute", async () => {
    const result = await readStageContextExpectationFixtureV1(COMPLETE_PATH);
    expect(result.ok).toBe(true);
    expect(path.isAbsolute(result.sourcePath)).toBe(true);
  });

  it("EXP-013 no path value inside the fixture is normalized", async () => {
    const result = await readStageContextExpectationFixtureV1(MINIMAL_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const item = result.fixture.expectedEvidence[0] as unknown as { match: { path: string } };
      expect(item.match.path).toBe("src/example.ts");
    }
  });

  it("EXP-014 array order is preserved", async () => {
    const result = await readStageContextExpectationFixtureV1(COMPLETE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixture.expectedEvidence[0].expectationId).toBe("REQ-FILE-001");
      expect(result.fixture.expectedEvidence[1].expectationId).toBe("REQ-SYMBOL-001");
    }
  });

  it("EXP-015 the reader creates no file", async () => {
    const { existsSync } = await import("node:fs");
    const before = existsSync(MISSING_PATH);
    await readStageContextExpectationFixtureV1(MISSING_PATH);
    const after = existsSync(MISSING_PATH);
    expect(before).toBe(false);
    expect(after).toBe(false);
  });

  it("EXP-016 a mocked non-file-not-found filesystem error returns UNREADABLE_FILE", async () => {
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        readFile: vi.fn().mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }))
      };
    });
    const { readStageContextExpectationFixtureV1: readMocked } = await import(
      "../../../src/evaluation/stageContextExpectations/readStageContextExpectationFixtureV1.js"
    );
    const result = await readMocked(COMPLETE_PATH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNREADABLE_FILE");
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });
});
