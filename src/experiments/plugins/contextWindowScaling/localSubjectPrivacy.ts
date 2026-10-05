import path from "node:path";
import type { LocalRepositorySubjectManifestV1 } from "../../../evaluation/localRepositorySubject/index.js";
import type { ExperimentRun, ExperimentTarget } from "../../types.js";
import type { CaseExecutionEvidenceV1 } from "./executionArtifact.js";
import { LocalSubjectExecutionError, redactPrivatePaths } from "./localSubjectErrors.js";

/** Value used wherever a durable external-local artifact would otherwise show a machine-local path. */
export const EXTERNAL_LOCAL_REDACTED_VALUE = "[redacted]";
const REDACTED_FILE_TEXT = "<redacted file>";

/** One opaque placeholder per file: counts stay exact and an empty list still means "no files". */
export function redactedFileList(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `<redacted file ${index + 1}>`);
}

/** Replaces known repository-relative paths (longest first) and private roots inside free text. */
export function redactKnownPaths(text: string, knownFiles: readonly string[], privateRoots: readonly string[] = []): string {
  let redacted = redactPrivatePaths(text, privateRoots);
  for (const file of [...knownFiles].sort((left, right) => right.length - left.length)) {
    if (file.length === 0) continue;
    // Native tool errors on Windows may spell a repository-relative path with backslashes.
    for (const variant of new Set([file, file.replace(/\//g, "\\")])) redacted = redacted.split(variant).join(REDACTED_FILE_TEXT);
  }
  return redacted;
}

function redactStrings<T>(value: T, redact: (text: string) => string): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((entry) => redactStrings(entry, redact)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, redactStrings(nested, redact)])) as T;
  }
  return value;
}

/**
 * Projects execution evidence for durable persistence of an external-local run. File identity lists become
 * placeholder lists of the same length (with an explicit per-treatment flag) and every free-text field has known
 * repository paths and private roots replaced. Scientific numbers, statuses and identifiers are untouched.
 */
export function projectEvidenceForExternalLocalPersistence(
  evidence: readonly CaseExecutionEvidenceV1[],
  privacy: { knownFiles: readonly string[]; privateRoots: readonly string[] }
): CaseExecutionEvidenceV1[] {
  const redact = (text: string): string => redactKnownPaths(text, privacy.knownFiles, privacy.privateRoots);
  return evidence.map((caseEvidence) => {
    const cloned = structuredClone(caseEvidence);
    return {
      ...redactStrings(cloned, redact),
      treatments: cloned.treatments.map((treatment) => {
        const safe = redactStrings(treatment, redact);
        return {
          ...safe,
          context: {
            ...safe.context,
            observedFiles: treatment.context.observedFiles === null ? null : redactedFileList(treatment.context.observedFiles.length),
          },
          relevantFileEvidence: {
            ...safe.relevantFileEvidence,
            expectedRelevantFiles: redactedFileList(treatment.relevantFileEvidence.expectedRelevantFiles.length),
            omittedRelevantFiles: redactedFileList(treatment.relevantFileEvidence.omittedRelevantFiles.length),
          },
          fileIdentityRedaction: "redacted" as const,
        };
      }),
    };
  });
}

/** Durable target identity for an external-local run: logical identity and Git identity, no filesystem facts. */
export function projectExternalLocalTarget(manifest: LocalRepositorySubjectManifestV1): ExperimentTarget {
  return {
    kind: "external-local",
    targetRoot: manifest.logicalTargetRoot,
    toolRoot: EXTERNAL_LOCAL_REDACTED_VALUE,
    packageName: null,
    packageVersion: null,
    hasPackageJson: false,
    hasLockfile: false,
    branch: manifest.repository.branch,
    commit: manifest.repository.commit,
    hasGit: true,
    isSelf: false,
    privacyProjection: "external-local-redacted",
  };
}

/** Replaces target and machine-local metadata of a run before any report is serialized. */
export function projectRunForExternalLocalPersistence(run: ExperimentRun, target: ExperimentTarget): ExperimentRun {
  const metadata: Record<string, unknown> = { ...(run.metadata ?? {}) };
  if ("outputRoot" in metadata) metadata.outputRoot = EXTERNAL_LOCAL_REDACTED_VALUE;
  if (typeof metadata.executionArtifactPath === "string") metadata.executionArtifactPath = path.basename(metadata.executionArtifactPath);
  if (typeof metadata.analysisArtifactPath === "string") metadata.analysisArtifactPath = path.basename(metadata.analysisArtifactPath);
  return { ...run, target, metadata: metadata as ExperimentRun["metadata"] };
}

const GENERIC_ISSUE_TEXT: Record<string, string> = {
  WORK_ROOT_INSIDE_TARGET: "the output directory must be outside the local subject repository",
  BEFORE_SNAPSHOT_FAILED: "the target snapshot before execution could not be captured",
  AFTER_SNAPSHOT_FAILED: "the target snapshot after execution could not be captured",
  SCRATCH_CLEANUP_FAILED: "the private scratch could not be removed",
  GUIDED_EXCLUSION_LIMIT: "the guided-index exclusions exceeded the safe limit",
  GUIDED_EXCLUSION_UNREPRESENTABLE: "the guided-index exclusions could not be expressed exactly",
};

/**
 * Safe, persistable description of a local-subject execution failure: issue codes, case and treatment identifiers,
 * error codes and mutation kinds only. Repository file names, mutation identifiers and the full comparison are
 * never included.
 */
export function describeLocalSubjectFailureForPersistence(error: LocalSubjectExecutionError): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const issue of error.issues) {
    if (seen.has(issue.code)) continue;
    seen.add(issue.code);
    if (issue.code === "EXECUTION_FAILED") {
      const details: string[] = [];
      for (const caseEvidence of error.caseEvidence ?? []) {
        for (const treatment of caseEvidence.treatments) {
          if (treatment.status === "failed" || treatment.errors.length > 0) {
            details.push(`case ${caseEvidence.caseId} treatment ${treatment.variantId}: ${treatment.errors.map((entry) => entry.code).join(", ") || "failed"}`);
          }
        }
      }
      parts.push(details.length > 0 ? `execution failed (${details.join("; ")})` : "execution failed before completing (details withheld)");
    } else if (issue.code === "TARGET_MUTATED") {
      const kinds = [...new Set((error.immutability?.mutations ?? []).map((mutation) => mutation.kind))].sort();
      parts.push(`the target changed during execution${kinds.length > 0 ? ` (${kinds.join(", ")})` : ""}; it was not restored`);
    } else {
      parts.push(GENERIC_ISSUE_TEXT[issue.code] ?? `issue ${issue.code}`);
    }
  }
  return `Local subject execution failed (${error.code}): ${parts.join("; ")}.`;
}
