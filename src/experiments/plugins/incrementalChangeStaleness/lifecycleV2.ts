import path from "node:path";
import type { IndexFreshnessAssessmentV1 } from "../../../evaluation/indexFreshness.js";
import type { MyDevKitIndexBuildMode, MyDevKitIncrementalRefreshEvidence, MyDevKitRefreshScope } from "../../../evaluation/types.js";
import {
  createDisposableTreatmentTarget,
  INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS,
  INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_INTENTS,
  type DisposableTreatmentTargetV1,
  type IncrementalChangeStalenessV2TreatmentId
} from "./disposableTarget.js";
import { cloneIncrementalChangeStalenessIndexDirectory } from "./indexClone.js";
import {
  defaultIncrementalChangeStalenessLifecycleDeps,
  fail,
  incrementalChangeStalenessIndexDir,
  incrementalChangeStalenessTargetsRoot,
  LifecycleFailure,
  prepareTreatmentIndexEvidence,
  type IncrementalChangeStalenessLifecycleDeps,
  type PrepareIncrementalChangeStalenessScenarioLifecycleOptions
} from "./lifecycle.js";
import {
  evaluateBaselineStaleFreshness,
  evaluateChangedPathSymmetry,
  evaluateRefreshedFreshness,
  evaluateToolIdentity,
  normalizeRelativePath,
  normalizeRootForComparison
} from "./lifecyclePolicy.js";
import { evaluateBaselineBootstrapEvidence, evaluatePartialRefreshRealization, evaluateV2InvocationCounts } from "./lifecyclePolicyV2.js";
import type { IncrementalChangeStalenessMutationReceiptV1 } from "./mutationExecution.js";
import {
  compareIncrementalChangeStalenessSourceStates,
  type IncrementalChangeStalenessSourceStateComparisonV1,
  type IncrementalChangeStalenessSourceStateV1
} from "./sourceState.js";
import type { IncrementalChangeStalenessIndexEvidenceV1, IncrementalChangeStalenessIndexRole, IncrementalChangeStalenessLifecycleFailureV1 } from "./treatmentSession.js";
import {
  INCREMENTAL_CHANGE_STALENESS_LIFECYCLE_SESSION_V2_SCHEMA_VERSION,
  type IncrementalChangeStalenessFullRefreshTreatmentSessionV2,
  type IncrementalChangeStalenessIndexEvidenceV2,
  type IncrementalChangeStalenessLifecycleResultV2,
  type IncrementalChangeStalenessPartialRefreshTreatmentSessionV2,
  type IncrementalChangeStalenessScenarioSessionV2,
  type IncrementalChangeStalenessStaleTreatmentSessionV2
} from "./treatmentSessionV2.js";

type TreatmentId = IncrementalChangeStalenessV2TreatmentId;
type Target = DisposableTreatmentTargetV1<TreatmentId>;
type PartialTreatmentId = "changed-files-refresh" | "affected-neighborhood-refresh";
type ComparedTreatmentId = Exclude<TreatmentId, "stale-index">;

const PARTIAL_REFRESH_SCOPES: Readonly<Record<PartialTreatmentId, MyDevKitRefreshScope>> = {
  "changed-files-refresh": "changed-files",
  "affected-neighborhood-refresh": "affected-neighborhood"
};
/** Every baseline is bootstrapped incrementally so upstream writes the cache metadata a later partial refresh needs. */
const BOOTSTRAP_MODE: MyDevKitIndexBuildMode = { kind: "incremental", refreshScope: "changed-files" };
const V2_TREATMENT_IDS = INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_IDS;

export type IncrementalChangeStalenessLifecycleDepsV2 = IncrementalChangeStalenessLifecycleDeps & {
  /** Index-directory copy seam; the default is the containment-checked clone owner. */
  cloneIndexDirectory: typeof cloneIncrementalChangeStalenessIndexDirectory;
};

export type PrepareIncrementalChangeStalenessScenarioLifecycleV2Options = Omit<PrepareIncrementalChangeStalenessScenarioLifecycleOptions, "deps"> & {
  deps?: Partial<IncrementalChangeStalenessLifecycleDepsV2>;
};

function withRefreshEvidence(
  evidence: IncrementalChangeStalenessIndexEvidenceV1<TreatmentId>,
  buildMode: MyDevKitIndexBuildMode,
  incrementalRefresh: MyDevKitIncrementalRefreshEvidence | null
): IncrementalChangeStalenessIndexEvidenceV2 {
  return Object.freeze({ ...evidence, buildMode, incrementalRefresh });
}

/**
 * v0.6.3 internal four-treatment lifecycle for ONE frozen scenario (runtime only; not yet wired into the
 * public plugin, execution artifact, comparison, or reports):
 *
 *  1. four independent disposable copies (stale-index, changed-files-refresh, affected-neighborhood-refresh,
 *     full-refresh), all derived from the same immutable canonical benchmark;
 *  2. pre-mutation controlled source-state equivalence of every treatment against the stale-index reference;
 *  3. all four baselines bootstrapped with `--incremental --refresh-scope changed-files` into brand-new
 *     index directories (expected bootstrap evidence: full fallback, `cache-missing`);
 *  4. each partial treatment's untouched baseline is cloned byte-for-byte into its own refreshed directory;
 *  5. BARRIER: only after every baseline + clone is ready is the same frozen mutation applied to all four;
 *  6. post-mutation source-state equivalence and symmetric complete-stale baseline freshness;
 *  7. stale-index keeps its baseline; each partial treatment refreshes its clone in place and full-refresh
 *     builds a new full index; every refreshed index must be complete `fresh`.
 *
 * Seven index invocations and seven freshness assessments per scenario. Performs no retrieval,
 * affected-neighborhood task traversal, or comparison classification. Sequential by design; deletes nothing.
 */
export async function prepareIncrementalChangeStalenessScenarioLifecycleV2(
  options: PrepareIncrementalChangeStalenessScenarioLifecycleV2Options
): Promise<IncrementalChangeStalenessLifecycleResultV2> {
  const cloneIndexDirectory = options.deps?.cloneIndexDirectory ?? cloneIncrementalChangeStalenessIndexDirectory;
  const deps: IncrementalChangeStalenessLifecycleDeps = { ...defaultIncrementalChangeStalenessLifecycleDeps, ...options.deps };
  const { repoRoot, scenario, baseCase, kitCommand } = options;
  const runOwnedRoot = path.resolve(options.runOwnedRoot);
  const events: string[] = [];
  const indexInvocationCounts = Object.fromEntries(V2_TREATMENT_IDS.map((id) => [id, 0])) as Record<TreatmentId, number>;
  const freshnessAssessmentCounts = Object.fromEntries(V2_TREATMENT_IDS.map((id) => [id, 0])) as Record<TreatmentId, number>;
  const sourceRoots = baseCase.sourceRoots;
  const controlledChangedPaths = scenario.mutation.files.map((file) => normalizeRelativePath(file.path)).sort();

  async function prepareIndex(
    target: Target,
    role: IncrementalChangeStalenessIndexRole,
    indexDir: string,
    mode: MyDevKitIndexBuildMode | undefined,
    existingIndexDir = false
  ) {
    const treatmentId = target.treatmentId;
    indexInvocationCounts[treatmentId] += 1;
    const { evidence, build } = await prepareTreatmentIndexEvidence({
      deps,
      runOwnedRoot,
      scenarioId: scenario.id,
      kitCommand,
      sourceRoots,
      target,
      role,
      indexDir,
      mode,
      existingIndexDir,
      onIndexPrepared: () =>
        events.push(`${treatmentId}:${role}-index-built`, `${treatmentId}:${role}-snapshot-captured`, `${treatmentId}:${role}-graph-loaded`)
    });
    events.push(`${treatmentId}:${role}-identity-verified`);
    return { evidence, build };
  }

  async function captureState(target: Target): Promise<IncrementalChangeStalenessSourceStateV1> {
    return deps.captureSourceState(target.targetRoot, sourceRoots, target.treatmentId, baseCase.benchmarkProjectId);
  }

  async function mutate(target: Target): Promise<IncrementalChangeStalenessMutationReceiptV1> {
    const receipt = await deps.executeMutation(scenario, target, sourceRoots, repoRoot);
    if (receipt.status !== "applied") {
      fail({ code: "mutation-failed", message: `${target.treatmentId} mutation was rejected: ${receipt.errors.join(" ")}`, treatmentId: target.treatmentId });
    }
    events.push(`${target.treatmentId}:mutation-applied`);
    return receipt;
  }

  async function assess(index: IncrementalChangeStalenessIndexEvidenceV1<TreatmentId>, target: Target): Promise<IndexFreshnessAssessmentV1> {
    freshnessAssessmentCounts[target.treatmentId] += 1;
    return deps.assessIndexFreshness({ snapshot: index.snapshot, targetRoot: target.targetRoot, sourceRoots });
  }

  function compareAgainstReference(
    reference: IncrementalChangeStalenessSourceStateV1,
    states: Record<TreatmentId, IncrementalChangeStalenessSourceStateV1>,
    code: "pre-mutation-not-equivalent" | "post-mutation-not-equivalent",
    phase: string
  ): Record<ComparedTreatmentId, IncrementalChangeStalenessSourceStateComparisonV1> {
    const comparisons = {} as Record<ComparedTreatmentId, IncrementalChangeStalenessSourceStateComparisonV1>;
    for (const treatmentId of V2_TREATMENT_IDS) {
      if (treatmentId === "stale-index") continue;
      const comparison = compareIncrementalChangeStalenessSourceStates(reference, states[treatmentId]);
      comparisons[treatmentId] = comparison;
      if (comparison.result !== "equivalent") {
        fail({
          code,
          message: `${treatmentId} is not ${phase} equivalent to the stale-index reference (${comparison.result}): ${comparison.reasons.join("; ")}`,
          treatmentId
        });
      }
    }
    return comparisons;
  }

  try {
    const baselineDirs = {} as Record<TreatmentId, string>;
    const refreshedDirs = {} as Record<TreatmentId, string>;
    for (const treatmentId of V2_TREATMENT_IDS) {
      baselineDirs[treatmentId] = incrementalChangeStalenessIndexDir(runOwnedRoot, scenario.id, treatmentId, "baseline");
      refreshedDirs[treatmentId] = incrementalChangeStalenessIndexDir(runOwnedRoot, scenario.id, treatmentId, "refreshed");
    }
    const allDirs = [...Object.values(baselineDirs), ...Object.values(refreshedDirs)].map(normalizeRootForComparison);
    if (new Set(allDirs).size !== allDirs.length) {
      fail({ code: "index-directory-collision", message: "Treatment/phase index directories are not distinct.", treatmentId: null });
    }

    // 1. Four independent disposable copies through the established owner, in fixed order.
    const targets = {} as Record<TreatmentId, Target>;
    for (const treatmentId of V2_TREATMENT_IDS) {
      try {
        targets[treatmentId] = await createDisposableTreatmentTarget<TreatmentId>({
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
    const targetRootKeys = V2_TREATMENT_IDS.map((id) => normalizeRootForComparison(targets[id].targetRoot));
    if (new Set(targetRootKeys).size !== targetRootKeys.length) {
      fail({ code: "treatment-target-creation-failed", message: "Treatment target roots are not distinct.", treatmentId: null });
    }
    events.push("treatment-targets-created");

    // 2. Pre-mutation equivalence gates all indexing and mutation; stale-index is only the comparison reference.
    const preStates = {} as Record<TreatmentId, IncrementalChangeStalenessSourceStateV1>;
    for (const treatmentId of V2_TREATMENT_IDS) preStates[treatmentId] = await captureState(targets[treatmentId]);
    events.push("pre-mutation-source-state-captured");
    const preMutationEquivalence = compareAgainstReference(preStates["stale-index"], preStates, "pre-mutation-not-equivalent", "pre-mutation");
    events.push("pre-mutation-equivalence-proven");

    // 3. Baselines: every treatment bootstraps incrementally into a brand-new index directory.
    const baselines = {} as Record<TreatmentId, IncrementalChangeStalenessIndexEvidenceV2>;
    const bootstraps = {} as Record<TreatmentId, MyDevKitIncrementalRefreshEvidence>;
    for (const treatmentId of V2_TREATMENT_IDS) {
      const { evidence, build } = await prepareIndex(targets[treatmentId], "baseline", baselineDirs[treatmentId], BOOTSTRAP_MODE);
      fail(evaluateBaselineBootstrapEvidence(build, treatmentId));
      bootstraps[treatmentId] = build.incrementalRefresh!;
      baselines[treatmentId] = withRefreshEvidence(evidence, build.mode, build.incrementalRefresh);
      events.push(`${treatmentId}:baseline-bootstrap-verified`);
    }
    const baselineTools = evaluateToolIdentity(V2_TREATMENT_IDS.map((id) => baselines[id]));
    fail(baselineTools.failure);
    events.push("baseline-tool-identity-verified");

    // 4. Preserve each partial treatment's immutable baseline; the refresh runs in place against a byte-for-byte clone.
    for (const treatmentId of ["changed-files-refresh", "affected-neighborhood-refresh"] as const) {
      try {
        await cloneIndexDirectory(runOwnedRoot, baselineDirs[treatmentId], refreshedDirs[treatmentId]);
      } catch (error) {
        fail({ code: "index-clone-failed", message: `${treatmentId} baseline index clone failed: ${(error as Error).message}`, treatmentId });
      }
      events.push(`${treatmentId}:baseline-index-cloned`);
    }

    // 5. Barrier: all four baselines are index + snapshot + graph READY and clones exist. Only now may mutation begin.
    events.push("baseline-barrier-ready");
    const receipts = {} as Record<TreatmentId, IncrementalChangeStalenessMutationReceiptV1>;
    for (const treatmentId of V2_TREATMENT_IDS) receipts[treatmentId] = await mutate(targets[treatmentId]);

    // 6. Post-mutation equivalence.
    const postStates = {} as Record<TreatmentId, IncrementalChangeStalenessSourceStateV1>;
    for (const treatmentId of V2_TREATMENT_IDS) postStates[treatmentId] = await captureState(targets[treatmentId]);
    events.push("post-mutation-source-state-captured");
    const postMutationEquivalence = compareAgainstReference(postStates["stale-index"], postStates, "post-mutation-not-equivalent", "post-mutation");
    events.push("post-mutation-equivalence-proven");

    // 7. Baseline (change-authority) freshness against each mutated target, symmetric with the reference.
    const baselineFreshness = {} as Record<TreatmentId, IndexFreshnessAssessmentV1>;
    for (const treatmentId of V2_TREATMENT_IDS) {
      baselineFreshness[treatmentId] = await assess(baselines[treatmentId], targets[treatmentId]);
      fail(evaluateBaselineStaleFreshness(baselineFreshness[treatmentId], controlledChangedPaths, treatmentId));
      events.push(`${treatmentId}:baseline-freshness-stale`);
    }
    for (const treatmentId of V2_TREATMENT_IDS) {
      if (treatmentId === "stale-index") continue;
      fail(evaluateChangedPathSymmetry(baselineFreshness["stale-index"], baselineFreshness[treatmentId], { reference: "stale-index", other: treatmentId }));
    }
    events.push("baseline-changed-paths-symmetric");

    // 8. stale-index: no rebuild; baseline stays the active retrieval index.
    events.push("stale-index:baseline-retained-as-active");

    // 9. Partial treatments: refresh the cloned working index in place through the shared build owner.
    const refreshed = {} as Partial<Record<TreatmentId, IncrementalChangeStalenessIndexEvidenceV2>>;
    const refreshedFreshness = {} as Partial<Record<TreatmentId, IndexFreshnessAssessmentV1>>;
    const realizations = {} as Partial<Record<PartialTreatmentId, "APPLIED_PARTIAL" | "FALLBACK_FULL">>;
    for (const treatmentId of ["changed-files-refresh", "affected-neighborhood-refresh"] as const) {
      const scope = PARTIAL_REFRESH_SCOPES[treatmentId];
      const { evidence, build } = await prepareIndex(
        targets[treatmentId],
        "refreshed",
        refreshedDirs[treatmentId],
        { kind: "incremental", refreshScope: scope },
        true
      );
      const realization = evaluatePartialRefreshRealization(build, scope, treatmentId);
      fail(realization.failure);
      realizations[treatmentId] = realization.realization!;
      events.push(`${treatmentId}:refresh-realization-${realization.realization === "APPLIED_PARTIAL" ? "applied-partial" : "fallback-full"}`);
      refreshed[treatmentId] = withRefreshEvidence(evidence, build.mode, build.incrementalRefresh);
      refreshedFreshness[treatmentId] = await assess(evidence, targets[treatmentId]);
      fail(evaluateRefreshedFreshness(refreshedFreshness[treatmentId]!, treatmentId));
      events.push(`${treatmentId}:refreshed-freshness-fresh`);
    }

    // 10. full-refresh: a NEW complete post-mutation index in a separate directory (baseline is not cloned).
    {
      const { evidence, build } = await prepareIndex(targets["full-refresh"], "refreshed", refreshedDirs["full-refresh"], undefined);
      refreshed["full-refresh"] = withRefreshEvidence(evidence, build.mode, build.incrementalRefresh);
      refreshedFreshness["full-refresh"] = await assess(evidence, targets["full-refresh"]);
      fail(evaluateRefreshedFreshness(refreshedFreshness["full-refresh"], "full-refresh"));
      events.push("full-refresh:refreshed-freshness-fresh");
    }

    // 11. Scenario-level proofs.
    const allTools = evaluateToolIdentity([...V2_TREATMENT_IDS.map((id) => baselines[id]), ...V2_TREATMENT_IDS.flatMap((id) => (refreshed[id] ? [refreshed[id]!] : []))]);
    fail(allTools.failure);
    events.push("tool-identity-consistent");
    fail(evaluateV2InvocationCounts(indexInvocationCounts, freshnessAssessmentCounts));
    events.push("invocation-counts-verified");
    events.push("lifecycle-ready");

    const common = (treatmentId: TreatmentId) => ({
      treatmentIntent: INCREMENTAL_CHANGE_STALENESS_V2_TREATMENT_INTENTS[treatmentId],
      target: targets[treatmentId],
      preMutationSourceState: preStates[treatmentId],
      postMutationSourceState: postStates[treatmentId],
      mutationReceipt: receipts[treatmentId],
      changeAuthority: Object.freeze({
        baselineIndex: baselines[treatmentId],
        baselineBootstrap: bootstraps[treatmentId],
        postMutationBaselineFreshness: baselineFreshness[treatmentId]
      }),
      indexInvocationCount: indexInvocationCounts[treatmentId],
      freshnessAssessmentCount: freshnessAssessmentCounts[treatmentId],
      lifecycleStatus: "ready" as const,
      warnings: Object.freeze([]) as readonly string[]
    });
    const partialSession = <T extends PartialTreatmentId>(treatmentId: T): IncrementalChangeStalenessPartialRefreshTreatmentSessionV2<T> =>
      Object.freeze({
        ...common(treatmentId),
        treatmentId,
        activeRetrieval: Object.freeze({ role: "refreshed" as const, index: refreshed[treatmentId]! }),
        postMutationIndexBuilt: true as const,
        refreshedIndex: refreshed[treatmentId]!,
        refreshedFreshness: refreshedFreshness[treatmentId]!,
        refreshRealization: realizations[treatmentId]!
      });
    const staleSession: IncrementalChangeStalenessStaleTreatmentSessionV2 = Object.freeze({
      ...common("stale-index"),
      treatmentId: "stale-index" as const,
      activeRetrieval: Object.freeze({ role: "baseline" as const, index: baselines["stale-index"] }),
      postMutationIndexBuilt: false as const,
      refreshedIndex: null,
      refreshedFreshness: null,
      refreshRealization: null
    });
    const fullSession: IncrementalChangeStalenessFullRefreshTreatmentSessionV2 = Object.freeze({
      ...common("full-refresh"),
      treatmentId: "full-refresh" as const,
      activeRetrieval: Object.freeze({ role: "refreshed" as const, index: refreshed["full-refresh"]! }),
      postMutationIndexBuilt: true as const,
      refreshedIndex: refreshed["full-refresh"]!,
      refreshedFreshness: refreshedFreshness["full-refresh"]!,
      refreshRealization: null
    });
    const session: IncrementalChangeStalenessScenarioSessionV2 = Object.freeze({
      schemaVersion: INCREMENTAL_CHANGE_STALENESS_LIFECYCLE_SESSION_V2_SCHEMA_VERSION,
      scenarioId: scenario.id,
      scenario,
      baseCase,
      runOwnedRoot,
      kitCommand,
      toolIdentity: allTools.tool!,
      controlledChangedPaths: Object.freeze(controlledChangedPaths),
      preMutationEquivalence: Object.freeze(preMutationEquivalence),
      postMutationEquivalence: Object.freeze(postMutationEquivalence),
      treatments: Object.freeze({
        "stale-index": staleSession,
        "changed-files-refresh": partialSession("changed-files-refresh"),
        "affected-neighborhood-refresh": partialSession("affected-neighborhood-refresh"),
        "full-refresh": fullSession
      }),
      totalIndexInvocationCount: V2_TREATMENT_IDS.reduce((sum, id) => sum + indexInvocationCounts[id], 0),
      totalFreshnessAssessmentCount: V2_TREATMENT_IDS.reduce((sum, id) => sum + freshnessAssessmentCounts[id], 0),
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
      indexInvocationCounts: Object.freeze({ ...indexInvocationCounts })
    };
  }
}
