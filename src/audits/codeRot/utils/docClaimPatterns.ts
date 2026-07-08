// ---------------------------------------------------------------------------
// v0.3.0 Batch 3 — deterministic doc-claim regex patterns.
//
// Shared by docsCodeMismatchDetector.ts and packageReleaseRotDetector.ts.
// Every pattern here matches a narrow, explicit phrase rather than inferring
// meaning from prose -- per Batch 3 scope, no LLM and no broad semantic
// interpretation. Ambiguous or ISF-style hedged wording ("not yet
// published", "planned for a later version") deliberately does not match
// these "unhedged claim" patterns.
// ---------------------------------------------------------------------------

// An unhedged claim that publication/release/tagging has already happened.
// A nearby hedge word ("not yet", "has not", "no") should be checked by the
// caller before treating a match as a real claim -- see
// isHedgedNearby() below.
export const PUBLISHED_OR_RELEASED_CLAIM_PATTERN =
  /\b(is now published|has been published to npm|npm publish (?:has |)(?:completed|succeeded)|published to npm|github release (?:has been created|exists|created)|release has been created|has been tagged|git tag (?:has been created|created))\b/i;

// Common hedge words that, if present in the same line/window, indicate the
// author is explicitly describing something as NOT having happened yet --
// used to suppress a false match on "is now published" when the actual
// sentence is "... has not been published to npm" etc.
const HEDGE_PATTERN = /\b(not yet|has not|have not|hasn't|haven't|no(?:t)?\b.{0,20}\byet\b|never)\b/i;

export function isHedgedNearby(windowText: string): boolean {
  return HEDGE_PATTERN.test(windowText);
}

// Matches "current package is v1.2.3" / "current version is `1.2.3`" /
// "package is version 1.2.3" style phrasing used across this project's own
// docs (README.md, docs/CURRENT_STATE.md, docs/PROJECT_OVERVIEW.md).
export const CURRENT_PACKAGE_VERSION_PATTERNS: readonly RegExp[] = [
  /current package is `?v?(\d+\.\d+\.\d+)`?/i,
  /current package (?:version )?(?:is|remains) `?v?(\d+\.\d+\.\d+)`?/i,
  /package is version `?(\d+\.\d+\.\d+)`?/i,
];

// A scoped (non-full) --checks run being described as if it were a complete
// release gate. Matches the bare phrase; callers must additionally check
// isNegatedNearby() before treating a match as a real (mistaken) claim --
// this project's own docs correctly say things like "rather than described
// as a full release gate" and "it is not the same as a full release gate",
// which contain the phrase precisely BECAUSE they are correctly denying it.
export const FULL_RELEASE_GATE_FOR_SCOPED_CHECKS_PATTERN =
  /scoped[^.\n]{0,80}(full release gate|full audit coverage|complete release gate)/i;

// Negation cues that, appearing in the same sentence as a
// FULL_RELEASE_GATE_FOR_SCOPED_CHECKS_PATTERN match, indicate the sentence
// is correctly denying the claim rather than making it.
const NEGATION_PATTERN = /\b(not|rather than|isn't|is not|n't)\b/i;

export function isNegatedNearby(windowText: string): boolean {
  return NEGATION_PATTERN.test(windowText);
}

// Feature-implementation claim phrasing: "<subject> is implemented" /
// "<subject> is current" vs "<subject> is planned" / "<subject> is future".
//
// Deliberately narrow (subject-anchored, not a freestanding scan for
// "current"/"planned" anywhere in a line) -- this project's own docs
// legitimately use both words in the same sentence when correctly
// describing a roadmap (e.g. "separates the implemented baseline from
// planned work"), and a broad co-occurrence scan would flag that as
// ambiguous noise. Anchoring both patterns to the same feature subject
// keeps false positives near zero: a real ambiguous match requires the
// SAME subject to be described as both implemented and planned.
export function currentClaimPatternFor(subjectPattern: string): RegExp {
  return new RegExp(`${subjectPattern}[^.\\n]{0,40}\\b(is implemented|is current|is now implemented)\\b`, "i");
}

export function plannedClaimPatternFor(subjectPattern: string): RegExp {
  return new RegExp(
    `${subjectPattern}[^.\\n]{0,40}\\b(is planned|is future|is not yet implemented|not implemented)\\b`,
    "i"
  );
}
