import { existsSync } from "node:fs";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import { assessIndexFreshness } from "../../../evaluation/indexFreshness.js";
import type { IndexFreshnessAssessmentV1 } from "../../../evaluation/indexFreshness.js";
import { prepareWarmIndexSession } from "../warmIndexReuse/warmIndexSession.js";
import type { MyDevKitIndexBuildMode, MyDevKitIndexBuildResult } from "../../../evaluation/types.js";
import {
  createDisposableTreatmentTarget,
  type DisposableTreatmentTargetV1,
  type IncrementalChangeStalenessTreatmentId,
  type IncrementalChangeStalenessV2TreatmentId
} from "./disposableTarget.js";
import {
  evaluateBaselineStaleFreshness,
  evaluateChangedPathSymmetry,
  evaluateIndexEvidence,
  evaluateRefreshedFreshness,
  evaluateToolIdentity,
  normalizeRelativePath,
  normalizeRootForComparison
} from "./lifecyclePolicy.js";
import { executeIncrementalChangeStalenessMutation, type IncrementalChangeStalenessMutationReceiptV1 } from "./mutationExecution.js";
import type { IncrementalChangeStalenessScenario } from "./scenarioTypes.js";
import {
  captureIncrementalChangeStalenessSourceState,
  compareIncrementalChangeStalenessSourceStates,
  type IncrementalChangeStalenessSourceStateV1
} from "./sourceState.js";
import {
  INCREMENTAL_CHANGE_STALENESS_LIFECYCLE_SESSION_SCHEMA_VERSION,
  type IncrementalChangeStalenessBaseCaseIdentityV1,
  type IncrementalChangeStalenessFullRefreshTreatmentSessionV1,
  type IncrementalChangeStalenessIndexEvidenceV1,
  type IncrementalChangeStalenessIndexRole,
  type IncrementalChangeStalenessLifecycleFailureV1,
  type IncrementalChangeStalenessLifecycleResultV1,
  type IncrementalChangeStalenessScenarioSessionV1,
  type IncrementalChangeStalenessStaleTreatmentSessionV1
} from "./treatmentSession.js";

/**
 * Mechanism seams for the lifecycle. Defaults are the established owners:
 * the shared warm-index session owner (full index build through
 * `buildMyDevKitIndex`, then `--version` probe, then `captureIndexSnapshot`,
 * then `loadAffectedNeighborhoodGraphEvidence`, strictly in that order),
 * `assessIndexFreshness`, the Batch 2 source-state capture, and the Batch 2
 * mutation executor. Tests may wrap
 * them to observe ordering/counts or inject failures.
 */
export type IncrementalChangeStalenessLifecycleDeps = {
  prepareIndexSession: typeof prepareWarmIndexSession;
  assessIndexFreshness: typeof assessIndexFreshness;
  executeMutation: typeof executeIncrementalChangeStalenessMutation;
  captureSourceState: typeof captureIncrementalChangeStalenessSourceState;
};

export const defaultIncrementalChangeStalenessLifecycleDeps: IncrementalChangeStalenessLifecycleDeps = {
  prepareIndexSession: prepareWarmIndexSession,
  assessIndexFreshness,
  executeMutation: executeIncrementalChangeStalenessMutation,
  captureSourceState: captureIncrementalChangeStalenessSourceState
};

export type PrepareIncrementalChangeStalenessScenarioLifecycleOptions = {
  /** Repository root owning the canonical benchmarks; the run-owned root must resolve inside it. */
  repoRoot: string;
  /** Absolute run-owned runtime root; every target, index, and command log of this run lives under it. */
  runOwnedRoot: string;
  scenario: IncrementalChangeStalenessScenario;
  baseCase: IncrementalChangeStalenessBaseCaseIdentityV1;
  kitCommand: string;
  deps?: Partial<IncrementalChangeStalenessLifecycleDeps>;
};

/** Deterministic run-owned layout: targets/, indexes/, and commands/ are separate sibling trees. */
export function incrementalChangeStalenessTargetsRoot(runOwnedRoot: string): string {
  return path.join(path.resolve(runOwnedRoot), "targets");
}

export function incrementalChangeStalenessIndexDir(
  runOwnedRoot: string,
  scenarioId: string,
  treatmentId: IncrementalChangeStalenessV2TreatmentId,
  role: IncrementalChangeStalenessIndexRole
): string {
  return resolveWithinRoot(path.resolve(runOwnedRoot), path.join("indexes", scenarioId, treatmentId, role));
}

export function incrementalChangeStalenessCommandsDir(
  runOwnedRoot: string,
  scenarioId: string,
  treatmentId: IncrementalChangeStalenessV2TreatmentId,
  role: IncrementalChangeStalenessIndexRole
): string {
  return resolveWithinRoot(path.resolve(runOwnedRoot), path.join("commands", scenarioId, treatmentId, role));
}

export class LifecycleFailure extends Error {
  constructor(readonly failure: IncrementalChangeStalenessLifecycleFailureV1) {
    super(failure.message);
  }
}

export function fail(failure: IncrementalChangeStalenessLifecycleFailureV1 | null): void {
  if (failure) throw new LifecycleFailure(failure);
}

/**
 * Shared by the v0.6.2 and v0.6.3 lifecycles: runs the index through the established warm-index
 * session owner (index -> version probe -> snapshot -> graph), then proves target/index identity.
 * `mode` defaults to an ordinary full build. The index directory must be absent unless
 * `existingIndexDir` is set (an in-place refresh of an already-cloned baseline).
 */
export async function prepareTreatmentIndexEvidence(params: {
  deps: IncrementalChangeStalenessLifecycleDeps;
  runOwnedRoot: string;
  scenarioId: string;
  kitCommand: string;
  sourceRoots: readonly string[];
  target: DisposableTreatmentTargetV1<IncrementalChangeStalenessV2TreatmentId>;
  role: IncrementalChangeStalenessIndexRole;
  indexDir: string;
  mode?: MyDevKitIndexBuildMode;
  existingIndexDir?: boolean;
  /** Called once the index, snapshot, and graph are all ready, before identity is proven. */
  onIndexPrepared?: () => void;
}): Promise<{ evidence: IncrementalChangeStalenessIndexEvidenceV1<IncrementalChangeStalenessV2TreatmentId>; build: MyDevKitIndexBuildResult }> {
  const { deps, target, role, indexDir, sourceRoots } = params;
  const treatmentId = target.treatmentId;
  if (params.existingIndexDir ? !existsSync(indexDir) : existsSync(indexDir)) {
    fail({
      code: "index-directory-collision",
      message: params.existingIndexDir
        ? `Expected an existing cloned ${treatmentId} ${role} index directory: ${indexDir}.`
        : `Refusing to overwrite existing ${treatmentId} ${role} index directory: ${indexDir}.`,
      treatmentId
    });
  }
  const commandsDir = incrementalChangeStalenessCommandsDir(params.runOwnedRoot, params.scenarioId, treatmentId, role);
  const prepared = await deps.prepareIndexSession({
    target: { absoluteTargetRoot: target.targetRoot, sourceRoots: [...sourceRoots] },
    kitCommand: params.kitCommand,
    indexDir,
    commandsDir,
    requireKit: false,
    ...(params.mode ? { mode: params.mode } : {})
  });
  if (!prepared.ok) {
    fail({
      code: role === "baseline" ? "baseline-index-build-failed" : "refresh-index-build-failed",
      message: `${treatmentId} ${role} my-dev-kit index build failed: ${prepared.warnings.join(" ") || `exit code ${prepared.build.command.exitCode}`}`,
      treatmentId
    });
    throw new Error("unreachable");
  }
  params.onIndexPrepared?.();
  const evidence: IncrementalChangeStalenessIndexEvidenceV1<IncrementalChangeStalenessV2TreatmentId> = Object.freeze({
    role,
    treatmentId,
    builtRelativeToMutation: role === "baseline" ? ("pre-mutation" as const) : ("post-mutation" as const),
    indexDir: prepared.session.indexDir,
    commandsDir,
    targetRoot: prepared.session.targetRoot,
    sourceRoots: prepared.session.sourceRoots,
    buildDurationMs: prepared.session.buildDurationMs,
    buildCommand: prepared.session.buildCommand,
    snapshot: prepared.session.indexSnapshot,
    graph: prepared.session.affectedNeighborhoodGraph
  });
  fail(evaluateIndexEvidence(evidence, { targetRoot: target.targetRoot, sourceRoots, indexDir }));
  return { evidence, build: prepared.build };
}

/**
 * Owns the matched Batch 3 lifecycle for ONE frozen scenario:
 *
 *  1. two independent disposable copies (stale-index, full-refresh);
 *  2. pre-mutation controlled source-state equivalence;
 *  3. stale-index baseline: index -> snapshot -> graph, then identity proof;
 *  4. full-refresh baseline: index -> snapshot -> graph, then identity proof;
 *  5. BARRIER: only after both baselines are fully ready, the same frozen
 *     mutation is applied independently to both copies;
 *  6. post-mutation controlled source-state equivalence;
 *  7. each baseline snapshot assessed against its mutated target (complete
 *     `stale` on exactly the scenario-controlled paths, symmetric across
 *     treatments);
 *  8. stale-index keeps its baseline index as active retrieval authority
 *     (no rebuild);
 *  9. full-refresh builds a NEW complete index into a separate directory,
 *     captures its snapshot/graph, and proves it complete `fresh`.
 *
 * Exactly three full index builds and three freshness assessments happen per
 * scenario. Performs no retrieval, affected-neighborhood traversal, metric
 * computation, correctness evaluation, or comparison classification, and
 * never acts on a reindex recommendation. Sequential by design. Does not
 * delete anything: the caller owns and cleans the run-owned root after the
 * session has been consumed.
 */
export async function prepareIncrementalChangeStalenessScenarioLifecycle(
  options: PrepareIncrementalChangeStalenessScenarioLifecycleOptions
): Promise<IncrementalChangeStalenessLifecycleResultV1> {
  const deps: IncrementalChangeStalenessLifecycleDeps = { ...defaultIncrementalChangeStalenessLifecycleDeps, ...options.deps };
  const { repoRoot, scenario, baseCase, kitCommand } = options;
  const runOwnedRoot = path.resolve(options.runOwnedRoot);
  const events: string[] = [];
  const indexBuildCounts: Record<IncrementalChangeStalenessTreatmentId, number> = { "stale-index": 0, "full-refresh": 0 };
  const sourceRoots = baseCase.sourceRoots;
  const controlledChangedPaths = scenario.mutation.files.map((file) => normalizeRelativePath(file.path)).sort();

  async function prepareIndex(
    target: DisposableTreatmentTargetV1,
    role: IncrementalChangeStalenessIndexRole,
    indexDir: string
  ): Promise<IncrementalChangeStalenessIndexEvidenceV1> {
    const treatmentId = target.treatmentId;
    if (existsSync(indexDir)) {
      fail({ code: "index-directory-collision", message: `Refusing to overwrite existing ${treatmentId} ${role} index directory: ${indexDir}.`, treatmentId });
    }
    indexBuildCounts[treatmentId] += 1;
    const { evidence } = await prepareTreatmentIndexEvidence({
      deps,
      runOwnedRoot,
      scenarioId: scenario.id,
      kitCommand,
      sourceRoots,
      target,
      role,
      indexDir,
      // prepareIndexSession resolves only after the index command, snapshot capture, and graph
      // loading have all completed, in that order.
      onIndexPrepared: () =>
        events.push(`${treatmentId}:${role}-index-built`, `${treatmentId}:${role}-snapshot-captured`, `${treatmentId}:${role}-graph-loaded`)
    });
    events.push(`${treatmentId}:${role}-identity-verified`);
    return evidence as IncrementalChangeStalenessIndexEvidenceV1;
  }

  async function captureState(target: DisposableTreatmentTargetV1): Promise<IncrementalChangeStalenessSourceStateV1> {
    return deps.captureSourceState(target.targetRoot, sourceRoots, target.treatmentId, baseCase.benchmarkProjectId);
  }

  async function mutate(target: DisposableTreatmentTargetV1): Promise<IncrementalChangeStalenessMutationReceiptV1> {
    const receipt = await deps.executeMutation(scenario, target, sourceRoots, repoRoot);
    if (receipt.status !== "applied") {
      fail({ code: "mutation-failed", message: `${target.treatmentId} mutation was rejected: ${receipt.errors.join(" ")}`, treatmentId: target.treatmentId });
    }
    events.push(`${target.treatmentId}:mutation-applied`);
    return receipt;
  }

  async function assess(index: IncrementalChangeStalenessIndexEvidenceV1, target: DisposableTreatmentTargetV1): Promise<IndexFreshnessAssessmentV1> {
    return deps.assessIndexFreshness({ snapshot: index.snapshot, targetRoot: target.targetRoot, sourceRoots });
  }

  try {
    const indexDirs = {
      staleBaseline: incrementalChangeStalenessIndexDir(runOwnedRoot, scenario.id, "stale-index", "baseline"),
      fullBaseline: incrementalChangeStalenessIndexDir(runOwnedRoot, scenario.id, "full-refresh", "baseline"),
      fullRefreshed: incrementalChangeStalenessIndexDir(runOwnedRoot, scenario.id, "full-refresh", "refreshed")
    };
    if (
      normalizeRootForComparison(indexDirs.staleBaseline) === normalizeRootForComparison(indexDirs.fullBaseline) ||
      normalizeRootForComparison(indexDirs.fullBaseline) === normalizeRootForComparison(indexDirs.fullRefreshed) ||
      normalizeRootForComparison(indexDirs.staleBaseline) === normalizeRootForComparison(indexDirs.fullRefreshed)
    ) {
      fail({ code: "index-directory-collision", message: "Treatment/phase index directories are not distinct.", treatmentId: null });
    }

    // 1. Two independent disposable copies through the Batch 2 owner.
    const targets = {} as Record<IncrementalChangeStalenessTreatmentId, DisposableTreatmentTargetV1>;
    for (const treatmentId of ["stale-index", "full-refresh"] as const) {
      try {
        targets[treatmentId] = await createDisposableTreatmentTarget({
          repoRoot,
          runRoot: incrementalChangeStalenessTargetsRoot(runOwnedRoot),
          scenarioId: scenario.id,
          treatmentId,
          benchmarkProjectId: baseCase.benchmarkProjectId,
          canonicalProjectRootRelative: baseCase.canonicalProjectRootRelative
        });
      } catch (error) {
        fail({ code: "treatment-target-creation-failed", message: `${treatmentId}: ${(error as Error).message}`, treatmentId });
      }
    }
    const stale = targets["stale-index"];
    const full = targets["full-refresh"];
    events.push("treatment-targets-created");

    // 2. Pre-mutation equivalence gates all indexing and mutation.
    const stalePre = await captureState(stale);
    const fullPre = await captureState(full);
    events.push("pre-mutation-source-state-captured");
    const preMutationEquivalence = compareIncrementalChangeStalenessSourceStates(stalePre, fullPre);
    if (preMutationEquivalence.result !== "equivalent") {
      fail({
        code: "pre-mutation-not-equivalent",
        message: `Treatment copies are not pre-mutation equivalent (${preMutationEquivalence.result}): ${preMutationEquivalence.reasons.join("; ")}`,
        treatmentId: null
      });
    }
    events.push("pre-mutation-equivalence-proven");

    // 3-4. Baselines: each index -> snapshot -> graph -> identity, sequentially.
    const staleBaseline = await prepareIndex(stale, "baseline", indexDirs.staleBaseline);
    const fullBaseline = await prepareIndex(full, "baseline", indexDirs.fullBaseline);
    const baselineTools = evaluateToolIdentity([staleBaseline, fullBaseline]);
    fail(baselineTools.failure);
    events.push("baseline-tool-identity-verified");

    // 5. Barrier: both baselines are index + snapshot + graph READY. Only now may mutation begin.
    events.push("baseline-barrier-ready");
    const staleReceipt = await mutate(stale);
    const fullReceipt = await mutate(full);

    // 6. Post-mutation equivalence.
    const stalePost = await captureState(stale);
    const fullPost = await captureState(full);
    events.push("post-mutation-source-state-captured");
    const postMutationEquivalence = compareIncrementalChangeStalenessSourceStates(stalePost, fullPost);
    if (postMutationEquivalence.result !== "equivalent") {
      fail({
        code: "post-mutation-not-equivalent",
        message: `Treatment copies are not post-mutation equivalent (${postMutationEquivalence.result}): ${postMutationEquivalence.reasons.join("; ")}`,
        treatmentId: null
      });
    }
    events.push("post-mutation-equivalence-proven");

    // 7. Baseline (change-authority) freshness against each mutated target.
    const staleBaselineFreshness = await assess(staleBaseline, stale);
    fail(evaluateBaselineStaleFreshness(staleBaselineFreshness, controlledChangedPaths, "stale-index"));
    events.push("stale-index:baseline-freshness-stale");
    const fullBaselineFreshness = await assess(fullBaseline, full);
    fail(evaluateBaselineStaleFreshness(fullBaselineFreshness, controlledChangedPaths, "full-refresh"));
    events.push("full-refresh:baseline-freshness-stale");
    fail(evaluateChangedPathSymmetry(staleBaselineFreshness, fullBaselineFreshness));
    events.push("baseline-changed-paths-symmetric");

    // 8. stale-index: no rebuild; baseline stays the active retrieval index.
    events.push("stale-index:baseline-retained-as-active");

    // 9. full-refresh: new complete post-mutation index in a separate directory.
    const refreshed = await prepareIndex(full, "refreshed", indexDirs.fullRefreshed);
    const refreshedFreshness = await assess(refreshed, full);
    fail(evaluateRefreshedFreshness(refreshedFreshness));
    events.push("full-refresh:refreshed-freshness-fresh");
    const allTools = evaluateToolIdentity([staleBaseline, fullBaseline, refreshed]);
    fail(allTools.failure);
    events.push("tool-identity-consistent");
    events.push("full-refresh:refreshed-active");
    events.push("lifecycle-ready");

    const staleSession: IncrementalChangeStalenessStaleTreatmentSessionV1 = Object.freeze({
      treatmentId: "stale-index",
      target: stale,
      preMutationSourceState: stalePre,
      postMutationSourceState: stalePost,
      mutationReceipt: staleReceipt,
      changeAuthority: Object.freeze({ baselineIndex: staleBaseline, postMutationBaselineFreshness: staleBaselineFreshness }),
      activeRetrieval: Object.freeze({ role: "baseline" as const, index: staleBaseline }),
      postMutationIndexBuilt: false as const,
      refreshedIndex: null,
      refreshedFreshness: null,
      indexBuildCount: indexBuildCounts["stale-index"],
      freshnessAssessmentCount: 1,
      lifecycleStatus: "ready" as const,
      warnings: Object.freeze([])
    });
    const fullSession: IncrementalChangeStalenessFullRefreshTreatmentSessionV1 = Object.freeze({
      treatmentId: "full-refresh",
      target: full,
      preMutationSourceState: fullPre,
      postMutationSourceState: fullPost,
      mutationReceipt: fullReceipt,
      changeAuthority: Object.freeze({ baselineIndex: fullBaseline, postMutationBaselineFreshness: fullBaselineFreshness }),
      activeRetrieval: Object.freeze({ role: "refreshed" as const, index: refreshed }),
      postMutationIndexBuilt: true as const,
      refreshedIndex: refreshed,
      refreshedFreshness,
      indexBuildCount: indexBuildCounts["full-refresh"],
      freshnessAssessmentCount: 2,
      lifecycleStatus: "ready" as const,
      warnings: Object.freeze([])
    });
    const session: IncrementalChangeStalenessScenarioSessionV1 = Object.freeze({
      schemaVersion: INCREMENTAL_CHANGE_STALENESS_LIFECYCLE_SESSION_SCHEMA_VERSION,
      scenarioId: scenario.id,
      scenario,
      baseCase,
      runOwnedRoot,
      kitCommand,
      toolIdentity: allTools.tool!,
      controlledChangedPaths: Object.freeze(controlledChangedPaths),
      preMutationEquivalence,
      postMutationEquivalence,
      treatments: Object.freeze({ "stale-index": staleSession, "full-refresh": fullSession }),
      lifecycleEvents: Object.freeze([...events]),
      status: "ready" as const
    });
    return { status: "ready", session };
  } catch (error) {
    const failure: IncrementalChangeStalenessLifecycleFailureV1 =
      error instanceof LifecycleFailure
        ? error.failure
        : { code: "lifecycle-error", message: `Lifecycle failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`, treatmentId: null };
    return {
      status: "failed",
      scenarioId: scenario.id,
      failure,
      lifecycleEvents: Object.freeze([...events]),
      indexBuildCounts: Object.freeze({ ...indexBuildCounts })
    };
  }
}
