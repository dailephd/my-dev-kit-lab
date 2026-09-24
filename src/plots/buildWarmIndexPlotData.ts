import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { WarmIndexNumberMetricV1 } from "../experiments/plugins/warmIndexReuse/metrics.js";
import {
  WARM_INDEX_REUSE_REPORT_SCHEMA_VERSION,
  type WarmIndexReuseReportTaskV1,
  type WarmIndexReuseReportV1,
} from "../report/experiments/warmIndexReuseReportModel.js";
import type { ExperimentPlotData, PlotPoint, PlotSeries, PlotSkippedPoint } from "./types.js";

// ---------------------------------------------------------------------------
// Warm-index plot data. Maps metrics already calculated by the warm-index
// metric owner (as carried by the plugin report) to plot points; unavailable
// metrics become skipped points with their reason. No formula is recalculated.
// ---------------------------------------------------------------------------

export const WARM_INDEX_PLOT_IDS = [
  "warm-index-amortized-index-cost",
  "warm-index-context-size",
  "warm-index-correctness",
  "warm-index-cumulative-token-usage",
] as const;

const WARM_INDEX_PLUGIN_ID = "warm-index-reuse";
const VARIANTS = ["raw-full-file", "warm-index-reuse"] as const;

/**
 * Returns the warm-index report section when `<experimentDir>/report.json` belongs to the
 * warm-index-reuse plugin, or null for any other directory. A warm report that is malformed
 * fails instead of falling back to legacy controlled-experiment parsing.
 */
export async function readWarmIndexPlotSource(experimentDir: string): Promise<WarmIndexReuseReportV1 | null> {
  const reportPath = path.join(experimentDir, "report.json");
  if (!existsSync(reportPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(reportPath, "utf8"));
  } catch {
    return null;
  }
  const report = (parsed as { report?: { plugin?: { id?: unknown }; warmIndexReuse?: unknown } })?.report;
  if (report?.plugin?.id !== WARM_INDEX_PLUGIN_ID) return null;

  const section = report.warmIndexReuse as Partial<WarmIndexReuseReportV1> | null | undefined;
  const invalid = (detail: string) =>
    new Error(`Invalid warm-index-reuse report for plots (${reportPath}): ${detail}`);
  if (!section || typeof section !== "object") throw invalid("missing warmIndexReuse section.");
  if (section.schemaVersion !== WARM_INDEX_REUSE_REPORT_SCHEMA_VERSION) {
    throw invalid(`unsupported schema version ${String(section.schemaVersion)}.`);
  }
  if (!Array.isArray(section.projects)) throw invalid("projects must be an array.");
  for (const project of section.projects) {
    if (!project || typeof project.benchmarkProject !== "string" || !Array.isArray(project.tasks)) {
      throw invalid("each project needs a benchmarkProject and a tasks array.");
    }
    for (const task of project.tasks) {
      if (!task || typeof task.taskOrdinal !== "number" || !task.raw || !task.warm) {
        throw invalid("each task needs a taskOrdinal and raw/warm metrics.");
      }
    }
  }
  return section as WarmIndexReuseReportV1;
}

type PlotAgentId = "fake-agent" | "codex" | "claude";

function correctnessTitles(agentId: PlotAgentId): { title: string; yLabel: string } {
  if (agentId === "codex") return { title: "Codex correctness by strategy", yLabel: "Codex correctness score" };
  if (agentId === "claude") return { title: "Claude correctness by strategy", yLabel: "Claude correctness score" };
  return { title: "Fake-agent correctness by strategy", yLabel: "Fake-agent correctness score" };
}

function cumulativeTokenTitles(agentId: PlotAgentId): { title: string; yLabel: string } {
  if (agentId === "codex") return { title: "Cumulative Codex token usage", yLabel: "Cumulative Codex total tokens" };
  if (agentId === "claude") return { title: "Cumulative Claude token usage", yLabel: "Cumulative Claude total tokens" };
  return { title: "Cumulative fake-agent token usage", yLabel: "Cumulative fake-agent total tokens (simulated)" };
}

export function buildWarmIndexPlotData(args: {
  section: WarmIndexReuseReportV1;
  experimentDir: string;
  generatedAt?: string;
}): ExperimentPlotData {
  const skippedPoints: PlotSkippedPoint[] = [];
  const series = (id: (typeof WARM_INDEX_PLOT_IDS)[number], title: string, yLabel: string): PlotSeries => ({
    id,
    title,
    xLabel: "Task ordinal",
    yLabel,
    kind: "scatter",
    points: [],
    warnings: [],
  });
  // Backward compatibility (v0.5.2 Batch 4, section 25): an older serialized v1 report predates the
  // additive `agent` field; its absence is treated as legacy fake-agent evidence, never rejected.
  const agentId: PlotAgentId = (args.section.agent?.id as PlotAgentId | undefined) ?? "fake-agent";
  const correctnessLabels = correctnessTitles(agentId);
  const cumulativeTokenLabels = cumulativeTokenTitles(agentId);

  const amortized = series("warm-index-amortized-index-cost", "Amortized index build cost", "Amortized index build duration (ms)");
  const contextSize = series("warm-index-context-size", "Raw vs retrieved context size", "Estimated context tokens");
  const correctness = series("warm-index-correctness", correctnessLabels.title, correctnessLabels.yLabel);
  const cumulativeTokens = series(
    "warm-index-cumulative-token-usage",
    cumulativeTokenLabels.title,
    cumulativeTokenLabels.yLabel
  );

  const add = (
    plot: PlotSeries,
    metric: WarmIndexNumberMetricV1,
    group: string,
    label: string,
    task: WarmIndexReuseReportTaskV1
  ) => {
    if (metric.availability === "available" && metric.value !== null && Number.isFinite(metric.value)) {
      const point: PlotPoint = { x: task.taskOrdinal, y: metric.value, group, label, metadata: { caseId: task.caseId } };
      plot.points.push(point);
    } else {
      skippedPoints.push({ plotId: plot.id, label, reason: metric.reason ?? `Metric is ${metric.availability}.` });
    }
  };

  for (const project of args.section.projects) {
    for (const task of project.tasks) {
      const taskLabel = `${project.benchmarkProject} task ${task.taskOrdinal} (${task.caseId})`;
      add(amortized, task.warm.amortizedIndexBuildDurationMs, project.benchmarkProject, taskLabel, task);
      for (const variantId of VARIANTS) {
        const side = variantId === "raw-full-file" ? task.raw : task.warm;
        const group = `${project.benchmarkProject} / ${variantId}`;
        const label = `${taskLabel} ${variantId}`;
        add(contextSize, side.contextEstimatedTokens, group, label, task);
        add(correctness, side.agentCorrectness, group, label, task);
        // Agent token totals only; estimated context tokens are never used as a fallback.
        add(cumulativeTokens, side.cumulativeAgentTotalTokens, group, label, task);
      }
    }
  }

  const plots = [amortized, contextSize, correctness, cumulativeTokens];
  const warnings: string[] = [];
  for (const plot of plots) {
    if (plot.points.length === 0) {
      plot.warnings.push("No comparable data available.");
      warnings.push(`${plot.title}: no comparable data available.`);
    }
  }
  return {
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    sourceExperimentDir: args.experimentDir,
    plots,
    skippedPoints,
    warnings,
  };
}
