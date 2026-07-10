import { captureTargetSnapshot, diffTargetSnapshots, type TargetSnapshot } from "../../../../securityValidation/attackScenarios/targetSnapshot.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — target mutation evidence for optional Gradle execution
// (agents.txt Batch 4 section 7.24).
//
// Reuses the existing read-only git-status snapshot/diff helpers from
// src/securityValidation/attackScenarios/targetSnapshot.ts (Batch 1's
// "reuse, don't create a second target-status model" rule) and layers a
// narrow Android-specific classifier on top of the diff to separate expected
// generated build output from unexpected tracked-file changes.
// ---------------------------------------------------------------------------

export { captureTargetSnapshot };
export type { TargetSnapshot };

const ANDROID_GENERATED_PATH_PATTERNS = [/^\.gradle\//, /(^|\/)build\//];

export function isExpectedAndroidGeneratedPath(entryPath: string): boolean {
  const normalized = entryPath.replace(/\\/g, "/");
  return ANDROID_GENERATED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export type TargetMutationReport = {
  comparable: boolean;
  reason?: string;
  expectedGeneratedChanges: string[];
  unexpectedChanges: string[];
  preExistingChangeCount: number;
};

// Compares a before/after snapshot pair, distinguishing generated build
// output (untracked/added paths under build/ or .gradle/) from anything
// else — a tracked-file modification, or a new file outside those
// directories, is always reported as unexpected regardless of its status
// code.
export function buildTargetMutationReport(before: TargetSnapshot, after: TargetSnapshot): TargetMutationReport {
  const diff = diffTargetSnapshots(before, after);
  if (!diff.comparable) {
    return { comparable: false, reason: diff.reason, expectedGeneratedChanges: [], unexpectedChanges: [], preExistingChangeCount: 0 };
  }

  const expectedGeneratedChanges: string[] = [];
  const unexpectedChanges: string[] = [];
  for (const entry of diff.newEntries) {
    const isUntrackedOrAdded = entry.code === "??" || entry.code.includes("A");
    if (isUntrackedOrAdded && isExpectedAndroidGeneratedPath(entry.path)) {
      expectedGeneratedChanges.push(entry.path);
    } else {
      unexpectedChanges.push(entry.path);
    }
  }

  return {
    comparable: true,
    expectedGeneratedChanges: expectedGeneratedChanges.sort((a, b) => a.localeCompare(b)),
    unexpectedChanges: unexpectedChanges.sort((a, b) => a.localeCompare(b)),
    preExistingChangeCount: diff.preExistingEntries.length,
  };
}
