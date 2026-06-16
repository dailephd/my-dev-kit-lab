import { describe, expect, it } from "vitest";
import { buildExperimentPlotDataFromRecords } from "../../src/plots/index.js";
import { compareExperimentRuns } from "../../src/evaluation/index.js";
import { makeExperimentRun } from "../evaluation/experimentTestHelpers.js";

describe("buildExperimentPlotDataFromRecords", () => {
  it("builds required plot data and skipped points", () => {
    const raw = makeExperimentRun({ runId: "raw", promptStrategy: "raw-full-file", tokenUsage: { totalTokens: 200, source: "agent-reported" } });
    const guided = makeExperimentRun({ runId: "guided", promptStrategy: "my-dev-kit-guided", tokenUsage: { totalTokens: 100, source: "agent-reported" }, durationMs: 500 });
    const comparisons = compareExperimentRuns([raw, guided]);
    const data = buildExperimentPlotDataFromRecords({ experimentDir: "experiment", runs: [raw, guided], comparisons, generatedAt: "now" });
    expect(data.plots.map((plot) => plot.id)).toEqual([
      "token-savings-vs-prompt-length",
      "time-reduction-vs-prompt-length",
      "token-savings-vs-project-complexity",
      "time-reduction-vs-project-complexity",
      "correctness-by-strategy",
      "run-outcomes-by-agent"
    ]);
    expect(data.plots.find((plot) => plot.id === "token-savings-vs-prompt-length")?.points[0]?.y).toBe(50);
    expect(data.plots.find((plot) => plot.id === "correctness-by-strategy")?.points).toHaveLength(2);
  });

  it("handles unavailable token data and timeout outcomes", () => {
    const raw = makeExperimentRun({ runId: "raw", promptStrategy: "raw-full-file", tokenUsage: { source: "unavailable" } });
    const guided = makeExperimentRun({ runId: "guided", promptStrategy: "my-dev-kit-guided", status: "timeout", tokenUsage: { source: "unavailable" } });
    const data = buildExperimentPlotDataFromRecords({ experimentDir: "experiment", runs: [raw, guided], comparisons: compareExperimentRuns([raw, guided]) });
    expect(data.skippedPoints.some((point) => point.reason.includes("Token comparison unavailable"))).toBe(true);
    expect(data.plots.find((plot) => plot.id === "run-outcomes-by-agent")?.points.some((point) => point.group === "timeout")).toBe(true);
  });
});
