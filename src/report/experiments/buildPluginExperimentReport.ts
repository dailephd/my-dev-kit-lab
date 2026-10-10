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
import { buildIncrementalChangeStalenessPluginReport } from "./buildIncrementalChangeStalenessPluginReport.js";
import { buildContextWindowScalingReport } from "./buildContextWindowScalingReport.js";
import type { ContextWindowScalingReportV1 } from "./contextWindowScalingReportModel.js";
import { buildRetrievalPrecisionRecallReport } from "./buildRetrievalPrecisionRecallReport.js";
import type { RetrievalPrecisionRecallReportV1 } from "./retrievalPrecisionRecallReportModel.js";
import { buildRetrievalQueryStrategyComparisonReport } from "./buildRetrievalQueryStrategyComparisonReport.js";
import type { RetrievalQueryStrategyComparisonReportV1 } from "./retrievalQueryStrategyComparisonReportModel.js";
import type { ContextPack } from "../../experiments/plugins/contextPackGeneration/types.js";
import { buildContextPackGenerationReport } from "./buildContextPackGenerationReport.js";
import { AGENT_SUCCESS_RATE_DETERMINISTIC_STATEMENT, AGENT_SUCCESS_RATE_REAL_AGENT_STATEMENT, buildAgentSuccessRateReport } from "./buildAgentSuccessRateReport.js";
import type { AgentSuccessRateReportV1 } from "./agentSuccessRateReportModel.js";
import type { ContextPackGenerationReportV1 } from "./contextPackGenerationReportModel.js";

// Bulk context-window-scaling evidence is presented by the typed report section; the complete
// evidence stays in context-window-scaling-execution.json.
const CONTEXT_WINDOW_SCALING_BULK_KEYS = ["executionEvidence", "aggregate"] as const;

// Same for retrieval-precision-recall: the typed section presents the evidence; the execution artifact keeps all of it.
const RETRIEVAL_PRECISION_RECALL_BULK_KEYS = ["caseExecutionEvidence", "aggregate"] as const;

// Same for retrieval-query-strategy-comparison: the typed section presents execution evidence and analysis.
const RETRIEVAL_QUERY_STRATEGY_COMPARISON_BULK_KEYS = ["caseExecutionEvidence", "analysis"] as const;

// Same for context-pack-generation: the typed section presents execution evidence and analysis.
const CONTEXT_PACK_GENERATION_BULK_KEYS = ["caseExecutionEvidence", "analysis"] as const;

// Same for agent-success-rate: the typed section presents execution evidence and analysis.
const AGENT_SUCCESS_RATE_BULK_KEYS = ["caseExecutionEvidence", "analysis"] as const;

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
  /** Persisted per-case context packs (loaded by the writer) used only for the bounded display preview. */
  contextPacks?: ReadonlyMap<string, ContextPack>;
}): PluginExperimentReport {
  const outputRoot = args.outputRoot ?? readString(args.run.metadata?.outputRoot) ?? null;
  const allOutcomes = args.run.cases.flatMap((experimentCase) => experimentCase.outcomes);
  const contextStrategyComparisonV043 = buildContextStrategyComparisonV043Report(args.run);
  const warmIndexReuse = buildWarmIndexReuseReport(args.run);
  const incrementalChangeStaleness = buildIncrementalChangeStalenessPluginReport(args.run);
  const contextWindowScaling = buildContextWindowScalingReport(args.run);
  const retrievalPrecisionRecall = buildRetrievalPrecisionRecallReport(args.run);
  const retrievalQueryStrategyComparison = buildRetrievalQueryStrategyComparisonReport(args.run);
  const contextPackGeneration = buildContextPackGenerationReport(args.run, args.contextPacks);
  const agentSuccessRate = buildAgentSuccessRateReport(args.run);
  const rawRun: ExperimentRun = { ...args.run, artifacts: relativizeArtifacts(args.run.artifacts, outputRoot) };
  for (const key of V043_BULK_ARRAY_KEYS) {
    delete (rawRun as Record<string, unknown>)[key];
  }
  if (contextWindowScaling) {
    for (const key of CONTEXT_WINDOW_SCALING_BULK_KEYS) {
      delete (rawRun as Record<string, unknown>)[key];
    }
  }
  if (retrievalPrecisionRecall) {
    for (const key of RETRIEVAL_PRECISION_RECALL_BULK_KEYS) {
      delete (rawRun as Record<string, unknown>)[key];
    }
  }
  if (retrievalQueryStrategyComparison) {
    for (const key of RETRIEVAL_QUERY_STRATEGY_COMPARISON_BULK_KEYS) {
      delete (rawRun as Record<string, unknown>)[key];
    }
  }
  if (contextPackGeneration) {
    for (const key of CONTEXT_PACK_GENERATION_BULK_KEYS) {
      delete (rawRun as Record<string, unknown>)[key];
    }
  }
  if (agentSuccessRate) {
    for (const key of AGENT_SUCCESS_RATE_BULK_KEYS) {
      delete (rawRun as Record<string, unknown>)[key];
    }
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
    incrementalChangeStaleness,
    contextWindowScaling,
    retrievalPrecisionRecall,
    retrievalQueryStrategyComparison,
    contextPackGeneration,
    agentSuccessRate,
    contextStrategyComparisonV043,
    interpretation: buildInterpretation(
      args.run,
      contextStrategyComparisonV043,
      warmIndexReuse,
      contextWindowScaling,
      retrievalPrecisionRecall,
      retrievalQueryStrategyComparison,
      contextPackGeneration,
      agentSuccessRate
    ),
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

/** Neutral, count-only sentence derived from the report's persisted freshness summary. */
function freshnessSentence(report: WarmIndexReuseReportV1): string {
  const summary = report.indexFreshnessSummary;
  if (!summary || summary.assessedTaskCount === 0) {
    return "No per-task index freshness assessment was available in this report.";
  }
  return (
    `Index freshness was assessed for ${summary.assessedTaskCount} task boundar${summary.assessedTaskCount === 1 ? "y" : "ies"}: ` +
    `fresh=${summary.freshTaskCount}, stale=${summary.staleTaskCount}, partially-stale=${summary.partiallyStaleTaskCount}, unknown=${summary.unknownTaskCount}. ` +
    "Freshness is observational evidence over files represented by the index snapshot and does not change retrieval or provider status."
  );
}

/** Neutral, count-only sentence derived from the report's persisted affected-neighborhood summary. */
function affectedNeighborhoodSentence(report: WarmIndexReuseReportV1): string {
  const summary = report.affectedNeighborhoodSummary;
  if (!summary || summary.assessedTaskCount === 0) {
    return "No per-task affected-neighborhood assessment was available in this report.";
  }
  return (
    `Affected-neighborhood evidence was available for ${summary.assessedTaskCount} task boundar${summary.assessedTaskCount === 1 ? "y" : "ies"}: ` +
    `complete=${summary.completeAssessmentCount}, partial=${summary.partialAssessmentCount}, unavailable=${summary.unavailableAssessmentCount}; ` +
    `relationships were related=${summary.relatedTaskCount}, unrelated=${summary.unrelatedTaskCount}, unknown=${summary.unknownRelationshipTaskCount}; ` +
    `reindex recommendations were recommended=${summary.recommendedReindexCount}, not-indicated=${summary.notIndicatedReindexCount}, unknown=${summary.unknownReindexRecommendationCount}. ` +
    "Affected-neighborhood evidence uses a one-hop baseline graph around confirmed changed indexed files/symbols. It is observational and does not alter retrieval or execution status."
  );
}

function buildInterpretation(
  run: ExperimentRun,
  contextStrategyComparisonV043: ContextStrategyComparisonV043ReportV1 | null,
  warmIndexReuse: WarmIndexReuseReportV1 | null,
  contextWindowScaling: ContextWindowScalingReportV1 | null,
  retrievalPrecisionRecall: RetrievalPrecisionRecallReportV1 | null,
  retrievalQueryStrategyComparison: RetrievalQueryStrategyComparisonReportV1 | null,
  contextPackGeneration: ContextPackGenerationReportV1 | null = null,
  agentSuccessRate: AgentSuccessRateReportV1 | null = null
): PluginExperimentReport["interpretation"] {
  if (agentSuccessRate) {
    const real = agentSuccessRate.identity.executionMode === "real-agent";
    const [raw, pack] = agentSuccessRate.treatments;
    const rate = (treatment: typeof raw, kind: "initial" | "final"): string => {
      const metric = kind === "initial" ? treatment?.initialSuccessRate : treatment?.finalSuccessRate;
      return metric && metric.availability === "available" && typeof metric.value === "number" ? metric.value.toFixed(4) : "unavailable";
    };
    const summary = real
      ? `${AGENT_SUCCESS_RATE_REAL_AGENT_STATEMENT} Provider ${agentSuccessRate.identity.providerId ?? "unknown"} ran ${agentSuccessRate.identity.caseCount} case(s) with up to ${agentSuccessRate.identity.maxAttemptsPerTreatment} attempt(s) per treatment. Initial-attempt success rate: raw-full-file ${rate(raw, "initial")}, context-pack ${rate(pack, "initial")}; final success rate: raw-full-file ${rate(raw, "final")}, context-pack ${rate(pack, "final")}. No treatment is declared best and no statistical or causal claim is made.`
      : `${AGENT_SUCCESS_RATE_DETERMINISTIC_STATEMENT} ${agentSuccessRate.identity.caseCount} case(s) were evaluated for each treatment identity.`;
    return {
      summary,
      recommendedNextStep: "Review per-case results, the repair history and the scientific limitations; unavailable evidence is never counted as a failure or as zero."
    };
  }
  if (contextPackGeneration) {
    const overall = contextPackGeneration.scopes.find((scope) => scope.scopeId === "overall");
    const saved = overall?.tokenSavings;
    const deltas = overall?.pairedDeltas;
    const summary =
      overall && saved && deltas
        ? `Overall matched comparison over ${overall.includedCaseCount} of ${overall.caseCount} case(s): the context pack used a mean of ${saved.meanTokensSaved} fewer estimated tokens than raw full-file context (${saved.percentSavedOfMeans}% of the raw mean; a negative value means more tokens); mean fact coverage delta ${deltas.meanFactCoverageDelta}, mean file F1 delta ${deltas.meanFileF1Delta}, mean symbol F1 delta ${deltas.meanSymbolF1Delta}. The treatments are reported side by side without a composite score.`
        : "No matched complete-case context-pack comparison was available for the overall scope. Review treatment availability and excluded cases before drawing conclusions.";
    return {
      summary,
      recommendedNextStep: "Review per-case coverage and size, the scope aggregates, and the bounded pack preview; unavailable values are never treated as zero."
    };
  }
  if (retrievalQueryStrategyComparison) {
    const overall = retrievalQueryStrategyComparison.scopes.find((scope) => scope.scopeId === "overall");
    const taskTypes = "Task-type results are reported separately for localized, cross-module, and broad-change cases.";
    const summary =
      overall?.interpretation === "unique-best"
        ? `Overall matched comparison: ${overall.bestStrategyId} is the unique nondominated strategy across ${overall.comparisonCaseCount} matched case(s). ${taskTypes}`
        : overall?.interpretation === "tradeoff"
          ? `Overall matched comparison has no single best strategy across ${overall.comparisonCaseCount} matched case(s); the Pareto front is ${overall.paretoFrontStrategyIds.join(", ")}. ${taskTypes}`
          : "No matched complete-case retrieval-strategy comparison was available for the overall scope. Review treatment availability and excluded cases before drawing conclusions.";
    return {
      summary,
      recommendedNextStep: "Review the task-type scope table, Pareto fronts, and per-case treatment metrics; do not treat Pareto-front order as a ranking."
    };
  }
  if (retrievalPrecisionRecall) {
    const summary = retrievalPrecisionRecall.runSummary;
    return {
      summary:
        `Retrieval quality was measured over ${summary.caseCount} case${summary.caseCount === 1 ? "" : "s"} (${summary.completedCaseCount} completed, ${summary.partialCaseCount} partial, ${summary.failedCaseCount} failed). ` +
        "Available case-level file, symbol and fact metrics are summarized without ranking strategies. " +
        "Unavailable and not-applicable evidence is excluded from macro means rather than treated as zero.",
      recommendedNextStep:
        "Review per-case missed and irrelevant context together with availability before drawing conclusions."
    };
  }
  if (contextWindowScaling) {
    const summary = contextWindowScaling.runSummary;
    return {
      summary:
        `Context-window-scaling evidence covers ${summary.caseCount} case${summary.caseCount === 1 ? "" : "s"}, ${summary.treatmentCount} treatments, and ${summary.budgetCount} budget${summary.budgetCount === 1 ? "" : "s"} ` +
        `(${summary.totalBudgetCellCount} budget cells): ${summary.evaluatedBudgetCellCount} evaluated, ${summary.contextTooLargeCellCount} context-too-large, ${summary.contextUnavailableCellCount} with unavailable context. ` +
        "Context-too-large is an expected measurement state, not an execution failure. The treatments are reported side by side and are not ranked.",
      recommendedNextStep:
        "Review the budget summary, per-case context sizes, and per-case budget matrix; unavailable correctness and success evidence are excluded from the rates and are never treated as zero.",
    };
  }
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
          "Estimated context-token values are context-size estimates, not provider token usage. " +
          freshnessSentence(warmIndexReuse) + " " + affectedNeighborhoodSentence(warmIndexReuse),
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
        "Context estimated tokens remain a separate character-based context-size estimate and are never substituted for provider telemetry. " +
        freshnessSentence(warmIndexReuse) + " " + affectedNeighborhoodSentence(warmIndexReuse),
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

