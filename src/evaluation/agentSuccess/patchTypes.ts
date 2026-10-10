export type PatchBounds = {
  maxPatchBytes: number;
  maxChangedPaths: number;
  maxPatchLines: number;
};

export const DEFAULT_PATCH_BOUNDS: Readonly<PatchBounds> = Object.freeze({
  maxPatchBytes: 1_048_576,
  maxChangedPaths: 64,
  maxPatchLines: 20_000
});

export type PatchExtractionFailureCode =
  | "EMPTY"
  | "PATCH_TOO_LARGE"
  | "PATCH_TOO_MANY_LINES"
  | "NO_CANDIDATE"
  | "AMBIGUOUS_CANDIDATES";

export type PatchExtractionResult =
  | { ok: true; patch: string }
  | { ok: false; code: PatchExtractionFailureCode; message: string };

export type PatchParseFailureCode = "PATCH_MALFORMED" | "UNSUPPORTED_PATH_QUOTING";

/** One file section of a parsed unified diff, as written in the patch (paths already -p1 stripped). */
export type ParsedPatchFile = {
  oldPath: string | null;
  newPath: string | null;
  /** Path from the `diff --git` line when both sides agree; null otherwise. */
  gitHeaderPath: string | null;
  isNew: boolean;
  isDelete: boolean;
  binary: boolean;
  rename: boolean;
  copy: boolean;
  oldMode: string | null;
  newMode: string | null;
  subproject: boolean;
  hunkCount: number;
};

export type PatchParseResult =
  | { ok: true; files: ParsedPatchFile[] }
  | { ok: false; code: PatchParseFailureCode; message: string };

export type PatchFileStatus = "added" | "modified" | "deleted";

export type PatchPolicyRejectionCode =
  | "TOO_MANY_PATHS"
  | "BINARY_PATCH"
  | "RENAME_OR_COPY"
  | "PATH_MISMATCH"
  | "SYMLINK_MODE"
  | "SUBMODULE"
  | "UNSAFE_PATH"
  | "PROTECTED_PATH";

export type PatchPolicyRejection = {
  code: PatchPolicyRejectionCode;
  path?: string;
  message: string;
};

export type PatchPolicyResult =
  | { ok: true; files: Array<{ path: string; status: PatchFileStatus }> }
  | { ok: false; rejections: PatchPolicyRejection[] };

/**
 * Structured outcome of proposing a patch. These are patch-pipeline outcomes only; they are deliberately
 * unrelated to ExperimentRunStatus.
 */
export type PatchApplicationResult =
  | { outcome: "parse-failure"; code: PatchExtractionFailureCode | PatchParseFailureCode; message: string }
  | { outcome: "policy-rejection"; rejections: PatchPolicyRejection[] }
  | { outcome: "git-check-failure"; message: string }
  | { outcome: "git-apply-failure"; message: string }
  | { outcome: "success"; files: Array<{ path: string; status: PatchFileStatus }> };
