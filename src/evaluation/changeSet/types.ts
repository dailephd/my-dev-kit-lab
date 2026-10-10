export const CHANGE_SET_SCHEMA_VERSION = "my-dev-kit-lab-change-set-v1";

/** No rename or copy detection: a moved file is one `deleted` record plus one `added` record. */
export type ChangedFileStatus = "added" | "modified" | "deleted";

export type ChangedFileV1 = {
  /** Project-relative POSIX path. */
  relativePath: string;
  status: ChangedFileStatus;
  /** sha256 of the baseline content; null for an added file. */
  beforeSha256: string | null;
  /** sha256 of the current content; null for a deleted file. */
  afterSha256: string | null;
  /** Lines added/removed per Git; null for a binary file. */
  additions: number | null;
  deletions: number | null;
};

/** Raw, deterministic change evidence relative to the sandbox baseline. It carries no score or judgement. */
export type ChangeSetV1 = {
  schemaVersion: typeof CHANGE_SET_SCHEMA_VERSION;
  sandboxId: string;
  baselineCommit: string;
  /** Sorted by relativePath in code-unit order. */
  changedFiles: ChangedFileV1[];
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  changedCount: number;
  totalAdditions: number;
  totalDeletions: number;
  /** Cumulative unified diff from the baseline to the current state ("" when nothing changed). */
  diff: string;
};

export type ChangeSetErrorCode = "SYMLINK_IN_SANDBOX" | "GIT_FAILED" | "INCONSISTENT_EVIDENCE";

export class ChangeSetError extends Error {
  readonly code: ChangeSetErrorCode;

  constructor(code: ChangeSetErrorCode, message: string) {
    super(`Change set error (${code}): ${message.length > 500 ? `${message.slice(0, 500)}...` : message}`);
    this.name = "ChangeSetError";
    this.code = code;
  }
}
