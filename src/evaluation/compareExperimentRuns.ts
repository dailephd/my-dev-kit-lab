import type { ExperimentComparison, ExperimentRun } from "./controlledExperimentTypes.js";

export function compareExperimentRuns(runs: ExperimentRun[]): ExperimentComparison[] {
  const groups = new Map<string, ExperimentRun[]>();
  for (const run of runs) {
    const key = [run.caseId, run.benchmarkProject, run.agentId, run.promptComplexityLevel].join("|");
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }

  const comparisons: ExperimentComparison[] = [];
  for (const groupRuns of groups.values()) {
    const raw = groupRuns.find((run) => run.promptStrategy === "raw-full-file");
    const guided = groupRuns.find((run) => run.promptStrategy === "my-dev-kit-guided");
    const anchor = raw ?? guided;
    if (!anchor) {
      continue;
    }
    const warnings: string[] = [];
    if (!raw || !guided) {
      warnings.push("Comparison is missing one paired strategy run.");
    }

    const rawTotalTokens = raw?.tokenUsage.totalTokens;
    const myDevKitTotalTokens = guided?.tokenUsage.totalTokens;
    const tokenComparisonAvailable = typeof rawTotalTokens === "number" && typeof myDevKitTotalTokens === "number";
    if (!tokenComparisonAvailable) {
      warnings.push("Token comparison unavailable because one or both runs lack total token usage.");
    }

    const tokenDelta = tokenComparisonAvailable ? rawTotalTokens - myDevKitTotalTokens : undefined;
    const tokenSavingsPercent =
      tokenComparisonAvailable && rawTotalTokens !== 0 && typeof tokenDelta === "number" ? round((tokenDelta / rawTotalTokens) * 100) : undefined;
    const durationDeltaMs =
      typeof raw?.durationMs === "number" && typeof guided?.durationMs === "number" ? raw.durationMs - guided.durationMs : undefined;
    const durationReductionPercent =
      typeof durationDeltaMs === "number" && raw && raw.durationMs !== 0 ? round((durationDeltaMs / raw.durationMs) * 100) : undefined;
    const correctnessDelta = raw && guided ? round(guided.correctness.correctnessScore - raw.correctness.correctnessScore) : undefined;

    comparisons.push({
      comparisonId: [anchor.caseId, anchor.benchmarkProject, anchor.agentId, anchor.promptComplexityLevel].join("."),
      caseId: anchor.caseId,
      benchmarkProject: anchor.benchmarkProject,
      agentId: anchor.agentId,
      complexityLevel: anchor.promptComplexityLevel,
      rawRunId: raw?.runId,
      myDevKitRunId: guided?.runId,
      rawStatus: raw?.status,
      myDevKitStatus: guided?.status,
      rawCorrectnessScore: raw?.correctness.correctnessScore,
      myDevKitCorrectnessScore: guided?.correctness.correctnessScore,
      sameCorrectnessPass: Boolean(raw && guided && raw.correctness.passed === guided.correctness.passed),
      correctnessDelta,
      rawDurationMs: raw?.durationMs,
      myDevKitDurationMs: guided?.durationMs,
      durationDeltaMs,
      durationReductionPercent,
      rawTotalTokens,
      myDevKitTotalTokens,
      tokenDelta,
      tokenSavingsPercent,
      tokenComparisonAvailable,
      reliabilityLabel: labelReliability(raw, guided, tokenComparisonAvailable),
      warnings
    });
  }
  return comparisons;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function labelReliability(
  raw: ExperimentRun | undefined,
  guided: ExperimentRun | undefined,
  tokenComparisonAvailable: boolean
): ExperimentComparison["reliabilityLabel"] {
  if (!raw || !guided) {
    return "partial";
  }
  if (raw.status === "agent-limit-reached" || guided.status === "agent-limit-reached") {
    return "limit-reached";
  }
  if (raw.status === "agent-unavailable" || guided.status === "agent-unavailable") {
    return "unavailable";
  }
  if (raw.status === "completed" && guided.status === "completed") {
    return tokenComparisonAvailable ? "strong" : "correctness-only";
  }
  if (raw.status === "failed" || guided.status === "failed" || raw.status === "invalid-output" || guided.status === "invalid-output") {
    return "failed";
  }
  return "partial";
}
