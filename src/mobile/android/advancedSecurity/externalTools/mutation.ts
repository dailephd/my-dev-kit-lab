import { captureTargetSnapshot, diffTargetSnapshots, type TargetSnapshot } from "../../../../securityValidation/attackScenarios/targetSnapshot.js";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — target mutation evidence for external-tool execution.
//
// Reuses the existing generic snapshot/diff primitives
// (src/securityValidation/attackScenarios/targetSnapshot.ts) exactly as
// src/mobile/android/gradle/validate/targetMutation.ts does — no second
// target-status model. Semgrep, OSV, and Dependency-Check are expected to
// produce zero target mutation (all their output goes to the external
// artifact root); Android Lint reuses the existing Android-generated-path
// classifier since it runs through the existing Gradle lint-debug operation.
// ---------------------------------------------------------------------------

export { captureTargetSnapshot };
export type { TargetSnapshot };

export type ExternalToolMutationReport = {
  comparable: boolean;
  reason?: string;
  expectedGeneratedChanges: string[];
  unexpectedChanges: string[];
};

export function buildExternalToolMutationReport(
  before: TargetSnapshot,
  after: TargetSnapshot,
  isExpectedGeneratedPath: (entryPath: string) => boolean = () => false
): ExternalToolMutationReport {
  const diff = diffTargetSnapshots(before, after);
  if (!diff.comparable) {
    return { comparable: false, reason: diff.reason, expectedGeneratedChanges: [], unexpectedChanges: [] };
  }

  const expectedGeneratedChanges: string[] = [];
  const unexpectedChanges: string[] = [];
  for (const entry of diff.newEntries) {
    const isUntrackedOrAdded = entry.code === "??" || entry.code.includes("A");
    if (isUntrackedOrAdded && isExpectedGeneratedPath(entry.path)) {
      expectedGeneratedChanges.push(entry.path);
    } else {
      unexpectedChanges.push(entry.path);
    }
  }

  return {
    comparable: true,
    expectedGeneratedChanges: expectedGeneratedChanges.sort((a, b) => a.localeCompare(b)),
    unexpectedChanges: unexpectedChanges.sort((a, b) => a.localeCompare(b)),
  };
}

// Bounded, best-effort discovery of files under `dir` that did not exist (or
// had a different mtime) before the run — used by the Android Lint adapter
// to find fresh XML/SARIF reports without trusting a stale pre-existing
// report. Never follows symlinks outside `dir`, never recurses unbounded.
export function findFreshFiles(dir: string, extensions: readonly string[], sinceEpochMs: number, maxDepth = 6): string[] {
  const results: string[] = [];
  function walk(current: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.mtimeMs >= sinceEpochMs) results.push(full);
    }
  }
  walk(dir, 0);
  return results.sort((a, b) => a.localeCompare(b));
}
