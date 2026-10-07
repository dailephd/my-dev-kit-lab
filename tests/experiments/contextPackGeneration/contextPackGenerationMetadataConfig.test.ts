import { describe, expect, it } from "vitest";
import {
  CONTEXT_PACK_GENERATION_PLUGIN_ID,
  CONTEXT_PACK_GENERATION_TREATMENT_IDS,
  CONTEXT_PACK_GENERATION_VARIANTS,
  contextPackGenerationConfigDefinition,
  contextPackGenerationMetadata,
  defaultContextPackGenerationConfig,
  validateContextPackGenerationConfig
} from "../../../src/experiments/plugins/contextPackGeneration/index.js";
import { RETRIEVAL_QUERY_STRATEGY_IDS } from "../../../src/evaluation/retrievalQueryStrategies.js";
import { RETRIEVAL_QUERY_STRATEGY_COMPARISON_VARIANTS } from "../../../src/experiments/plugins/retrievalQueryStrategyComparison/index.js";

describe("context-pack-generation metadata", () => {
  it("has the exact frozen identity", () => {
    expect(CONTEXT_PACK_GENERATION_PLUGIN_ID).toBe("context-pack-generation");
    expect(contextPackGenerationMetadata).toEqual({
      id: "context-pack-generation",
      name: "Context Pack Generation",
      description: expect.any(String),
      schemaVersion: "1.0.0",
      status: "experimental",
      supportedTargets: ["self", "external-local"],
      supportedOutputs: ["json", "html", "text", "artifact"]
    });
  });

  it("declares exactly two treatments in a stable order", () => {
    expect([...CONTEXT_PACK_GENERATION_TREATMENT_IDS]).toEqual(["raw-full-file", "context-pack"]);
    expect(CONTEXT_PACK_GENERATION_VARIANTS.map((variant) => variant.id)).toEqual(["raw-full-file", "context-pack"]);
  });
});

describe("context-pack-generation config", () => {
  it("accepts the default config", () => {
    const result = validateContextPackGenerationConfig(undefined);
    expect(result.valid).toBe(true);
    expect(result.config).toEqual(defaultContextPackGenerationConfig);
    expect(validateContextPackGenerationConfig({}).valid).toBe(true);
  });

  it("accepts the bundled-case filters", () => {
    expect(validateContextPackGenerationConfig({ caseIds: ["a"], benchmarkProjects: ["p"] }).valid).toBe(true);
    expect(validateContextPackGenerationConfig({ caseIds: [] }).valid).toBe(false);
  });

  it("rejects unknown fields", () => {
    const result = validateContextPackGenerationConfig({ bogus: 1 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("bogus");
  });

  it.each([
    "searchResultLimit",
    "maxSeedNodes",
    "graphDepth",
    "maxFiles",
    "maxSymbols",
    "maxSourceSlices",
    "maxSourceLinesPerSlice",
    "maxTotalSourceLines",
    "maxTestFiles",
    "maxCallRelationships"
  ])("does not allow the selection cap %s to be overridden", (field) => {
    expect(validateContextPackGenerationConfig({ [field]: 1 }).valid).toBe(false);
    expect(contextPackGenerationConfigDefinition.fields.map((entry) => entry.name)).not.toContain(field);
  });

  it.each(["treatments", "treatment", "treatmentIds", "variants", "strategies", "strategy"])("has no selector field %s", (field) => {
    expect(validateContextPackGenerationConfig({ [field]: ["raw-full-file"] }).valid).toBe(false);
    expect(contextPackGenerationConfigDefinition.fields.map((entry) => entry.name)).not.toContain(field);
  });

  it("rejects a non-object config", () => {
    expect(validateContextPackGenerationConfig("x").valid).toBe(false);
  });
});

describe("v0.8.1 boundary", () => {
  it("leaves the frozen seven-strategy set untouched", () => {
    expect([...RETRIEVAL_QUERY_STRATEGY_IDS]).toEqual([
      "keyword-search",
      "symbol-lookup",
      "graph-neighborhood",
      "source-slice",
      "data-model-graph",
      "model-view-lineage",
      "combined-graph-guided"
    ]);
    expect(RETRIEVAL_QUERY_STRATEGY_COMPARISON_VARIANTS.map((variant) => variant.id)).toEqual([...RETRIEVAL_QUERY_STRATEGY_IDS]);
    const ids = new Set<string>(RETRIEVAL_QUERY_STRATEGY_IDS);
    for (const treatment of CONTEXT_PACK_GENERATION_TREATMENT_IDS) expect(ids.has(treatment)).toBe(false);
  });
});
