import path from "node:path";
import type {
  ExperimentMetric,
  ExperimentOutcome,
  ExperimentPluginMetadata,
  ExperimentRun,
  ExperimentRunStatus,
  ExperimentVariant,
} from "../../experiments/index.js";
import type {
  PluginExperimentReport,
  PluginExperimentReportCaseSummary,
  PluginExperimentReportFinding,
  PluginExperimentReportVariantSummary,
} from "./experimentReportModel.js";
import { buildContextStrategyComparisonV043Report } from "./buildContextStrategyComparisonV043Report.js";
import type { ContextStrategyComparisonV043ReportV1 } from "./contextStrategyComparisonV043ReportModel.js";
import { buildWarmIndexReuseReport } from "./buildWarmIndexReuseReport.js";
import type { WarmIndexReuseReportV1 } from "./warmIndexReuseReportModel.js";

const V043_BULK_ARRAY_KEYS = [
  "v043StageContextExecutions",
  "v043StageContextEvaluations",
  "v043StageContextRunAssurance",
] as const;

export function buildPluginExperimentReport(args: {
  run: ExperimentRun;
  plugin: ExperimentPluginMetadata;
  outputRoot?: string;
  generatedAt?: string;
}): PluginExperimentReport {
  const outputRoot = args.outputRoot ?? readString(args.run.metadata?.outputRoot) ?? null;
  const allOutcomes = args.run.cases.flatMap((experimentCase) => experimentCase.outcomes);
  const contextStrategyComparisonV043 = buildContextStrategyComparisonV043Report(args.run);
  const warmIndexReuse = buildWarmIndexReuseReport(args.run);
  const rawRun: ExperimentRun = { ...args.run, artifacts: relativizeArtifacts(args.run.artifacts, outputRoot) };
  for (const key of V043_BULK_ARRAY_KEYS) {
    delete (rawRun as Record<string, unknown>)[key];
  }
  return {
    metadata: {
      generatedAt: args.generatedAt ?? new Date().toISOString(),
      runId: args.run.runId,
      startedAt: args.run.startedAt,
      completedAt: args.run.completedAt ?? null,
      status: args.run.status,
      outputRoot,
    },
    plugin: args.plugin,
    target: {
      ...args.run.target,
      mode: args.run.target.isSelf ? "self" : "external target",
    },
    summary: args.run.summary ?? null,
    variants: args.run.variants.map((variant) => buildVariantSummary(variant, allOutcomes)),
    cases: args.run.cases.map(buildCaseSummary),
    metrics: args.run.metrics,
    artifacts: relativizeArtifacts(args.run.artifacts, outputRoot),
    warnings: args.run.warnings,
    failures: args.run.failures,
    skippedOutcomes: allOutcomes.filter((outcome) => outcome.status === "skipped"),
    findings: buildFindings(args.run),
    warmIndexReuse,
    contextStrategyComparisonV043,
    interpretation: buildInterpretation(args.run, contextStrategyComparisonV043, warmIndexReuse),
    rawRun,
  };
}

function buildVariantSummary(
  variant: ExperimentVariant,
  outcomes: ExperimentOutcome[]
): PluginExperimentReportVariantSummary {
  const variantOutcomes = outcomes.filter((outcome) => outcome.variantId === variant.id);
  return {
    ...variant,
    outcomeCount: variantOutcomes.length,
    completedOutcomes: countStatus(variantOutcomes, "completed"),
    partialOutcomes: countStatus(variantOutcomes, "partial"),
    failedOutcomes: countStatus(variantOutcomes, "failed"),
    skippedOutcomes: countStatus(variantOutcomes, "skipped"),
    metrics: variantOutcomes.flatMap((outcome) => outcome.metrics),
  };
}

function buildCaseSummary(experimentCase: ExperimentRun["cases"][number]): PluginExperimentReportCaseSummary {
  return {
    id: experimentCase.id,
    name: experimentCase.name,
    status: summarizeStatus(experimentCase.outcomes),
    outcomeCount: experimentCase.outcomes.length,
    completedOutcomes: countStatus(experimentCase.outcomes, "completed"),
    partialOutcomes: countStatus(experimentCase.outcomes, "partial"),
    failedOutcomes: countStatus(experimentCase.outcomes, "failed"),
    skippedOutcomes: countStatus(experimentCase.outcomes, "skipped"),
    outcomes: experimentCase.outcomes,
  };
}

function buildFindings(run: ExperimentRun): PluginExperimentReportFinding[] {
  const skipped = run.cases.flatMap((experimentCase) =>
    experimentCase.outcomes
      .filter((outcome) => outcome.status === "skipped")
      .map((outcome) => ({
        severity: "skip" as const,
        code: "outcome-skipped",
        message: `Outcome skipped: ${outcome.id}`,
        caseId: outcome.caseId,
        variantId: outcome.variantId,
      }))
  );
  return [
    ...run.warnings.map((warning) => ({
      severity: "warning" as const,
      code: warning.code,
      message: warning.message,
      caseId: warning.caseId,
      variantId: warning.variantId,
    })),
    ...run.failures.map((failure) => ({
      severity: "failure" as const,
      code: failure.code,
      message: failure.message,
      caseId: failure.caseId,
      variantId: failure.variantId,
    })),
    ...skipped,
  ];
}

function buildInterpretation(
  run: ExperimentRun,
  contextStrategyComparisonV043: ContextStrategyComparisonV043ReportV1 | null,
  warmIndexReuse: WarmIndexReuseReportV1 | null
): PluginExperimentReport["interpretation"] {
  if (run.pluginId === "warm-index-reuse" && warmIndexReuse) {
    const summary = warmIndexReuse.summary;
    const campaign = warmIndexReuse.agentCampaign;
    if (!campaign) {
      return {
        summary:
          `The warm-index run prepared ${summary.preparedSessionProjectCount} of ${summary.projectCount} project indexes and evaluated ${summary.taskCount} tasks. ` +
          "The report separates one-time index-build duration from per-task retrieval duration and shows how the fixed build cost is amortized across repeated tasks. " +
          `Deterministic fake-agent correctness/token evidence is available for ${summary.agentCorrectnessAvailableCount} of ${summary.agentSideCount} task sides (correctness) and ${summary.agentTotalTokensAvailableCount} (total tokens); ` +
          "fake-agent totals are simulated harness evidence, not real-model or provider measurements. " +
          "Estimated context-token values are context-size estimates, not provider token usage.",
        recommendedNextStep:
          run.status === "completed"
            ? "Review per-task measurements and cumulative component costs for each project; the variants are reported side by side and are not ranked."
            : "Inspect unavailable metrics, warnings, and failures before drawing conclusions from this run.",
      };
    }

    const nonCompletedCounts = (
      [
        ["failed", campaign.outcomeCounts.failed],
        ["timeout", campaign.outcomeCounts.timeout],
        ["invalid-output", campaign.outcomeCounts.invalidOutput],
        ["agent-unavailable", campaign.outcomeCounts.agentUnavailable],
        ["agent-limit-reached", campaign.outcomeCounts.agentLimitReached],
        ["skipped", campaign.outcomeCounts.skipped],
      ] as const
    )
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `${label}=${count}`)
      .join(", ");

    const isInfrastructureComplete = run.status === "completed";
    const isAgentEvidenceComplete = campaign.agentEvidenceStatus === "complete";
    return {
      summary:
        `Campaign preset ${campaign.presetId} selected agent ${campaign.agentId} over ${summary.projectCount} prepared project ` +
        `index${summary.projectCount === 1 ? "" : "es"} and ${campaign.selectedCaseCount} selected task${campaign.selectedCaseCount === 1 ? "" : "s"}. ` +
        `Agent evidence status: ${campaign.agentEvidenceStatus} (${campaign.executedSideCount} of ${campaign.scheduledSideCount} scheduled sides executed` +
        `${nonCompletedCounts ? `; outcome counts: ${nonCompletedCounts}` : ""}). ` +
        `Token evidence status: ${campaign.tokenEvidenceStatus} (${summary.agentTotalTokensAvailableCount} of ${summary.agentSideCount} task sides have a total-token value). ` +
        "Context estimated tokens remain a separate character-based context-size estimate and are never substituted for provider telemetry.",
      recommendedNextStep: isInfrastructureComplete && isAgentEvidenceComplete
        ? "Review per-task correctness, token provenance, and cumulative component measurements."
        : "Review infrastructure gaps (index build, raw/warm retrieval) separately from provider/agent limitations before drawing conclusions from this run.",
    };
  }

  if (run.pluginId === "context-strategy-comparison" && (contextStrategyComparisonV043?.summary.strategyCount ?? 0) > 0) {
    return {
      summary: `Stage-context evidence was recorded for ${contextStrategyComparisonV043!.summary.strategyCount} strategy executions. Review each strategy independently; this report does not calculate a composite ranking or winning strategy.`,
      recommendedNextStep:
        "Review required evidence, irrelevant inclusion, state comparisons, target immutability, determinism, and explicit unavailable or not-applicable metrics for each strategy.",
    };
  }

  if (run.pluginId === "context-strategy-comparison") {
    const tokenSavings = metricNumber(run.metrics, "average-token-savings-percent");
    const correctnessDelta = metricNumber(run.metrics, "average-correctness-delta");
    const durationReduction = metricNumber(run.metrics, "average-duration-reduction-percent");
    const better =
      tokenSavings !== undefined && tokenSavings > 0 && (correctnessDelta ?? 0) >= 0
        ? "my-dev-kit-guided"
        : correctnessDelta !== undefined && correctnessDelta < 0
          ? "raw-full-file"
          : "inconclusive";
    return {
      summary: [
        "raw-full-file vs my-dev-kit-guided comparison",
        `Best-supported strategy: ${better}.`,
        tokenSavings === undefined ? undefined : `Average token savings: ${tokenSavings}%.`,
        durationReduction === undefined ? undefined : `Average duration reduction: ${durationReduction}%.`,
        correctnessDelta === undefined ? undefined : `Average correctness delta: ${correctnessDelta}.`,
      ]
        .filter(Boolean)
        .join(" "),
      recommendedNextStep:
        run.status === "completed"
          ? "Review case-level outcomes and repeat with real agents if this was a fake-agent smoke run."
          : "Review warnings, skipped outcomes, and failures before using this run as evidence.",
    };
  }

  return {
    summary: `Experiment ${run.pluginId} finished with status ${run.status}.`,
    recommendedNextStep:
      run.failures.length > 0 || run.warnings.length > 0
        ? "Review warnings and failures before comparing results."
        : "Use the JSON report as the source of truth for follow-up analysis.",
  };
}

function relativizeArtifacts(artifacts: ExperimentRun["artifacts"], outputRoot: string | null) {
  if (!outputRoot) return artifacts;
  return artifacts.map((artifact) => {
    if (!artifact.path) return artifact;
    const relative = path.relative(outputRoot, artifact.path);
    return {
      ...artifact,
      path: relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : artifact.path,
    };
  });
}

function countStatus(outcomes: ExperimentOutcome[], status: ExperimentRunStatus): number {
  return outcomes.filter((outcome) => outcome.status === status).length;
}

function summarizeStatus(outcomes: ExperimentOutcome[]): ExperimentRunStatus {
  if (outcomes.length === 0) return "skipped";
  if (outcomes.every((outcome) => outcome.status === "completed")) return "completed";
  if (outcomes.every((outcome) => outcome.status === "skipped")) return "skipped";
  if (outcomes.some((outcome) => outcome.status === "completed")) return "partial";
  return "failed";
}

function metricNumber(metrics: ExperimentMetric[], id: string): number | undefined {
  const value = metrics.find((metric) => metric.id === id)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

