import type { ContextWindowScalingAggregateV1 } from "../experiments/plugins/contextWindowScaling/metrics.js";
import { STANDARD_CONTEXT_BUDGETS } from "../experiments/plugins/contextWindowScaling/contextBudget.js";
import type { ExperimentPlotData, PlotPoint, PlotSeries, PlotSkippedPoint } from "./types.js";

// ---------------------------------------------------------------------------
// Context-window-scaling plot data. Maps values already calculated by
// aggregateContextWindowScaling() (carried on ContextWindowScalingRun.aggregate) to plot
// points. Nothing is recalculated; a null aggregate value becomes a skipped point, never 0.
// ---------------------------------------------------------------------------

export const CONTEXT_WINDOW_SCALING_PLOT_IDS = [
  "context-window-scaling-context-size",
  "context-window-scaling-success-rate-by-budget",
  "context-window-scaling-correctness-by-budget",
] as const;

export const CONTEXT_WINDOW_SCALING_SKIP_REASONS = {
  contextSize: "context-size-unavailable",
  successRate: "success-rate-unavailable",
  correctness: "correctness-unavailable",
} as const;

/** Standard budgets read as 8k/16k/32k/64k; any other budget keeps its exact integer form. */
export function formatContextBudgetLabel(budget: number): string {
  return STANDARD_CONTEXT_BUDGETS.includes(budget) ? `${budget / 1024}k` : String(budget);
}

export function buildContextWindowScalingPlotData(args: {
  aggregate: ContextWindowScalingAggregateV1;
  experimentDir: string;
  generatedAt: string;
}): ExperimentPlotData {
  const { aggregate } = args;
  const skippedPoints: PlotSkippedPoint[] = [];
  const series = (id: (typeof CONTEXT_WINDOW_SCALING_PLOT_IDS)[number], title: string, xLabel: string, yLabel: string): PlotSeries => ({
    id,
    title,
    xLabel,
    yLabel,
    kind: "scatter",
    points: [],
    warnings: [],
  });
  const contextSize = series(
    CONTEXT_WINDOW_SCALING_PLOT_IDS[0],
    "Raw vs Retrieved Context Size",
    "Case ordinal (canonical case order)",
    "Estimated context tokens"
  );
  const successRate = series(
    CONTEXT_WINDOW_SCALING_PLOT_IDS[1],
    "Success Rate by Context Budget",
    "Context budget (estimated tokens)",
    "Success rate (percent)"
  );
  const correctness = series(
    CONTEXT_WINDOW_SCALING_PLOT_IDS[2],
    "Correctness by Context Budget",
    "Context budget (estimated tokens)",
    "Mean correctness score"
  );

  const add = (plot: PlotSeries, x: number, value: number | null, group: string, label: string, reason: string, metadata: PlotPoint["metadata"]) => {
    if (value !== null && Number.isFinite(value)) {
      plot.points.push({ x, y: value, group, label, metadata });
    } else {
      skippedPoints.push({ plotId: plot.id, label, reason });
    }
  };

  // Case ordinal follows the aggregate's canonical case order (first appearance of each caseId).
  const caseOrdinals = new Map<string, number>();
  for (const summary of aggregate.caseTreatmentContextSummaries) {
    if (!caseOrdinals.has(summary.caseId)) caseOrdinals.set(summary.caseId, caseOrdinals.size + 1);
  }
  for (const summary of aggregate.caseTreatmentContextSummaries) {
    add(
      contextSize,
      caseOrdinals.get(summary.caseId)!,
      summary.contextStatus === "available" ? summary.estimatedTokens : null,
      summary.variantId,
      `${summary.caseId} ${summary.variantId}`,
      CONTEXT_WINDOW_SCALING_SKIP_REASONS.contextSize,
      { caseId: summary.caseId }
    );
  }

  for (const summary of aggregate.budgetTreatmentSummaries) {
    const label = `${summary.variantId} ${formatContextBudgetLabel(summary.contextBudgetTokens)}`;
    const metadata = { contextBudgetTokens: summary.contextBudgetTokens };
    add(successRate, summary.contextBudgetTokens, summary.successRatePercent, summary.variantId, label, CONTEXT_WINDOW_SCALING_SKIP_REASONS.successRate, metadata);
    add(correctness, summary.contextBudgetTokens, summary.meanCorrectnessScore, summary.variantId, label, CONTEXT_WINDOW_SCALING_SKIP_REASONS.correctness, metadata);
  }

  const plots = [contextSize, successRate, correctness];
  const warnings: string[] = [];
  for (const plot of plots) {
    if (plot.points.length === 0) {
      plot.warnings.push("No comparable data available.");
      warnings.push(`${plot.title}: no comparable data available.`);
    }
  }
  return { generatedAt: args.generatedAt, sourceExperimentDir: args.experimentDir, plots, skippedPoints, warnings };
}
