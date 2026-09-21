import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import type { EvaluationCase } from "../../../evaluation/types.js";
import { summarizeExperimentRun } from "../../results.js";
import type {
  ExperimentCase,
  ExperimentFailure,
  ExperimentOutcome,
  ExperimentPlugin,
  ExperimentPluginMetadata,
  ExperimentRun,
  ExperimentVariant,
  ExperimentWarning,
} from "../../types.js";
import {
  defaultWarmIndexReuseConfig,
  validateWarmIndexReuseConfig,
  warmIndexReuseConfigDefinition,
  type WarmIndexReuseConfig,
} from "./config.js";
import {
  aggregateStatus,
  executeWarmIndexReuse,
  type WarmIndexExecutionError,
  type WarmIndexProjectExecutionV1,
  type WarmIndexTaskExecutionV1,
} from "./execution.js";
import {
  buildWarmIndexExecutionArtifact,
  WARM_INDEX_EXECUTION_ARTIFACT_FILE,
  type WarmIndexProjectSummaryV1,
} from "./executionArtifact.js";
import {
  calculateWarmIndexMetrics,
  toRawOutcomeMetrics,
  toRunLevelMetrics,
  toWarmOutcomeMetrics,
  type WarmIndexMetricsV1,
  type WarmIndexTaskMetricsV1,
} from "./metrics.js";
import { selectWarmIndexCases } from "./selection.js";

export const RAW_FULL_FILE_VARIANT_ID = "raw-full-file";
export const WARM_INDEX_REUSE_VARIANT_ID = "warm-index-reuse";

export const warmIndexReuseMetadata: ExperimentPluginMetadata = {
  id: "warm-index-reuse",
  name: "Warm Index Reuse",
  description:
    "Measure repeated task execution where one my-dev-kit index is built once per benchmark project and reused across multiple tasks, with a matched raw-full-file baseline per task.",
  schemaVersion: "1.0.0",
  status: "experimental",
  supportedTargets: ["self", "external-local"],
  supportedOutputs: ["json", "html", "text", "artifact"],
};

const WARM_INDEX_VARIANTS: ExperimentVariant[] = [
  {
    id: RAW_FULL_FILE_VARIANT_ID,
    name: "Raw full file",
    description: "Every file matched by the case's raw include globs, read once per task.",
  },
  {
    id: WARM_INDEX_REUSE_VARIANT_ID,
    name: "Warm index reuse",
    description: "my-dev-kit retrieval against one index prepared once per benchmark project.",
  },
];

/**
 * The run record carries only bounded, context-free project summaries: generic report writers
 * serialize the whole run, so full context text must not live on it.
 */
export type WarmIndexReuseRun = ExperimentRun & {
  projectExecutions: WarmIndexProjectSummaryV1[];
  /** Calculated once from projectExecutions; reports render it and never recalculate. */
  warmIndexMetrics: WarmIndexMetricsV1;
};

export const warmIndexReusePlugin: ExperimentPlugin<WarmIndexReuseConfig, WarmIndexReuseRun> = {
  metadata: warmIndexReuseMetadata,
  defaultConfig: defaultWarmIndexReuseConfig,
  configDefinition: warmIndexReuseConfigDefinition,
  supportedVariants: WARM_INDEX_VARIANTS.map((variant) => variant.id),
  validateConfig: validateWarmIndexReuseConfig,
  async run(context) {
    const startedAt = context.startedAt.toISOString();
    const cases = selectWarmIndexCases(readCasesInput(context.inputs), context.config);
    const outDir = context.outputRoot ?? path.resolve(context.toolRoot, context.config.outDir);
    await mkdir(outDir, { recursive: true });

    const projects = await executeWarmIndexReuse({
      cases,
      kitCommand: context.config.kitCommand,
      outputRoot: outDir,
    });

    const artifact = buildWarmIndexExecutionArtifact({
      runId: context.runId,
      pluginId: warmIndexReuseMetadata.id,
      projects,
    });
    const artifactPath = resolveWithinRoot(outDir, WARM_INDEX_EXECUTION_ARTIFACT_FILE);
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

    const run = mapWarmIndexExecutionToRun({
      runId: context.runId,
      startedAt,
      completedAt: new Date().toISOString(),
      target: context.target,
      cases,
      projects,
      projectSummaries: artifact.projects,
      artifactPath,
    });
    return run;
  },
  summarize(result) {
    return result.summary ?? summarizeExperimentRun(result);
  },
};

export function mapWarmIndexExecutionToRun(args: {
  runId: string;
  startedAt: string;
  completedAt: string;
  target: ExperimentRun["target"];
  cases: readonly EvaluationCase[];
  projects: readonly WarmIndexProjectExecutionV1[];
  projectSummaries: WarmIndexProjectSummaryV1[];
  artifactPath: string;
}): WarmIndexReuseRun {
  const titles = new Map(args.cases.map((evaluationCase) => [evaluationCase.id, evaluationCase.title]));
  const warmIndexMetrics = calculateWarmIndexMetrics(args.projectSummaries);
  // projectSummaries (and therefore metrics) preserve project and task order of args.projects.
  const experimentCases: ExperimentCase[] = args.projects.flatMap((project, projectIndex) =>
    project.tasks.map((task, taskIndex) => {
      const taskMetrics = warmIndexMetrics.projects[projectIndex].tasks[taskIndex];
      return {
        id: task.caseId,
        name: titles.get(task.caseId) ?? task.caseId,
        outcomes: [buildRawOutcome(project, task, taskMetrics), buildWarmOutcome(project, task, taskMetrics)],
        metadata: { benchmarkProject: task.benchmarkProject, sessionKey: project.projectSegment },
      };
    })
  );
  const warnings: ExperimentWarning[] = args.projects.flatMap((project) =>
    project.warnings.map((message) => ({
      code: "warm-index-setup-warning",
      message,
      details: { benchmarkProject: project.benchmarkProject },
    }))
  );
  const run: WarmIndexReuseRun = {
    runId: args.runId,
    pluginId: warmIndexReuseMetadata.id,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    status: aggregateStatus(experimentCases.flatMap((experimentCase) => experimentCase.outcomes.map((outcome) => outcome.status))),
    target: args.target,
    variants: WARM_INDEX_VARIANTS.map((variant) => ({ ...variant })),
    cases: experimentCases,
    metrics: toRunLevelMetrics(warmIndexMetrics),
    artifacts: [
      {
        id: "warm-index-execution",
        label: "Warm index execution evidence",
        path: args.artifactPath,
        kind: "artifact",
        mimeType: "application/json",
        description: "Per-project index setup and per-task raw/warm execution summaries without context text.",
      },
    ],
    warnings,
    failures: [],
    metadata: { executionArtifactPath: args.artifactPath },
    projectExecutions: args.projectSummaries,
    warmIndexMetrics,
  };
  run.summary = summarizeExperimentRun(run);
  return run;
}

function outcomeMetadata(project: WarmIndexProjectExecutionV1, task: WarmIndexTaskExecutionV1) {
  return {
    benchmarkProject: task.benchmarkProject,
    sessionKey: project.projectSegment,
    warmSessionAvailable: project.session !== undefined,
    taskStatus: task.status,
  };
}

function buildRawOutcome(
  project: WarmIndexProjectExecutionV1,
  task: WarmIndexTaskExecutionV1,
  taskMetrics: WarmIndexTaskMetricsV1
): ExperimentOutcome {
  return {
    id: `${task.caseId}:${RAW_FULL_FILE_VARIANT_ID}`,
    caseId: task.caseId,
    variantId: RAW_FULL_FILE_VARIANT_ID,
    status: task.rawStatus,
    metrics: toRawOutcomeMetrics(taskMetrics, RAW_FULL_FILE_VARIANT_ID),
    artifacts: [],
    warnings: [],
    failures: toFailures(task, "raw", RAW_FULL_FILE_VARIANT_ID),
    metadata: outcomeMetadata(project, task),
  };
}

function buildWarmOutcome(
  project: WarmIndexProjectExecutionV1,
  task: WarmIndexTaskExecutionV1,
  taskMetrics: WarmIndexTaskMetricsV1
): ExperimentOutcome {
  return {
    id: `${task.caseId}:${WARM_INDEX_REUSE_VARIANT_ID}`,
    caseId: task.caseId,
    variantId: WARM_INDEX_REUSE_VARIANT_ID,
    status: task.warmStatus,
    metrics: toWarmOutcomeMetrics(taskMetrics, WARM_INDEX_REUSE_VARIANT_ID),
    artifacts: [],
    warnings: task.warnings.map((message) => ({
      code: "warm-retrieval-warning",
      message,
      variantId: WARM_INDEX_REUSE_VARIANT_ID,
      caseId: task.caseId,
    })),
    failures: toFailures(task, "warm", WARM_INDEX_REUSE_VARIANT_ID),
    metadata: outcomeMetadata(project, task),
  };
}

function toFailures(
  task: WarmIndexTaskExecutionV1,
  side: WarmIndexExecutionError["side"],
  variantId: string
): ExperimentFailure[] {
  return task.errors
    .filter((error) => error.side === side)
    .map((error) => ({ code: error.code, message: error.message, variantId, caseId: task.caseId, recoverable: true }));
}

function readCasesInput(inputs: Record<string, unknown> | undefined): EvaluationCase[] {
  const value = inputs?.cases;
  if (!Array.isArray(value)) {
    throw new Error("Warm index reuse requires cases input.");
  }
  return value as EvaluationCase[];
}
