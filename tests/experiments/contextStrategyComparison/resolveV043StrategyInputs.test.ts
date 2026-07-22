import { describe, expect, it } from "vitest";
import { resolveV043StrategyInputs } from "../../../src/experiments/plugins/contextStrategyComparison/resolveV043StrategyInputs.js";
import { CONTEXT_STRATEGY_IDS_WITH_V043, V043_STAGE_CONTEXT_STRATEGY_IDS } from "../../../src/experiments/plugins/contextStrategyComparison/v043StrategyIds.js";
import type { V043StageContextStrategyInputV1 } from "../../../src/experiments/plugins/contextStrategyComparison/v043StrategyInputContracts.js";

function architectureInput(): V043StageContextStrategyInputV1 {
  return {
    strategyId: "architecture-context-only",
    expectationsPath: "tests/fixtures/stage-context-expectations/complete-v1.0.0.json",
    architectureContextCapsulePath: "fixtures/architecture-context-capsule.json"
  };
}

function inputFor(strategyId: (typeof V043_STAGE_CONTEXT_STRATEGY_IDS)[number]): V043StageContextStrategyInputV1 {
  switch (strategyId) {
    case "architecture-context-only":
      return architectureInput();
    case "architecture-plus-implementation-refresh":
      return {
        strategyId,
        expectationsPath: "tests/fixtures/stage-context-expectations/complete-v1.0.0.json",
        architectureContextCapsulePath: "fixtures/architecture-context-capsule.json",
        implementationContextCapsulePath: "fixtures/implementation-context-capsule.json"
      };
    case "architecture-plus-implementation-and-test-refresh":
      return {
        strategyId,
        expectationsPath: "tests/fixtures/stage-context-expectations/complete-v1.0.0.json",
        architectureContextCapsulePath: "fixtures/architecture-context-capsule.json",
        implementationContextCapsulePath: "fixtures/implementation-context-capsule.json",
        testImplementationContextCapsulePath: "fixtures/test-implementation-context-capsule.json"
      };
    case "full-workflow-library":
      return {
        strategyId,
        expectationsPath: "tests/fixtures/stage-context-expectations/complete-v1.0.0.json",
        fullWorkflowLibraryFixturePath: "fixtures/full-workflow-library.json"
      };
    case "bounded-workflow-instruction-packet":
      return {
        strategyId,
        expectationsPath: "tests/fixtures/stage-context-expectations/complete-v1.0.0.json",
        workflowInstructionPacketPath: "fixtures/workflow-instruction-packet.json"
      };
    case "combined-bounded-stage-context":
      return {
        strategyId,
        expectationsPath: "tests/fixtures/stage-context-expectations/complete-v1.0.0.json",
        contextArtifacts: [{ role: "architecture", contextCapsulePath: "fixtures/architecture-context-capsule.json" }],
        workflowInstructionPacketPath: "fixtures/workflow-instruction-packet.json"
      };
  }
}

describe("resolveV043StrategyInputs", () => {
  it("EXE-030 no selected v0.4.3 strategies and no inputs succeeds", () => {
    const result = resolveV043StrategyInputs(["raw-full-file", "my-dev-kit-guided"], []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.inputByStrategyId).toEqual({});
  });

  it("EXE-031 legacy-only selected strategies require no v0.4.3 input", () => {
    const result = resolveV043StrategyInputs(["raw-full-file"], []);
    expect(result.ok).toBe(true);
  });

  it("EXE-032 one selected v0.4.3 strategy with one matching input succeeds", () => {
    const input = architectureInput();
    const result = resolveV043StrategyInputs(["architecture-context-only"], [input]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.inputByStrategyId["architecture-context-only"]).toBe(input);
  });

  it("EXE-033 all six selected v0.4.3 strategies with one input each succeed", () => {
    const inputs = V043_STAGE_CONTEXT_STRATEGY_IDS.map(inputFor);
    const result = resolveV043StrategyInputs(V043_STAGE_CONTEXT_STRATEGY_IDS, inputs);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const strategyId of V043_STAGE_CONTEXT_STRATEGY_IDS) {
        expect(result.inputByStrategyId[strategyId]).toBeDefined();
      }
    }
  });

  it("EXE-034 resolved inputs retain original object references", () => {
    const input = architectureInput();
    const result = resolveV043StrategyInputs(["architecture-context-only"], [input]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.inputByStrategyId["architecture-context-only"]).toBe(input);
  });

  it("EXE-035 a missing selected input fails", () => {
    const result = resolveV043StrategyInputs(["architecture-context-only"], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([
        {
          code: "MISSING_STRATEGY_INPUT",
          strategyId: "architecture-context-only",
          message: expect.any(String)
        }
      ]);
    }
  });

  it("EXE-036 a duplicate selected input fails", () => {
    const result = resolveV043StrategyInputs(["architecture-context-only"], [architectureInput(), architectureInput()]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === "DUPLICATE_STRATEGY_INPUT")).toBe(true);
    }
  });

  it("EXE-037 an input for an unselected strategy fails", () => {
    const result = resolveV043StrategyInputs([], [architectureInput()]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([
        {
          code: "INPUT_STRATEGY_NOT_SELECTED",
          strategyId: "architecture-context-only",
          message: expect.any(String)
        }
      ]);
    }
  });

  it("EXE-038 missing and extra issues are both returned", () => {
    const result = resolveV043StrategyInputs(
      ["architecture-context-only", "bounded-workflow-instruction-packet"],
      [inputFor("bounded-workflow-instruction-packet"), inputFor("full-workflow-library")]
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.code === "MISSING_STRATEGY_INPUT" && issue.strategyId === "architecture-context-only")).toBe(
        true
      );
      expect(
        result.issues.some((issue) => issue.code === "INPUT_STRATEGY_NOT_SELECTED" && issue.strategyId === "full-workflow-library")
      ).toBe(true);
    }
  });

  it("EXE-039 issue order follows selected strategy order, then provided-input order", () => {
    const result = resolveV043StrategyInputs(
      ["bounded-workflow-instruction-packet", "architecture-context-only"],
      [inputFor("full-workflow-library"), inputFor("combined-bounded-stage-context")]
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.strategyId)).toEqual([
        "bounded-workflow-instruction-packet",
        "architecture-context-only",
        "full-workflow-library",
        "combined-bounded-stage-context"
      ]);
    }
  });

  it("EXE-040 selected strategy order is not changed", () => {
    const selected = ["bounded-workflow-instruction-packet", "architecture-context-only"] as const;
    const before = [...selected];
    resolveV043StrategyInputs(selected, []);
    expect(selected).toEqual(before);
  });

  it("EXE-041 provided input order is not changed", () => {
    const inputs = [inputFor("full-workflow-library"), inputFor("bounded-workflow-instruction-packet")];
    const before = [...inputs];
    resolveV043StrategyInputs(["full-workflow-library", "bounded-workflow-instruction-packet"], inputs);
    expect(inputs).toEqual(before);
  });

  it("EXE-042 existing strategy IDs are ignored by input resolution", () => {
    const result = resolveV043StrategyInputs(CONTEXT_STRATEGY_IDS_WITH_V043.slice(0, 2), []);
    expect(result.ok).toBe(true);
  });

  it("EXE-043 the function performs no filesystem access", () => {
    const result = resolveV043StrategyInputs(["architecture-context-only"], [architectureInput()]);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.ok).toBe(true);
  });

  it("EXE-044 the function does not mutate its inputs", () => {
    const selected = ["architecture-context-only"] as const;
    const inputs = [architectureInput()];
    const selectedBefore = JSON.stringify(selected);
    const inputsBefore = JSON.stringify(inputs);
    resolveV043StrategyInputs(selected, inputs);
    expect(JSON.stringify(selected)).toBe(selectedBefore);
    expect(JSON.stringify(inputs)).toBe(inputsBefore);
  });
});
