import type { BenchmarkTaskAnswerKey, EvaluationCase, ExpectedAnswerFact, TaskLocality } from "../types.js";

export const LOCAL_REPOSITORY_SUBJECT_CONFIG_SCHEMA_ID = "my-dev-kit-lab-local-repository-subject-config-v1";
export const LOCAL_REPOSITORY_SUBJECT_CONFIG_SCHEMA_VERSION = "1.0.0";
export const LOCAL_REPOSITORY_SUBJECT_MANIFEST_SCHEMA_ID = "my-dev-kit-lab-local-repository-subject-manifest-v1";
export const LOCAL_REPOSITORY_SUBJECT_MANIFEST_SCHEMA_VERSION = "1.0.0";

/** Operational safety policy (not a quality metric): files larger than this are never eligible subject material. */
export const DEFAULT_LOCAL_REPOSITORY_SUBJECT_MAX_FILE_BYTES = 1_048_576;
export const LOCAL_REPOSITORY_SUBJECT_SAFETY_POLICY_VERSION = "1.0.0";

export const LOCAL_REPOSITORY_SUBJECT_LIMITS = {
  subjectIdMaxLength: 128,
} as const;

export const LOCAL_REPOSITORY_SUBJECT_CONFIG_FIELDS = ["schemaVersion", "subjectId", "cases"] as const;
export const LOCAL_REPOSITORY_SUBJECT_CASE_FIELDS = [
  "id",
  "title",
  "sourceRoots",
  "query",
  "expectedFiles",
  "expectedSymbols",
  "rawIncludeGlobs",
  "answerKey",
  "expectedFacts",
  "taskLocality",
  "promptComplexityHint",
  "projectComplexityRelevance",
  "notes",
] as const;

export type LocalRepositorySubjectCaseV1 = {
  id: string;
  title: string;
  sourceRoots: string[];
  query: string;
  expectedFiles: string[];
  expectedSymbols: string[];
  rawIncludeGlobs: string[];
  answerKey?: BenchmarkTaskAnswerKey;
  expectedFacts?: ExpectedAnswerFact[];
  taskLocality?: TaskLocality;
  promptComplexityHint?: string;
  projectComplexityRelevance?: string;
  notes?: string;
};

export type LocalRepositorySubjectConfigV1 = {
  schemaVersion: typeof LOCAL_REPOSITORY_SUBJECT_CONFIG_SCHEMA_VERSION;
  subjectId: string;
  cases: LocalRepositorySubjectCaseV1[];
};

/** Thrown when the config, or required paths it names, fail validation. Messages carry logical labels only. */
export class LocalRepositorySubjectConfigError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`Invalid local repository subject configuration: ${errors.join("; ")}`);
    this.name = "LocalRepositorySubjectConfigError";
    this.errors = [...errors];
  }
}

export type LocalRepositorySubjectRepositoryErrorCode =
  | "GIT_UNAVAILABLE"
  | "NOT_A_GIT_REPOSITORY"
  | "NOT_WORKTREE_ROOT"
  | "NO_HEAD_COMMIT"
  | "GIT_CHECK_IGNORE_FAILED"
  | "REPOSITORY_PATH_INVALID";

/** Thrown when the selected repository cannot be identified or classified safely. Never carries raw Git output. */
export class LocalRepositorySubjectRepositoryError extends Error {
  readonly code: LocalRepositorySubjectRepositoryErrorCode;

  constructor(code: LocalRepositorySubjectRepositoryErrorCode, message: string) {
    super(`Local repository subject repository error (${code}): ${message}`);
    this.name = "LocalRepositorySubjectRepositoryError";
    this.code = code;
  }
}

export type LocalRepositoryIdentity = {
  /** Full commit SHA (never abbreviated). */
  commit: string;
  /** Branch name, or null for detached HEAD. */
  branch: string | null;
  workingTreeDirty: boolean;
};

export type LocalRepositorySubjectSafetyPolicy = {
  version: typeof LOCAL_REPOSITORY_SUBJECT_SAFETY_POLICY_VERSION;
  maxFileBytes: number;
  gitIgnoreAuthority: "git";
  symlinkPolicy: "excluded-not-followed";
};

export type LocalRepositorySubjectInventoryCounts = {
  eligibleFileCount: number;
  eligibleByteCount: number;
  gitIgnoredCount: number;
  oversizedCount: number;
  symlinkCount: number;
  otherExcludedCount: number;
};

export type LocalRepositorySubjectExtensionSummaryEntry = {
  extension: string;
  fileCount: number;
};

/** Privacy-safe, persistable-later model. Contains no absolute path, source text, or private file lists. */
export type LocalRepositorySubjectManifestV1 = {
  schemaId: typeof LOCAL_REPOSITORY_SUBJECT_MANIFEST_SCHEMA_ID;
  schemaVersion: typeof LOCAL_REPOSITORY_SUBJECT_MANIFEST_SCHEMA_VERSION;
  subjectId: string;
  logicalTargetRoot: string;
  repository: LocalRepositoryIdentity;
  safetyPolicy: LocalRepositorySubjectSafetyPolicy;
  sourceRoots: string[];
  caseCount: number;
  caseIds: string[];
  inventory: LocalRepositorySubjectInventoryCounts & {
    extensionSummary: LocalRepositorySubjectExtensionSummaryEntry[];
  };
};

/** Runtime-only object: carries the physical repository root and eligible file paths; never persist directly. */
export type LocalRepositorySubject = {
  subjectId: string;
  logicalTargetRoot: string;
  repositoryRoot: string;
  manifest: LocalRepositorySubjectManifestV1;
  evaluationCases: EvaluationCase[];
  eligibleFiles: string[];
};

export function logicalTargetRootForSubject(subjectId: string): string {
  return `local-repository:${subjectId}`;
}

/** Locale-independent ordering by code unit. */
export function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
