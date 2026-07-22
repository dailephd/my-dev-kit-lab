import type {
  ExperimentArtifacts as LegacyExperimentArtifacts,
  ExperimentComparison,
  ExperimentRun as LegacyExperimentRun,
} from "../../../evaluation/controlledExperimentTypes.js";
import type {
  ExperimentArtifact,
  ExperimentCase,
  ExperimentFailure,
  ExperimentMetric,
  ExperimentOutcome,
  ExperimentRun,
  ExperimentRunStatus,
  ExperimentVariant,
  ExperimentWarning,
} from "../../types.js";
import { summarizeExperimentRun } from "../../results.js";
import type { ExperimentTarget } from "../../types.js";
import type { V043StageContextStrategyExecutionResult } from "./v043StrategyExecutionTypes.js";
import type { V043StageContextEvaluationResultV1 } from "../../../evaluation/stageContextMetrics/types.js";
import type { V043StageContextRunAssuranceResultV1 } from "./v043RunAssuranceTypes.js";

export type ContextStrategyComparisonRun = ExperimentRun & {
  legacyArtifacts: LegacyExperimentArtifacts;
  v043StageContextExecutions: V043StageContextStrategyExecutionResult[];
  v043StageContextEvaluations: V043StageContextEvaluationResultV1[];
  v043StageContextRunAssurance: V043StageContextRunAssuranceResultV1[];
};

export function mapLegacyArtifactsToExperimentRun(args: {
  runId: string;
  startedAt: string;
  completedAt: string;
  target: ExperimentTarget;
  legacyArtifacts: LegacyExperimentArtifacts;
  v043StageContextExecutions: V043StageContextStrategyExecutionResult[];
  v043StageContextEvaluations: V043StageContextEvaluationResultV1[];
  v043StageContextRunAssurance: V043StageContextRunAssuranceResultV1[];
  pluginResultPath?: string;
}): ContextStrategyComparisonRun {
  const variants = buildVariants(args.legacyArtifacts.runs);
  const cases = buildCases(args.legacyArtifacts.runs);
  const warnings = buildWarnings(args.legacyArtifacts);
  const failures = buildFailures(args.legacyArtifacts.runs);
  const metrics = buildRunMetrics(args.legacyArtifacts);
  const artifacts = buildArtifacts(args.legacyArtifacts, args.pluginResultPath);
  const status = statusFromArtifacts(args.legacyArtifacts);
  const run: ContextStrategyComparisonRun = {
    runId: args.runId,
    pluginId: "context-strategy-comparison",
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    status,
    target: args.target,
    variants,
    cases,
    metrics,
    artifacts,
    warnings,
    failures,
    legacyArtifacts: args.legacyArtifacts,
    v043StageContextExecutions: args.v043StageContextExecutions,
    v043StageContextEvaluations: args.v043StageContextEvaluations,
    v043StageContextRunAssurance: args.v043StageContextRunAssurance,
    metadata: {
      pluginName: "Context Strategy Comparison",
      pluginSchemaVersion: "1.0.0",
      legacySummaryPath: args.legacyArtifacts.artifactPaths.summaryPath,
    },
  };
  return {
    ...run,
    summary: summarizeExperimentRun(run),
  };
}

function buildVariants(runs: LegacyExperimentRun[]): ExperimentVariant[] {
  const strategies = [...new Set(runs.map((run) => run.promptStrategy))];
  return strategies.map((strategy) => ({
    id: strategy,
    name: strategy === "raw-full-file" ? "Raw Full File" : "My Dev Kit Guided",
    description:
      strategy === "raw-full-file"
        ? "Full source files are embedded directly in the prompt."
        : "The prompt asks the agent to use my-dev-kit retrieval/context commands.",
    metadata: { strategy },
  }));
}

function buildCases(runs: LegacyExperimentRun[]): ExperimentCase[] {
  const caseIds = [...new Set(runs.map((run) => run.caseId))];
  return caseIds.map((caseId) => {
    const caseRuns = runs.filter((run) => run.caseId === caseId);
    return {
      id: caseId,
      name: caseId,
      outcomes: caseRuns.map(mapOutcome),
      metadata: {
        benchmarkProject: caseRuns[0]?.benchmarkProject ?? "",
      },
    };
  });
}

function mapOutcome(run: LegacyExperimentRun): ExperimentOutcome {
  return {
    id: run.runId,
    caseId: run.caseId,
    variantId: run.promptStrategy,
    status: outcomeStatus(run),
    metrics: buildOutcomeMetrics(run),
    artifacts: buildOutcomeArtifacts(run),
    warnings: run.warnings.map((message) => ({
      code: "legacy-run-warning",
      message,
      caseId: run.caseId,
      variantId: run.promptStrategy,
    })),
    failures: run.errors.map((message) => ({
      code: run.status,
      message,
      caseId: run.caseId,
      variantId: run.promptStrategy,
      recoverable: true,
    })),
    startedAt: run.startedAt,
    completedAt: run.endedAt,
    metadata: {
      agentId: run.agentId,
      benchmarkProject: run.benchmarkProject,
      promptComplexityLevel: run.promptComplexityLevel,
      promptVariantId: run.promptVariantId,
      legacyStatus: run.status,
      statusReason: run.statusReason,
    },
  };
}

function buildOutcomeMetrics(run: LegacyExperimentRun): ExperimentMetric[] {
  const metrics: ExperimentMetric[] = [
    {
      id: "correctness-score",
      name: "Correctness score",
      value: run.correctness.correctnessScore,
      variantId: run.promptStrategy,
      caseId: run.caseId,
    },
    {
      id: "duration-ms",
      name: "Duration",
      value: run.durationMs,
      unit: "ms",
      variantId: run.promptStrategy,
      caseId: run.caseId,
    },
  ];
  if (typeof run.tokenUsage.totalTokens === "number") {
    metrics.push({
      id: "total-tokens",
      name: "Total tokens",
      value: run.tokenUsage.totalTokens,
      unit: "tokens",
      variantId: run.promptStrategy,
      caseId: run.caseId,
    });
  }
  return metrics;
}

function buildOutcomeArtifacts(run: LegacyExperimentRun): ExperimentArtifact[] {
  const artifacts: ExperimentArtifact[] = [];
  if (run.artifactPaths.promptPath) {
    artifacts.push({
      id: `${run.runId}-prompt`,
      label: "Prompt",
      path: run.artifactPaths.promptPath,
      kind: "text",
      caseId: run.caseId,
      variantId: run.promptStrategy,
    });
  }
  if (run.artifactPaths.agentRunResultPath) {
    artifacts.push({
      id: `${run.runId}-agent-result`,
      label: "Agent run result",
      path: run.artifactPaths.agentRunResultPath,
      kind: "json",
      caseId: run.caseId,
      variantId: run.promptStrategy,
    });
  }
  if (run.artifactPaths.parsedAnswerPath) {
    artifacts.push({
      id: `${run.runId}-parsed-answer`,
      label: "Parsed answer",
      path: run.artifactPaths.parsedAnswerPath,
      kind: "json",
      caseId: run.caseId,
      variantId: run.promptStrategy,
    });
  }
  if (run.artifactPaths.correctnessScorePath) {
    artifacts.push({
      id: `${run.runId}-correctness`,
      label: "Correctness score",
      path: run.artifactPaths.correctnessScorePath,
      kind: "json",
      caseId: run.caseId,
      variantId: run.promptStrategy,
    });
  }
  return artifacts;
}

function buildArtifacts(
  legacyArtifacts: LegacyExperimentArtifacts,
  pluginResultPath?: string
): ExperimentArtifact[] {
  const artifacts: ExperimentArtifact[] = [
    { id: "legacy-summary", label: "Experiment summary", path: legacyArtifacts.artifactPaths.summaryPath, kind: "json" },
    { id: "legacy-runs", label: "Experiment runs", path: legacyArtifacts.artifactPaths.runsPath, kind: "json" },
    { id: "legacy-comparisons", label: "Experiment comparisons", path: legacyArtifacts.artifactPaths.comparisonsPath, kind: "json" },
    { id: "legacy-config", label: "Experiment config", path: legacyArtifacts.artifactPaths.configPath, kind: "json" },
  ];
  if (pluginResultPath) {
    artifacts.push({
      id: "plugin-result",
      label: "Plugin result",
      path: pluginResultPath,
      kind: "json",
    });
  }
  return artifacts;
}

function buildRunMetrics(legacyArtifacts: LegacyExperimentArtifacts): ExperimentMetric[] {
  const summary = legacyArtifacts.summary;
  return [
    { id: "total-runs", name: "Total runs", value: summary.totalRuns },
    { id: "completed-runs", name: "Completed runs", value: summary.completedRuns },
    { id: "failed-runs", name: "Failed runs", value: summary.failedRuns },
    { id: "total-comparisons", name: "Total comparisons", value: summary.totalComparisons },
    {
      id: "average-token-savings-percent",
      name: "Average token savings",
      value: summary.averageTokenSavingsPercent,
      unit: "percent",
    },
    {
      id: "average-duration-reduction-percent",
      name: "Average duration reduction",
      value: summary.averageDurationReductionPercent,
      unit: "percent",
    },
    {
      id: "average-correctness-delta",
      name: "Average correctness delta",
      value: summary.averageCorrectnessDelta,
    },
  ];
}

function buildWarnings(legacyArtifacts: LegacyExperimentArtifacts): ExperimentWarning[] {
  return legacyArtifacts.warnings.map((message) => ({
    code: "legacy-artifact-warning",
    message,
  }));
}

function buildFailures(runs: LegacyExperimentRun[]): ExperimentFailure[] {
  return runs.flatMap((run) =>
    run.errors.map((message) => ({
      code: run.status,
      message,
      variantId: run.promptStrategy,
      caseId: run.caseId,
      recoverable: true,
    }))
  );
}

function outcomeStatus(run: LegacyExperimentRun): ExperimentRunStatus {
  if (run.status === "completed") return "completed";
  if (run.status === "skipped") return "skipped";
  return "failed";
}

function statusFromArtifacts(legacyArtifacts: LegacyExperimentArtifacts): ExperimentRunStatus {
  const summary = legacyArtifacts.summary;
  if (summary.totalRuns === 0) return "skipped";
  if (summary.completedRuns === summary.totalRuns) return "completed";
  if (summary.completedRuns > 0) return "partial";
  if (summary.skippedRuns === summary.totalRuns) return "skipped";
  return "failed";
}

export function comparisonMetrics(comparison: ExperimentComparison): ExperimentMetric[] {
  return [
    {
      id: `${comparison.comparisonId}-token-savings-percent`,
      name: "Token savings",
      value: comparison.tokenSavingsPercent ?? null,
      unit: "percent",
      caseId: comparison.caseId,
    },
    {
      id: `${comparison.comparisonId}-correctness-delta`,
      name: "Correctness delta",
      value: comparison.correctnessDelta ?? null,
      caseId: comparison.caseId,
    },
  ];
}
