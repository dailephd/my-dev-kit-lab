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

// v0.3.1 Batch 4 -- common, generic exported-declaration names that are
// expected to repeat across unrelated files legitimately (CLI entrypoints,
// handler/lifecycle conventions, etc.) -- excluded from the source-facts
// duplicate-declaration-candidate heuristic in duplicateImplementationDetector.ts
// to keep false positives near zero. v0.3.2 Batch 2 adds Python lifecycle/
// dunder names ("teardown", "__init__", "__call__") for the same reason,
// reused by both duplicateImplementationDetector.ts and
// deadCodeCandidateDetector.ts's new Python-aware checks.
export const GENERIC_DECLARATION_NAMES = new Set([
  "run",
  "main",
  "init",
  "initialize",
  "setup",
  "teardown",
  "handler",
  "handle",
  "execute",
  "process",
  "validate",
  "parse",
  "format",
  "render",
  "build",
  "create",
  "start",
  "stop",
  "load",
  "save",
  "update",
  "remove",
  "apply",
  "get",
  "set",
  "default",
  "__init__",
  "__call__",
]);

// v0.3.2 Batch 2 -- true for a generic/lifecycle declaration name (see
// GENERIC_DECLARATION_NAMES above) or a pytest-style `test_*` name. Shared by
// the Python-aware dead-code and duplicate-implementation checks so a
// `test_*` helper/fixture function is never flagged as a candidate dead-code
// symbol or a duplicate-implementation candidate merely for repeating across
// unrelated test modules, a legitimate and extremely common pytest
// convention. Comparison is case-insensitive; callers pass the already-
// lowercased name where convenient.
export function isGenericOrTestPrefixedDeclarationName(name: string): boolean {
  const lower = name.toLowerCase();
  return GENERIC_DECLARATION_NAMES.has(lower) || lower.startsWith("test_");
}
