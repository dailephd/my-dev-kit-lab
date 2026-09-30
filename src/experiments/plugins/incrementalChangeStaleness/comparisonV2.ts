import {
  compareCorrectness,
  compareRequiredFileEvidence,
  type CorrectnessComparableV1,
  type CorrectnessRelationV1,
  type RequiredFileEvidenceRelationV1,
  type RequiredFileEvidenceV1
} from "./comparison.js";
import type { PartialRefreshRealization } from "./lifecyclePolicyV2.js";

// v0.6.3 Batch 3 -- neutral candidate-vs-full-refresh comparison primitives. Pure and deterministic.
//
// The stale-index vs full-refresh comparison keeps the historical v0.6.2 semantics in comparison.ts.
// The relations here reuse those exact rules under neutral "candidate" terminology; full-refresh is the
// comparison REFERENCE, never a declared best treatment. Nothing here ranks, scores, or recommends.

export type CandidateCorrectnessRelationV2 = "candidate-worse" | "same" | "candidate-better" | "unknown";
export type CandidateRequiredFileRelationV2 = "candidate-worse" | "same" | "candidate-better" | "unknown";

function neutral<T extends CorrectnessRelationV1 | RequiredFileEvidenceRelationV1>(relation: T): CandidateCorrectnessRelationV2 {
  if (relation === "stale-worse") return "candidate-worse";
  if (relation === "stale-better") return "candidate-better";
  return relation;
}

/** Same rules as the v0.6.2 correctness comparison, candidate vs reference. */
export function compareCandidateCorrectness(candidate: CorrectnessComparableV1, reference: CorrectnessComparableV1): CandidateCorrectnessRelationV2 {
  return neutral(compareCorrectness(candidate, reference));
}

/** Same rules as the v0.6.2 required-file comparison, candidate vs reference. */
export function compareCandidateRequiredFileEvidence(
  candidate: Pick<RequiredFileEvidenceV1, "status">,
  reference: Pick<RequiredFileEvidenceV1, "status">
): CandidateRequiredFileRelationV2 {
  return neutral(compareRequiredFileEvidence(candidate, reference));
}

/** Scoped to the frozen evidence dimensions only; not a safety verdict, winner, recommendation, or quality score. */
export type PartialRefreshReferenceClassificationV2 =
  | "observed-regression-relative-to-full"
  | "no-observed-regression-relative-to-full"
  | "inconclusive"
  | "not-comparable-as-partial-refresh";

export type PartialRefreshReferenceReasonCodeV2 =
  | "candidate-correctness-lower"
  | "candidate-missing-required-file"
  | "correctness-unavailable"
  | "required-file-evidence-unavailable"
  | "no-reference-regression-observed"
  | "candidate-fell-back-to-full";

export type PartialRefreshReferenceClassificationResultV2 = {
  classification: PartialRefreshReferenceClassificationV2;
  reasonCodes: PartialRefreshReferenceReasonCodeV2[];
};

/**
 * Frozen precedence. Rule 0 (realization gate) first: a full fallback is never evidence about
 * partial-refresh performance. Then observed regression (either dimension worse), then inconclusive
 * (a dimension unknown), then no observed regression (including candidate-better, which is not a
 * winner claim). affected-neighborhood evidence and reindexRecommendation are never inputs.
 */
export function classifyPartialRefreshAgainstFull(args: {
  realization: PartialRefreshRealization;
  correctnessRelation: CandidateCorrectnessRelationV2;
  requiredFileEvidenceRelation: CandidateRequiredFileRelationV2;
}): PartialRefreshReferenceClassificationResultV2 {
  const { realization, correctnessRelation, requiredFileEvidenceRelation } = args;

  // RULE 0 -- realization gate.
  if (realization === "FALLBACK_FULL") {
    return { classification: "not-comparable-as-partial-refresh", reasonCodes: ["candidate-fell-back-to-full"] };
  }

  // RULE 1 -- observed regression wins even if the other dimension is unknown.
  if (correctnessRelation === "candidate-worse" || requiredFileEvidenceRelation === "candidate-worse") {
    const reasonCodes: PartialRefreshReferenceReasonCodeV2[] = [];
    if (correctnessRelation === "candidate-worse") reasonCodes.push("candidate-correctness-lower");
    if (requiredFileEvidenceRelation === "candidate-worse") reasonCodes.push("candidate-missing-required-file");
    return { classification: "observed-regression-relative-to-full", reasonCodes };
  }

  // RULE 2 -- inconclusive.
  if (correctnessRelation === "unknown" || requiredFileEvidenceRelation === "unknown") {
    const reasonCodes: PartialRefreshReferenceReasonCodeV2[] = [];
    if (correctnessRelation === "unknown") reasonCodes.push("correctness-unavailable");
    if (requiredFileEvidenceRelation === "unknown") reasonCodes.push("required-file-evidence-unavailable");
    return { classification: "inconclusive", reasonCodes };
  }

  // RULE 3 -- no observed regression.
  return { classification: "no-observed-regression-relative-to-full", reasonCodes: ["no-reference-regression-observed"] };
}
