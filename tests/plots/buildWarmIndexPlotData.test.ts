import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  makeCase,
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
