import path from "node:path";
import type { AffectedNeighborhoodGraphEvidenceV1 } from "../../../evaluation/affectedNeighborhood.js";
import type { IndexFreshnessAssessmentV1 } from "../../../evaluation/indexFreshness.js";
import type { IndexSnapshotToolV1 } from "../../../evaluation/indexSnapshot.js";
import type { IncrementalChangeStalenessTreatmentId } from "./disposableTarget.js";
import type {
  IncrementalChangeStalenessIndexEvidenceV1,
  IncrementalChangeStalenessLifecycleFailureV1
} from "./treatmentSession.js";

/**
 * Pure v0.6.2 Batch 3 lifecycle-readiness policy. Every function here only
 * inspects already-produced evidence and returns an explicit failure or
 * null; none touches the filesystem, runs my-dev-kit, mutates, or retrieves.
 * These rules are scoped to this experiment's matched production lifecycle
 * and deliberately do not change the released v0.6.0/v0.6.1 semantics of the
 * evidence they read.
 */

export function normalizeRootForComparison(root: string): string {
  const resolved = path.resolve(root);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

function normalizeSourceRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Exact, order-preserving source-root equality after separator/trailing-slash normalization. */
export function sameSourceRoots(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((root, index) => normalizeSourceRoot(root) === normalizeSourceRoot(right[index]));
}

/**
 * Graph evidence is usable for this lifecycle only when an indexed-file claim
 * exists (not `unavailable`) AND the code graph was actually loaded, since a
 * null code graph makes later node mapping impossible.
 */
export function isUsableGraphEvidence(graph: AffectedNeighborhoodGraphEvidenceV1): boolean {
  return graph.status !== "unavailable" && graph.codeGraph !== null;
}

function failure(
  code: IncrementalChangeStalenessLifecycleFailureV1["code"],
  message: string,
  treatmentId: IncrementalChangeStalenessTreatmentId | null
): IncrementalChangeStalenessLifecycleFailureV1 {
  return { code, message, treatmentId };
}

/**
 * Proves one prepared index belongs to the intended treatment target, uses
 * the canonical source roots, carries a complete IndexSnapshotV1 (whose
 * manifest projectRoot/sourceRoots were already checked against the target by
 * captureIndexSnapshot), and carries usable graph evidence loaded from the
 * same index directory. Never relies on directory naming alone.
 */
export function evaluateIndexEvidence(
  evidence: IncrementalChangeStalenessIndexEvidenceV1,
  expected: { targetRoot: string; sourceRoots: readonly string[]; indexDir: string }
): IncrementalChangeStalenessLifecycleFailureV1 | null {
  const refreshed = evidence.role === "refreshed";
  const label = `${evidence.treatmentId} ${evidence.role} index`;
  const targetMismatchCode = refreshed ? "active-index-target-mismatch" : "index-target-mismatch";

  if (normalizeRootForComparison(evidence.targetRoot) !== normalizeRootForComparison(expected.targetRoot)) {
    return failure(targetMismatchCode, `${label} target root ${evidence.targetRoot} does not match treatment target ${expected.targetRoot}.`, evidence.treatmentId);
  }
  if (normalizeRootForComparison(evidence.indexDir) !== normalizeRootForComparison(expected.indexDir)) {
    return failure(targetMismatchCode, `${label} directory ${evidence.indexDir} does not match the owned index directory ${expected.indexDir}.`, evidence.treatmentId);
  }
  if (!sameSourceRoots(evidence.sourceRoots, expected.sourceRoots)) {
    return failure(
      "source-root-mismatch",
      `${label} source roots [${evidence.sourceRoots.join(", ")}] do not match canonical base-case source roots [${expected.sourceRoots.join(", ")}].`,
      evidence.treatmentId
    );
  }
  const snapshot = evidence.snapshot;
  if (snapshot.status === "unavailable" && snapshot.unavailable?.code === "manifest-target-mismatch") {
    return failure(targetMismatchCode, `${label} manifest does not belong to the treatment target: ${snapshot.unavailable.message}`, evidence.treatmentId);
  }
  if (snapshot.status !== "complete") {
    const reason = snapshot.unavailable ? `${snapshot.unavailable.code}: ${snapshot.unavailable.message}` : `${snapshot.unresolvedFileCount} unresolved indexed file(s)`;
    return failure(refreshed ? "refreshed-snapshot-unavailable" : "baseline-snapshot-unavailable", `${label} IndexSnapshotV1 is ${snapshot.status} (${reason}).`, evidence.treatmentId);
  }
  if (normalizeRootForComparison(evidence.graph.indexRoot) !== normalizeRootForComparison(expected.indexDir)) {
    return failure(targetMismatchCode, `${label} graph evidence was loaded from ${evidence.graph.indexRoot}, not ${expected.indexDir}.`, evidence.treatmentId);
  }
  if (!isUsableGraphEvidence(evidence.graph)) {
    const reason = evidence.graph.unavailable ? `${evidence.graph.unavailable.code}: ${evidence.graph.unavailable.message}` : "code graph was not loaded";
    return failure(refreshed ? "refreshed-graph-unavailable" : "baseline-graph-unavailable", `${label} graph evidence is not usable (${evidence.graph.status}; ${reason}).`, evidence.treatmentId);
  }
  return null;
}

/**
 * Every index of one matched scenario must come from the same configured
 * my-dev-kit command and the same probed tool version. An unavailable
 * version is never guessed: identity that cannot be established blocks
 * readiness explicitly.
 */
export function evaluateToolIdentity(
  indexes: readonly IncrementalChangeStalenessIndexEvidenceV1[]
): { failure: IncrementalChangeStalenessLifecycleFailureV1 | null; tool: IndexSnapshotToolV1 | null } {
  for (const index of indexes) {
    if (index.snapshot.tool.availability !== "available" || index.snapshot.tool.version === null) {
      return {
        failure: failure(
          "tool-identity-unavailable",
          `${index.treatmentId} ${index.role} index my-dev-kit version could not be established: ${index.snapshot.tool.reason ?? "unavailable"}.`,
          index.treatmentId
        ),
        tool: null
      };
    }
  }
  const versions = [...new Set(indexes.map((index) => index.snapshot.tool.version))];
  if (versions.length > 1) {
    return {
      failure: failure(
        "tool-identity-mismatch",
        `Matched scenario indexes were built with different my-dev-kit versions: ${indexes.map((index) => `${index.treatmentId}/${index.role}=${index.snapshot.tool.version}`).join(", ")}.`,
        null
      ),
      tool: null
    };
  }
  const commands = [...new Set(indexes.map((index) => index.snapshot.indexCommand.commandString))];
  if (commands.length > 1) {
    return {
      failure: failure("tool-identity-mismatch", `Matched scenario indexes were built with different my-dev-kit commands: ${commands.join(" | ")}.`, null),
      tool: null
    };
  }
  return { failure: null, tool: indexes.length > 0 ? { ...indexes[0].snapshot.tool } : null };
}

function changedPaths(assessment: IndexFreshnessAssessmentV1): string[] {
  return assessment.changes.map((change) => normalizeRelativePath(change.path)).sort();
}

/**
 * A frozen production scenario must be observed as COMPLETE `stale` against
 * the pre-mutation baseline snapshot, and the confirmed changed set must be
 * exactly the scenario-declared controlled file(s) (all modifications, none
 * missing). `fresh`, `unknown`, and `partially-stale` never count as a proven
 * controlled stale state.
 */
export function evaluateBaselineStaleFreshness(
  assessment: IndexFreshnessAssessmentV1,
  controlledChangedPaths: readonly string[],
  treatmentId: IncrementalChangeStalenessTreatmentId
): IncrementalChangeStalenessLifecycleFailureV1 | null {
  if (assessment.status !== "stale") {
    return failure("baseline-freshness-not-stale", `${treatmentId} baseline freshness after mutation is ${assessment.status}, not complete stale.`, treatmentId);
  }
  if (assessment.baselineSnapshotStatus !== "complete" || assessment.unresolvedFileCount !== 0 || assessment.changesTruncated) {
    return failure(
      "baseline-freshness-not-stale",
      `${treatmentId} baseline freshness comparison is incomplete (snapshot ${assessment.baselineSnapshotStatus}, ${assessment.unresolvedFileCount} unresolved, truncated=${assessment.changesTruncated}).`,
      treatmentId
    );
  }
  const expected = [...controlledChangedPaths].map(normalizeRelativePath).sort();
  const observed = changedPaths(assessment);
  const sameSet = observed.length === expected.length && observed.every((value, index) => value === expected[index]);
  if (!sameSet || assessment.missingFileCount !== 0) {
    return failure(
      "baseline-changed-paths-mismatch",
      `${treatmentId} baseline freshness changed paths [${observed.join(", ")}] (missing=${assessment.missingFileCount}) do not match scenario-controlled paths [${expected.join(", ")}].`,
      treatmentId
    );
  }
  return null;
}

/**
 * Both treatments applied the same mutation to equivalent copies, so their
 * baseline freshness change evidence must agree path-for-path, including
 * baseline and current content identity.
 */
export function evaluateChangedPathSymmetry(
  stale: IndexFreshnessAssessmentV1,
  fullRefresh: IndexFreshnessAssessmentV1
): IncrementalChangeStalenessLifecycleFailureV1 | null {
  const key = (assessment: IndexFreshnessAssessmentV1) =>
    assessment.changes
      .map((change) => `${normalizeRelativePath(change.path)}\t${change.changeType}\t${change.baselineSha256}\t${change.currentSha256 ?? "null"}`)
      .sort();
  const left = key(stale);
  const right = key(fullRefresh);
  const same = left.length === right.length && left.every((value, index) => value === right[index]);
  if (!same) {
    return failure(
      "treatment-changed-paths-conflict",
      `stale-index and full-refresh baseline freshness disagree about the controlled change: stale=[${left.join("; ")}] full-refresh=[${right.join("; ")}].`,
      null
    );
  }
  return null;
}

/** The refreshed index must be proven complete `fresh` against the unchanged mutated target. */
export function evaluateRefreshedFreshness(assessment: IndexFreshnessAssessmentV1): IncrementalChangeStalenessLifecycleFailureV1 | null {
  const complete = assessment.baselineSnapshotStatus === "complete" && assessment.unresolvedFileCount === 0;
  if (assessment.status !== "fresh" || !complete || assessment.changedFileCount !== 0 || assessment.missingFileCount !== 0) {
    return failure(
      "refreshed-freshness-not-fresh",
      `full-refresh refreshed index freshness is ${assessment.status} (snapshot ${assessment.baselineSnapshotStatus}, ${assessment.changedFileCount} changed, ${assessment.missingFileCount} missing, ${assessment.unresolvedFileCount} unresolved); complete fresh is required.`,
      "full-refresh"
    );
  }
  return null;
}
