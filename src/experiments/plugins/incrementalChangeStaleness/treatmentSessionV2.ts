import type { IndexFreshnessAssessmentV1 } from "../../../evaluation/indexFreshness.js";
import type { IndexSnapshotToolV1 } from "../../../evaluation/indexSnapshot.js";
import type { MyDevKitIncrementalRefreshEvidence, MyDevKitIndexBuildMode } from "../../../evaluation/types.js";
import type {
  DisposableTreatmentTargetV1,
  IncrementalChangeStalenessV2TreatmentId,
  IncrementalChangeStalenessV2TreatmentIntent
} from "./disposableTarget.js";
import type { PartialRefreshRealization } from "./lifecyclePolicyV2.js";
import type { IncrementalChangeStalenessMutationReceiptV1 } from "./mutationExecution.js";
import type { IncrementalChangeStalenessScenario } from "./scenarioTypes.js";
import type { IncrementalChangeStalenessSourceStateComparisonV1, IncrementalChangeStalenessSourceStateV1 } from "./sourceState.js";
import type {
  IncrementalChangeStalenessBaseCaseIdentityV1,
  IncrementalChangeStalenessIndexEvidenceV1,
  IncrementalChangeStalenessLifecycleFailureV1
} from "./treatmentSession.js";

/**
 * v0.6.3 in-memory (runtime-only) four-treatment lifecycle session schema version. This is NOT the
 * persisted execution artifact; persistence is a later batch.
 */
export const INCREMENTAL_CHANGE_STALENESS_LIFECYCLE_SESSION_V2_SCHEMA_VERSION = "2.0.0";

/** Index evidence plus the Batch 1 build mode and validated upstream refresh evidence of its build. */
export type IncrementalChangeStalenessIndexEvidenceV2 = IncrementalChangeStalenessIndexEvidenceV1<IncrementalChangeStalenessV2TreatmentId> & {
  /** The build mode Lab requested for this index invocation. */
  readonly buildMode: MyDevKitIndexBuildMode;
  /** Validated per-invocation upstream evidence; null for a full-mode build. */
  readonly incrementalRefresh: MyDevKitIncrementalRefreshEvidence | null;
};

export type IncrementalChangeStalenessChangeAuthorityV2 = {
  readonly baselineIndex: IncrementalChangeStalenessIndexEvidenceV2;
  /** Upstream evidence of the baseline bootstrap (expected: changed-files requested, full applied, cache-missing). */
  readonly baselineBootstrap: MyDevKitIncrementalRefreshEvidence;
  /** assessIndexFreshness(baseline snapshot, mutated target); required to be complete `stale`. */
  readonly postMutationBaselineFreshness: IndexFreshnessAssessmentV1;
};

type TreatmentSessionBaseV2<T extends IncrementalChangeStalenessV2TreatmentId> = {
  readonly treatmentId: T;
  readonly treatmentIntent: IncrementalChangeStalenessV2TreatmentIntent;
  readonly target: DisposableTreatmentTargetV1<IncrementalChangeStalenessV2TreatmentId>;
  readonly preMutationSourceState: IncrementalChangeStalenessSourceStateV1;
  readonly postMutationSourceState: IncrementalChangeStalenessSourceStateV1;
  readonly mutationReceipt: IncrementalChangeStalenessMutationReceiptV1;
  readonly changeAuthority: IncrementalChangeStalenessChangeAuthorityV2;
  /** Every my-dev-kit index invocation of this treatment (bootstrap included). */
  readonly indexInvocationCount: number;
  readonly freshnessAssessmentCount: number;
  readonly lifecycleStatus: "ready";
  readonly warnings: readonly string[];
};

export type IncrementalChangeStalenessStaleTreatmentSessionV2 = TreatmentSessionBaseV2<"stale-index"> & {
  readonly activeRetrieval: { readonly role: "baseline"; readonly index: IncrementalChangeStalenessIndexEvidenceV2 };
  readonly postMutationIndexBuilt: false;
  readonly refreshedIndex: null;
  readonly refreshedFreshness: null;
  readonly refreshRealization: null;
};

/** changed-files-refresh / affected-neighborhood-refresh: refreshed index is a separate in-place-refreshed clone. */
export type IncrementalChangeStalenessPartialRefreshTreatmentSessionV2<T extends "changed-files-refresh" | "affected-neighborhood-refresh"> =
  TreatmentSessionBaseV2<T> & {
    readonly activeRetrieval: { readonly role: "refreshed"; readonly index: IncrementalChangeStalenessIndexEvidenceV2 };
    readonly postMutationIndexBuilt: true;
    readonly refreshedIndex: IncrementalChangeStalenessIndexEvidenceV2;
    readonly refreshedFreshness: IndexFreshnessAssessmentV1;
    /** APPLIED_PARTIAL only when upstream reported an applied partial refresh; FALLBACK_FULL for a truthful full fallback. */
    readonly refreshRealization: PartialRefreshRealization;
  };

export type IncrementalChangeStalenessFullRefreshTreatmentSessionV2 = TreatmentSessionBaseV2<"full-refresh"> & {
  readonly activeRetrieval: { readonly role: "refreshed"; readonly index: IncrementalChangeStalenessIndexEvidenceV2 };
  readonly postMutationIndexBuilt: true;
  readonly refreshedIndex: IncrementalChangeStalenessIndexEvidenceV2;
  readonly refreshedFreshness: IndexFreshnessAssessmentV1;
  readonly refreshRealization: null;
};

export type IncrementalChangeStalenessTreatmentSessionV2 =
  | IncrementalChangeStalenessStaleTreatmentSessionV2
  | IncrementalChangeStalenessPartialRefreshTreatmentSessionV2<"changed-files-refresh">
  | IncrementalChangeStalenessPartialRefreshTreatmentSessionV2<"affected-neighborhood-refresh">
  | IncrementalChangeStalenessFullRefreshTreatmentSessionV2;

export type IncrementalChangeStalenessScenarioSessionV2 = {
  readonly schemaVersion: typeof INCREMENTAL_CHANGE_STALENESS_LIFECYCLE_SESSION_V2_SCHEMA_VERSION;
  readonly scenarioId: string;
  readonly scenario: IncrementalChangeStalenessScenario;
  readonly baseCase: IncrementalChangeStalenessBaseCaseIdentityV1;
  readonly runOwnedRoot: string;
  readonly kitCommand: string;
  /** The single my-dev-kit tool identity shared by every index of this scenario. */
  readonly toolIdentity: IndexSnapshotToolV1;
  readonly controlledChangedPaths: readonly string[];
  /** Pairwise comparisons of each other treatment against the stale-index reference (fixed order). */
  readonly preMutationEquivalence: Readonly<Record<Exclude<IncrementalChangeStalenessV2TreatmentId, "stale-index">, IncrementalChangeStalenessSourceStateComparisonV1>>;
  readonly postMutationEquivalence: Readonly<Record<Exclude<IncrementalChangeStalenessV2TreatmentId, "stale-index">, IncrementalChangeStalenessSourceStateComparisonV1>>;
  readonly treatments: {
    readonly "stale-index": IncrementalChangeStalenessStaleTreatmentSessionV2;
    readonly "changed-files-refresh": IncrementalChangeStalenessPartialRefreshTreatmentSessionV2<"changed-files-refresh">;
    readonly "affected-neighborhood-refresh": IncrementalChangeStalenessPartialRefreshTreatmentSessionV2<"affected-neighborhood-refresh">;
    readonly "full-refresh": IncrementalChangeStalenessFullRefreshTreatmentSessionV2;
  };
  /** Total index invocations across all treatments (expected 7). */
  readonly totalIndexInvocationCount: number;
  /** Total freshness assessments across all treatments (expected 7). */
  readonly totalFreshnessAssessmentCount: number;
  readonly lifecycleEvents: readonly string[];
  readonly status: "ready";
};

export type IncrementalChangeStalenessLifecycleResultV2 =
  | { readonly status: "ready"; readonly session: IncrementalChangeStalenessScenarioSessionV2 }
  | {
      readonly status: "failed";
      readonly scenarioId: string;
      readonly failure: IncrementalChangeStalenessLifecycleFailureV1;
      readonly lifecycleEvents: readonly string[];
      readonly indexInvocationCounts: Readonly<Record<IncrementalChangeStalenessV2TreatmentId, number>>;
    };
