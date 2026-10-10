import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readEvaluationCases } from "../../src/evaluation/readEvaluationCases.js";
import {
  STANDARD_CONTEXT_BUDGETS,
  aggregateContextWindowScaling,
  contextWindowScalingMetadata,
  contextWindowScalingPlugin,
  type ContextWindowScalingRun,
} from "../../src/experiments/plugins/contextWindowScaling/index.js";
import { createDefaultExperimentPluginRegistry } from "../../src/experiments/defaultRegistry.js";
import {
  CONTEXT_WINDOW_SCALING_PLOT_IDS,
  CONTEXT_WINDOW_SCALING_SKIP_REASONS,
  buildContextWindowScalingPlotData,
  renderSvgChart,
  writePlotArtifactsFromData,
  type ExperimentPlotData,
  type PlotSeries,
} from "../../src/plots/index.js";
import { FAIL, PASS, caseEvidence, target, treatmentEvidence } from "../experiments/contextWindowScaling/evidenceFactory.js";

const GENERATED_AT = "2026-01-01T00:00:00.000Z";
const build = (aggregate: ReturnType<typeof aggregateContextWindowScaling>): ExperimentPlotData =>
  buildContextWindowScalingPlotData({ aggregate, experimentDir: "out", generatedAt: GENERATED_AT });
const plotOf = (data: ExperimentPlotData, id: string): PlotSeries => data.plots.find((p) => p.id === id)!;
const ys = (plot: PlotSeries, group: string) => plot.points.filter((p) => p.group === group).map((p) => p.y);
const xs = (plot: PlotSeries, group: string) => plot.points.filter((p) => p.group === group).map((p) => p.x);

function syntheticAggregate(budgets: number[], specs: Array<{ raw: number | null; rawEval: typeof PASS | null; guided?: number | null }>) {
  const cases = specs.map((spec, i) =>
    caseEvidence(`c${i}`, [
      treatmentEvidence({ variantId: "raw-full-file", budgets, tokens: spec.raw, shared: spec.rawEval }),
      treatmentEvidence({ variantId: "my-dev-kit-guided", budgets, tokens: spec.guided === undefined ? 50 : spec.guided, shared: PASS }),
    ])
  );
  return aggregateContextWindowScaling({ contextBudgets: budgets, cases });
}

describe("context-window-scaling plot data (synthetic aggregates)", () => {
  it("defines exactly the three roadmap plots, with no utilization plot", () => {
    const data = build(syntheticAggregate([8192, 16384], [{ raw: 100, rawEval: PASS }]));
    expect(CONTEXT_WINDOW_SCALING_PLOT_IDS).toEqual([
      "context-window-scaling-context-size",
      "context-window-scaling-success-rate-by-budget",
      "context-window-scaling-correctness-by-budget",
    ]);
    expect(data.plots.map((p) => p.id)).toEqual([...CONTEXT_WINDOW_SCALING_PLOT_IDS]);
    expect(JSON.stringify(data).toLowerCase()).not.toContain("utilization");
  });

  it("uses exact treatment identities as series groups and no evaluative wording", () => {
    const data = build(syntheticAggregate([8192], [{ raw: 100, rawEval: PASS }]));
    for (const plot of data.plots) {
      expect([...new Set(plot.points.map((p) => p.group))]).toEqual(["raw-full-file", "my-dev-kit-guided"]);
    }
    const text = JSON.stringify(data).toLowerCase();
    for (const banned of ["winner", "better", "superior", "optimal", "preferred"]) expect(text).not.toContain(banned);
  });

  it("plots one context-size point per case and treatment in canonical case order, unrounded", () => {
    const data = build(syntheticAggregate([8192, 16384], [{ raw: 9001, rawEval: PASS, guided: 77 }, { raw: 123, rawEval: PASS, guided: 5 }]));
    const plot = plotOf(data, "context-window-scaling-context-size");
    expect(plot.points).toHaveLength(4);
    expect(ys(plot, "raw-full-file")).toEqual([9001, 123]);
    expect(xs(plot, "raw-full-file")).toEqual([1, 2]);
    expect(ys(plot, "my-dev-kit-guided")).toEqual([77, 5]);
    expect(plot.points.map((p) => p.metadata?.caseId)).toEqual(["c0", "c0", "c1", "c1"]);
  });

  it("records unavailable context size as a skipped point, not zero", () => {
    const data = build(syntheticAggregate([8192], [{ raw: null, rawEval: null }, { raw: 100, rawEval: PASS }]));
    const plot = plotOf(data, "context-window-scaling-context-size");
    expect(ys(plot, "raw-full-file")).toEqual([100]);
    expect(data.skippedPoints.filter((s) => s.plotId === plot.id)).toEqual([
      { plotId: plot.id, label: "c0 raw-full-file", reason: CONTEXT_WINDOW_SCALING_SKIP_REASONS.contextSize },
    ]);
  });

  it("orders budgets ascending then raw before guided, and keeps aggregate values exactly", () => {
    const aggregate = syntheticAggregate([16384, 8192], [{ raw: 9000, rawEval: PASS }, { raw: 100, rawEval: FAIL }, { raw: 100, rawEval: PASS }]);
    const data = build(aggregate);
    const plot = plotOf(data, "context-window-scaling-success-rate-by-budget");
    expect(plot.points.map((p) => `${p.x}:${p.group}`)).toEqual([
      "8192:raw-full-file",
      "8192:my-dev-kit-guided",
      "16384:raw-full-file",
      "16384:my-dev-kit-guided",
    ]);
    const expected = aggregate.budgetTreatmentSummaries.map((s) => s.successRatePercent);
    expect(plot.points.map((p) => p.y)).toEqual(expected);
    const corr = plotOf(data, "context-window-scaling-correctness-by-budget");
    expect(corr.points.map((p) => p.y)).toEqual(aggregate.budgetTreatmentSummaries.map((s) => s.meanCorrectnessScore));
  });

  it("turns null success rate and null correctness into skipped points, never zero", () => {
    const data = build(syntheticAggregate([8192], [{ raw: null, rawEval: null }]));
    const rate = plotOf(data, "context-window-scaling-success-rate-by-budget");
    const corr = plotOf(data, "context-window-scaling-correctness-by-budget");
    expect(ys(rate, "raw-full-file")).toEqual([]);
    expect(ys(corr, "raw-full-file")).toEqual([]);
    expect(data.skippedPoints).toEqual(
      expect.arrayContaining([
        { plotId: rate.id, label: "raw-full-file 8k", reason: "success-rate-unavailable" },
        { plotId: corr.id, label: "raw-full-file 8k", reason: "correctness-unavailable" },
      ])
    );
    expect(data.plots.some((p) => p.points.some((pt) => pt.group === "raw-full-file" && pt.y === 0 && p.id !== rate.id))).toBe(false);
  });

  it("preserves arbitrary custom budgets numerically, ascending, with exact labels", () => {
    const aggregate = syntheticAggregate([20000, 12000, 8192], [{ raw: 9000, rawEval: PASS }]);
    const plot = plotOf(build(aggregate), "context-window-scaling-success-rate-by-budget");
    expect([...new Set(plot.points.map((p) => p.x))]).toEqual([8192, 12000, 20000]);
    expect(plot.points.map((p) => p.label)).toContain("raw-full-file 12000");
    expect(plot.points.map((p) => p.label)).toContain("raw-full-file 8k");
  });

  it("is deterministic for identical aggregate evidence, including SVG bytes", () => {
    const aggregate = syntheticAggregate([8192, 16384], [{ raw: 9000, rawEval: PASS }, { raw: 100, rawEval: PASS }]);
    const a = build(aggregate);
    const b = build(structuredClone(aggregate));
    expect(a).toEqual(b);
    a.plots.forEach((plot, i) => expect(renderSvgChart(plot)).toBe(renderSvgChart(b.plots[i]!)));
  });

  it("keeps the existing no-data behaviour when every point is unavailable", () => {
    const data = build(syntheticAggregate([8192], [{ raw: null, rawEval: null, guided: null }]));
    const plot = plotOf(data, "context-window-scaling-context-size");
    expect(plot.points).toEqual([]);
    expect(plot.warnings).toEqual(["No comparable data available."]);
    expect(renderSvgChart(plot)).toContain("No comparable data available");
  });
});

describe("fixed-corpus plots from a real ContextWindowScalingRun", () => {
  let run: ContextWindowScalingRun;
  let outputRoot: string;
  let plotRoot: string;
  beforeAll(async () => {
    const cases = await readEvaluationCases(path.join(process.cwd(), "benchmarks", "contracts", "context-window-scaling-cases.json"), process.cwd());
    outputRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-plots-run-"));
    plotRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-plots-out-"));
    run = await contextWindowScalingPlugin.run({
      runId: "fixed-plots",
      startedAt: new Date(),
      toolRoot: process.cwd(),
      target,
      outputRoot,
      config: { contextBudgets: [...STANDARD_CONTEXT_BUDGETS], kitCommand: `node ${path.join(process.cwd(), "tests", "fixtures", "fake-context-scaling-kit-cli.js")}` },
      inputs: { cases },
    });
  }, 120_000);
  afterAll(async () => {
    await rm(outputRoot, { recursive: true, force: true });
    await rm(plotRoot, { recursive: true, force: true });
  });

  it("plots actual aggregate context sizes per case", () => {
    const data = build(run.aggregate);
    const plot = plotOf(data, "context-window-scaling-context-size");
    expect(ys(plot, "raw-full-file")).toEqual([14035, 28184, 56512, 104252]);
    expect(ys(plot, "my-dev-kit-guided")).toEqual([276, 225, 246, 173]);
    expect(xs(plot, "raw-full-file")).toEqual([1, 2, 3, 4]);
    expect(data.skippedPoints.filter((s) => s.plotId === plot.id)).toEqual([]);
  });

  it("plots success rate by budget", () => {
    const plot = plotOf(build(run.aggregate), "context-window-scaling-success-rate-by-budget");
    expect(xs(plot, "raw-full-file")).toEqual([8192, 16384, 32768, 65536]);
    expect(ys(plot, "raw-full-file")).toEqual([0, 25, 50, 75]);
    expect(ys(plot, "my-dev-kit-guided")).toEqual([100, 100, 100, 100]);
  });

  it("plots correctness by budget, skipping raw 8k instead of drawing zero", () => {
    const data = build(run.aggregate);
    const plot = plotOf(data, "context-window-scaling-correctness-by-budget");
    expect(xs(plot, "raw-full-file")).toEqual([16384, 32768, 65536]);
    expect(ys(plot, "raw-full-file")).toEqual([1, 1, 1]);
    expect(ys(plot, "my-dev-kit-guided")).toEqual([1, 1, 1, 1]);
    expect(data.skippedPoints).toEqual([{ plotId: plot.id, label: "raw-full-file 8k", reason: "correctness-unavailable" }]);
  });

  it("writes exactly the three chart families with the normal writer", async () => {
    const before = await readdir(process.cwd());
    const artifacts = await writePlotArtifactsFromData({ data: build(run.aggregate), outDir: plotRoot });
    expect(Object.keys(artifacts.artifactPaths.charts)).toEqual([...CONTEXT_WINDOW_SCALING_PLOT_IDS]);
    for (const id of CONTEXT_WINDOW_SCALING_PLOT_IDS) {
      expect(existsSync(path.join(plotRoot, "charts", `${id}.svg`))).toBe(true);
    }
    expect(existsSync(artifacts.artifactPaths.dataPath)).toBe(true);
    expect((await readdir(path.join(plotRoot, "charts"))).sort()).toEqual(CONTEXT_WINDOW_SCALING_PLOT_IDS.map((id) => `${id}.svg`).sort());
    expect((await readdir(plotRoot)).sort()).toEqual(["charts", "plot-data.json", "plots-summary.json"]);
    expect(await readdir(process.cwd())).toEqual(before);
  });
});

describe("plugin metadata and registration", () => {
  it("advertises plot without screenshot and is registered before retrieval-precision-recall and retrieval-query-strategy-comparison", () => {
    expect(contextWindowScalingMetadata.supportedOutputs).toEqual(["json", "text", "html", "plot"]);
    const registry = createDefaultExperimentPluginRegistry();
    expect(registry.list()).toHaveLength(8);
    expect(registry.list().map((p) => p.id).at(-5)).toBe("context-window-scaling");
    expect(registry.list().map((p) => p.id).slice(-4)).toEqual(["retrieval-precision-recall", "retrieval-query-strategy-comparison", "context-pack-generation", "agent-success-rate"]);
  });
});
