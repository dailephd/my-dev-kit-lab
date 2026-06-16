import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../core/pathSafety.js";
import { buildExperimentPlotData } from "./buildExperimentPlotData.js";
import { renderSvgChart } from "./renderSvgChart.js";
import type { ExperimentPlotData, PlotArtifacts } from "./types.js";

const chartFiles: Record<string, string> = {
  "token-savings-vs-prompt-length": "token-savings-vs-prompt-length.svg",
  "time-reduction-vs-prompt-length": "time-reduction-vs-prompt-length.svg",
  "token-savings-vs-project-complexity": "token-savings-vs-project-complexity.svg",
  "time-reduction-vs-project-complexity": "time-reduction-vs-project-complexity.svg",
  "correctness-by-strategy": "correctness-by-strategy.svg",
  "run-outcomes-by-agent": "run-outcomes-by-agent.svg"
};

export async function writePlotArtifacts(options: { experimentDir: string; outDir: string; repoRoot?: string }): Promise<PlotArtifacts> {
  const data = await buildExperimentPlotData({ experimentDir: options.experimentDir, repoRoot: options.repoRoot });
  return writePlotArtifactsFromData({ data, outDir: options.outDir });
}

export async function writePlotArtifactsFromData(options: { data: ExperimentPlotData; outDir: string }): Promise<PlotArtifacts> {
  const outDir = path.resolve(options.outDir);
  const chartsDir = resolveWithinRoot(outDir, "charts");
  await mkdir(chartsDir, { recursive: true });
  const summaryPath = resolveWithinRoot(outDir, "plots-summary.json");
  const dataPath = resolveWithinRoot(outDir, "plot-data.json");
  const charts: Record<string, string> = {};

  for (const plot of options.data.plots) {
    const fileName = chartFiles[plot.id] ?? `${plot.id}.svg`;
    const chartPath = resolveWithinRoot(chartsDir, fileName);
    await writeFile(chartPath, renderSvgChart(plot), "utf8");
    charts[plot.id] = chartPath;
  }

  const summary = {
    generatedAt: options.data.generatedAt,
    sourceExperimentDir: options.data.sourceExperimentDir,
    chartCount: Object.keys(charts).length,
    skippedPointCount: options.data.skippedPoints.length,
    warnings: options.data.warnings
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(dataPath, `${JSON.stringify(options.data, null, 2)}\n`, "utf8");

  return {
    summary,
    data: options.data,
    artifactPaths: { summaryPath, dataPath, chartsDir, charts }
  };
}
