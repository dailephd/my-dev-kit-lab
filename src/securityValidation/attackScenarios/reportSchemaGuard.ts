// ---------------------------------------------------------------------------
// v0.2.2 Batch 6 — report-poisoning JSON schema guard.
//
// Batch 3/4 scenarios (configInjectionScenario, reportPoisoningScenario)
// each hardcoded their own "expected top-level JSON keys" allowlist to
// detect payload-created structural injection. That approach broke twice
// (Batch 4, Batch 5) purely because a *legitimate* additive top-level field
// was introduced elsewhere and nobody remembered to update both copies of
// the list.
//
// This module replaces the hardcoded-allowlist approach with a baseline
// comparison: render the same report shape twice — once with an inert
// placeholder string in the content fields a payload would occupy, once
// with the actual payload — and compare the top-level key *sets* of the
// parsed JSON. A payload can only produce an "extra" key if it actually broke
// out of its string context and created new JSON structure; legitimate
// schema evolution (a new field added to renderJsonReport's output) shows up
// identically in both renders and is never flagged. This keeps the
// injection check meaningful without hardcoding field names anywhere.
// ---------------------------------------------------------------------------

// Inert content used for the "clean" baseline render — deliberately boring,
// never matches any payload shape.
export const SAFE_BASELINE_CONTENT = "SAFE_BASELINE_CONTENT_NOT_A_PAYLOAD";

export type JsonStructuralInjectionCheck = {
  parseable: boolean;
  // Top-level keys present in the poisoned render but absent from the clean
  // baseline render — non-empty means the payload created new JSON
  // structure, not just data.
  injectedTopLevelKeys: string[];
};

// Compares the top-level key sets of two already-rendered JSON strings
// (baseline vs. candidate). Returns parseable:false (and no injected keys)
// if either fails to parse — a parse failure is reported separately by
// callers as "jsonCorrupted", not conflated with structural injection.
export function detectJsonStructuralInjection(
  baselineJson: string,
  candidateJson: string
): JsonStructuralInjectionCheck {
  let baseline: Record<string, unknown>;
  let candidate: Record<string, unknown>;
  try {
    baseline = JSON.parse(baselineJson) as Record<string, unknown>;
    candidate = JSON.parse(candidateJson) as Record<string, unknown>;
  } catch {
    return { parseable: false, injectedTopLevelKeys: [] };
  }
  const baselineKeys = new Set(Object.keys(baseline));
  const injectedTopLevelKeys = Object.keys(candidate).filter((k) => !baselineKeys.has(k));
  return { parseable: true, injectedTopLevelKeys };
}
