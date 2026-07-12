import type { CandidateEvidence } from "./candidateEvidence.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 1 — deterministic ordering for candidate evidence produced by
// later v0.4.1 detectors. Mirrors the existing localeCompare-by-id pattern
// already used for finding/module ordering (e.g.
// src/mobile/android/validate/validateAndroidTarget.ts's
// `.sort((a, b) => a.id.localeCompare(b.id))`, detect/detectAndroidProject.ts)
// rather than introducing a different comparator convention.
//
// Ordering key precedence: category, then rule id, then module path, then
// source path, then line, then column, then fingerprint (final tiebreaker —
// guarantees a total order even for two otherwise-identical locations).
// Must never depend on filesystem enumeration order or object insertion
// order.
// ---------------------------------------------------------------------------

function compareOptionalNumber(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a - b;
}

function compareOptionalString(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a.localeCompare(b);
}

export function compareCandidateEvidence(a: CandidateEvidence, b: CandidateEvidence): number {
  return (
    a.category.localeCompare(b.category) ||
    a.ruleId.localeCompare(b.ruleId) ||
    compareOptionalString(a.modulePath, b.modulePath) ||
    a.location.path.localeCompare(b.location.path) ||
    compareOptionalNumber(a.location.line, b.location.line) ||
    compareOptionalNumber(a.location.column, b.location.column) ||
    a.fingerprint.localeCompare(b.fingerprint)
  );
}

export function sortCandidateEvidence(evidence: readonly CandidateEvidence[]): CandidateEvidence[] {
  return [...evidence].sort(compareCandidateEvidence);
}
