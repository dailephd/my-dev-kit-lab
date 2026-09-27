import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import { sanitizePathSegment } from "../../outputPaths.js";
import { summarizeExperimentRun } from "../../results.js";
import type {
  ExperimentCase,
  ExperimentExecutionContext,
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
import { prepareIncrementalChangeStalenessScenarioLifecycle, type IncrementalChangeStalenessLifecycleDeps } from "./lifecycle.js";
import { resolveIncrementalChangeStalenessScenarios, type IncrementalChangeStalenessResolvedScenarioV1 } from "./scenarioSelection.js";
import type { IncrementalChangeStalenessLifecycleResultV1 } from "./treatmentSession.js";

export const INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID = "incremental-change-staleness";
export const STALE_INDEX_VARIANT_ID: IncrementalChangeStalenessTreatmentId = "stale-index";
export const FULL_REFRESH_VARIANT_ID: IncrementalChangeStalenessTreatmentId = "full-refresh";

/** Marker proving a runtime directory was created by (and belongs to) one plugin run. */
export const INCREMENTAL_CHANGE_STALENESS_RUN_OWNER_MARKER = ".incremental-change-staleness-run-owner.json";

export const incrementalChangeStalenessMetadata: ExperimentPluginMetadata = {
  id: INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID,
  name: "Incremental Change Staleness",
  description:
    "Prepare matched stale-index and full-refresh my-dev-kit index treatments around the same frozen controlled source change in disposable copies of bundled benchmark projects.",
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

/** Status vocabulary (shared with existing plugin metadata) for evidence this intermediate build does not produce. */
const NOT_RUN = "not-run";

/**
 * Deterministic run-owned runtime root, derived from the run id under the
 * repository's gitignored incremental-change-staleness runtime root. Both
 * `run` and `cleanup` derive it from the context; no global state is kept.
 */
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
 * Removes the run-owned runtime root (targets, indexes, command logs) only
 * when it carries this run's ownership marker. Never touches the shared
 * runtime parent, canonical benchmarks, or any other run's directory.
 */
export async function cleanupIncrementalChangeStalenessRun(toolRoot: string, runId: string): Promise<boolean> {
  const runOwnedRoot = resolveIncrementalChangeStalenessRunOwnedRoot(toolRoot, runId);
  if (!(await isOwnedByRun(runOwnedRoot, runId))) {
    return false;
  }
  await removeIncrementalChangeStalenessRuntimeRoot(toolRoot, runOwnedRoot);
  return true;
}

export type IncrementalChangeStalenessScenarioLifecycleRecordV1 = {
  readonly resolved: IncrementalChangeStalenessResolvedScenarioV1;
  readonly result: IncrementalChangeStalenessLifecycleResultV1;
};

/**
 * Runs the matched lifecycle for every selected scenario, sequentially and in
 * catalog order. The returned in-memory sessions are valid until the
 * run-owned root is cleaned up.
 */
export async function runIncrementalChangeStalenessLifecycles(options: {
  repoRoot: string;
  runOwnedRoot: string;
  kitCommand: string;
  scenarioIds?: readonly string[];
  deps?: Partial<IncrementalChangeStalenessLifecycleDeps>;
}): Promise<IncrementalChangeStalenessScenarioLifecycleRecordV1[]> {
  const resolvedScenarios = await resolveIncrementalChangeStalenessScenarios({ repoRoot: options.repoRoot, scenarioIds: options.scenarioIds });
  const records: IncrementalChangeStalenessScenarioLifecycleRecordV1[] = [];
  for (const resolved of resolvedScenarios) {
    const result = await prepareIncrementalChangeStalenessScenarioLifecycle({
      repoRoot: options.repoRoot,
      runOwnedRoot: options.runOwnedRoot,
      scenario: resolved.scenario,
      baseCase: resolved.baseCase,
      kitCommand: options.kitCommand,
      deps: options.deps
    });
    records.push({ resolved, result });
  }
  return records;
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
    const records = await runIncrementalChangeStalenessLifecycles({
      repoRoot: context.toolRoot,
      runOwnedRoot,
      kitCommand: context.config.kitCommand,
      scenarioIds: context.config.caseIds
    });
    return mapIncrementalChangeStalenessLifecyclesToRun({
      runId: context.runId,
      startedAt,
      completedAt: new Date().toISOString(),
      target: context.target,
      kitCommand: context.config.kitCommand,
      records
    });
  },
  summarize(result) {
    return result.summary ?? summarizeExperimentRun(result);
  },
  async cleanup(context: ExperimentExecutionContext<IncrementalChangeStalenessConfig>) {
    await cleanupIncrementalChangeStalenessRun(context.toolRoot, context.runId);
  }
};

/**
 * Maps lifecycle-only results to the generic run contract. A ready lifecycle
 * is reported as a `partial` outcome because treatment retrieval, correctness,
 * and comparison are not executed yet; no retrieval/correctness/token metric
 * is emitted (absent, never zero). Every selected scenario yields exactly two
 * outcomes, stale-index then full-refresh, in catalog order.
 */
export function mapIncrementalChangeStalenessLifecyclesToRun(args: {
  runId: string;
  startedAt: string;
  completedAt: string;
  target: ExperimentRun["target"];
  kitCommand: string;
  records: readonly IncrementalChangeStalenessScenarioLifecycleRecordV1[];
}): IncrementalChangeStalenessRun {
  const cases: ExperimentCase[] = args.records.map(({ resolved, result }) => ({
    id: resolved.scenario.id,
    name: `${resolved.scenario.id} (${resolved.scenario.category})`,
    outcomes: INCREMENTAL_CHANGE_STALENESS_TREATMENT_IDS.map((treatmentId) => buildOutcome(resolved, result, treatmentId)),
    metadata: {
      category: resolved.scenario.category,
      benchmarkProject: resolved.baseCase.benchmarkProjectId,
      baseCaseId: resolved.baseCase.caseId,
      lifecycleStatus: result.status
    }
  }));
  const outcomeStatuses = cases.flatMap((experimentCase) => experimentCase.outcomes.map((outcome) => outcome.status));
  const status = outcomeStatuses.length > 0 && outcomeStatuses.every((value) => value === "failed") ? "failed" : "partial";
  const run: IncrementalChangeStalenessRun = {
    runId: args.runId,
    pluginId: INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    status,
    target: args.target,
    variants: TREATMENT_VARIANTS.map((variant) => ({ ...variant })),
    cases,
    metrics: [],
    artifacts: [],
    warnings: [
      {
        code: "treatment-execution-not-implemented",
        message:
          "This build prepares and verifies the stale-index/full-refresh index lifecycle only; treatment retrieval, correctness, and stale-vs-refresh comparison are not executed."
      }
    ],
    failures: [],
    metadata: {
      lifecycleOnly: true,
      kitCommand: args.kitCommand,
      scenarioIds: args.records.map((record) => record.resolved.scenario.id),
      retrievalStatus: NOT_RUN,
      correctnessStatus: NOT_RUN,
      comparisonStatus: NOT_RUN
    }
  };
  run.summary = summarizeExperimentRun(run);
  return run;
}

function buildOutcome(
  resolved: IncrementalChangeStalenessResolvedScenarioV1,
  result: IncrementalChangeStalenessLifecycleResultV1,
  treatmentId: IncrementalChangeStalenessTreatmentId
): ExperimentOutcome {
  const caseId = resolved.scenario.id;
  const base = {
    id: `${caseId}:${treatmentId}`,
    caseId,
    variantId: treatmentId,
    metrics: [],
    artifacts: []
  };
  const notRun = { retrievalStatus: NOT_RUN, correctnessStatus: NOT_RUN, comparisonStatus: NOT_RUN };
  if (result.status === "failed") {
    return {
      ...base,
      status: "failed",
      warnings: [],
      failures: [
        {
          code: `lifecycle-${result.failure.code}`,
          message: result.failure.message,
          variantId: treatmentId,
          caseId,
          recoverable: false,
          details: { attributedTreatmentId: result.failure.treatmentId }
        }
      ],
      metadata: {
        treatmentId,
        lifecycleStatus: "failed",
        lifecycleFailureCode: result.failure.code,
        indexBuildCount: result.indexBuildCounts[treatmentId],
        ...notRun
      }
    };
  }
  const treatment = result.session.treatments[treatmentId];
  const baselineFreshness = treatment.changeAuthority.postMutationBaselineFreshness;
  return {
    ...base,
    status: "partial",
    warnings: [
      {
        code: "treatment-execution-not-run",
        message: "Index lifecycle is ready; treatment retrieval and correctness were not executed.",
        variantId: treatmentId,
        caseId
      }
    ],
    failures: [],
    metadata: {
      treatmentId,
      lifecycleStatus: "ready",
      activeRetrievalIndexRole: treatment.activeRetrieval.role,
      postMutationIndexBuilt: treatment.postMutationIndexBuilt,
      indexBuildCount: treatment.indexBuildCount,
      freshnessAssessmentCount: treatment.freshnessAssessmentCount,
      baselineFreshnessStatus: baselineFreshness.status,
      baselineChangedPaths: baselineFreshness.changes.map((change) => change.path),
      baselineIndexBuildDurationMs: treatment.changeAuthority.baselineIndex.buildDurationMs,
      refreshedIndexBuildDurationMs: treatment.refreshedIndex ? treatment.refreshedIndex.buildDurationMs : null,
      refreshedFreshnessStatus: treatment.refreshedFreshness ? treatment.refreshedFreshness.status : null,
      myDevKitVersion: result.session.toolIdentity.version,
      ...notRun
    }
  };
}
