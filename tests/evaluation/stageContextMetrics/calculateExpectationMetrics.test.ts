import { describe, expect, it } from "vitest";
import {
  calculateAllowedEvidenceCoverage,
  calculateForbiddenEvidenceInclusion,
  calculateIrrelevantFileInclusion,
  calculateIrrelevantInstructionInclusion,
  calculateRequiredEvidenceRecall,
  calculateRequiredProvenanceRecall
} from "../../../src/evaluation/stageContextMetrics/calculateExpectationMetrics.js";
import type { StageContextExpectationFixtureV1, StageContextExpectationItemV1 } from "../../../src/evaluation/stageContextExpectations/index.js";
import type { StageContextExpectationMatchV1, StageContextObservedEvidenceV1 } from "../../../src/evaluation/stageContextMetrics/types.js";

function match(overrides: Partial<StageContextExpectationMatchV1>): StageContextExpectationMatchV1 {
  return {
    expectationId: "REQ-FILE-001",
    inclusion: "required",
    sourceArtifact: "context-capsule",
    category: "file",
    targetKey: "context-capsule|file|path:src/a.ts",
    outcome: "matched",
    matchedSourceInstances: ["instance"],
    matchedSourceFieldPaths: ["path"],
    ...overrides
  };
}

function item(overrides: Record<string, unknown>): StageContextExpectationItemV1 {
  return {
    expectationId: "REQ-FILE-001",
    inclusion: "required",
    sourceArtifact: "context-capsule",
    category: "file",
    match: { path: "src/a.ts" },
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
    targetKey: "context-capsule|file|path:src/a.ts",
    sourceFieldPath: "candidateFiles[0].path",
    ...overrides
  };
}

describe("calculateRequiredEvidenceRecall", () => {
  it("MET-096 required recall uses matched required items only", () => {
    const result = calculateRequiredEvidenceRecall([
      match({ expectationId: "REQ-1", inclusion: "required", outcome: "matched" }),
      match({ expectationId: "ALLOW-1", inclusion: "allowed", outcome: "matched" })
    ]);
    expect(result.denominator).toBe(1);
    expect(result.numerator).toBe(1);
  });

  it("MET-097 required recall preserves matched and missing ID order", () => {
    const result = calculateRequiredEvidenceRecall([
      match({ expectationId: "REQ-1", outcome: "missing" }),
      match({ expectationId: "REQ-2", outcome: "matched" }),
      match({ expectationId: "REQ-3", outcome: "missing" })
    ]);
    expect(result.matchedExpectationIds).toEqual(["REQ-2"]);
    expect(result.missingExpectationIds).toEqual(["REQ-1", "REQ-3"]);
  });

  it("MET-098 no required items returns not-applicable", () => {
    const result = calculateRequiredEvidenceRecall([match({ inclusion: "allowed" })]);
    expect(result.availability).toBe("not-applicable");
    expect(result.numerator).toBeNull();
    expect(result.reason).toBe("The expectation fixture contains no required evidence items.");
  });
});

describe("calculateAllowedEvidenceCoverage", () => {
  it("MET-099 allowed coverage uses allowed items only", () => {
    const result = calculateAllowedEvidenceCoverage([
      match({ expectationId: "ALLOW-1", inclusion: "allowed", outcome: "matched" }),
      match({ expectationId: "REQ-1", inclusion: "required", outcome: "matched" })
    ]);
    expect(result.denominator).toBe(1);
  });

  it("MET-100 missing allowed evidence remains represented without failure semantics", () => {
    const result = calculateAllowedEvidenceCoverage([match({ inclusion: "allowed", outcome: "missing" })]);
    expect(result.availability).toBe("available");
    expect(result.numerator).toBe(0);
    expect(result.missingExpectationIds).toEqual(["REQ-FILE-001"]);
  });

  it("MET-101 no allowed items returns not-applicable", () => {
    const result = calculateAllowedEvidenceCoverage([match({ inclusion: "required" })]);
    expect(result.availability).toBe("not-applicable");
    expect(result.reason).toBe("The expectation fixture contains no allowed evidence items.");
  });
});

describe("calculateForbiddenEvidenceInclusion", () => {
  it("MET-102 forbidden inclusion counts violated forbidden items", () => {
    const result = calculateForbiddenEvidenceInclusion([
      match({ expectationId: "FORBID-1", inclusion: "forbidden", outcome: "violated" }),
      match({ expectationId: "FORBID-2", inclusion: "forbidden", outcome: "matched" })
    ]);
    expect(result.numerator).toBe(1);
    expect(result.denominator).toBe(2);
  });

  it("MET-103 forbidden inclusion does not invert the rate", () => {
    const result = calculateForbiddenEvidenceInclusion([match({ inclusion: "forbidden", outcome: "violated" })]);
    expect(result.rate).toBe(1);
  });

  it("MET-104 no forbidden items returns not-applicable", () => {
    const result = calculateForbiddenEvidenceInclusion([match({ inclusion: "required" })]);
    expect(result.availability).toBe("not-applicable");
    expect(result.reason).toBe("The expectation fixture contains no forbidden evidence items.");
  });
});

describe("calculateRequiredProvenanceRecall", () => {
  it("MET-105 required provenance recall uses required provenance only", () => {
    const result = calculateRequiredProvenanceRecall([
      match({ expectationId: "REQ-PROV-1", inclusion: "required", category: "provenance", outcome: "matched" }),
      match({ expectationId: "REQ-FILE-1", inclusion: "required", category: "file", outcome: "matched" })
    ]);
    expect(result.denominator).toBe(1);
  });

  it("MET-106 no required provenance returns not-applicable", () => {
    const result = calculateRequiredProvenanceRecall([match({ inclusion: "required", category: "file" })]);
    expect(result.availability).toBe("not-applicable");
    expect(result.reason).toBe("The expectation fixture contains no required provenance items.");
  });

  it("MET-107 rates are not rounded", () => {
    const result = calculateRequiredProvenanceRecall([
      match({ expectationId: "1", category: "provenance", outcome: "matched" }),
      match({ expectationId: "2", category: "provenance", outcome: "matched" }),
      match({ expectationId: "3", category: "provenance", outcome: "missing" })
    ]);
    expect(result.rate).toBe(2 / 3);
  });

  it("MET-108 unavailable and not-applicable ratios use null numeric fields", () => {
    const result = calculateRequiredProvenanceRecall([]);
    expect(result.numerator).toBeNull();
    expect(result.denominator).toBeNull();
    expect(result.rate).toBeNull();
  });
});

describe("calculateIrrelevantFileInclusion", () => {
  it("MET-109 irrelevant files exclude required covered files", () => {
    const expectations = fixture([item({ expectationId: "REQ-FILE-001", inclusion: "required", match: { path: "src/covered.ts" } })]);
    const observed = [
      evidence({ targetKey: "context-capsule|file|path:src/covered.ts" }),
      evidence({ targetKey: "context-capsule|file|path:src/uncovered.ts" })
    ];
    const result = calculateIrrelevantFileInclusion(expectations, observed);
    expect(result.evidenceKeys).toEqual(["context-capsule|file|path:src/uncovered.ts"]);
  });

  it("MET-110 irrelevant files exclude allowed covered files", () => {
    const expectations = fixture([item({ expectationId: "ALLOW-FILE-001", inclusion: "allowed", match: { path: "src/covered.ts" } })]);
    const observed = [evidence({ targetKey: "context-capsule|file|path:src/covered.ts" })];
    const result = calculateIrrelevantFileInclusion(expectations, observed);
    expect(result.count).toBe(0);
  });

  it("MET-111 forbidden file evidence remains irrelevant", () => {
    const expectations = fixture([item({ expectationId: "FORBID-FILE-001", inclusion: "forbidden", match: { path: "src/forbidden.ts" } })]);
    const observed = [evidence({ targetKey: "context-capsule|file|path:src/forbidden.ts" })];
    const result = calculateIrrelevantFileInclusion(expectations, observed);
    expect(result.evidenceKeys).toEqual(["context-capsule|file|path:src/forbidden.ts"]);
  });

  it("MET-112 irrelevant file order follows observed order", () => {
    const expectations = fixture([]);
    const observed = [
      evidence({ targetKey: "context-capsule|file|path:b.ts" }),
      evidence({ targetKey: "context-capsule|file|path:a.ts" })
    ];
    const result = calculateIrrelevantFileInclusion(expectations, observed);
    expect(result.evidenceKeys).toEqual(["context-capsule|file|path:b.ts", "context-capsule|file|path:a.ts"]);
  });

  it("MET-113 no file evidence returns not-applicable", () => {
    const expectations = fixture([]);
    const result = calculateIrrelevantFileInclusion(expectations, []);
    expect(result.availability).toBe("not-applicable");
    expect(result.reason).toBe("The completed strategy contains no context-capsule file evidence.");
  });
});

describe("calculateIrrelevantInstructionInclusion", () => {
  it("MET-114 irrelevant instructions require sourceArtifact and category equality", () => {
    const expectations = fixture([
      item({
        expectationId: "REQ-WORKFLOW-001",
        inclusion: "required",
        category: "workflow",
        sourceArtifact: "workflow-instruction-packet",
        match: { id: "workflow.a" }
      })
    ]);
    const observed = [
      evidence({
        sourceArtifact: "workflow-instruction-packet",
        category: "workflow",
        targetKey: "workflow-instruction-packet|workflow|id:workflow.a"
      }),
      evidence({
        sourceArtifact: "full-workflow-library",
        category: "workflow",
        targetKey: "full-workflow-library|workflow|id:workflow.a"
      })
    ];
    const result = calculateIrrelevantInstructionInclusion(expectations, observed);
    expect(result.evidenceKeys).toEqual(["full-workflow-library|workflow|id:workflow.a"]);
  });

  it("MET-115 forbidden instruction evidence remains irrelevant", () => {
    const expectations = fixture([
      item({
        expectationId: "FORBID-COMMAND-001",
        inclusion: "forbidden",
        category: "command",
        sourceArtifact: "workflow-instruction-packet",
        match: { id: "command.forbidden" }
      })
    ]);
    const observed = [
      evidence({
        sourceArtifact: "workflow-instruction-packet",
        category: "command",
        targetKey: "workflow-instruction-packet|command|id:command.forbidden"
      })
    ];
    const result = calculateIrrelevantInstructionInclusion(expectations, observed);
    expect(result.evidenceKeys).toEqual(["workflow-instruction-packet|command|id:command.forbidden"]);
  });

  it("MET-116 no instruction evidence returns not-applicable", () => {
    const result = calculateIrrelevantInstructionInclusion(fixture([]), []);
    expect(result.availability).toBe("not-applicable");
    expect(result.reason).toBe("The completed strategy contains no workflow instruction evidence.");
  });

  it("MET-117 no path or ID normalization occurs", () => {
    const expectations = fixture([item({ expectationId: "REQ-FILE-001", inclusion: "required", match: { path: "SRC/Example.ts" } })]);
    const observed = [evidence({ targetKey: "context-capsule|file|path:src/example.ts" })];
    const result = calculateIrrelevantFileInclusion(expectations, observed);
    expect(result.evidenceKeys).toEqual(["context-capsule|file|path:src/example.ts"]);
  });
});
