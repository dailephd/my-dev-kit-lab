import { relativeWithinRoot } from "../../../core/pathSafety.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 1 — deterministic source-location normalization shared by
// later v0.4.1 checks.
//
// Reuses relativeWithinRoot (src/core/pathSafety.ts) for target containment
// and stable forward-slash path separators rather than a second path-safety
// implementation. relativeWithinRoot throws if the resolved path escapes
// root — callers of buildAndroidSourceLocation must supply an already
// target-contained absolute path (as manifest parsing already does today via
// the same helper).
// ---------------------------------------------------------------------------

export type AndroidSourceLocation = {
  path: string;
  line?: number;
  column?: number;
  startLine?: number;
  endLine?: number;
};

// `absolutePath` must already be an absolute, filesystem-resolved path (the
// same convention relativeWithinRoot's existing callers use, e.g. the
// manifest reader) — a relative path here would be resolved against the
// process cwd, not root, and silently produce the wrong location.
export function buildAndroidSourceLocation(
  root: string,
  absolutePath: string,
  position?: { line?: number; column?: number; startLine?: number; endLine?: number }
): AndroidSourceLocation {
  const relativePath = relativeWithinRoot(root, absolutePath);
  return {
    path: relativePath,
    line: position?.line,
    column: position?.column,
    startLine: position?.startLine,
    endLine: position?.endLine,
  };
}
