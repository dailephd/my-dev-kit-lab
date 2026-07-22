import { describe, expect, it } from "vitest";
import { matchStageContextExpectations } from "../../../src/evaluation/stageContextMetrics/matchStageContextExpectations.js";
import type { StageContextExpectationFixtureV1, StageContextExpectationItemV1 } from "../../../src/evaluation/stageContextExpectations/index.js";
import type { StageContextObservedEvidenceV1 } from "../../../src/evaluation/stageContextMetrics/types.js";

function item(overrides: Record<string, unknown>): StageContextExpectationItemV1 {
  return {
    expectationId: "REQ-FILE-001",
    inclusion: "required",
    sourceArtifact: "context-capsule",
    category: "file",
    match: { path: "src/example.ts" },
    notes: [],
    ...overrides
  } as unknown as StageContextExpectationItemV1;
}

function fixture(items: StageContextExpectationItemV1[]): StageContextExpectationFixtureV1 {
  return {
    schemaVersion: "1.0.0",
    caseId: "CASE-MET-001",
    title: "t",
    description: "d",
    expectedEvidence: items,
    expectedStates: {},
    warnings: []
  };
}

function evidence(overrides: Partial<StageContextObservedEvidenceV1>): StageContextObservedEvidenceV1 {
  return {
    sourceArtifact: "context-capsule",
    sourceInstance: "architecture.contextCapsule",
    category: "file",
    targetKey: "context-capsule|file|path:src/example.ts",
    sourceFieldPath: "candidateFiles[0].path",
    ...overrides
  };
}

describe("matchStageContextExpectations", () => {
  it("MET-078 required observed evidence returns matched", () => {
    const result = matchStageContextExpectations(fixture([item({})]), [evidence({})]);
    expect(result[0].outcome).toBe("matched");
  });

  it("MET-079 required absent evidence returns missing", () => {
    const result = matchStageContextExpectations(fixture([item({})]), []);
    expect(result[0].outcome).toBe("missing");
  });

  it("MET-080 allowed observed evidence returns matched", () => {
    const result = matchStageContextExpectations(
      fixture([item({ expectationId: "ALLOW-FILE-001", inclusion: "allowed" })]),
      [evidence({})]
    );
    expect(result[0].outcome).toBe("matched");
  });

  it("MET-081 allowed absent evidence returns missing", () => {
    const result = matchStageContextExpectations(fixture([item({ expectationId: "ALLOW-FILE-001", inclusion: "allowed" })]), []);
    expect(result[0].outcome).toBe("missing");
  });

  it("MET-082 forbidden observed evidence returns violated", () => {
    const result = matchStageContextExpectations(
      fixture([item({ expectationId: "FORBID-FILE-001", inclusion: "forbidden" })]),
      [evidence({})]
    );
    expect(result[0].outcome).toBe("violated");
  });

  it("MET-083 forbidden absent evidence returns matched", () => {
    const result = matchStageContextExpectations(fixture([item({ expectationId: "FORBID-FILE-001", inclusion: "forbidden" })]), []);
    expect(result[0].outcome).toBe("matched");
  });

  it("MET-084 match order follows expectedEvidence order", () => {
    const items = [
      item({ expectationId: "REQ-FILE-001", match: { path: "a.ts" } }),
      item({ expectationId: "REQ-FILE-002", match: { path: "b.ts" } }),
      item({ expectationId: "REQ-FILE-003", match: { path: "c.ts" } })
    ];
    const result = matchStageContextExpectations(fixture(items), []);
    expect(result.map((r) => r.expectationId)).toEqual(["REQ-FILE-001", "REQ-FILE-002", "REQ-FILE-003"]);
  });

  it("MET-085 source artifact must match", () => {
    const result = matchStageContextExpectations(fixture([item({})]), [
      evidence({ sourceArtifact: "retrieval-audit-record" })
    ]);
    expect(result[0].outcome).toBe("missing");
  });

  it("MET-086 category must match", () => {
    const result = matchStageContextExpectations(fixture([item({})]), [evidence({ category: "test-file" })]);
    expect(result[0].outcome).toBe("missing");
  });

  it("MET-087 target key must match exactly", () => {
    const result = matchStageContextExpectations(fixture([item({})]), [
      evidence({ targetKey: "context-capsule|file|path:src/different.ts" })
    ]);
    expect(result[0].outcome).toBe("missing");
  });

  it("MET-088 case differences do not match", () => {
    const result = matchStageContextExpectations(fixture([item({ match: { path: "SRC/Example.ts" } })]), [
      evidence({ targetKey: "context-capsule|file|path:src/example.ts" })
    ]);
    expect(result[0].outcome).toBe("missing");
  });

  it("MET-089 slash differences do not match", () => {
    const result = matchStageContextExpectations(fixture([item({ match: { path: "src\\example.ts" } })]), [
      evidence({ targetKey: "context-capsule|file|path:src/example.ts" })
    ]);
    expect(result[0].outcome).toBe("missing");
  });

  it("MET-090 whitespace differences do not match", () => {
    const result = matchStageContextExpectations(fixture([item({ match: { path: " src/example.ts" } })]), [
      evidence({ targetKey: "context-capsule|file|path:src/example.ts" })
    ]);
    expect(result[0].outcome).toBe("missing");
  });

  it("MET-091 matched source instances preserve first-observed order", () => {
    const result = matchStageContextExpectations(fixture([item({})]), [
      evidence({ sourceInstance: "second" }),
      evidence({ sourceInstance: "first" })
    ]);
    expect(result[0].matchedSourceInstances).toEqual(["second", "first"]);
  });

  it("MET-092 matched source field paths preserve first-observed order", () => {
    const result = matchStageContextExpectations(fixture([item({})]), [
      evidence({ sourceFieldPath: "b.path" }),
      evidence({ sourceFieldPath: "a.path" })
    ]);
    expect(result[0].matchedSourceFieldPaths).toEqual(["b.path", "a.path"]);
  });

  it("MET-093 duplicate matched source instances are removed", () => {
    const result = matchStageContextExpectations(fixture([item({})]), [
      evidence({ sourceInstance: "same" }),
      evidence({ sourceInstance: "same" })
    ]);
    expect(result[0].matchedSourceInstances).toEqual(["same"]);
  });

  it("MET-094 no fuzzy matching occurs", () => {
    const result = matchStageContextExpectations(fixture([item({ match: { path: "src/example.ts" } })]), [
      evidence({ targetKey: "context-capsule|file|path:src/example2.ts" })
    ]);
    expect(result[0].outcome).toBe("missing");
  });

  it("MET-095 expectations and evidence are not mutated", () => {
    const expectations = fixture([item({})]);
    const evidenceList = [evidence({})];
    const before = JSON.stringify(expectations);
    const evidenceBefore = JSON.stringify(evidenceList);
    matchStageContextExpectations(expectations, evidenceList);
    expect(JSON.stringify(expectations)).toBe(before);
    expect(JSON.stringify(evidenceList)).toBe(evidenceBefore);
  });
});
