import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTEXT_STRATEGY_IDS_WITH_V043,
  EXISTING_CONTEXT_STRATEGY_IDS,
  V043_STAGE_CONTEXT_STRATEGY_IDS
} from "../../../src/experiments/plugins/contextStrategyComparison/v043StrategyIds.js";

describe("v0.4.3 stage-context strategy IDs", () => {
  it("STR-001 existing IDs equal raw-full-file and my-dev-kit-guided", () => {
    expect(EXISTING_CONTEXT_STRATEGY_IDS).toEqual(["raw-full-file", "my-dev-kit-guided"]);
  });

  it("STR-002 the six v0.4.3 IDs exactly match Section 38 in order", () => {
    expect(V043_STAGE_CONTEXT_STRATEGY_IDS).toEqual([
      "architecture-context-only",
      "architecture-plus-implementation-refresh",
      "architecture-plus-implementation-and-test-refresh",
      "full-workflow-library",
      "bounded-workflow-instruction-packet",
      "combined-bounded-stage-context"
    ]);
  });

  it("STR-003 the complete ID list contains exactly eight entries", () => {
    expect(CONTEXT_STRATEGY_IDS_WITH_V043).toHaveLength(8);
  });

  it("STR-004 the complete ID list orders existing IDs before v0.4.3 IDs", () => {
    expect(CONTEXT_STRATEGY_IDS_WITH_V043.slice(0, 2)).toEqual(EXISTING_CONTEXT_STRATEGY_IDS);
    expect(CONTEXT_STRATEGY_IDS_WITH_V043.slice(2)).toEqual(V043_STAGE_CONTEXT_STRATEGY_IDS);
  });

  it("STR-005 all eight IDs are unique", () => {
    expect(new Set(CONTEXT_STRATEGY_IDS_WITH_V043).size).toBe(8);
  });

  it("STR-006 no existing plugin registration file was modified by Batch 3", () => {
    const config = readFileSync("src/experiments/plugins/contextStrategyComparison/config.ts", "utf8");
    expect(config).toContain('strategies: ["raw-full-file", "my-dev-kit-guided"]');
  });
});
