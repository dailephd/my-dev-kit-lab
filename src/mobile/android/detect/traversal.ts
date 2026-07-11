import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { relativeWithinRoot } from "../../../core/pathSafety.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 2 — bounded, deterministic filesystem traversal for Android
// detection.
//
// A dedicated walker (rather than reusing src/core/fileGlobs.ts) because
// Android detection needs a wider and different exclusion set (.gradle, out,
// reports, lab-output, .my-dev-kit, IDE caches) than the generic glob helper
// currently declares, and widening that shared helper's exclusion list would
// change behavior for every other consumer of collectFilesForGlobs. Reuses
// src/core/pathSafety.ts's relativeWithinRoot for containment/normalization
// so target-root escape guarantees stay centralized.
// ---------------------------------------------------------------------------

const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  ".gradle",
  "build",
  "out",
  "dist",
  "node_modules",
  "coverage",
  "reports",
  "lab-output",
  ".my-dev-kit",
  ".idea",
  ".vscode",
  ".vs",
]);

export type TraversalResult = {
  relativeFilePaths: string[];
  skippedSymlinks: string[];
};

// Walks `root`, returning sorted POSIX-style relative file paths. Directory
// symlinks are never followed (recorded in `skippedSymlinks` instead), and
// traversal never leaves `root` (relativeWithinRoot throws on escape, which
// cannot happen here since paths are built from readdir entries under root).
export function walkAndroidCandidateFiles(root: string): TraversalResult {
  const resolvedRoot = path.resolve(root);
  const relativeFilePaths: string[] = [];
  const skippedSymlinks: string[] = [];

  const visit = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        let stat;
        try {
          stat = lstatSync(fullPath);
        } catch {
          continue;
        }
        if (stat.isSymbolicLink()) {
          skippedSymlinks.push(relativeWithinRoot(resolvedRoot, fullPath));
          continue;
        }
      }

      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) {
          continue;
        }
        visit(fullPath);
        continue;
      }

      if (entry.isFile()) {
        relativeFilePaths.push(relativeWithinRoot(resolvedRoot, fullPath));
      }
    }
  };

  visit(resolvedRoot);

  return {
    relativeFilePaths: relativeFilePaths.sort((a, b) => a.localeCompare(b)),
    skippedSymlinks: skippedSymlinks.sort((a, b) => a.localeCompare(b)),
  };
}
