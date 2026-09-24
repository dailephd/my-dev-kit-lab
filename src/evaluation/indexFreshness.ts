import { realpath } from "node:fs/promises";
import {
  compareCodeUnits,
  mapInBatches,
  resolveIndexedFilePath,
  snapshotIndexedFile,
  type IndexSnapshotFileV1,
  type IndexSnapshotStatus,
  type IndexSnapshotV1,
} from "./indexSnapshot.js";

export const INDEX_FRESHNESS_SCHEMA_VERSION = "my-dev-kit-lab-index-freshness-v1";

const MAX_CHANGES = 100;
const MAX_UNRESOLVED = 50;
const MAX_REPORTED_PATH_LENGTH = 260;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type IndexFreshnessStatus = "fresh" | "stale" | "partially-stale" | "unknown";

export type IndexFreshnessChangeType = "modified" | "missing";

export type IndexFreshnessUnresolvedReason =
  | "snapshot-unavailable"
  | "snapshot-file-unresolved"
  | "unsafe-path"
  | "file-read-failed"
  | "unsupported-snapshot-entry";

/** A confirmed change to a file the index snapshot proves was indexed. `current*` are null when missing. */
export type IndexFreshnessChangeV1 = {
  path: string;
  changeType: IndexFreshnessChangeType;
  baselineSha256: string;
  baselineSizeBytes: number;
  baselineModifiedAt: string;
  currentSha256: string | null;
  currentSizeBytes: number | null;
  currentModifiedAt: string | null;
};

/** Comparison evidence that could not be established; `path` is null for snapshot-level gaps. */
export type IndexFreshnessUnresolvedV1 = {
  path: string | null;
  reasonCode: IndexFreshnessUnresolvedReason;
  message: string;
};

/**
 * Observational freshness of the files an index snapshot represents. SHA-256 decides content
 * identity; mtime is diagnostic only. Says nothing about files the snapshot does not list, new
 * files, retrieval quality, or whether to re-index.
 */
export type IndexFreshnessAssessmentV1 = {
  schemaVersion: typeof INDEX_FRESHNESS_SCHEMA_VERSION;
  status: IndexFreshnessStatus;
  assessedAt: string;
  baselineSnapshotStatus: IndexSnapshotStatus;
  /** Files the snapshot lists as indexed (including ones the snapshot itself could not hash). */
  indexedFileCount: number;
  /** Files whose current bytes were read and hashed: `unchangedFileCount + changedFileCount`. */
  comparableFileCount: number;
  unchangedFileCount: number;
  /** Comparable files whose SHA-256 differs from the baseline. */
  changedFileCount: number;
  missingFileCount: number;
  /** Unresolved comparison entries (file-level and snapshot-level), before list truncation. */
  unresolvedFileCount: number;
  changes: IndexFreshnessChangeV1[];
  changesTruncated: boolean;
  unresolved: IndexFreshnessUnresolvedV1[];
  unresolvedTruncated: boolean;
  warnings: string[];
};

/**
 * Policy: the four-state freshness decision table. `fresh` requires a complete baseline and a
 * complete comparison with no confirmed change; a confirmed change is `stale` only when the
 * comparison was complete, otherwise `partially-stale`; without a confirmed change an incomplete
 * comparison is `unknown`. Never converts uncertainty to `fresh`. Pure.
 */
export function classifyIndexFreshness(input: {
  baselineSnapshotStatus: IndexSnapshotStatus;
  confirmedChangeCount: number;
  unresolvedCount: number;
}): IndexFreshnessStatus {
  if (input.baselineSnapshotStatus === "unavailable") {
    return "unknown";
  }
  const comparisonComplete = input.baselineSnapshotStatus === "complete" && input.unresolvedCount === 0;
  if (input.confirmedChangeCount > 0) {
    return comparisonComplete ? "stale" : "partially-stale";
  }
  return comparisonComplete ? "fresh" : "unknown";
}

function boundedText(value: string): string {
  return value.length > MAX_REPORTED_PATH_LENGTH ? `${value.slice(0, MAX_REPORTED_PATH_LENGTH)}...` : value;
}

function isValidBaselineEntry(entry: unknown): entry is IndexSnapshotFileV1 {
  if (typeof entry !== "object" || entry === null) return false;
  const candidate = entry as Record<string, unknown>;
  return (
    typeof candidate.path === "string" &&
    candidate.path.length > 0 &&
    typeof candidate.sha256 === "string" &&
    SHA256_PATTERN.test(candidate.sha256) &&
    typeof candidate.sizeBytes === "number" &&
    typeof candidate.modifiedAt === "string"
  );
}

type FileComparison =
  | { kind: "unchanged" }
  | { kind: "change"; change: IndexFreshnessChangeV1 }
  | { kind: "unresolved"; unresolved: IndexFreshnessUnresolvedV1 };

async function compareIndexedFile(
  targetRoot: string,
  realTargetRoot: string,
  sourceRoots: readonly string[],
  entry: unknown
): Promise<FileComparison> {
  if (!isValidBaselineEntry(entry)) {
    const listedPath = typeof (entry as { path?: unknown } | null)?.path === "string" ? boundedText((entry as { path: string }).path) : null;
    return {
      kind: "unresolved",
      unresolved: {
        path: listedPath,
        reasonCode: "unsupported-snapshot-entry",
        message: "Snapshot entry lacks a path, SHA-256, size, or modified time.",
      },
    };
  }
  const resolution = resolveIndexedFilePath(targetRoot, sourceRoots, entry.path);
  if (!resolution.ok) {
    return {
      kind: "unresolved",
      unresolved: { path: boundedText(entry.path), reasonCode: "unsafe-path", message: `Path cannot be safely resolved (${resolution.reason}).` },
    };
  }
  const current = await snapshotIndexedFile(targetRoot, realTargetRoot, resolution.relativePath);
  if (!current.ok) {
    if (current.reason === "missing") {
      return {
        kind: "change",
        change: {
          path: entry.path,
          changeType: "missing",
          baselineSha256: entry.sha256,
          baselineSizeBytes: entry.sizeBytes,
          baselineModifiedAt: entry.modifiedAt,
          currentSha256: null,
          currentSizeBytes: null,
          currentModifiedAt: null,
        },
      };
    }
    const unsafe = current.reason === "outside-target-or-source-roots" || current.reason === "invalid-path";
    return {
      kind: "unresolved",
      unresolved: {
        path: boundedText(entry.path),
        reasonCode: unsafe ? "unsafe-path" : "file-read-failed",
        message: unsafe ? "Current file resolves outside the target." : `Current file could not be read as a regular file (${current.reason}).`,
      },
    };
  }
  if (current.file.sha256 === entry.sha256) {
    return { kind: "unchanged" };
  }
  return {
    kind: "change",
    change: {
      path: entry.path,
      changeType: "modified",
      baselineSha256: entry.sha256,
      baselineSizeBytes: entry.sizeBytes,
      baselineModifiedAt: entry.modifiedAt,
      currentSha256: current.file.sha256,
      currentSizeBytes: current.file.sizeBytes,
      currentModifiedAt: current.file.modifiedAt,
    },
  };
}

/**
 * Compares the files an index snapshot lists against their current state. Read-only: never
 * modifies the target, invokes my-dev-kit, re-indexes, or retrieves. Files that exist now but are
 * absent from the snapshot are deliberately ignored — the snapshot records the exact indexed set,
 * not everything under the source roots, so "added" files cannot be inferred truthfully. Never
 * throws; an unassessable input yields an explicit `unknown` assessment.
 */
export async function assessIndexFreshness(options: {
  snapshot: IndexSnapshotV1 | null;
  targetRoot: string;
  sourceRoots: readonly string[];
  now?: () => Date;
}): Promise<IndexFreshnessAssessmentV1> {
  const { snapshot, targetRoot, sourceRoots } = options;
  const assessedAt = (options.now ?? (() => new Date()))().toISOString();
  const baselineSnapshotStatus: IndexSnapshotStatus = snapshot?.status ?? "unavailable";

  const changes: IndexFreshnessChangeV1[] = [];
  const unresolved: IndexFreshnessUnresolvedV1[] = [];
  let unchangedFileCount = 0;
  let unresolvedTotal = 0;
  const addUnresolved = (entry: IndexFreshnessUnresolvedV1, count = 1): void => {
    unresolvedTotal += count;
    unresolved.push(entry);
  };

  try {
    if (!snapshot || snapshot.status === "unavailable") {
      addUnresolved({
        path: null,
        reasonCode: "snapshot-unavailable",
        message: snapshot?.unavailable ? boundedText(snapshot.unavailable.message) : "No index snapshot is available for this session.",
      });
    } else {
      let realTargetRoot: string | undefined;
      try {
        realTargetRoot = await realpath(targetRoot);
      } catch {
        addUnresolved({ path: null, reasonCode: "file-read-failed", message: "Target root could not be resolved." });
      }
      if (snapshot.status === "complete" && snapshot.files.length !== snapshot.indexedFileCount) {
        addUnresolved({
          path: null,
          reasonCode: "unsupported-snapshot-entry",
          message: `Complete snapshot lists ${snapshot.indexedFileCount} indexed files but carries ${snapshot.files.length} entries.`,
        });
      }
      for (const entry of snapshot.unresolvedFiles) {
        addUnresolved({
          path: entry.path,
          reasonCode: "snapshot-file-unresolved",
          message: `The index snapshot could not hash this indexed file (${entry.reason}).`,
        });
      }
      // Unresolved entries the snapshot itself truncated still count toward the total.
      unresolvedTotal += Math.max(0, snapshot.unresolvedFileCount - snapshot.unresolvedFiles.length);

      if (realTargetRoot !== undefined) {
        const rootForComparison = realTargetRoot;
        const comparisons = await mapInBatches(snapshot.files as readonly unknown[], (entry) =>
          compareIndexedFile(targetRoot, rootForComparison, sourceRoots, entry)
        );
        for (const comparison of comparisons) {
          if (comparison.kind === "unchanged") unchangedFileCount += 1;
          else if (comparison.kind === "change") changes.push(comparison.change);
          else addUnresolved(comparison.unresolved);
        }
      }
    }
  } catch (error) {
    addUnresolved({
      path: null,
      reasonCode: "file-read-failed",
      message: boundedText(`Freshness comparison failed: ${error instanceof Error ? error.message : String(error)}`),
    });
  }

  changes.sort((left, right) => compareCodeUnits(left.path, right.path) || compareCodeUnits(left.changeType, right.changeType));
  unresolved.sort(
    (left, right) =>
      compareCodeUnits(left.path ?? "", right.path ?? "") || compareCodeUnits(left.reasonCode, right.reasonCode) || compareCodeUnits(left.message, right.message)
  );

  const modifiedCount = changes.filter((change) => change.changeType === "modified").length;
  const missingCount = changes.length - modifiedCount;
  const warnings: string[] = [];
  if (changes.length > MAX_CHANGES) warnings.push(`Change list truncated to ${MAX_CHANGES} of ${changes.length} entries.`);
  if (unresolved.length > MAX_UNRESOLVED) warnings.push(`Unresolved list truncated to ${MAX_UNRESOLVED} of ${unresolved.length} entries.`);

  return {
    schemaVersion: INDEX_FRESHNESS_SCHEMA_VERSION,
    status: classifyIndexFreshness({ baselineSnapshotStatus, confirmedChangeCount: changes.length, unresolvedCount: unresolvedTotal }),
    assessedAt,
    baselineSnapshotStatus,
    indexedFileCount: snapshot?.indexedFileCount ?? 0,
    comparableFileCount: unchangedFileCount + modifiedCount,
    unchangedFileCount,
    changedFileCount: modifiedCount,
    missingFileCount: missingCount,
    unresolvedFileCount: unresolvedTotal,
    changes: changes.slice(0, MAX_CHANGES),
    changesTruncated: changes.length > MAX_CHANGES,
    unresolved: unresolved.slice(0, MAX_UNRESOLVED),
    unresolvedTruncated: unresolvedTotal > Math.min(unresolved.length, MAX_UNRESOLVED),
    warnings,
  };
}
