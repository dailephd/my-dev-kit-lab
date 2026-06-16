import { describe, expect, it } from "vitest";
import { compareExperimentRuns } from "../../src/evaluation/index.js";
import { makeExperimentRun } from "./experimentTestHelpers.js";

describe("compareExperimentRuns", () => {
  it("pairs raw and my-dev-kit runs and computes token, duration, and correctness deltas", () => {
    const comparisons = compareExperimentRuns([
      makeExperimentRun({ promptStrategy: "raw-full-file", runId: "raw", tokenUsage: { totalTokens: 200, source: "agent-reported" }, durationMs: 1000 }),
      makeExperimentRun({
        promptStrategy: "my-dev-kit-guided",
        runId: "guided",
        tokenUsage: { totalTokens: 120, source: "agent-reported" },
        durationMs: 700,
        correctness: { ...makeExperimentRun().correctness, correctnessScore: 0.9 }
      })
    ]);
    expect(comparisons).toHaveLength(1);
    expect(comparisons[0].rawRunId).toBe("raw");
    expect(comparisons[0].myDevKitRunId).toBe("guided");
    expect(comparisons[0].tokenDelta).toBe(80);
    expect(comparisons[0].tokenSavingsPercent).toBe(40);
    expect(comparisons[0].durationDeltaMs).toBe(300);
    expect(comparisons[0].durationReductionPercent).toBe(30);
    expect(comparisons[0].correctnessDelta).toBe(-0.1);
    expect(comparisons[0].reliabilityLabel).toBe("strong");
  });

  it("marks token comparison unavailable and labels correctness-only", () => {
    const [comparison] = compareExperimentRuns([
      makeExperimentRun({ promptStrategy: "raw-full-file", tokenUsage: { source: "unavailable" } }),
      makeExperimentRun({ promptStrategy: "my-dev-kit-guided", tokenUsage: { totalTokens: 120, source: "agent-reported" } })
    ]);
    expect(comparison.tokenComparisonAvailable).toBe(false);
    expect(comparison.reliabilityLabel).toBe("correctness-only");
    expect(comparison.warnings[0]).toContain("Token comparison unavailable");
  });

  it("labels partial, limit-reached, unavailable, and failed comparisons without crashing on missing pairs", () => {
    expect(compareExperimentRuns([makeExperimentRun({ promptStrategy: "raw-full-file" })])[0].reliabilityLabel).toBe("partial");
    expect(
      compareExperimentRuns([
        makeExperimentRun({ promptStrategy: "raw-full-file" }),
        makeExperimentRun({ promptStrategy: "my-dev-kit-guided", status: "agent-limit-reached" })
      ])[0].reliabilityLabel
    ).toBe("limit-reached");
    expect(
      compareExperimentRuns([
        makeExperimentRun({ promptStrategy: "raw-full-file", status: "agent-unavailable" }),
        makeExperimentRun({ promptStrategy: "my-dev-kit-guided" })
      ])[0].reliabilityLabel
    ).toBe("unavailable");
    expect(
      compareExperimentRuns([
        makeExperimentRun({ promptStrategy: "raw-full-file", status: "failed" }),
        makeExperimentRun({ promptStrategy: "my-dev-kit-guided" })
      ])[0].reliabilityLabel
    ).toBe("failed");
  });
});
