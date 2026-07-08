import path from "node:path";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 4 — shared file-path pattern helpers.
//
// Small, deterministic path helpers reused by the Batch 4 candidate-based
// detectors (duplicate implementation, dead code, architecture drift).
// Deliberately forward-slash only -- inventory relativePath values are
// already forward-slash normalized by projectInventory.ts.
// ---------------------------------------------------------------------------

// Returns the first path segment (e.g. "src/audits/foo.ts" -> "src") or null
// for a root-level file with no directory segment.
export function firstPathSegment(relativePath: string): string | null {
  const idx = relativePath.indexOf("/");
  return idx === -1 ? null : relativePath.slice(0, idx);
}

// Returns the first two path segments joined (e.g. "src/audits/foo.ts" ->
// "src/audits"), or the single segment if there is no second one.
export function firstTwoPathSegments(relativePath: string): string {
  const parts = relativePath.split("/");
  return parts.length <= 2 ? (parts[0] ?? relativePath) : `${parts[0]}/${parts[1]}`;
}

export function baseNameNoExt(relativePath: string): string {
  const basename = path.basename(relativePath);
  const ext = path.extname(basename);
  return ext ? basename.slice(0, -ext.length) : basename;
}

// Common, generic infra-ish basenames that are expected to repeat across
// unrelated directories legitimately (barrels, shared type files, etc.) --
// excluded from the "same basename across unrelated roots" duplicate-
// candidate heuristic to keep false positives near zero.
export const GENERIC_INFRA_BASENAMES = new Set([
  "index",
  "types",
  "type",
  "config",
  "utils",
  "util",
  "helpers",
  "helper",
  "constants",
  "constant",
  "setup",
  "fixtures",
  "fixture",
  "errors",
  "error",
]);
