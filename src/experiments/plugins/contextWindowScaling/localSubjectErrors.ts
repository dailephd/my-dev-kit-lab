import type { V043TargetImmutabilityComparisonV1 } from "../../../evaluation/targetImmutability/index.js";
import type { CaseExecutionEvidenceV1 } from "./executionArtifact.js";

export type LocalSubjectExecutionErrorCode =
  | "WORK_ROOT_INSIDE_TARGET"
  | "BEFORE_SNAPSHOT_FAILED"
  | "EXECUTION_FAILED"
  | "TARGET_MUTATED"
  | "AFTER_SNAPSHOT_FAILED"
  | "SCRATCH_CLEANUP_FAILED"
  | "GUIDED_EXCLUSION_LIMIT"
  | "GUIDED_EXCLUSION_UNREPRESENTABLE";

export type LocalSubjectExecutionIssue = {
  code: LocalSubjectExecutionErrorCode;
  /** Labels and repository-relative paths only; absolute target and scratch paths are redacted. */
  message: string;
};

/**
 * Thrown when a local-subject execution did not complete cleanly. The primary code is the first issue in the
 * ordered list (execution, mutation, snapshot, cleanup); every issue is retained so a secondary failure never
 * masks the primary one. `caseEvidence` and `immutability` are runtime-only partial evidence for forensics and
 * must not be persisted without the later privacy projection.
 */
export class LocalSubjectExecutionError extends Error {
  readonly code: LocalSubjectExecutionErrorCode;
  readonly issues: readonly LocalSubjectExecutionIssue[];
  readonly caseEvidence: readonly CaseExecutionEvidenceV1[] | null;
  readonly immutability: V043TargetImmutabilityComparisonV1 | null;

  constructor(
    issues: readonly LocalSubjectExecutionIssue[],
    partial: {
      caseEvidence?: readonly CaseExecutionEvidenceV1[] | null;
      immutability?: V043TargetImmutabilityComparisonV1 | null;
    } = {}
  ) {
    if (issues.length === 0) throw new Error("LocalSubjectExecutionError requires at least one issue.");
    super(`Local subject execution failed (${issues[0].code}): ${issues.map((issue) => issue.message).join("; ")}`);
    this.name = "LocalSubjectExecutionError";
    this.code = issues[0].code;
    this.issues = [...issues];
    this.caseEvidence = partial.caseEvidence ?? null;
    this.immutability = partial.immutability ?? null;
  }
}

/** Replaces absolute private roots in a message so errors never carry the target or scratch location. */
export function redactPrivatePaths(message: string, privatePaths: readonly string[]): string {
  let redacted = message;
  for (const privatePath of privatePaths) {
    if (!privatePath) continue;
    const variants = new Set([privatePath, privatePath.replace(/\\/g, "/"), privatePath.replace(/\//g, "\\")]);
    for (const variant of variants) {
      redacted = redacted.split(variant).join("<private-path>");
    }
  }
  return redacted;
}
