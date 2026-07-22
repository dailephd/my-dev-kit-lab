import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { readV043FullWorkflowLibraryFixture } from "../../../src/experiments/plugins/contextStrategyComparison/readV043FullWorkflowLibraryFixture.js";

const COMPLETE_PATH = "tests/fixtures/full-workflow-library/complete-v1.0.0.json";
const FUTURE_MINOR_PATH = "tests/fixtures/full-workflow-library/future-minor-v1.1.0-additive.json";
const MISSING_PATH = "tests/fixtures/full-workflow-library/does-not-exist.json";

async function readWithMockedFileContents(contents: string) {
  vi.resetModules();
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
      ...actual,
      readFile: vi.fn().mockResolvedValueOnce(contents)
    };
  });
  const { readV043FullWorkflowLibraryFixture: readMocked } = await import(
    "../../../src/experiments/plugins/contextStrategyComparison/readV043FullWorkflowLibraryFixture.js"
  );
  const result = await readMocked(COMPLETE_PATH);
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
  return result;
}

describe("readV043FullWorkflowLibraryFixture", () => {
  it("EXE-001 complete fixture succeeds", async () => {
    const result = await readV043FullWorkflowLibraryFixture(COMPLETE_PATH);
    expect(result.ok).toBe(true);
  });

  it("EXE-002 future-minor fixture succeeds", async () => {
    const result = await readV043FullWorkflowLibraryFixture(FUTURE_MINOR_PATH);
    expect(result.ok).toBe(true);
  });

  it("EXE-003 fixture and rawFixture are the same object", async () => {
    const result = await readV043FullWorkflowLibraryFixture(COMPLETE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixture).toBe(result.rawFixture);
  });

  it("EXE-004 unknown additive root field survives", async () => {
    const result = await readV043FullWorkflowLibraryFixture(FUTURE_MINOR_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.fixture as unknown as Record<string, unknown>).futureMinorRootField).toBe("preserved");
    }
  });

  it("EXE-005 missing file returns FILE_NOT_FOUND", async () => {
    const result = await readV043FullWorkflowLibraryFixture(MISSING_PATH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FILE_NOT_FOUND");
  });

  it("EXE-006 malformed JSON returns MALFORMED_JSON via a mocked read result", async () => {
    const result = await readWithMockedFileContents("{ this is not valid JSON");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MALFORMED_JSON");
  });

  it("EXE-007 non-object root returns NON_OBJECT_ROOT via a mocked read result", async () => {
    const result = await readWithMockedFileContents("[]");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NON_OBJECT_ROOT");
  });

  it("EXE-008 unsupported major fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "2.0.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: ["workflow.a"],
      stageIds: ["stage.a"],
      commandIds: ["command.a"],
      ruleIds: ["rule.a"],
      reportContractIds: ["report.a"],
      provenanceEvidenceIds: [],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_SCHEMA_MAJOR");
  });

  it("EXE-009 invalid schema syntax fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: ["workflow.a"],
      stageIds: ["stage.a"],
      commandIds: ["command.a"],
      ruleIds: ["rule.a"],
      reportContractIds: ["report.a"],
      provenanceEvidenceIds: [],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_SCHEMA_VERSION");
  });

  it("EXE-010 invalid fixtureId fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0.0",
      fixtureId: "not-a-valid-id",
      title: "t",
      description: "d",
      workflowIds: ["workflow.a"],
      stageIds: ["stage.a"],
      commandIds: ["command.a"],
      ruleIds: ["rule.a"],
      reportContractIds: ["report.a"],
      provenanceEvidenceIds: [],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_FIXTURE_ID");
  });

  it("EXE-011 empty workflowIds fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: [],
      stageIds: ["stage.a"],
      commandIds: ["command.a"],
      ruleIds: ["rule.a"],
      reportContractIds: ["report.a"],
      provenanceEvidenceIds: [],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMPTY_REQUIRED_ID_SET");
  });

  it("EXE-012 empty stageIds fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: ["workflow.a"],
      stageIds: [],
      commandIds: ["command.a"],
      ruleIds: ["rule.a"],
      reportContractIds: ["report.a"],
      provenanceEvidenceIds: [],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMPTY_REQUIRED_ID_SET");
  });

  it("EXE-013 empty commandIds fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: ["workflow.a"],
      stageIds: ["stage.a"],
      commandIds: [],
      ruleIds: ["rule.a"],
      reportContractIds: ["report.a"],
      provenanceEvidenceIds: [],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMPTY_REQUIRED_ID_SET");
  });

  it("EXE-014 empty ruleIds fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: ["workflow.a"],
      stageIds: ["stage.a"],
      commandIds: ["command.a"],
      ruleIds: [],
      reportContractIds: ["report.a"],
      provenanceEvidenceIds: [],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMPTY_REQUIRED_ID_SET");
  });

  it("EXE-015 empty reportContractIds fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: ["workflow.a"],
      stageIds: ["stage.a"],
      commandIds: ["command.a"],
      ruleIds: ["rule.a"],
      reportContractIds: [],
      provenanceEvidenceIds: [],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMPTY_REQUIRED_ID_SET");
  });

  it("EXE-016 empty provenanceEvidenceIds succeeds", async () => {
    const result = await readV043FullWorkflowLibraryFixture(COMPLETE_PATH);
    expect(result.ok).toBe(true);
  });

  it("EXE-017 duplicate workflow ID fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: ["workflow.a", "workflow.a"],
      stageIds: ["stage.a"],
      commandIds: ["command.a"],
      ruleIds: ["rule.a"],
      reportContractIds: ["report.a"],
      provenanceEvidenceIds: [],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_ID");
  });

  it("EXE-018 duplicate stage ID fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: ["workflow.a"],
      stageIds: ["stage.a", "stage.a"],
      commandIds: ["command.a"],
      ruleIds: ["rule.a"],
      reportContractIds: ["report.a"],
      provenanceEvidenceIds: [],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_ID");
  });

  it("EXE-019 duplicate command ID fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: ["workflow.a"],
      stageIds: ["stage.a"],
      commandIds: ["command.a", "command.a"],
      ruleIds: ["rule.a"],
      reportContractIds: ["report.a"],
      provenanceEvidenceIds: [],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_ID");
  });

  it("EXE-020 duplicate rule ID fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: ["workflow.a"],
      stageIds: ["stage.a"],
      commandIds: ["command.a"],
      ruleIds: ["rule.a", "rule.a"],
      reportContractIds: ["report.a"],
      provenanceEvidenceIds: [],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_ID");
  });

  it("EXE-021 duplicate report-contract ID fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: ["workflow.a"],
      stageIds: ["stage.a"],
      commandIds: ["command.a"],
      ruleIds: ["rule.a"],
      reportContractIds: ["report.a", "report.a"],
      provenanceEvidenceIds: [],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_ID");
  });

  it("EXE-022 duplicate provenance evidence ID fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: ["workflow.a"],
      stageIds: ["stage.a"],
      commandIds: ["command.a"],
      ruleIds: ["rule.a"],
      reportContractIds: ["report.a"],
      provenanceEvidenceIds: ["provenance.a", "provenance.a"],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_ID");
  });

  it("EXE-023 the same ID in different arrays succeeds", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: ["shared.id"],
      stageIds: ["shared.id"],
      commandIds: ["shared.id"],
      ruleIds: ["shared.id"],
      reportContractIds: ["shared.id"],
      provenanceEvidenceIds: ["shared.id"],
      rawText: "text",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(true);
  });

  it("EXE-024 empty rawText fails", async () => {
    const fixtureText = JSON.stringify({
      schemaVersion: "1.0.0",
      fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
      title: "t",
      description: "d",
      workflowIds: ["workflow.a"],
      stageIds: ["stage.a"],
      commandIds: ["command.a"],
      ruleIds: ["rule.a"],
      reportContractIds: ["report.a"],
      provenanceEvidenceIds: [],
      rawText: "",
      warnings: []
    });
    const result = await readWithMockedFileContents(fixtureText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMPTY_RAW_TEXT");
  });

  it("EXE-025 array order is preserved", async () => {
    const result = await readV043FullWorkflowLibraryFixture(COMPLETE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixture.workflowIds).toEqual(["workflow.feature", "workflow.release"]);
      expect(result.fixture.stageIds[0]).toBe("stage.feature.architecture");
      expect(result.fixture.stageIds[3]).toBe("stage.release.readiness");
    }
  });

  it("EXE-026 IDs remain opaque", async () => {
    const result = await readV043FullWorkflowLibraryFixture(COMPLETE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixture.workflowIds[0]).toBe("workflow.feature");
    }
  });

  it("EXE-027 no value is normalized", async () => {
    const result = await readV043FullWorkflowLibraryFixture(COMPLETE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixture.commandIds).toContain("command.context.inspect");
    }
  });

  it("EXE-028 the reader creates no file", async () => {
    const before = existsSync(MISSING_PATH);
    await readV043FullWorkflowLibraryFixture(MISSING_PATH);
    const after = existsSync(MISSING_PATH);
    expect(before).toBe(false);
    expect(after).toBe(false);
  });

  it("EXE-029 a mocked non-file-not-found read error returns UNREADABLE_FILE", async () => {
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        readFile: vi.fn().mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }))
      };
    });
    const { readV043FullWorkflowLibraryFixture: readMocked } = await import(
      "../../../src/experiments/plugins/contextStrategyComparison/readV043FullWorkflowLibraryFixture.js"
    );
    const result = await readMocked(COMPLETE_PATH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNREADABLE_FILE");
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });
});
