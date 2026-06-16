import { describe, expect, it } from "vitest";
import { compareTokenSavings } from "../../src/evaluation/compareTokenSavings.js";

describe("compareTokenSavings", () => {
  it("computes tokens saved and percent saved", () => {
    const result = compareTokenSavings([
      {
        evaluationCase: { id: "x", title: "X", benchmarkProject: "todo-ts" } as any,
        rawBaseline: { totalEstimatedTokens: 100, totalChars: 400, totalFiles: 2, durationMs: 10 } as any,
        myDevKit: { totalEstimatedTokens: 25, totalChars: 100, filesRead: ["a"], commands: [1, 2], durationMs: 5, skipped: false, warnings: [] } as any
      }
    ]);
    expect(result.cases[0].tokensSaved).toBe(75);
    expect(result.cases[0].percentSaved).toBe(75);
  });

  it("handles zero raw tokens and skipped cases and aggregates correctly", () => {
    const result = compareTokenSavings([
      {
        evaluationCase: { id: "x", title: "X", benchmarkProject: "todo-ts" } as any,
        rawBaseline: { totalEstimatedTokens: 0, totalChars: 0, totalFiles: 0, durationMs: 10 } as any,
        myDevKit: { totalEstimatedTokens: 0, totalChars: 0, filesRead: [], commands: [], durationMs: 5, skipped: true, warnings: ["skip"] } as any
      }
    ]);
    expect(result.cases[0].percentSaved).toBe(0);
    expect(result.summary.completedCaseCount).toBe(0);
    expect(result.summary.skippedCaseCount).toBe(1);
    expect(result.summary.warnings).toContain("skip");
  });
});
