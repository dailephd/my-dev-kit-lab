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

export function buildPluginExperimentReport(args: {
  run: ExperimentRun;
  plugin: ExperimentPluginMetadata;
  outputRoot?: string;
  generatedAt?: string;
}): PluginExperimentReport {
  const outputRoot = args.outputRoot ?? readString(args.run.metadata?.outputRoot) ?? null;
  const allOutcomes = args.run.cases.flatMap((experimentCase) => experimentCase.outcomes);
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
    interpretation: buildInterpretation(args.run),
    rawRun: {
      ...args.run,
      artifacts: relativizeArtifacts(args.run.artifacts, outputRoot),
    },
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

function buildInterpretation(run: ExperimentRun): PluginExperimentReport["interpretation"] {
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

