import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateV043StrategyInput } from "../../../src/experiments/plugins/contextStrategyComparison/validateV043StrategyInput.js";
import type {
  ArchitectureContextOnlyStrategyInputV1,
  ArchitecturePlusImplementationAndTestRefreshStrategyInputV1,
  ArchitecturePlusImplementationRefreshStrategyInputV1,
  BoundedWorkflowInstructionPacketStrategyInputV1,
  CombinedBoundedStageContextStrategyInputV1,
  FullWorkflowLibraryStrategyInputV1
} from "../../../src/experiments/plugins/contextStrategyComparison/v043StrategyInputContracts.js";

const EXPECTATIONS_PATH = "tests/fixtures/stage-context-expectations/complete-v1.0.0.json";

function architectureContextOnly(): ArchitectureContextOnlyStrategyInputV1 {
  return {
    strategyId: "architecture-context-only",
    expectationsPath: EXPECTATIONS_PATH,
    architectureContextCapsulePath: "fixtures/architecture-context-capsule.json"
  };
}

function architecturePlusImplementationRefresh(): ArchitecturePlusImplementationRefreshStrategyInputV1 {
  return {
    strategyId: "architecture-plus-implementation-refresh",
    expectationsPath: EXPECTATIONS_PATH,
    architectureContextCapsulePath: "fixtures/architecture-context-capsule.json",
    implementationContextCapsulePath: "fixtures/implementation-context-capsule.json"
  };
}

function architecturePlusImplementationAndTestRefresh(): ArchitecturePlusImplementationAndTestRefreshStrategyInputV1 {
  return {
    strategyId: "architecture-plus-implementation-and-test-refresh",
    expectationsPath: EXPECTATIONS_PATH,
    architectureContextCapsulePath: "fixtures/architecture-context-capsule.json",
    implementationContextCapsulePath: "fixtures/implementation-context-capsule.json",
    testImplementationContextCapsulePath: "fixtures/test-implementation-context-capsule.json"
  };
}

function fullWorkflowLibrary(): FullWorkflowLibraryStrategyInputV1 {
  return {
    strategyId: "full-workflow-library",
    expectationsPath: EXPECTATIONS_PATH,
    fullWorkflowLibraryFixturePath: "fixtures/full-workflow-library.json"
  };
}

function boundedWorkflowInstructionPacket(): BoundedWorkflowInstructionPacketStrategyInputV1 {
  return {
    strategyId: "bounded-workflow-instruction-packet",
    expectationsPath: EXPECTATIONS_PATH,
    workflowInstructionPacketPath: "fixtures/workflow-instruction-packet.json"
  };
}

function combinedBoundedStageContext(): CombinedBoundedStageContextStrategyInputV1 {
  return {
    strategyId: "combined-bounded-stage-context",
    expectationsPath: EXPECTATIONS_PATH,
    contextArtifacts: [{ role: "architecture", contextCapsulePath: "fixtures/architecture-context-capsule.json" }],
    workflowInstructionPacketPath: "fixtures/workflow-instruction-packet.json"
  };
}

const VALID_INPUTS = [
  architectureContextOnly(),
  architecturePlusImplementationRefresh(),
  architecturePlusImplementationAndTestRefresh(),
  fullWorkflowLibrary(),
  boundedWorkflowInstructionPacket(),
  combinedBoundedStageContext()
];

describe("validateV043StrategyInput", () => {
  it("STR-021 each of the six valid inputs succeeds", () => {
    for (const input of VALID_INPUTS) {
      const result = validateV043StrategyInput(input);
      expect(result.ok, `strategy ${input.strategyId} should validate`).toBe(true);
    }
  });

  it("STR-022 success returns the exact original input object", () => {
    const input = architectureContextOnly();
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input).toBe(input);
  });

  it("STR-023 a non-object input fails", () => {
    expect(validateV043StrategyInput(null).ok).toBe(false);
    expect(validateV043StrategyInput("a string").ok).toBe(false);
    expect(validateV043StrategyInput(42).ok).toBe(false);
    expect(validateV043StrategyInput([]).ok).toBe(false);
    expect(validateV043StrategyInput(undefined).ok).toBe(false);
  });

  it("STR-024 an existing strategy ID fails as an invalid v0.4.3 input strategy", () => {
    const result = validateV043StrategyInput({ strategyId: "raw-full-file", expectationsPath: EXPECTATIONS_PATH });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "INVALID_STRATEGY_ID")).toBe(true);
  });

  it("STR-025 an unknown strategy ID fails", () => {
    const result = validateV043StrategyInput({ strategyId: "not-a-real-strategy", expectationsPath: EXPECTATIONS_PATH });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "INVALID_STRATEGY_ID")).toBe(true);
  });

  it("STR-026 each strategy rejects a missing expectationsPath", () => {
    for (const input of VALID_INPUTS) {
      const mutated = { ...input } as Record<string, unknown>;
      delete mutated.expectationsPath;
      const result = validateV043StrategyInput(mutated);
      expect(result.ok, `strategy ${input.strategyId} should reject missing expectationsPath`).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((issue) => issue.code === "MISSING_REQUIRED_FIELD" && issue.fieldPath === "expectationsPath")).toBe(
          true
        );
      }
    }
  });

  it("STR-027 each required artifact path rejects a missing field", () => {
    const mutated = architectureContextOnly() as unknown as Record<string, unknown>;
    delete mutated.architectureContextCapsulePath;
    const result = validateV043StrategyInput(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some(
          (issue) => issue.code === "MISSING_REQUIRED_FIELD" && issue.fieldPath === "architectureContextCapsulePath"
        )
      ).toBe(true);
    }
  });

  it("STR-028 an empty expectationsPath fails", () => {
    const input = { ...architectureContextOnly(), expectationsPath: "" };
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === "EMPTY_PATH" && issue.fieldPath === "expectationsPath")).toBe(true);
    }
  });

  it("STR-029 an empty required artifact path fails", () => {
    const input = { ...architectureContextOnly(), architectureContextCapsulePath: "" };
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some((issue) => issue.code === "EMPTY_PATH" && issue.fieldPath === "architectureContextCapsulePath")
      ).toBe(true);
    }
  });

  it("STR-030 an optional audit path succeeds when absent", () => {
    const input = architectureContextOnly();
    expect("architectureRetrievalAuditRecordPath" in input).toBe(false);
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(true);
  });

  it("STR-031 an optional audit path fails when present but empty", () => {
    const input = { ...architectureContextOnly(), architectureRetrievalAuditRecordPath: "" };
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some(
          (issue) => issue.code === "EMPTY_PATH" && issue.fieldPath === "architectureRetrievalAuditRecordPath"
        )
      ).toBe(true);
    }
  });

  it("STR-032 unknown root fields fail", () => {
    const input = { ...architectureContextOnly(), extraField: "unexpected" };
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === "UNKNOWN_INPUT_FIELD" && issue.fieldPath === "extraField")).toBe(true);
    }
  });

  it("STR-033 unknown combined-entry fields fail", () => {
    const input = combinedBoundedStageContext();
    const mutatedEntry = { ...input.contextArtifacts[0], extraField: "unexpected" };
    const result = validateV043StrategyInput({ ...input, contextArtifacts: [mutatedEntry] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some(
          (issue) => issue.code === "UNKNOWN_INPUT_FIELD" && issue.fieldPath === "contextArtifacts[0].extraField"
        )
      ).toBe(true);
    }
  });

  it("STR-034 combined contextArtifacts rejects an empty array", () => {
    const input = { ...combinedBoundedStageContext(), contextArtifacts: [] };
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "EMPTY_CONTEXT_ARTIFACT_SET")).toBe(true);
  });

  it("STR-035 combined contextArtifacts rejects more than three entries", () => {
    const input = {
      ...combinedBoundedStageContext(),
      contextArtifacts: [
        { role: "architecture", contextCapsulePath: "a.json" },
        { role: "implementation", contextCapsulePath: "b.json" },
        { role: "test-implementation", contextCapsulePath: "c.json" },
        { role: "architecture", contextCapsulePath: "d.json" }
      ]
    };
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "TOO_MANY_CONTEXT_ARTIFACTS")).toBe(true);
  });

  it("STR-036 combined contextArtifacts accepts one entry", () => {
    const result = validateV043StrategyInput(combinedBoundedStageContext());
    expect(result.ok).toBe(true);
  });

  it("STR-037 combined contextArtifacts accepts three unique roles", () => {
    const input = {
      ...combinedBoundedStageContext(),
      contextArtifacts: [
        { role: "architecture", contextCapsulePath: "a.json" },
        { role: "implementation", contextCapsulePath: "b.json" },
        { role: "test-implementation", contextCapsulePath: "c.json" }
      ]
    };
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(true);
  });

  it("STR-038 combined contextArtifacts rejects a duplicate role", () => {
    const input = {
      ...combinedBoundedStageContext(),
      contextArtifacts: [
        { role: "architecture", contextCapsulePath: "a.json" },
        { role: "architecture", contextCapsulePath: "b.json" }
      ]
    };
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "DUPLICATE_CONTEXT_ROLE")).toBe(true);
  });

  it("STR-039 combined contextArtifacts rejects an invalid role", () => {
    const input = {
      ...combinedBoundedStageContext(),
      contextArtifacts: [{ role: "not-a-role", contextCapsulePath: "a.json" }]
    };
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "INVALID_CONTEXT_ROLE")).toBe(true);
  });

  it("STR-040 combined context entry rejects a missing capsule path", () => {
    const input = { ...combinedBoundedStageContext(), contextArtifacts: [{ role: "architecture" }] };
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some(
          (issue) => issue.code === "MISSING_REQUIRED_FIELD" && issue.fieldPath === "contextArtifacts[0].contextCapsulePath"
        )
      ).toBe(true);
    }
  });

  it("STR-041 combined context entry accepts an absent audit path", () => {
    const input = combinedBoundedStageContext();
    expect("retrievalAuditRecordPath" in input.contextArtifacts[0]).toBe(false);
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(true);
  });

  it("STR-042 combined context entry rejects an empty audit path", () => {
    const input = {
      ...combinedBoundedStageContext(),
      contextArtifacts: [{ role: "architecture", contextCapsulePath: "a.json", retrievalAuditRecordPath: "" }]
    };
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some(
          (issue) => issue.code === "EMPTY_PATH" && issue.fieldPath === "contextArtifacts[0].retrievalAuditRecordPath"
        )
      ).toBe(true);
    }
  });

  it("STR-043 combined array order is preserved", () => {
    const input = {
      ...combinedBoundedStageContext(),
      contextArtifacts: [
        { role: "test-implementation", contextCapsulePath: "c.json" },
        { role: "architecture", contextCapsulePath: "a.json" },
        { role: "implementation", contextCapsulePath: "b.json" }
      ]
    };
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const validated = result.input as CombinedBoundedStageContextStrategyInputV1;
      expect(validated.contextArtifacts.map((entry) => entry.role)).toEqual([
        "test-implementation",
        "architecture",
        "implementation"
      ]);
    }
  });

  it("STR-044 input paths are not normalized", () => {
    const input = { ...architectureContextOnly(), architectureContextCapsulePath: "./fixtures/../fixtures/example.json" };
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const validated = result.input as ArchitectureContextOnlyStrategyInputV1;
      expect(validated.architectureContextCapsulePath).toBe("./fixtures/../fixtures/example.json");
    }
  });

  it("STR-045 validation does not resolve paths", () => {
    const input = architectureContextOnly();
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const validated = result.input as ArchitectureContextOnlyStrategyInputV1;
      expect(validated.architectureContextCapsulePath).toBe("fixtures/architecture-context-capsule.json");
    }
  });

  it("STR-046 validation does not access the filesystem", () => {
    const input = { ...architectureContextOnly(), architectureContextCapsulePath: "does/not/exist.json" };
    const result = validateV043StrategyInput(input);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.ok).toBe(true);
  });

  it("STR-047 validation does not mutate the input", () => {
    const input = combinedBoundedStageContext();
    const before = JSON.stringify(input);
    validateV043StrategyInput(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("STR-048 validation returns all issues", () => {
    const input = { ...architectureContextOnly(), extraField: "unexpected" } as Record<string, unknown>;
    delete input.expectationsPath;
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });

  it("STR-049 issue ordering follows Section 44", () => {
    const input = { ...architectureContextOnly(), extraField: "unexpected" } as Record<string, unknown>;
    delete input.architectureContextCapsulePath;
    const result = validateV043StrategyInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const unknownIndex = result.issues.findIndex((issue) => issue.code === "UNKNOWN_INPUT_FIELD");
      const missingIndex = result.issues.findIndex((issue) => issue.code === "MISSING_REQUIRED_FIELD");
      expect(unknownIndex).toBeGreaterThanOrEqual(0);
      expect(missingIndex).toBeGreaterThanOrEqual(0);
      expect(unknownIndex).toBeLessThan(missingIndex);
    }
  });

  it("STR-050 no strategy input triggers artifact reading", () => {
    for (const input of VALID_INPUTS) {
      const result = validateV043StrategyInput(input);
      expect(result).not.toBeInstanceOf(Promise);
    }
    const source = readFileSync("src/experiments/plugins/contextStrategyComparison/validateV043StrategyInput.ts", "utf8");
    expect(source).not.toContain("node:fs");
  });
});
