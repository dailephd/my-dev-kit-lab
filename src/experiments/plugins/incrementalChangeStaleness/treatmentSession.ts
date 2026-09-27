import type { MeasuredCommandResult } from "../../../core/runMeasuredCommand.js";
import type { AffectedNeighborhoodGraphEvidenceV1 } from "../../../evaluation/affectedNeighborhood.js";
import type { IndexFreshnessAssessmentV1 } from "../../../evaluation/indexFreshness.js";
import type { IndexSnapshotToolV1, IndexSnapshotV1 } from "../../../evaluation/indexSnapshot.js";
import type { DisposableTreatmentTargetV1, IncrementalChangeStalenessTreatmentId } from "./disposableTarget.js";
import type { IncrementalChangeStalenessMutationReceiptV1 } from "./mutationExecution.js";
import type { IncrementalChangeStalenessScenario } from "./scenarioTypes.js";
import type { IncrementalChangeStalenessSourceStateComparisonV1, IncrementalChangeStalenessSourceStateV1 } from "./sourceState.js";

/**
 * v0.6.2 Batch 3 in-memory lifecycle session schema version. This is the
 * runtime handoff contract Batch 4 consumes for treatment execution; it is
 * NOT a persisted artifact and carries full graph evidence only in memory.
 */
export const INCREMENTAL_CHANGE_STALENESS_LIFECYCLE_SESSION_SCHEMA_VERSION = "1.0.0";

/** Which phase of the controlled change an index was built in. */
export type IncrementalChangeStalenessIndexRole = "baseline" | "refreshed";

/**
 * One complete my-dev-kit index prepared for one treatment/phase: the build
 * command evidence, the IndexSnapshotV1 captured from it, and the graph
 * evidence loaded from it. Built through the existing full-index owner only.
 */
export type IncrementalChangeStalenessIndexEvidenceV1 = {
  readonly role: IncrementalChangeStalenessIndexRole;
  readonly treatmentId: IncrementalChangeStalenessTreatmentId;
  /** `pre-mutation` for every baseline index, `post-mutation` for the refreshed index. */
  readonly builtRelativeToMutation: "pre-mutation" | "post-mutation";
  readonly indexDir: string;
  readonly commandsDir: string;
  /** Resolved treatment target root the index was built from (matches the manifest projectRoot). */
  readonly targetRoot: string;
  /** Canonical base-case source roots, in their configured order. */
  readonly sourceRoots: readonly string[];
  readonly buildDurationMs: number;
  readonly buildCommand: MeasuredCommandResult;
  readonly snapshot: IndexSnapshotV1;
  readonly graph: AffectedNeighborhoodGraphEvidenceV1;
};

/**
 * Evidence describing the controlled change relative to the ORIGINAL
 * baseline index. Retained for both treatments; never replaced when a
 * refreshed index is built.
 */
export type IncrementalChangeStalenessChangeAuthorityV1 = {
  readonly baselineIndex: IncrementalChangeStalenessIndexEvidenceV1;
  /** assessIndexFreshness(baseline snapshot, mutated target); required to be complete `stale`. */
  readonly postMutationBaselineFreshness: IndexFreshnessAssessmentV1;
};

/** The index Batch 4 will actually retrieve from for this treatment. */
export type IncrementalChangeStalenessActiveRetrievalAuthorityV1 = {
  readonly role: IncrementalChangeStalenessIndexRole;
  readonly index: IncrementalChangeStalenessIndexEvidenceV1;
};

type IncrementalChangeStalenessTreatmentSessionBaseV1 = {
  readonly target: DisposableTreatmentTargetV1;
  readonly preMutationSourceState: IncrementalChangeStalenessSourceStateV1;
  readonly postMutationSourceState: IncrementalChangeStalenessSourceStateV1;
  readonly mutationReceipt: IncrementalChangeStalenessMutationReceiptV1;
  readonly changeAuthority: IncrementalChangeStalenessChangeAuthorityV1;
  /** Full index builds this treatment performed in the lifecycle. */
  readonly indexBuildCount: number;
  /** Freshness assessments this treatment performed in the lifecycle. */
  readonly freshnessAssessmentCount: number;
  readonly lifecycleStatus: "ready";
  readonly warnings: readonly string[];
};

/**
 * stale-index: exactly one (baseline) index build; the baseline index stays
 * the active retrieval authority after the mutation. `postMutationIndexBuilt`
 * is positive evidence that no reindex happened.
 */
export type IncrementalChangeStalenessStaleTreatmentSessionV1 = IncrementalChangeStalenessTreatmentSessionBaseV1 & {
  readonly treatmentId: "stale-index";
  readonly activeRetrieval: IncrementalChangeStalenessActiveRetrievalAuthorityV1 & { readonly role: "baseline" };
  readonly postMutationIndexBuilt: false;
  readonly refreshedIndex: null;
  readonly refreshedFreshness: null;
};

/**
 * full-refresh: a baseline index (change authority) plus a new complete
 * post-mutation index (active retrieval authority) written to its own
 * directory; the refreshed snapshot is required to be complete `fresh`.
 */
export type IncrementalChangeStalenessFullRefreshTreatmentSessionV1 = IncrementalChangeStalenessTreatmentSessionBaseV1 & {
  readonly treatmentId: "full-refresh";
  readonly activeRetrieval: IncrementalChangeStalenessActiveRetrievalAuthorityV1 & { readonly role: "refreshed" };
  readonly postMutationIndexBuilt: true;
  readonly refreshedIndex: IncrementalChangeStalenessIndexEvidenceV1;
  /** assessIndexFreshness(refreshed snapshot, unchanged mutated target); required to be complete `fresh`. */
  readonly refreshedFreshness: IndexFreshnessAssessmentV1;
};

export type IncrementalChangeStalenessTreatmentSessionV1 =
  | IncrementalChangeStalenessStaleTreatmentSessionV1
  | IncrementalChangeStalenessFullRefreshTreatmentSessionV1;

export type IncrementalChangeStalenessBaseCaseIdentityV1 = {
  readonly caseId: string;
  readonly benchmarkProjectId: string;
  /** Repository-relative canonical benchmark project root (from the project profile). */
  readonly canonicalProjectRootRelative: string;
  readonly canonicalProjectRoot: string;
  readonly sourceRoots: readonly string[];
};

/**
 * One matched, lifecycle-ready scenario: both treatments prepared from the
 * same frozen scenario and the same canonical base case. Batch 4 consumes
 * this to run treatment retrieval; Batch 3 never retrieves.
 */
export type IncrementalChangeStalenessScenarioSessionV1 = {
  readonly schemaVersion: typeof INCREMENTAL_CHANGE_STALENESS_LIFECYCLE_SESSION_SCHEMA_VERSION;
  readonly scenarioId: string;
  readonly scenario: IncrementalChangeStalenessScenario;
  readonly baseCase: IncrementalChangeStalenessBaseCaseIdentityV1;
  readonly runOwnedRoot: string;
  readonly kitCommand: string;
  /** The single my-dev-kit tool identity shared by all three indexes of this scenario. */
  readonly toolIdentity: IndexSnapshotToolV1;
  /** Scenario-declared controlled paths, POSIX-normalized and sorted. */
  readonly controlledChangedPaths: readonly string[];
  readonly preMutationEquivalence: IncrementalChangeStalenessSourceStateComparisonV1;
  readonly postMutationEquivalence: IncrementalChangeStalenessSourceStateComparisonV1;
  readonly treatments: {
    readonly "stale-index": IncrementalChangeStalenessStaleTreatmentSessionV1;
    readonly "full-refresh": IncrementalChangeStalenessFullRefreshTreatmentSessionV1;
  };
  /** Ordered lifecycle stages actually reached; deterministic for a given scenario. */
  readonly lifecycleEvents: readonly string[];
  readonly status: "ready";
};

export type IncrementalChangeStalenessLifecycleFailureCode =
  | "base-case-unresolved"
  | "treatment-target-creation-failed"
  | "pre-mutation-not-equivalent"
  | "index-directory-collision"
  | "baseline-index-build-failed"
  | "baseline-snapshot-unavailable"
  | "baseline-graph-unavailable"
  | "index-target-mismatch"
  | "source-root-mismatch"
  | "tool-identity-unavailable"
  | "tool-identity-mismatch"
  | "mutation-failed"
  | "post-mutation-not-equivalent"
  | "baseline-freshness-not-stale"
  | "baseline-changed-paths-mismatch"
  | "treatment-changed-paths-conflict"
  | "refresh-index-build-failed"
  | "refreshed-snapshot-unavailable"
  | "refreshed-graph-unavailable"
  | "refreshed-freshness-not-fresh"
  | "active-index-target-mismatch"
  | "lifecycle-error";

export type IncrementalChangeStalenessLifecycleFailureV1 = {
  readonly code: IncrementalChangeStalenessLifecycleFailureCode;
  readonly message: string;
  /** The treatment the failure is attributable to; null for scenario-level failures. */
  readonly treatmentId: IncrementalChangeStalenessTreatmentId | null;
};

export type IncrementalChangeStalenessLifecycleResultV1 =
  | { readonly status: "ready"; readonly session: IncrementalChangeStalenessScenarioSessionV1 }
  | {
      readonly status: "failed";
      readonly scenarioId: string;
      readonly failure: IncrementalChangeStalenessLifecycleFailureV1;
      readonly lifecycleEvents: readonly string[];
      readonly indexBuildCounts: Readonly<Record<IncrementalChangeStalenessTreatmentId, number>>;
    };
