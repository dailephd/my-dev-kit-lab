import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import type { IncrementalChangeStalenessTreatmentId } from "./disposableTarget.js";
import { sha256Hex } from "./scenarioMutation.js";

/**
 * v0.6.2 Batch 2 controlled-source-state schema version. This is a
 * copy-equivalence guard scoped to a benchmark case's configured indexed
 * source roots; it is NOT the real `IndexSnapshotV1` captured from an actual
 * my-dev-kit index build (that remains Batch 3's responsibility).
 */
export const INCREMENTAL_CHANGE_STALENESS_SOURCE_STATE_SCHEMA_VERSION = "1.0.0";

export type IncrementalChangeStalenessSourceStateStatus = "complete" | "unavailable";

export type IncrementalChangeStalenessSourceFileIdentity = {
  /** POSIX-normalized, project-root-relative path. */
  relativePath: string;
  sha256: string;
};

export type IncrementalChangeStalenessSourceStateV1 = {
  schemaVersion: string;
  treatmentId: IncrementalChangeStalenessTreatmentId;
  benchmarkProjectId: string;
  /** Declared source roots this capture is scoped to (as configured on the base case), normalized. */
  sourceRoots: string[];
  status: IncrementalChangeStalenessSourceStateStatus;
  /** Sorted by relativePath; empty when status is "unavailable". */
  files: IncrementalChangeStalenessSourceFileIdentity[];
  fileCount: number;
  /** Deterministic aggregate SHA-256 over sorted "relativePath\tsha256\n" lines; null when unavailable. */
  digest: string | null;
  reason?: string;
};

function normalizeSourceRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Recursively enumerates regular files (symbolic links are skipped, never
 * followed) underneath one project-relative source root, hashing each with
 * SHA-256. Deterministic: results are always returned to the caller sorted.
 */
async function collectSourceRootFiles(projectRoot: string, sourceRoot: string): Promise<IncrementalChangeStalenessSourceFileIdentity[]> {
  const absoluteRoot = resolveWithinRoot(projectRoot, sourceRoot);
  const results: IncrementalChangeStalenessSourceFileIdentity[] = [];

  async function walk(currentAbsoluteDir: string): Promise<void> {
    const entries = await readdir(currentAbsoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        // Never follow symlinks when building controlled source-state evidence.
        continue;
      }
      const entryAbsolutePath = path.join(currentAbsoluteDir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryAbsolutePath);
      } else if (entry.isFile()) {
        const buffer = await readFile(entryAbsolutePath);
        const relativePath = path.relative(projectRoot, entryAbsolutePath).split(path.sep).join("/");
        results.push({ relativePath, sha256: sha256Hex(buffer) });
      }
    }
  }

  await walk(absoluteRoot);
  return results;
}

function computeDigest(files: readonly IncrementalChangeStalenessSourceFileIdentity[]): string {
  const serialized = files.map((file) => `${file.relativePath}\t${file.sha256}\n`).join("");
  return createHash("sha256").update(Buffer.from(serialized, "utf8")).digest("hex");
}

/**
 * Captures bounded, deterministic controlled source-state evidence for one
 * disposable treatment copy, scoped to the base case's own configured
 * `sourceRoots` (never invented separately). Never converts an unreadable or
 * missing source root into an empty/zero-file "complete" result: any
 * enumeration failure makes the whole capture "unavailable" with a reason.
 */
export async function captureIncrementalChangeStalenessSourceState(
  projectRoot: string,
  sourceRoots: readonly string[],
  treatmentId: IncrementalChangeStalenessTreatmentId,
  benchmarkProjectId: string
): Promise<IncrementalChangeStalenessSourceStateV1> {
  const normalizedSourceRoots = sourceRoots.map(normalizeSourceRoot);

  if (normalizedSourceRoots.length === 0) {
    return {
      schemaVersion: INCREMENTAL_CHANGE_STALENESS_SOURCE_STATE_SCHEMA_VERSION,
      treatmentId,
      benchmarkProjectId,
      sourceRoots: normalizedSourceRoots,
      status: "unavailable",
      files: [],
      fileCount: 0,
      digest: null,
      reason: "No source roots were configured for this benchmark case."
    };
  }

  try {
    const perRoot = await Promise.all(normalizedSourceRoots.map((root) => collectSourceRootFiles(projectRoot, root)));
    const files = perRoot.flat().sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return {
      schemaVersion: INCREMENTAL_CHANGE_STALENESS_SOURCE_STATE_SCHEMA_VERSION,
      treatmentId,
      benchmarkProjectId,
      sourceRoots: normalizedSourceRoots,
      status: "complete",
      files,
      fileCount: files.length,
      digest: computeDigest(files)
    };
  } catch (error) {
    return {
      schemaVersion: INCREMENTAL_CHANGE_STALENESS_SOURCE_STATE_SCHEMA_VERSION,
      treatmentId,
      benchmarkProjectId,
      sourceRoots: normalizedSourceRoots,
      status: "unavailable",
      files: [],
      fileCount: 0,
      digest: null,
      reason: `Unable to capture controlled source state: ${(error as Error).message}`
    };
  }
}

export type IncrementalChangeStalenessSourceStateEquivalence = "equivalent" | "different" | "unknown";

export type IncrementalChangeStalenessSourceStateComparisonV1 = {
  result: IncrementalChangeStalenessSourceStateEquivalence;
  /** Bounded, human-readable reasons: unavailability causes or concrete differences. Never full file contents. */
  reasons: string[];
};

/**
 * Deterministically compares two controlled source-state captures.
 * `equivalent` requires both sides complete, matching normalized source-root
 * sets, matching path sets, and matching per-file SHA-256 values.
 * Incomplete/unavailable evidence on either side always yields `unknown`,
 * never `equivalent` and never a false `different`.
 */
export function compareIncrementalChangeStalenessSourceStates(
  left: IncrementalChangeStalenessSourceStateV1,
  right: IncrementalChangeStalenessSourceStateV1
): IncrementalChangeStalenessSourceStateComparisonV1 {
  const reasons: string[] = [];
  if (left.status !== "complete") {
    reasons.push(`left source state is unavailable${left.reason ? `: ${left.reason}` : "."}`);
  }
  if (right.status !== "complete") {
    reasons.push(`right source state is unavailable${right.reason ? `: ${right.reason}` : "."}`);
  }
  if (reasons.length > 0) {
    return { result: "unknown", reasons };
  }

  const leftRoots = [...left.sourceRoots].sort();
  const rightRoots = [...right.sourceRoots].sort();
  if (leftRoots.length !== rightRoots.length || leftRoots.some((root, index) => root !== rightRoots[index])) {
    return {
      result: "different",
      reasons: [`source-root contract differs: left=${JSON.stringify(leftRoots)} right=${JSON.stringify(rightRoots)}`]
    };
  }

  const leftByPath = new Map(left.files.map((file) => [file.relativePath, file.sha256]));
  const rightByPath = new Map(right.files.map((file) => [file.relativePath, file.sha256]));
  const differences: string[] = [];

  for (const [relativePath, sha256] of leftByPath) {
    if (!rightByPath.has(relativePath)) {
      differences.push(`only on left: ${relativePath}`);
    } else if (rightByPath.get(relativePath) !== sha256) {
      differences.push(`content differs: ${relativePath}`);
    }
  }
  for (const relativePath of rightByPath.keys()) {
    if (!leftByPath.has(relativePath)) {
      differences.push(`only on right: ${relativePath}`);
    }
  }

  if (differences.length > 0) {
    return { result: "different", reasons: differences };
  }
  return { result: "equivalent", reasons: [] };
}
