import { describe, expect, it } from "vitest";
import { countEstimatedTokens } from "../../../src/core/countTokens.js";
import { createDefaultExperimentPluginRegistry } from "../../../src/experiments/defaultRegistry.js";
import {
  CONTEXT_WINDOW_SCALING_PLUGIN_ID,
  CONTEXT_WINDOW_SCALING_TREATMENT_IDS,
  STANDARD_CONTEXT_BUDGETS,
  buildContextBudgetEvidence,
  calculateContextBudgetUtilizationPercent,
  classifyContextFit,
  contextWindowScalingMetadata,
  defaultContextWindowScalingConfig,
  validateContextBudgets,
  validateContextWindowScalingConfig,
} from "../../../src/experiments/plugins/contextWindowScaling/index.js";

describe("context-window-scaling metadata", () => {
  it("freezes identity, status, target, and treatment vocabulary", () => {
    expect(contextWindowScalingMetadata.id).toBe("context-window-scaling");
    expect(CONTEXT_WINDOW_SCALING_PLUGIN_ID).toBe("context-window-scaling");
    expect(contextWindowScalingMetadata.name).toBe("Context Window Scaling");
    expect(contextWindowScalingMetadata.status).toBe("experimental");
    expect(contextWindowScalingMetadata.schemaVersion).toBe("1.0.0");
    expect(contextWindowScalingMetadata.supportedTargets).toEqual(["self", "external-local"]);
    expect([...CONTEXT_WINDOW_SCALING_TREATMENT_IDS]).toEqual(["raw-full-file", "my-dev-kit-guided"]);
  });

  it("is publicly registered in the default registry, followed by retrieval-precision-recall", () => {
    const ids = createDefaultExperimentPluginRegistry()
      .list()
      .map((plugin) => plugin.id);
    expect(ids).toEqual(["context-strategy-comparison", "warm-index-reuse", "incremental-change-staleness", "context-window-scaling", "retrieval-precision-recall", "retrieval-query-strategy-comparison"]);
  });
});

describe("context budget constants and config", () => {
  it("defaults to the ascending standard budgets", () => {
    expect([...STANDARD_CONTEXT_BUDGETS]).toEqual([8192, 16384, 32768, 65536]);
    expect(defaultContextWindowScalingConfig.contextBudgets).toEqual([8192, 16384, 32768, 65536]);
    expect(validateContextWindowScalingConfig(undefined)).toMatchObject({
      valid: true,
      config: { contextBudgets: [8192, 16384, 32768, 65536] },
    });
    expect(validateContextWindowScalingConfig({})).toMatchObject({ valid: true });
  });

  it("does not let callers mutate the default", () => {
    const result = validateContextWindowScalingConfig(undefined);
    if (result.valid) {
      result.config?.contextBudgets.push(1);
    }
    expect(defaultContextWindowScalingConfig.contextBudgets).toEqual([8192, 16384, 32768, 65536]);
  });

  it.each([
    [[8192], [8192]],
    [[8192, 16384, 32768, 65536], [8192, 16384, 32768, 65536]],
    [[12000], [12000]],
    [[65536, 12000, 8192], [8192, 12000, 65536]],
    [[Number.MAX_SAFE_INTEGER], [Number.MAX_SAFE_INTEGER]],
  ])("accepts %j as %j", (input, expected) => {
    expect(validateContextBudgets(input)).toEqual({ budgets: expected, errors: [] });
    expect(validateContextWindowScalingConfig({ contextBudgets: input })).toMatchObject({
      valid: true,
      config: { contextBudgets: expected },
    });
  });

  it.each([
    ["empty array", []],
    ["zero", [0]],
    ["negative", [-1]],
    ["fractional", [8192.5]],
    ["NaN", [Number.NaN]],
    ["+Infinity", [Number.POSITIVE_INFINITY]],
    ["-Infinity", [Number.NEGATIVE_INFINITY]],
    ["unsafe integer", [Number.MAX_SAFE_INTEGER + 1]],
    ["duplicate", [8192, 8192]],
    ["duplicate after other values", [8192, 16384, 8192]],
    ["string entry", ["8k"]],
    ["non-array", 8192],
    ["null", null],
  ])("rejects %s", (_label, input) => {
    const direct = validateContextBudgets(input);
    expect(direct.budgets).toEqual([]);
    expect(direct.errors.length).toBeGreaterThan(0);
    expect(validateContextWindowScalingConfig({ contextBudgets: input }).valid).toBe(false);
    expect(validateContextBudgets(input)).toEqual(direct);
  });

  it("reports duplicates explicitly and bounds error output", () => {
    expect(validateContextBudgets([8192, 8192]).errors).toEqual(["contextBudgets contains duplicate value(s): 8192."]);
    expect(validateContextBudgets(Array.from({ length: 50 }, () => 0)).errors.length).toBeLessThanOrEqual(6);
  });

  it("rejects non-object configs and unsupported fields", () => {
    expect(validateContextWindowScalingConfig("x").valid).toBe(false);
    expect(validateContextWindowScalingConfig([]).valid).toBe(false);
    expect(validateContextWindowScalingConfig({ contextBudgets: [8192], extra: 1 }).valid).toBe(false);
  });
});

describe("context fit classification", () => {
  it.each([
    [8191, 8192, "fits"],
    [8192, 8192, "fits"],
    [8193, 8192, "context-too-large"],
    [16384, 16384, "fits"],
    [16385, 16384, "context-too-large"],
    [32768, 32768, "fits"],
    [32769, 32768, "context-too-large"],
    [65536, 65536, "fits"],
    [65537, 65536, "context-too-large"],
    [0, 8192, "fits"],
  ] as const)("%i against %i => %s", (tokens, budget, status) => {
    expect(classifyContextFit(tokens, budget)).toBe(status);
  });

  it("agrees with the canonical estimator at the character boundary", () => {
    expect(classifyContextFit(countEstimatedTokens("x".repeat(8192 * 4)), 8192)).toBe("fits");
    expect(classifyContextFit(countEstimatedTokens("x".repeat(8192 * 4 + 1)), 8192)).toBe("context-too-large");
  });

  it("rejects invalid budgets and measurements instead of guessing", () => {
    expect(() => classifyContextFit(1, 0)).toThrow(RangeError);
    expect(() => classifyContextFit(1, 1.5)).toThrow(RangeError);
    expect(() => classifyContextFit(-1, 8192)).toThrow(RangeError);
    expect(() => classifyContextFit(Number.NaN, 8192)).toThrow(RangeError);
  });
});

describe("context budget utilization", () => {
  it("is estimated / budget * 100 without capping", () => {
    expect(calculateContextBudgetUtilizationPercent(4096, 8192)).toBe(50);
    expect(calculateContextBudgetUtilizationPercent(8192, 8192)).toBe(100);
    expect(calculateContextBudgetUtilizationPercent(12288, 8192)).toBe(150);
    expect(calculateContextBudgetUtilizationPercent(0, 8192)).toBe(0);
  });

  it("does not round internally", () => {
    expect(calculateContextBudgetUtilizationPercent(1, 3)).toBe((1 / 3) * 100);
  });

  it("rejects invalid inputs", () => {
    expect(() => calculateContextBudgetUtilizationPercent(1, 0)).toThrow(RangeError);
    expect(() => calculateContextBudgetUtilizationPercent(-1, 8192)).toThrow(RangeError);
  });

  it("builds compact evidence combining fit and utilization", () => {
    expect(buildContextBudgetEvidence(12288, 8192)).toEqual({
      contextBudgetTokens: 8192,
      contextEstimatedTokens: 12288,
      contextFitStatus: "context-too-large",
      contextBudgetUtilizationPercent: 150,
    });
  });
});
