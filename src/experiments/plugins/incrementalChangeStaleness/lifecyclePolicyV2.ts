import type { MyDevKitIndexBuildResult, MyDevKitRefreshScope } from "../../../evaluation/types.js";
import type { IncrementalChangeStalenessV2TreatmentId } from "./disposableTarget.js";
import { lifecycleFailure } from "./lifecyclePolicy.js";
import type { IncrementalChangeStalenessLifecycleFailureV1 } from "./treatmentSession.js";

/** Pure v0.6.3 four-treatment lifecycle policy; inspects already-produced evidence only. */

/**
 * v0.6.3: every treatment baseline is bootstrapped with `--incremental --refresh-scope changed-files`
 * against a brand-new index directory. Upstream must truthfully report the expected bootstrap full
 * fallback (`cache-missing`); this is bootstrap evidence, never an experimental partial-refresh fallback.
 */
export function evaluateBaselineBootstrapEvidence(
  build: MyDevKitIndexBuildResult,
  treatmentId: IncrementalChangeStalenessV2TreatmentId
): IncrementalChangeStalenessLifecycleFailureV1 | null {
  const evidence = build.incrementalRefresh;
  const label = `${treatmentId} baseline bootstrap`;
  if (build.mode.kind !== "incremental" || build.mode.refreshScope !== "changed-files") {
    return lifecycleFailure("baseline-bootstrap-contract-mismatch", `${label} was not requested as incremental changed-files.`, treatmentId);
  }
  if (!evidence) {
    return lifecycleFailure("baseline-bootstrap-contract-mismatch", `${label} returned no incrementalRefresh evidence.`, treatmentId);
  }
  if (
    evidence.requestedScope !== "changed-files" ||
    evidence.appliedScope !== "full" ||
    evidence.selectionStatus !== "fallback-full" ||
    evidence.fallbackReason !== "cache-missing"
  ) {
    return lifecycleFailure(
      "baseline-bootstrap-contract-mismatch",
      `${label} expected requested=changed-files applied=full status=fallback-full reason=cache-missing but observed requested=${evidence.requestedScope} applied=${evidence.appliedScope} status=${evidence.selectionStatus} reason=${evidence.fallbackReason}.`,
      treatmentId
    );
  }
  return null;
}

/** Runtime realization of a requested post-mutation partial refresh; carries no winner/safety meaning. */
export type PartialRefreshRealization = "APPLIED_PARTIAL" | "FALLBACK_FULL";

/**
 * v0.6.3: classifies a post-mutation partial-refresh build. A truthful `fallback-full` is a valid
 * realization (FALLBACK_FULL), never collapsed to APPLIED_PARTIAL. `not-needed` after an already
 * proven controlled mutation contradicts that mutation and fails the lifecycle. Missing or invalid
 * evidence fails too.
 */
export function evaluatePartialRefreshRealization(
  build: MyDevKitIndexBuildResult,
  requestedScope: MyDevKitRefreshScope,
  treatmentId: IncrementalChangeStalenessV2TreatmentId
): { failure: IncrementalChangeStalenessLifecycleFailureV1 | null; realization: PartialRefreshRealization | null } {
  const evidence = build.incrementalRefresh;
  if (build.mode.kind !== "incremental" || build.mode.refreshScope !== requestedScope || !evidence || evidence.requestedScope !== requestedScope) {
    return {
      failure: lifecycleFailure("refresh-evidence-invalid", `${treatmentId} refresh did not carry valid ${requestedScope} incrementalRefresh evidence.`, treatmentId),
      realization: null
    };
  }
  if (evidence.selectionStatus === "not-needed" || evidence.appliedScope === "none") {
    return {
      failure: lifecycleFailure(
        "refresh-not-needed-after-mutation",
        `${treatmentId} refresh reported not-needed (applied=${evidence.appliedScope}) although the controlled mutation was already proven.`,
        treatmentId
      ),
      realization: null
    };
  }
  if (evidence.selectionStatus === "applied" && evidence.appliedScope === requestedScope) {
    return { failure: null, realization: "APPLIED_PARTIAL" };
  }
  if (evidence.selectionStatus === "fallback-full" && evidence.appliedScope === "full") {
    return { failure: null, realization: "FALLBACK_FULL" };
  }
  return {
    failure: lifecycleFailure(
      "refresh-evidence-invalid",
      `${treatmentId} refresh reported an unclassifiable outcome (status=${evidence.selectionStatus}, applied=${evidence.appliedScope}).`,
      treatmentId
    ),
    realization: null
  };
}

/** v0.6.3 per-scenario counts: 7 index invocations and 7 freshness assessments. */
export const INCREMENTAL_CHANGE_STALENESS_V2_EXPECTED_INDEX_INVOCATIONS = {
  "stale-index": 1,
  "changed-files-refresh": 2,
  "affected-neighborhood-refresh": 2,
  "full-refresh": 2
} as const satisfies Record<IncrementalChangeStalenessV2TreatmentId, number>;

export const INCREMENTAL_CHANGE_STALENESS_V2_EXPECTED_FRESHNESS_ASSESSMENTS = {
  "stale-index": 1,
  "changed-files-refresh": 2,
  "affected-neighborhood-refresh": 2,
  "full-refresh": 2
} as const satisfies Record<IncrementalChangeStalenessV2TreatmentId, number>;

export function evaluateV2InvocationCounts(
  indexInvocationCounts: Readonly<Record<IncrementalChangeStalenessV2TreatmentId, number>>,
  freshnessAssessmentCounts: Readonly<Record<IncrementalChangeStalenessV2TreatmentId, number>>
): IncrementalChangeStalenessLifecycleFailureV1 | null {
  for (const treatmentId of Object.keys(INCREMENTAL_CHANGE_STALENESS_V2_EXPECTED_INDEX_INVOCATIONS) as IncrementalChangeStalenessV2TreatmentId[]) {
    const expectedIndex = INCREMENTAL_CHANGE_STALENESS_V2_EXPECTED_INDEX_INVOCATIONS[treatmentId];
    const expectedFreshness = INCREMENTAL_CHANGE_STALENESS_V2_EXPECTED_FRESHNESS_ASSESSMENTS[treatmentId];
    if (indexInvocationCounts[treatmentId] !== expectedIndex || freshnessAssessmentCounts[treatmentId] !== expectedFreshness) {
      return lifecycleFailure(
        "invocation-count-mismatch",
        `${treatmentId} performed ${indexInvocationCounts[treatmentId]} index invocation(s) and ${freshnessAssessmentCounts[treatmentId]} freshness assessment(s); expected ${expectedIndex} and ${expectedFreshness}.`,
        treatmentId
      );
    }
  }
  return null;
}
