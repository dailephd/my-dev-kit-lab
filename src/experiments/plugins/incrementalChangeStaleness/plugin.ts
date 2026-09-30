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
  INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS,
  INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_INTENTS,
  removeIncrementalChangeStalenessRuntimeRoot,
  type IncrementalChangeStalenessTreatmentId,
  type IncrementalChangeStalenessV2TreatmentId
} from "./disposableTarget.js";
import type { IncrementalChangeStalenessScenarioExecutionV1, IncrementalChangeStalenessTreatmentExecutionV1 } from "./execution.js";
import { buildIncrementalChangeStalenessExecutionArtifactV2, writeIncrementalChangeStalenessExecutionArtifactV2 } from "./executionArtifactV2.js";
import {
  executeIncrementalChangeStalenessScenarioV2,
  type IncrementalChangeStalenessScenarioExecutionV2,
  type IncrementalChangeStalenessTreatmentExecutionV2
} from "./executionV2.js";
import { prepareIncrementalChangeStalenessScenarioLifecycleV2 } from "./lifecycleV2.js";
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
    "Compares no refresh, my-dev-kit changed-files incremental refresh, my-dev-kit affected-neighborhood incremental refresh, and full refresh after the same deterministic controlled source change. Comparisons are scoped to the observed evidence (correctness and required-file presence); full refresh is a reference treatment, not an asserted winner, and a partial treatment may truthfully fall back to a full rebuild.",
  schemaVersion: "1.0.0",
  status: "experimental",
  supportedTargets: ["self"],
  supportedOutputs: ["json", "html"]
};

export const CHANGED_FILES_REFRESH_VARIANT_ID: IncrementalChangeStalenessV2TreatmentId = "changed-files-refresh";
export const AFFECTED_NEIGHBORHOOD_REFRESH_VARIANT_ID: IncrementalChangeStalenessV2TreatmentId = "affected-neighborhood-refresh";

/** Public v0.6.3 treatments, in the fixed lifecycle order. Factual descriptions only; no treatment is called best or preferred. */
const TREATMENT_VARIANTS: ExperimentVariant[] = [
  {
    id: STALE_INDEX_VARIANT_ID,
    name: "No refresh (stale index)",
    description: "Keeps the pre-mutation baseline index and performs no post-mutation refresh."
  },
  {
    id: CHANGED_FILES_REFRESH_VARIANT_ID,
    name: "Changed-files refresh",
    description: "Uses my-dev-kit's incremental changed-files refresh after the controlled mutation; upstream may truthfully fall back to a full rebuild."
  },
  {
    id: AFFECTED_NEIGHBORHOOD_REFRESH_VARIANT_ID,
    name: "Affected-neighborhood refresh",
    description: "Uses my-dev-kit's affected-neighborhood incremental refresh after the controlled mutation; upstream may truthfully fall back to a full rebuild."
  },
  {
    id: FULL_REFRESH_VARIANT_ID,
    name: "Full refresh",
    description: "Builds a complete post-mutation index and uses it as the comparison reference."
  }
];

/** The released v0.6.2 two-treatment variants, kept only for the historical V1 run mapper. */
const V1_TREATMENT_VARIANTS: ExperimentVariant[] = [
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
  supportedVariants: [...INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS],
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

    const executions: IncrementalChangeStalenessScenarioExecutionV2[] = [];
    for (const resolved of resolvedScenarios) {
      const lifecycle = await prepareIncrementalChangeStalenessScenarioLifecycleV2({
        repoRoot: context.toolRoot,
        runOwnedRoot,
        scenario: resolved.scenario,
        baseCase: resolved.baseCase,
        kitCommand: context.config.kitCommand
      });
      const execution = await executeIncrementalChangeStalenessScenarioV2({
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
    const artifact = buildIncrementalChangeStalenessExecutionArtifactV2({
      runId: context.runId,
      pluginId: INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID,
      executions
    });
    // The artifact is written before the framework's separate `cleanup` phase runs, so it is
    // written before the run-owned ephemeral index/target state is ever destroyed.
    const artifactPath = await writeIncrementalChangeStalenessExecutionArtifactV2(outDir, artifact);

    return mapIncrementalChangeStalenessExecutionsToRunV2({
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

type TreatmentMetricsInput = Pick<IncrementalChangeStalenessTreatmentExecutionV1, "retrieval" | "fakeAgent" | "affectedNeighborhood"> & {
  treatmentId: IncrementalChangeStalenessV2TreatmentId;
};

function treatmentMetrics(treatment: TreatmentMetricsInput, caseId: string): ExperimentMetric[] {
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
    variants: V1_TREATMENT_VARIANTS.map((variant) => ({ ...variant })),
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

// ---------------------------------------------------------------------------
// v0.6.3 four-treatment mapping. Maps already-executed V2 evidence; recomputes nothing.
// ---------------------------------------------------------------------------

const UPSTREAM_REFRESH_METRIC_SPECS = [
  { id: "upstream-refresh-fresh-extraction-file-count", name: "Upstream fresh-extraction files", field: "freshExtractionFileCount", description: "Files my-dev-kit freshly re-extracted during the refresh invocation (upstream execution evidence, not Lab task overlap)." },
  { id: "upstream-refresh-reused-file-count", name: "Upstream reused files", field: "reusedFileCount", description: "Files my-dev-kit reused from the previous index during the refresh invocation (upstream execution evidence)." },
  { id: "upstream-refresh-forced-neighbor-reanalysis-file-count", name: "Upstream forced-neighbor reanalysis files", field: "forcedNeighborReanalysisFileCount", description: "Neighbor files my-dev-kit forced to re-analyze during the refresh invocation (upstream execution evidence)." },
  { id: "upstream-refresh-seed-file-count", name: "Upstream seed files", field: "seedFileCount", description: "Seed files my-dev-kit selected for the affected-neighborhood refresh (upstream execution evidence; absent when upstream reported none)." },
  { id: "upstream-refresh-seed-symbol-count", name: "Upstream seed symbols", field: "seedSymbolCount", description: "Seed symbols my-dev-kit selected for the affected-neighborhood refresh (upstream execution evidence; absent when upstream reported none)." },
  { id: "upstream-refresh-affected-node-count", name: "Upstream affected nodes", field: "affectedNodeCount", description: "Graph nodes my-dev-kit treated as affected during the refresh (upstream execution evidence, distinct from the Lab affected-neighborhood metrics)." },
  { id: "upstream-refresh-affected-edge-count", name: "Upstream affected edges", field: "affectedEdgeCount", description: "Graph edges my-dev-kit treated as affected during the refresh (upstream execution evidence, distinct from the Lab affected-neighborhood metrics)." }
] as const;

function upstreamRefreshMetrics(treatment: IncrementalChangeStalenessTreatmentExecutionV2, caseId: string): ExperimentMetric[] {
  const refresh = treatment.refreshExecution;
  if (refresh.kind !== "incremental") return [];
  const metrics: ExperimentMetric[] = [];
  for (const spec of UPSTREAM_REFRESH_METRIC_SPECS) {
    const value = refresh.incrementalRefresh[spec.field];
    // Null upstream fields are unavailable evidence, never a zero-valued metric.
    if (typeof value === "number") metrics.push(metric(spec.id, spec.name, spec.description, "count", value, treatment.treatmentId, caseId));
  }
  return metrics;
}

function comparisonMetadata(execution: IncrementalChangeStalenessScenarioExecutionV2, treatmentId: IncrementalChangeStalenessV2TreatmentId): Record<string, unknown> {
  const comparison = execution.referenceComparisons.find((entry) => entry.candidateTreatmentId === treatmentId);
  if (!comparison) return {};
  if (comparison.kind === "stale-risk") {
    return {
      comparisonCorrectnessRelation: comparison.comparison.correctnessRelation,
      comparisonRequiredFileEvidenceRelation: comparison.comparison.requiredFileEvidenceRelation,
      staleRiskClassification: comparison.comparison.staleRiskClassification
    };
  }
  return {
    referenceComparisonCorrectnessRelation: comparison.correctnessRelation,
    referenceComparisonRequiredFileEvidenceRelation: comparison.requiredFileEvidenceRelation,
    referenceComparisonClassification: comparison.classification
  };
}

function treatmentOutcomeV2(execution: IncrementalChangeStalenessScenarioExecutionV2, treatmentId: IncrementalChangeStalenessV2TreatmentId): ExperimentOutcome {
  const caseId = execution.scenarioId;
  const treatmentIntent = INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_INTENTS[treatmentId];
  const base = { id: `${caseId}:${treatmentId}`, caseId, variantId: treatmentId, artifacts: [] };
  const treatment = execution.treatments.find((entry) => entry.treatmentId === treatmentId);
  if (execution.status === "failed" || !treatment) {
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
      metadata: { treatmentId, treatmentIntent, scenarioStatus: execution.status }
    };
  }
  const status = treatment.status === "completed" ? "completed" : treatment.status === "failed" ? "failed" : "partial";
  const refresh = treatment.refreshExecution;
  const incremental = refresh.kind === "incremental" ? refresh.incrementalRefresh : null;
  return {
    ...base,
    status,
    metrics: [...treatmentMetrics(treatment, caseId), ...upstreamRefreshMetrics(treatment, caseId)],
    warnings:
      treatment.retrievalStatus === "failed" || treatment.fakeAgent?.status === "failed"
        ? [{ code: "incremental-change-staleness-treatment-partial", message: treatment.failureReason ?? "Treatment retrieval or fake-agent evaluation did not fully complete.", variantId: treatmentId, caseId }]
        : [],
    failures: [],
    metadata: {
      treatmentId,
      treatmentIntent,
      activeIndexPhase: treatment.activeIndexPhase,
      treatmentStatus: treatment.status,
      retrievalStatus: treatment.retrievalStatus,
      fakeAgentStatus: treatment.fakeAgent?.status ?? "not-run",
      requiredFileEvidenceStatus: treatment.requiredFileEvidence.status,
      affectedNeighborhoodRelationship: treatment.affectedNeighborhood.relationship,
      affectedNeighborhoodReindexRecommendation: treatment.affectedNeighborhood.reindexRecommendation,
      refreshKind: refresh.kind,
      refreshRealization: refresh.realization,
      // Upstream categorical evidence only for incremental treatments; never invented for the others.
      ...(incremental
        ? {
            requestedScope: incremental.requestedScope,
            appliedScope: incremental.appliedScope,
            selectionStatus: incremental.selectionStatus,
            fallbackReason: incremental.fallbackReason
          }
        : {}),
      ...comparisonMetadata(execution, treatmentId)
    }
  };
}

function countByRealization(
  executions: readonly IncrementalChangeStalenessScenarioExecutionV2[],
  treatmentId: IncrementalChangeStalenessV2TreatmentId,
  realization: string
): number {
  return executions.filter((execution) => execution.treatments.find((treatment) => treatment.treatmentId === treatmentId)?.refreshExecution.realization === realization).length;
}

export function mapIncrementalChangeStalenessExecutionsToRunV2(args: {
  runId: string;
  startedAt: string;
  completedAt: string;
  target: ExperimentRun["target"];
  kitCommand: string;
  executions: readonly IncrementalChangeStalenessScenarioExecutionV2[];
  artifactPath: string;
}): IncrementalChangeStalenessRun {
  const cases: ExperimentCase[] = args.executions.map((execution) => {
    const partialClass = (candidate: IncrementalChangeStalenessV2TreatmentId) => {
      const comparison = execution.referenceComparisons.find((entry) => entry.candidateTreatmentId === candidate);
      return comparison && comparison.kind === "partial-refresh" ? comparison.classification : null;
    };
    const stale = execution.referenceComparisons.find((entry) => entry.candidateTreatmentId === "stale-index");
    return {
      id: execution.scenarioId,
      name: `${execution.scenarioId} (${execution.category})`,
      // Exactly four outcomes per scenario, in the fixed lifecycle order (never a "raw" outcome).
      outcomes: INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS.map((treatmentId) => treatmentOutcomeV2(execution, treatmentId)),
      metadata: {
        category: execution.category,
        benchmarkProject: execution.benchmarkProjectId,
        baseCaseId: execution.baseCaseId,
        scenarioStatus: execution.status,
        staleRiskClassification: stale && stale.kind === "stale-risk" ? stale.comparison.staleRiskClassification : null,
        changedFilesReferenceClassification: partialClass("changed-files-refresh"),
        affectedNeighborhoodReferenceClassification: partialClass("affected-neighborhood-refresh")
      }
    };
  });
  const outcomeStatuses = cases.flatMap((experimentCase) => experimentCase.outcomes.map((outcome) => outcome.status));
  const status =
    outcomeStatuses.length > 0 && outcomeStatuses.every((value) => value === "failed")
      ? "failed"
      : outcomeStatuses.every((value) => value === "completed")
        ? "completed"
        : "partial";
  const count = (id: string, name: string, value: number, description: string) => ({ id, name, value, unit: "count", description });
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
      count("incremental-change-staleness-scenario-count", "Scenario count", args.executions.length, "Selected scenarios in this run."),
      count(
        "incremental-change-staleness-observed-regression-count",
        "Observed stale regression count",
        args.executions.filter((execution) => {
          const stale = execution.referenceComparisons.find((entry) => entry.candidateTreatmentId === "stale-index");
          return stale?.kind === "stale-risk" && stale.comparison.staleRiskClassification === "observed-stale-regression";
        }).length,
        "Scenarios whose no-refresh treatment was classified observed-stale-regression against full refresh."
      ),
      count("incremental-change-staleness-changed-files-applied-partial-count", "Changed-files applied-partial count", countByRealization(args.executions, "changed-files-refresh", "APPLIED_PARTIAL"), "Scenarios where the changed-files refresh was applied as a partial refresh."),
      count("incremental-change-staleness-changed-files-fallback-full-count", "Changed-files fallback-full count", countByRealization(args.executions, "changed-files-refresh", "FALLBACK_FULL"), "Scenarios where the changed-files refresh fell back to a full rebuild."),
      count("incremental-change-staleness-affected-neighborhood-applied-partial-count", "Affected-neighborhood applied-partial count", countByRealization(args.executions, "affected-neighborhood-refresh", "APPLIED_PARTIAL"), "Scenarios where the affected-neighborhood refresh was applied as a partial refresh."),
      count("incremental-change-staleness-affected-neighborhood-fallback-full-count", "Affected-neighborhood fallback-full count", countByRealization(args.executions, "affected-neighborhood-refresh", "FALLBACK_FULL"), "Scenarios where the affected-neighborhood refresh fell back to a full rebuild.")
    ],
    artifacts: [
      {
        id: "incremental-change-staleness-execution",
        label: "Incremental-change-staleness execution evidence",
        path: args.artifactPath,
        kind: "artifact",
        mimeType: "application/json",
        description: "Per-scenario four-treatment execution, refresh-realization, and full-refresh reference-comparison evidence, without raw context bodies."
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
