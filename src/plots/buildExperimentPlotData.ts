import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExperimentComparison, ExperimentRun } from "../evaluation/controlledExperimentTypes.js";
import type { ExperimentPlotData, PlotPoint, PlotSeries, PlotSkippedPoint } from "./types.js";

export async function buildExperimentPlotData(options: { experimentDir: string; repoRoot?: string; generatedAt?: string }): Promise<ExperimentPlotData> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const experimentDir = path.resolve(repoRoot, options.experimentDir);
  const runsPayload = JSON.parse(await readFile(path.join(experimentDir, "experiment-runs.json"), "utf8")) as { runs: ExperimentRun[] };
  const comparisonsPayload = JSON.parse(await readFile(path.join(experimentDir, "experiment-comparisons.json"), "utf8")) as {
    comparisons: ExperimentComparison[];
  };
  return buildExperimentPlotDataFromRecords({
    experimentDir,
    runs: runsPayload.runs ?? [],
    comparisons: comparisonsPayload.comparisons ?? [],
    generatedAt: options.generatedAt
  });
}

export function buildExperimentPlotDataFromRecords(args: {
  experimentDir: string;
  runs: ExperimentRun[];
  comparisons: ExperimentComparison[];
  generatedAt?: string;
}): ExperimentPlotData {
  const skippedPoints: PlotSkippedPoint[] = [];
  const warnings: string[] = [];
  const runById = new Map(args.runs.map((run) => [run.runId, run]));

  const plots: PlotSeries[] = [
    scatter("token-savings-vs-prompt-length", "Token savings vs prompt length", "Prompt estimated tokens", "Token savings percent"),
    scatter("time-reduction-vs-prompt-length", "Execution time reduction vs prompt length", "Prompt estimated tokens", "Duration reduction percent"),
    scatter("token-savings-vs-project-complexity", "Token savings vs project complexity", "Project complexity score", "Token savings percent"),
    scatter("time-reduction-vs-project-complexity", "Execution time reduction vs project complexity", "Project complexity score", "Duration reduction percent"),
    { id: "correctness-by-strategy", title: "Correctness score by strategy", xLabel: "Prompt strategy", yLabel: "Correctness score", kind: "bar", points: [], warnings: [] },
    { id: "run-outcomes-by-agent", title: "Run outcome counts by agent", xLabel: "Agent", yLabel: "Run count", kind: "bar", points: [], warnings: [] }
  ];
  const byId = new Map(plots.map((plot) => [plot.id, plot]));

  for (const comparison of args.comparisons) {
    const rawRun = comparison.rawRunId ? runById.get(comparison.rawRunId) : undefined;
    const guidedRun = comparison.myDevKitRunId ? runById.get(comparison.myDevKitRunId) : undefined;
    const promptTokens = guidedRun?.promptMetrics.promptEstimatedTokens ?? rawRun?.promptMetrics.promptEstimatedTokens;
    const projectComplexityScore = guidedRun?.projectComplexityScore ?? rawRun?.projectComplexityScore;
    const label = [comparison.caseId, comparison.benchmarkProject, comparison.complexityLevel].join(" / ");

    addComparisonPoint({
      plot: byId.get("token-savings-vs-prompt-length")!,
      skippedPoints,
      comparison,
      x: promptTokens,
      y: comparison.tokenSavingsPercent,
      label,
      reason: comparison.tokenComparisonAvailable ? undefined : "Token comparison unavailable."
    });
    addComparisonPoint({
      plot: byId.get("time-reduction-vs-prompt-length")!,
      skippedPoints,
      comparison,
      x: promptTokens,
      y: comparison.durationReductionPercent,
      label,
      reason: typeof comparison.durationReductionPercent === "number" ? undefined : "Duration comparison unavailable."
    });
    addComparisonPoint({
      plot: byId.get("token-savings-vs-project-complexity")!,
      skippedPoints,
      comparison,
      x: projectComplexityScore,
      y: comparison.tokenSavingsPercent,
      label,
      reason: comparison.tokenComparisonAvailable ? undefined : "Token comparison unavailable."
    });
    addComparisonPoint({
      plot: byId.get("time-reduction-vs-project-complexity")!,
      skippedPoints,
      comparison,
      x: projectComplexityScore,
      y: comparison.durationReductionPercent,
      label,
      reason: typeof comparison.durationReductionPercent === "number" ? undefined : "Duration comparison unavailable."
    });
  }

  for (const run of args.runs) {
    byId.get("correctness-by-strategy")!.points.push({
      x: strategyIndex(run.promptStrategy),
      y: run.correctness.correctnessScore,
      group: run.agentId,
      label: [run.caseId, run.benchmarkProject, run.promptComplexityLevel, run.promptStrategy].join(" / "),
      metadata: { strategy: run.promptStrategy, status: run.status }
    });
  }

  for (const [key, count] of countOutcomeGroups(args.runs)) {
    const [agentId, status] = key.split("|");
    byId.get("run-outcomes-by-agent")!.points.push({
      x: agentIndex(agentId),
      y: count,
      group: status,
      label: `${agentId} ${status}`,
      metadata: { agentId, status }
    });
  }

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
    warnings
  };
}

function scatter(id: string, title: string, xLabel: string, yLabel: string): PlotSeries {
  return { id, title, xLabel, yLabel, kind: "scatter", points: [], warnings: [] };
}

function addComparisonPoint(args: {
  plot: PlotSeries;
  skippedPoints: PlotSkippedPoint[];
  comparison: ExperimentComparison;
  x?: number;
  y?: number;
  label: string;
  reason?: string;
}): void {
  if (args.reason || typeof args.x !== "number" || typeof args.y !== "number" || !Number.isFinite(args.x) || !Number.isFinite(args.y)) {
    args.skippedPoints.push({ plotId: args.plot.id, label: args.label, reason: args.reason ?? "Point value unavailable." });
    return;
  }
  args.plot.points.push({
    x: args.x,
    y: args.y,
    group: args.comparison.agentId,
    label: args.label,
    metadata: {
      caseId: args.comparison.caseId,
      benchmarkProject: args.comparison.benchmarkProject,
      complexityLevel: args.comparison.complexityLevel
    }
  });
}

function countOutcomeGroups(runs: ExperimentRun[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const key = `${run.agentId}|${run.status}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function strategyIndex(strategy: string): number {
  return strategy === "raw-full-file" ? 1 : 2;
}

function agentIndex(agentId: string): number {
  return agentId === "fake-agent" ? 1 : agentId === "codex" ? 2 : agentId === "claude" ? 3 : 4;
}
