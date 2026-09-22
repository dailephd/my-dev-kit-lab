import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultExperimentPluginRegistry, runExperiment } from "../../src/experiments/index.js";
import {
  buildWarmIndexPlotData,
  readWarmIndexPlotSource,
  renderSvgChart,
  WARM_INDEX_PLOT_IDS,
  writePlotArtifacts,
} from "../../src/plots/index.js";
import { buildWarmIndexReuseReport, writePluginExperimentReports } from "../../src/report/index.js";
import type { WarmIndexReuseReportV1 } from "../../src/report/index.js";
import {
  fakeKitCommand,
  loadBundledProjectProfiles,
  loadProductionWarmIndexCases,
  makeCase,
  makeCases,
  writeFakeKitVariant,
} from "../experiments/warmIndexReuse/warmIndexTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function warmOutput(env: NodeJS.ProcessEnv = {}, kitCommand = fakeKitCommand) {
  const outputRoot = tempDir("warm-plot-run-");
  const registry = createDefaultExperimentPluginRegistry();
  const run = await runExperiment({
    pluginId: "warm-index-reuse",
    registry,
    outputRoot,
    config: { kitCommand },
    inputs: { cases: [makeCase({ id: "task-a" }), makeCase({ id: "task-b" })], projectProfiles: await loadBundledProjectProfiles(), env },
    toolRoot: process.cwd(),
    runId: "warm-plot-run",
  });
  await writePluginExperimentReports({ run, plugin: registry.describe("warm-index-reuse") });
  return { run, outputRoot, section: buildWarmIndexReuseReport(run)! };
}

function plot(data: ReturnType<typeof buildWarmIndexPlotData>, id: string) {
  const series = data.plots.find((candidate) => candidate.id === id);
  if (!series) throw new Error(`missing plot ${id}`);
  return series;
}

describe("buildWarmIndexPlotData", () => {
  it("builds exactly the four roadmap plots in order", async () => {
    const { section, outputRoot } = await warmOutput();
    const data = buildWarmIndexPlotData({ section, experimentDir: outputRoot, generatedAt: "2026-09-21T00:00:00.000Z" });
    expect(data.plots.map((series) => series.id)).toEqual([...WARM_INDEX_PLOT_IDS]);
    expect(data.plots.map((series) => series.title)).toEqual([
      "Amortized index build cost",
      "Raw vs retrieved context size",
      "Fake-agent correctness by strategy",
      "Cumulative fake-agent token usage",
    ]);
    expect(data.plots.every((series) => series.xLabel === "Task ordinal")).toBe(true);
  });

  it("plots the precomputed amortized metric and skips unavailable values with their reason", async () => {
    const { section, outputRoot } = await warmOutput();
    const task = section.projects[0].tasks[1];
    task.warm.amortizedIndexBuildDurationMs = { ...task.warm.amortizedIndexBuildDurationMs, value: 999 };
    section.projects[0].tasks[0].warm.amortizedIndexBuildDurationMs = {
      availability: "unavailable",
      value: null,
      unit: "ms",
      source: "derived",
      reason: "No valid warm index session was prepared.",
      tokenCountMethod: null,
    };
    const data = buildWarmIndexPlotData({ section, experimentDir: outputRoot });
    const amortized = plot(data, "warm-index-amortized-index-cost");
    expect(amortized.points.map((point) => [point.x, point.y, point.group])).toEqual([[2, 999, "todo-ts"]]);
    expect(data.skippedPoints).toContainEqual({
      plotId: "warm-index-amortized-index-cost",
      label: "todo-ts task 1 (task-a)",
      reason: "No valid warm index session was prepared.",
    });
  });

  it("plots raw and retrieved estimated context tokens per project and variant", async () => {
    const { section, outputRoot } = await warmOutput();
    const contextSize = plot(buildWarmIndexPlotData({ section, experimentDir: outputRoot }), "warm-index-context-size");
    expect(contextSize.points.map((point) => [point.x, point.group])).toEqual([
      [1, "todo-ts / raw-full-file"],
      [1, "todo-ts / warm-index-reuse"],
      [2, "todo-ts / raw-full-file"],
      [2, "todo-ts / warm-index-reuse"],
    ]);
    expect(contextSize.points[0].y).toBe(section.projects[0].tasks[0].raw.contextEstimatedTokens.value);
    expect(contextSize.points[1].y).toBe(section.projects[0].tasks[0].warm.contextEstimatedTokens.value);
  });

  it("plots fake-agent correctness only where it is available", async () => {
    const { section, outputRoot } = await warmOutput({ FAKE_AGENT_MODE: "failure" });
    const data = buildWarmIndexPlotData({ section, experimentDir: outputRoot });
    const correctness = plot(data, "warm-index-correctness");
    expect(correctness.points).toEqual([]);
    expect(correctness.warnings).toContain("No comparable data available.");
    expect(data.skippedPoints.filter((point) => point.plotId === "warm-index-correctness")).toHaveLength(4);
  });

  it("plots cumulative fake-agent tokens and never falls back to estimated context tokens", async () => {
    const withTokens = await warmOutput();
    const cumulative = plot(buildWarmIndexPlotData({ section: withTokens.section, experimentDir: withTokens.outputRoot }), "warm-index-cumulative-token-usage");
    expect(cumulative.points.map((point) => point.y)).toEqual(
      withTokens.section.projects[0].tasks.flatMap((task) => [task.raw.cumulativeAgentTotalTokens.value, task.warm.cumulativeAgentTotalTokens.value])
    );

    const missing = await warmOutput({ FAKE_AGENT_MODE: "missing-token-usage" });
    const data = buildWarmIndexPlotData({ section: missing.section, experimentDir: missing.outputRoot });
    const missingTokens = plot(data, "warm-index-cumulative-token-usage");
    expect(missing.section.projects[0].tasks[0].raw.cumulativeEstimatedContextTokens.availability).toBe("available");
    expect(missingTokens.points).toEqual([]);
    const skipped = data.skippedPoints.filter((point) => point.plotId === "warm-index-cumulative-token-usage");
    expect(skipped).toHaveLength(4);
    expect(skipped[0].reason).toContain("fake-agent total tokens evidence is missing");
    expect(renderSvgChart(missingTokens)).toContain("No comparable data available");
  });
});

describe("plots generate for warm-index-reuse output", () => {
  it("writes four warm charts through the existing writer", async () => {
    const { outputRoot } = await warmOutput();
    const plotsOut = tempDir("warm-plots-");
    const artifacts = await writePlotArtifacts({ experimentDir: outputRoot, outDir: plotsOut });
    expect(artifacts.summary.chartCount).toBe(4);
    expect(Object.keys(artifacts.artifactPaths.charts)).toEqual([...WARM_INDEX_PLOT_IDS]);
    for (const id of WARM_INDEX_PLOT_IDS) {
      const svg = readFileSync(path.join(plotsOut, "charts", `${id}.svg`), "utf8");
      expect(svg).toContain("<svg");
    }
    const dataText = readFileSync(path.join(plotsOut, "plot-data.json"), "utf8");
    expect(dataText).not.toContain("contextText");
    expect(dataText).not.toContain("createTask(title: string)");
    expect(JSON.parse(readFileSync(path.join(plotsOut, "plots-summary.json"), "utf8")).chartCount).toBe(4);
  });

  it("fails clearly for a malformed warm report instead of using the legacy loader", async () => {
    const dir = tempDir("warm-plot-bad-");
    writeFileSync(path.join(dir, "report.json"), JSON.stringify({ report: { plugin: { id: "warm-index-reuse" }, warmIndexReuse: null } }));
    await expect(readWarmIndexPlotSource(dir)).rejects.toThrow("Invalid warm-index-reuse report for plots");
    await expect(writePlotArtifacts({ experimentDir: dir, outDir: tempDir("warm-plot-out-") })).rejects.toThrow("missing warmIndexReuse section");

    const wrongSchema = { schemaVersion: "other", projects: [] } as unknown as WarmIndexReuseReportV1;
    writeFileSync(path.join(dir, "report.json"), JSON.stringify({ report: { plugin: { id: "warm-index-reuse" }, warmIndexReuse: wrongSchema } }));
    await expect(readWarmIndexPlotSource(dir)).rejects.toThrow("unsupported schema version");
  });

  it("leaves other plugin reports and legacy directories to the legacy loader", async () => {
    const dir = tempDir("warm-plot-other-");
    expect(await readWarmIndexPlotSource(dir)).toBeNull();
    writeFileSync(path.join(dir, "report.json"), JSON.stringify({ report: { plugin: { id: "context-strategy-comparison" } } }));
    expect(await readWarmIndexPlotSource(dir)).toBeNull();
  });

  it("still produces the plot set when a project index fails", async () => {
    const kitCommand = writeFakeKitVariant(tempDir("warm-kit-"), { failOn: "index" });
    const { outputRoot } = await warmOutput({}, kitCommand);
    const artifacts = await writePlotArtifacts({ experimentDir: outputRoot, outDir: tempDir("warm-plots-") });
    expect(artifacts.summary.chartCount).toBe(4);
    expect(artifacts.data.skippedPoints.some((point) => point.plotId === "warm-index-amortized-index-cost")).toBe(true);
  });
});

describe("buildWarmIndexPlotData for the expanded v0.5.1 suite", () => {
  const MEDIUM = "task-workflow-medium-ts";
  const LARGE = "task-analytics-large-mixed";
  const ORDINALS = [1, 2, 3, 4, 5, 6];

  async function productionOutput() {
    const outputRoot = tempDir("warm-plot-prod-");
    const registry = createDefaultExperimentPluginRegistry();
    const cases = await loadProductionWarmIndexCases();
    const run = await runExperiment({
      pluginId: "warm-index-reuse",
      registry,
      outputRoot,
      config: { kitCommand: fakeKitCommand },
      inputs: { cases, projectProfiles: await loadBundledProjectProfiles(), env: {} },
      toolRoot: process.cwd(),
      runId: "warm-plot-production-run",
    });
    await writePluginExperimentReports({ run, plugin: registry.describe("warm-index-reuse") });
    return { outputRoot, cases, section: buildWarmIndexReuseReport(run)! };
  }

  const groupPoints = (series: ReturnType<typeof plot>) => {
    const groups = new Map<string, Array<{ x: number; caseId: unknown }>>();
    for (const point of series.points) {
      groups.set(point.group ?? "", [...(groups.get(point.group ?? "") ?? []), { x: point.x, caseId: point.metadata?.caseId }]);
    }
    return groups;
  };

  it("plots the 12-case production corpus with per-project ordinals 1..6, expected groups, and case IDs", async () => {
    const { section, outputRoot, cases } = await productionOutput();
    const data = buildWarmIndexPlotData({ section, experimentDir: outputRoot, generatedAt: "2026-09-22T00:00:00.000Z" });
    const idsByProject = new Map([MEDIUM, LARGE].map((project) => [project, cases.filter((c) => c.benchmarkProject === project).map((c) => c.id)]));

    expect(data.plots.map((series) => series.id)).toEqual([...WARM_INDEX_PLOT_IDS]);
    expect(data.plots.every((series) => series.xLabel === "Task ordinal")).toBe(true);
    expect(data.skippedPoints).toEqual([]);
    expect(data.plots.map((series) => [series.id, series.points.length])).toEqual([
      ["warm-index-amortized-index-cost", 12],
      ["warm-index-context-size", 24],
      ["warm-index-correctness", 24],
      ["warm-index-cumulative-token-usage", 24],
    ]);

    const amortized = groupPoints(plot(data, "warm-index-amortized-index-cost"));
    expect([...amortized.keys()]).toEqual([MEDIUM, LARGE]);
    for (const [project, points] of amortized) {
      expect(points.map((point) => point.x)).toEqual(ORDINALS);
      expect(points.map((point) => point.caseId)).toEqual(idsByProject.get(project));
    }
    for (const id of ["warm-index-context-size", "warm-index-correctness", "warm-index-cumulative-token-usage"]) {
      const groups = groupPoints(plot(data, id));
      expect([...groups.keys()].sort()).toEqual(
        [`${MEDIUM} / raw-full-file`, `${MEDIUM} / warm-index-reuse`, `${LARGE} / raw-full-file`, `${LARGE} / warm-index-reuse`].sort()
      );
      for (const [group, points] of groups) {
        expect(points.map((point) => point.x)).toEqual(ORDINALS);
        expect(points.map((point) => point.caseId)).toEqual(idsByProject.get(group.split(" / ")[0]));
      }
    }

    // Cumulative fake-agent token points are agent token totals only, never estimated context tokens.
    const cumulative = plot(data, "warm-index-cumulative-token-usage");
    const expected = section.projects.flatMap((project) =>
      project.tasks.flatMap((task) => [task.raw.cumulativeAgentTotalTokens.value, task.warm.cumulativeAgentTotalTokens.value])
    );
    expect(cumulative.points.map((point) => point.y)).toEqual(expected);
    const estimated = section.projects.flatMap((project) =>
      project.tasks.flatMap((task) => [task.raw.cumulativeEstimatedContextTokens.value, task.warm.cumulativeEstimatedContextTokens.value])
    );
    expect(cumulative.points.map((point) => point.y)).not.toEqual(estimated);
    expect(JSON.stringify(data)).not.toMatch(/locality/i);
  }, 120_000);

  it("writes exactly four SVG charts and bounded plot data for the production corpus", async () => {
    const { outputRoot } = await productionOutput();
    const plotsOut = tempDir("warm-plots-prod-");
    const artifacts = await writePlotArtifacts({ experimentDir: outputRoot, outDir: plotsOut });
    expect(artifacts.summary.chartCount).toBe(4);
    expect(Object.keys(artifacts.artifactPaths.charts)).toEqual([...WARM_INDEX_PLOT_IDS]);
    expect(readdirSync(path.join(plotsOut, "charts")).sort()).toEqual(WARM_INDEX_PLOT_IDS.map((id) => `${id}.svg`).sort());
    for (const id of WARM_INDEX_PLOT_IDS) {
      const svg = readFileSync(path.join(plotsOut, "charts", `${id}.svg`), "utf8");
      expect(svg.length).toBeGreaterThan(0);
      expect(svg).toContain("<svg");
    }
    const dataText = readFileSync(path.join(plotsOut, "plot-data.json"), "utf8");
    const plotData = JSON.parse(dataText) as { plots: Array<{ id: string; points: unknown[] }> };
    expect(plotData.plots.map((series) => [series.id, series.points.length])).toEqual([
      ["warm-index-amortized-index-cost", 12],
      ["warm-index-context-size", 24],
      ["warm-index-correctness", 24],
      ["warm-index-cumulative-token-usage", 24],
    ]);
    expect(dataText).not.toContain("contextText");
    expect(dataText).not.toContain("source for unknown");
  }, 120_000);

  it("skips unavailable six-task evidence with its reason and never plots fabricated zeros", async () => {
    // A missing prompt profile makes the fake agent fail for task 3 only (execution evidence stays available).
    const cases = makeCases(6);
    cases[2] = { ...cases[2], projectProfileRef: "missing-profile" };
    const outputRoot = tempDir("warm-plot-gap-");
    const registry = createDefaultExperimentPluginRegistry();
    const run = await runExperiment({
      pluginId: "warm-index-reuse",
      registry,
      outputRoot,
      config: { kitCommand: fakeKitCommand },
      inputs: { cases, projectProfiles: await loadBundledProjectProfiles(), env: {} },
      toolRoot: process.cwd(),
      runId: "warm-plot-gap-run",
    });
    const data = buildWarmIndexPlotData({ section: buildWarmIndexReuseReport(run)!, experimentDir: outputRoot });

    expect(plot(data, "warm-index-context-size").points).toHaveLength(12);
    const correctness = plot(data, "warm-index-correctness");
    expect(correctness.points.map((point) => point.x)).toEqual([1, 1, 2, 2, 4, 4, 5, 5, 6, 6]);
    const correctnessSkipped = data.skippedPoints.filter((point) => point.plotId === "warm-index-correctness");
    expect(correctnessSkipped.map((point) => point.label)).toEqual([
      "todo-ts task 3 (task-3) raw-full-file",
      "todo-ts task 3 (task-3) warm-index-reuse",
    ]);
    expect(correctnessSkipped.every((point) => point.reason.includes("not scoreable"))).toBe(true);

    const cumulative = plot(data, "warm-index-cumulative-token-usage");
    expect(cumulative.points.map((point) => point.x)).toEqual([1, 1, 2, 2]);
    expect(cumulative.points.every((point) => point.y > 0)).toBe(true);
    const cumulativeSkipped = data.skippedPoints.filter((point) => point.plotId === "warm-index-cumulative-token-usage");
    expect(cumulativeSkipped).toHaveLength(8);
    expect(cumulativeSkipped.every((point) => point.reason.includes("Task 3 (task-3)"))).toBe(true);
  }, 120_000);
});
