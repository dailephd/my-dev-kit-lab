import type { JsonValue } from "../upstreamArtifacts/index.js";

export interface V043TargetImmutabilityConfigV1 {
  targetRootPath: string;
  relativeFilePaths: readonly string[];
}

export type V043TargetImmutabilityConfigErrorCode =
  | "NON_OBJECT_CONFIG"
  | "UNKNOWN_CONFIG_FIELD"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_FIELD_TYPE"
  | "EMPTY_TARGET_ROOT_PATH"
  | "EMPTY_RELATIVE_FILE_SET"
  | "TOO_MANY_RELATIVE_FILES"
  | "EMPTY_RELATIVE_FILE_PATH"
  | "ABSOLUTE_RELATIVE_FILE_PATH"
  | "RELATIVE_FILE_PATH_TRAVERSAL"
  | "DUPLICATE_RELATIVE_FILE_PATH";

export interface V043TargetImmutabilityConfigIssue {
  code: V043TargetImmutabilityConfigErrorCode;
  fieldPath: string;
  message: string;
}

export type V043TargetImmutabilityConfigValidationResult =
  | {
      ok: true;
      config: V043TargetImmutabilityConfigV1;
    }
  | {
      ok: false;
      issues: V043TargetImmutabilityConfigIssue[];
    };

export type V043TargetFileSnapshotState = "file" | "missing" | "directory" | "symbolic-link" | "other";

export interface V043TargetFileSnapshotV1 {
  relativePath: string;
  resolvedPath: string;
  state: V043TargetFileSnapshotState;
  sha256: string | null;
  symbolicLinkTarget: string | null;
}

export type V043TargetGitAvailability = "available" | "not-repository";

export interface V043TargetUntrackedFileSnapshotV1 {
  path: string;
  state: "file" | "missing" | "symbolic-link" | "other";
  sha256: string | null;
  symbolicLinkTarget: string | null;
}

export interface V043TargetGitSnapshotV1 {
  availability: V043TargetGitAvailability;
  branch: string | null;
  head: string | null;
  statusEntries: string[];
  worktreeDiffSha256: string | null;
  stagedDiffSha256: string | null;
  untrackedFiles: V043TargetUntrackedFileSnapshotV1[];
}

export interface V043TargetSnapshotV1 {
  targetRootPath: string;
  resolvedTargetRootPath: string;
  configuredFiles: V043TargetFileSnapshotV1[];
  git: V043TargetGitSnapshotV1;
}

export type V043TargetSnapshotErrorCode =
  | "TARGET_ROOT_NOT_FOUND"
  | "TARGET_ROOT_NOT_DIRECTORY"
  | "TARGET_ROOT_UNREADABLE"
  | "CONFIGURED_FILE_READ_FAILED"
  | "GIT_COMMAND_UNAVAILABLE"
  | "GIT_COMMAND_FAILED";

export interface V043TargetSnapshotFailure {
  ok: false;
  code: V043TargetSnapshotErrorCode;
  targetRootPath: string;
  message: string;
  fieldPath?: string;
}

export interface V043TargetSnapshotSuccess {
  ok: true;
  snapshot: V043TargetSnapshotV1;
}

export type V043TargetSnapshotResult = V043TargetSnapshotSuccess | V043TargetSnapshotFailure;

export type V043TargetMutationKind =
  | "git-availability"
  | "git-branch"
  | "git-head"
  | "git-status"
  | "git-worktree-diff"
  | "git-staged-diff"
  | "git-untracked-file"
  | "configured-file";

export interface V043TargetMutationV1 {
  id: string;
  kind: V043TargetMutationKind;
  fieldPath: string;
  before: JsonValue;
  after: JsonValue;
}

export interface V043TargetImmutabilityComparisonV1 {
  status: "unchanged" | "mutated";
  targetRootPath: string;
  resolvedTargetRootPath: string;
  preExistingGitStatusEntryCount: number;
  newMutationCount: number;
  mutations: V043TargetMutationV1[];
}

export type V043TargetImmutabilityRunResultV1 =
  | {
      availability: "available";
      comparison: V043TargetImmutabilityComparisonV1;
      reason: null;
    }
  | {
      availability: "unavailable";
      comparison: null;
      reason: string;
      beforeFailure?: V043TargetSnapshotFailure;
      afterFailure?: V043TargetSnapshotFailure;
    };
