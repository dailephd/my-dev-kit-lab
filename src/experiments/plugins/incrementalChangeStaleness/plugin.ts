import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import { readBenchmarkProjectProfiles } from "../../../evaluation/benchmarkMetadata.js";
import { toAffectedNeighborhoodMetricValues } from "../../../evaluation/affectedNeighborhoodMetrics.js";
import type { BenchmarkProjectProfile } from "../../../evaluation/types.js";
import { sanitizePathSegment } from "../../outputPaths.js";
import { summarizeExperimentRun } from "../../results.js";
import type {
  ExperimentCase,
  ExperimentExecutionContext,
  ExperimentMetric,
  ExperimentOutcome,
  ExperimentPlugin,
  ExperimentPluginMetadata,
  ExperimentRun,
  ExperimentVariant
} from "../../types.js";
import {
  defaultIncrementalChangeStalenessConfig,
  incrementalChangeStalenessConfigDefinition,
  validateIncrementalChangeStalenessConfig,
  type IncrementalChangeStalenessConfig
} from "./config.js";
import {
  DEFAULT_INCREMENTAL_CHANGE_STALENESS_RUNTIME_ROOT_RELATIVE,
  INCREMENTAL_CHANGE_STALENESS_TREATMENT_IDS,
  removeIncrementalChangeStalenessRuntimeRoot,
  type IncrementalChangeStalenessTreatmentId
} from "./disposableTarget.js";
import { executeIncrementalChangeStalenessScenario, type IncrementalChangeStalenessScenarioExecutionV1, type IncrementalChangeStalenessTreatmentExecutionV1 } from "./execution.js";
import {
  buildIncrementalChangeStalenessExecutionArtifact,
  writeIncrementalChangeStalenessExecutionArtifact
} from "./executionArtifact.js";
import { prepareIncrementalChangeStalenessScenarioLifecycle, type IncrementalChangeStalenessLifecycleDeps } from "./lifecycle.js";
import { BENCHMARK_PROJECT_PROFILES_PATH } from "./scenarioCatalog.js";
import { resolveIncrementalChangeStalenessScenarios } from "./scenarioSelection.js";

export const INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID = "incremental-change-staleness";
export const STALE_INDEX_VARIANT_ID: IncrementalChangeStalenessTreatmentId = "stale-index";
export const FULL_REFRESH_VARIANT_ID: IncrementalChangeStalenessTreatmentId = "full-refresh";

/** Marker proving a runtime directory was created by (and belongs to) one plugin run. */
export const INCREMENTAL_CHANGE_STALENESS_RUN_OWNER_MARKER = ".incremental-change-staleness-run-owner.json";

export const incrementalChangeStalenessMetadata: ExperimentPluginMetadata = {
  id: INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID,
  name: "Incremental Change Staleness",
  description:
    "Compares stale-index and full-refresh my-dev-kit retrieval after the same frozen controlled source change: matched correctness, required-file evidence, and a conservative stale-risk classification.",
  schemaVersion: "1.0.0",
  status: "experimental",
  supportedTargets: ["self"],
  supportedOutputs: ["json", "html"]
};

const TREATMENT_VARIANTS: ExperimentVariant[] = [
  {
    id: STALE_INDEX_VARIANT_ID,
    name: "Stale index",
    description: "Keeps the pre-mutation baseline index as its active retrieval index after the controlled change; never reindexes."
  },
  {
    id: FULL_REFRESH_VARIANT_ID,
    name: "Full refresh",
    description: "Builds a new complete post-mutation index in a separate directory and uses it as its active retrieval index."
  }
];

export function resolveIncrementalChangeStalenessRunOwnedRoot(toolRoot: string, runId: string): string {
  return resolveWithinRoot(path.resolve(toolRoot), path.join(DEFAULT_INCREMENTAL_CHANGE_STALENESS_RUNTIME_ROOT_RELATIVE, sanitizePathSegment(runId)));
}

async function claimRunOwnedRoot(runOwnedRoot: string, runId: string): Promise<void> {
  if (existsSync(runOwnedRoot)) {
    throw new Error(`Incremental-change-staleness run-owned runtime root already exists; refusing to reuse it: ${runOwnedRoot}`);
  }
  await mkdir(path.dirname(runOwnedRoot), { recursive: true });
  // Non-recursive: fails if another run claimed the same directory in the meantime.
  await mkdir(runOwnedRoot);
  await writeFile(
    path.join(runOwnedRoot, INCREMENTAL_CHANGE_STALENESS_RUN_OWNER_MARKER),
    `${JSON.stringify({ pluginId: INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID, runId }, null, 2)}\n`,
    "utf8"
  );
}

async function isOwnedByRun(runOwnedRoot: string, runId: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(path.join(runOwnedRoot, INCREMENTAL_CHANGE_STALENESS_RUN_OWNER_MARKER), "utf8")) as {
      pluginId?: unknown;
      runId?: unknown;
    };
    return marker.pluginId === INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID && marker.runId === runId;
  } catch {
    return false;
  }
}

/**
 * Removes the run-owned runtime root (targets, indexes, command logs, agent artifacts) only when
 * it carries this run's ownership marker. Never touches the shared runtime parent, canonical
 * benchmarks, or any other run's directory. Called by the framework's `cleanup` phase, strictly
 * after `run()` has already written the persisted execution artifact to the (separate) output root.
 */
export async function cleanupIncrementalChangeStalenessRun(toolRoot: string, runId: string): Promise<boolean> {
  const runOwnedRoot = resolveIncrementalChangeStalenessRunOwnedRoot(toolRoot, runId);
  if (!(await isOwnedByRun(runOwnedRoot, runId))) {
    return false;
  }
  await removeIncrementalChangeStalenessRuntimeRoot(toolRoot, runOwnedRoot);
  return true;
}

export type IncrementalChangeStalenessRun = ExperimentRun;

export const incrementalChangeStalenessPlugin: ExperimentPlugin<IncrementalChangeStalenessConfig, IncrementalChangeStalenessRun> = {
  metadata: incrementalChangeStalenessMetadata,
  defaultConfig: defaultIncrementalChangeStalenessConfig,
  configDefinition: incrementalChangeStalenessConfigDefinition,
  supportedVariants: [...INCREMENTAL_CHANGE_STALENESS_TREATMENT_IDS],
  validateConfig: validateIncrementalChangeStalenessConfig,
  async run(context) {
    if (!context.target.isSelf) {
      throw new Error(
        "incremental-change-staleness runs only against the lab's bundled benchmark projects; an external --target is not supported."
      );
    }
    const startedAt = context.startedAt.toISOString();
    const runOwnedRoot = resolveIncrementalChangeStalenessRunOwnedRoot(context.toolRoot, context.runId);
    await claimRunOwnedRoot(runOwnedRoot, context.runId);

    const resolvedScenarios = await resolveIncrementalChangeStalenessScenarios({
      repoRoot: context.toolRoot,
      scenarioIds: context.config.caseIds
    });
    const projectProfiles: BenchmarkProjectProfile[] = await readBenchmarkProjectProfiles(
      path.resolve(context.toolRoot, BENCHMARK_PROJECT_PROFILES_PATH),
      context.toolRoot
    );

    const executions: IncrementalChangeStalenessScenarioExecutionV1[] = [];
    for (const resolved of resolvedScenarios) {
      const lifecycle = await prepareIncrementalChangeStalenessScenarioLifecycle({
        repoRoot: context.toolRoot,
        runOwnedRoot,
        scenario: resolved.scenario,
        baseCase: resolved.baseCase,
        kitCommand: context.config.kitCommand
      });
      const execution = await executeIncrementalChangeStalenessScenario({
        repoRoot: context.toolRoot,
        scenario: resolved.scenario,
        lifecycle,
        baseCase: resolved.baseCase,
        projectProfiles,
        runOwnedRoot,
        cwd: context.target.targetRoot
      });
      executions.push(execution);
    }

    const outDir = context.outputRoot ?? path.resolve(context.toolRoot, context.config.outDir);
    const artifact = buildIncrementalChangeStalenessExecutionArtifact({
      runId: context.runId,
      pluginId: INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID,
      executions
    });
    // The artifact is written before the framework's separate `cleanup` phase runs, so it is
    // written before the run-owned ephemeral index/target state is ever destroyed.
    const artifactPath = await writeIncrementalChangeStalenessExecutionArtifact(outDir, artifact);

    return mapIncrementalChangeStalenessExecutionsToRun({
      runId: context.runId,
      startedAt,
      completedAt: new Date().toISOString(),
      target: context.target,
      kitCommand: context.config.kitCommand,
      executions,
      artifactPath
    });
  },
  summarize(result) {
    return result.summary ?? summarizeExperimentRun(result);
  },
  async cleanup(context: ExperimentExecutionContext<IncrementalChangeStalenessConfig>) {
    await cleanupIncrementalChangeStalenessRun(context.toolRoot, context.runId);
  }
};

function metric(id: string, name: string, description: string, unit: string, value: number, variantId: string, caseId: string): ExperimentMetric {
  return { id, name, description, unit, value, variantId, caseId };
}

function treatmentMetrics(treatment: IncrementalChangeStalenessTreatmentExecutionV1, caseId: string): ExperimentMetric[] {
  const variantId = treatment.treatmentId;
  const metrics: ExperimentMetric[] = [];
  if (treatment.retrieval) {
    metrics.push(
      metric("context-character-count", "Context characters", "Characters in the retrieved my-dev-kit context.", "characters", treatment.retrieval.totalChars, variantId, caseId),
      metric(
        "context-estimated-token-count",
        "Estimated context tokens",
        "Character-based estimate of retrieved context tokens; not provider token usage.",
        "estimated-tokens",
        treatment.retrieval.totalEstimatedTokens,
        variantId,
        caseId
      ),
      metric(
        "operation-duration-ms",
        "Operation duration",
        "Measured retrieval-only duration (search, lookup, slice, source); excludes index build.",
        "ms",
        treatment.retrieval.durationMs,
        variantId,
        caseId
      )
    );
  }
  if (treatment.fakeAgent && treatment.fakeAgent.correctness.available && treatment.fakeAgent.correctness.score !== null) {
    metrics.push(
      metric(
        "agent-correctness-score",
        "Agent correctness score",
        "Deterministic benchmark answer-key correctness score for the selected agent output; not semantic LLM judging.",
        "score",
        treatment.fakeAgent.correctness.score,
        variantId,
        caseId
      )
    );
  }
  const affectedMetricValues = toAffectedNeighborhoodMetricValues(
    treatment.affectedNeighborhood,
    "No affected-neighborhood assessment was recorded for this treatment."
  );
  const affectedSpecs: Array<{ id: string; name: string; description: string; field: keyof typeof affectedMetricValues }> = [
    { id: "affected-neighborhood-changed-file-count", name: "Changed indexed files", description: "Unique confirmed modified or missing files that the baseline index snapshot represents.", field: "changedFileCount" },
    { id: "affected-neighborhood-changed-symbol-count", name: "Changed baseline symbols", description: "Baseline indexed symbol identities belonging to confirmed changed indexed files.", field: "changedSymbolCount" },
    { id: "affected-neighborhood-node-count", name: "Affected graph nodes", description: "Unique resolved seed nodes plus their direct one-hop baseline graph neighbors.", field: "affectedNodeCount" },
    { id: "affected-neighborhood-edge-count", name: "Affected graph edges", description: "Unique baseline graph edges incident to at least one resolved seed node.", field: "affectedEdgeCount" },
    { id: "affected-neighborhood-task-overlap-count", name: "Task-overlap nodes", description: "Unique baseline graph nodes both in the affected neighborhood and resolved from the task's expected files/symbols.", field: "taskOverlapCount" },
    { id: "affected-neighborhood-task-overlap-percent", name: "Task-overlap percent", description: "Task-overlap nodes as a percentage of resolvable task graph nodes.", field: "taskOverlapPercent" }
  ];
  for (const spec of affectedSpecs) {
    const value = affectedMetricValues[spec.field];
    if (value.availability === "available" && value.value !== null) {
      metrics.push(metric(spec.id, spec.name, spec.description, value.unit, value.value, variantId, caseId));
    }
  }
  return metrics;
}

function treatmentOutcome(execution: IncrementalChangeStalenessScenarioExecutionV1, treatmentId: IncrementalChangeStalenessTreatmentId): ExperimentOutcome {
  const caseId = execution.scenarioId;
  const base = { id: `${caseId}:${treatmentId}`, caseId, variantId: treatmentId, artifacts: [] };
  if (execution.status === "failed" || !execution.stale || !execution.fullRefresh) {
    return {
      ...base,
      status: "failed",
      metrics: [],
      warnings: [],
      failures: [
        {
          code: "incremental-change-staleness-scenario-failed",
          message: execution.failureReason ?? "Scenario execution failed before treatment evidence was produced.",
          variantId: treatmentId,
          caseId,
          recoverable: false
        }
      ],
      metadata: { treatmentId, scenarioStatus: execution.status }
    };
  }
  const treatment = treatmentId === "stale-index" ? execution.stale : execution.fullRefresh;
  const status = treatment.status === "completed" ? "completed" : treatment.status === "failed" ? "failed" : "partial";
  return {
    ...base,
    status,
    metrics: treatmentMetrics(treatment, caseId),
    warnings: treatment.retrievalStatus === "failed" || treatment.fakeAgent?.status === "failed"
      ? [{ code: "incremental-change-staleness-treatment-partial", message: treatment.failureReason ?? "Treatment retrieval or fake-agent evaluation did not fully complete.", variantId: treatmentId, caseId }]
      : [],
    failures: [],
    metadata: {
      treatmentId,
      activeIndexPhase: treatment.activeIndexPhase,
      retrievalStatus: treatment.retrievalStatus,
      fakeAgentStatus: treatment.fakeAgent?.status ?? "not-run",
      requiredFileEvidenceStatus: treatment.requiredFileEvidence.status,
      affectedNeighborhoodRelationship: treatment.affectedNeighborhood.relationship,
      affectedNeighborhoodReindexRecommendation: treatment.affectedNeighborhood.reindexRecommendation,
      comparisonCorrectnessRelation: execution.comparison.correctnessRelation,
      comparisonRequiredFileEvidenceRelation: execution.comparison.requiredFileEvidenceRelation,
      staleRiskClassification: execution.comparison.staleRiskClassification
    }
  };
}

export function mapIncrementalChangeStalenessExecutionsToRun(args: {
  runId: string;
  startedAt: string;
  completedAt: string;
  target: ExperimentRun["target"];
  kitCommand: string;
  executions: readonly IncrementalChangeStalenessScenarioExecutionV1[];
  artifactPath: string;
}): IncrementalChangeStalenessRun {
  const cases: ExperimentCase[] = args.executions.map((execution) => ({
    id: execution.scenarioId,
    name: `${execution.scenarioId} (${execution.category})`,
    // Exactly two outcomes per scenario, stale-index then full-refresh (never a third "raw" outcome).
    outcomes: [treatmentOutcome(execution, "stale-index"), treatmentOutcome(execution, "full-refresh")],
    metadata: {
      category: execution.category,
      benchmarkProject: execution.benchmarkProjectId,
      baseCaseId: execution.baseCaseId,
      scenarioStatus: execution.status,
      staleRiskClassification: execution.comparison.staleRiskClassification
    }
  }));
  const outcomeStatuses = cases.flatMap((experimentCase) => experimentCase.outcomes.map((outcome) => outcome.status));
  const status =
    outcomeStatuses.length > 0 && outcomeStatuses.every((value) => value === "failed")
      ? "failed"
      : outcomeStatuses.every((value) => value === "completed")
        ? "completed"
        : "partial";
  const run: IncrementalChangeStalenessRun = {
    runId: args.runId,
    pluginId: INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    status,
    target: args.target,
    variants: TREATMENT_VARIANTS.map((variant) => ({ ...variant })),
    cases,
    metrics: [
      { id: "incremental-change-staleness-scenario-count", name: "Scenario count", value: args.executions.length, unit: "count", description: "Selected scenarios in this run." },
      {
        id: "incremental-change-staleness-observed-regression-count",
        name: "Observed stale regression count",
        value: args.executions.filter((execution) => execution.comparison.staleRiskClassification === "observed-stale-regression").length,
        unit: "count",
        description: "Scenarios classified observed-stale-regression."
      }
    ],
    artifacts: [
      {
        id: "incremental-change-staleness-execution",
        label: "Incremental-change-staleness execution evidence",
        path: args.artifactPath,
        kind: "artifact",
        mimeType: "application/json",
        description: "Per-scenario matched stale-index/full-refresh execution and comparison evidence, without raw context bodies."
      }
    ],
    warnings: [],
    failures: [],
    metadata: {
      kitCommand: args.kitCommand,
      scenarioIds: args.executions.map((execution) => execution.scenarioId),
      executionArtifactPath: args.artifactPath
    }
  };
  run.summary = summarizeExperimentRun(run);
  return run;
}
