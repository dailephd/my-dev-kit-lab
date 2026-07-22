import { isDeepStrictEqual } from "node:util";
import type { JsonValue } from "../upstreamArtifacts/index.js";
import type {
  V043TargetImmutabilityComparisonV1,
  V043TargetMutationV1,
  V043TargetSnapshotV1,
  V043TargetUntrackedFileSnapshotV1
} from "./types.js";

function mutation(
  id: string,
  kind: V043TargetMutationV1["kind"],
  fieldPath: string,
  before: JsonValue,
  after: JsonValue
): V043TargetMutationV1 {
  return { id, kind, fieldPath, before, after };
}

export function compareTargetSnapshots(
  before: V043TargetSnapshotV1,
  after: V043TargetSnapshotV1
): V043TargetImmutabilityComparisonV1 {
  const mutations: V043TargetMutationV1[] = [];

  if (before.git.availability !== after.git.availability) {
    mutations.push(mutation("git.availability", "git-availability", "git.availability", before.git.availability, after.git.availability));
  }
  if (before.git.branch !== after.git.branch) {
    mutations.push(mutation("git.branch", "git-branch", "git.branch", before.git.branch, after.git.branch));
  }
  if (before.git.head !== after.git.head) {
    mutations.push(mutation("git.head", "git-head", "git.head", before.git.head, after.git.head));
  }
  if (!isDeepStrictEqual(before.git.statusEntries, after.git.statusEntries)) {
    mutations.push(
      mutation("git.status", "git-status", "git.statusEntries", before.git.statusEntries, after.git.statusEntries)
    );
  }
  if (before.git.worktreeDiffSha256 !== after.git.worktreeDiffSha256) {
    mutations.push(
      mutation(
        "git.worktree-diff",
        "git-worktree-diff",
        "git.worktreeDiffSha256",
        before.git.worktreeDiffSha256,
        after.git.worktreeDiffSha256
      )
    );
  }
  if (before.git.stagedDiffSha256 !== after.git.stagedDiffSha256) {
    mutations.push(
      mutation(
        "git.staged-diff",
        "git-staged-diff",
        "git.stagedDiffSha256",
        before.git.stagedDiffSha256,
        after.git.stagedDiffSha256
      )
    );
  }

  const afterUntrackedByPath = new Map<string, V043TargetUntrackedFileSnapshotV1>(
    after.git.untrackedFiles.map((entry) => [entry.path, entry])
  );
  const beforeUntrackedPaths = new Set(before.git.untrackedFiles.map((entry) => entry.path));

  for (const beforeEntry of before.git.untrackedFiles) {
    const afterEntry = afterUntrackedByPath.get(beforeEntry.path);
    if (afterEntry === undefined) {
      mutations.push(
        mutation(
          `git.untracked:${beforeEntry.path}`,
          "git-untracked-file",
          `git.untrackedFiles.${beforeEntry.path}`,
          beforeEntry as unknown as JsonValue,
          null
        )
      );
    } else if (!isDeepStrictEqual(beforeEntry, afterEntry)) {
      mutations.push(
        mutation(
          `git.untracked:${beforeEntry.path}`,
          "git-untracked-file",
          `git.untrackedFiles.${beforeEntry.path}`,
          beforeEntry as unknown as JsonValue,
          afterEntry as unknown as JsonValue
        )
      );
    }
  }
  for (const afterEntry of after.git.untrackedFiles) {
    if (!beforeUntrackedPaths.has(afterEntry.path)) {
      mutations.push(
        mutation(
          `git.untracked:${afterEntry.path}`,
          "git-untracked-file",
          `git.untrackedFiles.${afterEntry.path}`,
          null,
          afterEntry as unknown as JsonValue
        )
      );
    }
  }

  const afterConfiguredByPath = new Map(after.configuredFiles.map((entry) => [entry.relativePath, entry]));
  for (const beforeEntry of before.configuredFiles) {
    const afterEntry = afterConfiguredByPath.get(beforeEntry.relativePath);
    if (afterEntry === undefined || !isDeepStrictEqual(beforeEntry, afterEntry)) {
      mutations.push(
        mutation(
          `file:${beforeEntry.relativePath}`,
          "configured-file",
          `configuredFiles.${beforeEntry.relativePath}`,
          beforeEntry as unknown as JsonValue,
          (afterEntry ?? null) as unknown as JsonValue
        )
      );
    }
  }

  return {
    status: mutations.length > 0 ? "mutated" : "unchanged",
    targetRootPath: before.targetRootPath,
    resolvedTargetRootPath: before.resolvedTargetRootPath,
    preExistingGitStatusEntryCount: before.git.statusEntries.length,
    newMutationCount: mutations.length,
    mutations
  };
}
