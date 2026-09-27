// v0.6.2 Batch 4 -- pure, deterministic comparison/classification owner.
//
// This module owns exactly:
//  - CorrectnessRelationV1;
//  - RequiredFileEvidenceStatusV1 / RequiredFileEvidenceV1;
//  - RequiredFileEvidenceRelationV1;
//  - StaleRiskClassificationV1;
//  - the pure functions that compute them.
//
// Every function here is a pure, side-effect-free transform over already
// collected evidence. No retrieval, no filesystem access, no my-dev-kit
// invocation, and no numeric risk score: see the frozen batch prompt
// sections 22-35 for the exact rules this file implements.

/** Comparable numeric correctness evidence for one treatment, or null when unavailable. */
export type CorrectnessComparableV1 = { available: true; score: number } | { available: false };

export type CorrectnessRelationV1 = "stale-worse" | "same" | "stale-better" | "unknown";

/** Section 23: exact correctness comparison rules. */
export function compareCorrectness(stale: CorrectnessComparableV1, fullRefresh: CorrectnessComparableV1): CorrectnessRelationV1 {
  if (!stale.available || !fullRefresh.available) {
    return "unknown";
  }
  if (stale.score < fullRefresh.score) return "stale-worse";
  if (stale.score > fullRefresh.score) return "stale-better";
  return "same";
}

export type RequiredFileEvidenceStatusV1 = "present" | "missing" | "unknown";

/**
 * Section 28: bounded per-treatment required-file evidence record. Arrays are normalized and
 * deterministically sorted by the caller before this record is constructed.
 */
export type RequiredFileEvidenceV1 = {
  status: RequiredFileEvidenceStatusV1;
  requiredFiles: string[];
  observedFiles: string[];
  missingFiles: string[];
  reason: string | null;
};

/** Repository-standard forward-slash path normalization, matching existing lifecycle policy. */
export function normalizeRequiredFilePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeRequiredFilePath))].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Section 27: builds one treatment's required-file evidence.
 *
 * - `observedFilesComplete: false` means the treatment's actual-files-read set could not be
 *   established completely (retrieval failed/partial or the contract could not prove completeness);
 *   the result is always `unknown` in that case, regardless of `observedFiles` contents.
 * - Otherwise: every normalized required file present in `observedFiles` is `present`; any
 *   absence is `missing`.
 */
export function buildRequiredFileEvidence(args: {
  requiredFiles: readonly string[];
  observedFiles: readonly string[];
  observedFilesComplete: boolean;
  unknownReason?: string;
}): RequiredFileEvidenceV1 {
  const requiredFiles = sortedUnique(args.requiredFiles);
  const observedFiles = sortedUnique(args.observedFiles);
  if (!args.observedFilesComplete) {
    return {
      status: "unknown",
      requiredFiles,
      observedFiles,
      missingFiles: [],
      reason: args.unknownReason ?? "Retrieval evidence did not establish a complete actual-files-read set."
    };
  }
  const observedSet = new Set(observedFiles);
  const missingFiles = requiredFiles.filter((file) => !observedSet.has(file));
  return {
    status: missingFiles.length === 0 ? "present" : "missing",
    requiredFiles,
    observedFiles,
    missingFiles,
    reason: null
  };
}

export type RequiredFileEvidenceRelationV1 = "stale-worse" | "same" | "stale-better" | "unknown";

/** Section 30: exact required-file comparison rules. */
export function compareRequiredFileEvidence(
  stale: Pick<RequiredFileEvidenceV1, "status">,
  fullRefresh: Pick<RequiredFileEvidenceV1, "status">
): RequiredFileEvidenceRelationV1 {
  if (stale.status === "unknown" || fullRefresh.status === "unknown") {
    return "unknown";
  }
  if (stale.status === "missing" && fullRefresh.status === "present") return "stale-worse";
  if (stale.status === "present" && fullRefresh.status === "missing") return "stale-better";
  return "same";
}

export type StaleRiskClassificationV1 = "observed-stale-regression" | "no-observed-stale-regression" | "inconclusive";

export type StaleRiskReasonCode =
  | "stale-correctness-lower"
  | "stale-missing-required-file"
  | "correctness-unavailable"
  | "required-file-evidence-unavailable"
  | "no-stale-specific-difference-observed";

export type StaleRiskClassificationResultV1 = {
  staleRiskClassification: StaleRiskClassificationV1;
  reasonCodes: StaleRiskReasonCode[];
};

/**
 * Sections 31-35: the frozen precedence algorithm. Correctness and required-file evidence are the
 * only two inputs; affected-neighborhood evidence and reindexRecommendation are never inputs here.
 */
export function classifyStaleRisk(
  correctnessRelation: CorrectnessRelationV1,
  requiredFileEvidenceRelation: RequiredFileEvidenceRelationV1
): StaleRiskClassificationResultV1 {
  const reasonCodes: StaleRiskReasonCode[] = [];

  // RULE 1 -- observed regression wins even if the other dimension is unknown.
  if (correctnessRelation === "stale-worse" || requiredFileEvidenceRelation === "stale-worse") {
    if (correctnessRelation === "stale-worse") reasonCodes.push("stale-correctness-lower");
    if (requiredFileEvidenceRelation === "stale-worse") reasonCodes.push("stale-missing-required-file");
    return { staleRiskClassification: "observed-stale-regression", reasonCodes: dedupe(reasonCodes) };
  }

  // RULE 2 -- inconclusive.
  if (correctnessRelation === "unknown" || requiredFileEvidenceRelation === "unknown") {
    if (correctnessRelation === "unknown") reasonCodes.push("correctness-unavailable");
    if (requiredFileEvidenceRelation === "unknown") reasonCodes.push("required-file-evidence-unavailable");
    return { staleRiskClassification: "inconclusive", reasonCodes: dedupe(reasonCodes) };
  }

  // RULE 3 -- no observed regression.
  return { staleRiskClassification: "no-observed-stale-regression", reasonCodes: ["no-stale-specific-difference-observed"] };
}

function dedupe(values: readonly StaleRiskReasonCode[]): StaleRiskReasonCode[] {
  return [...new Set(values)];
}
