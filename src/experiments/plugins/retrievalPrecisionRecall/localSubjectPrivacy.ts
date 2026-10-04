import type { RetrievalQualityMetricsV1 } from "../../../evaluation/retrievalQuality/index.js";
import { LocalSubjectExecutionError } from "../contextWindowScaling/localSubjectErrors.js";
import { redactedFileList } from "../contextWindowScaling/localSubjectPrivacy.js";
import type {
  RetrievalPrecisionRecallCaseEvidenceV1,
  RetrievalPrecisionRecallErrorCode,
  RetrievalPrecisionRecallIdentityRedactionV1
} from "./types.js";

/** Single fixed placeholder for a withheld case title. */
export const REDACTED_CASE_TITLE = "<redacted case title>";

/** The one V1 marker stamped on every externally projected case, so placeholders are never mistaken for real values. */
export const RETRIEVAL_IDENTITY_REDACTION: RetrievalPrecisionRecallIdentityRedactionV1 = {
  fileIdentities: "redacted",
  symbolIdentities: "redacted",
  factIdentities: "redacted",
  warningText: "redacted",
  caseTitle: "redacted"
};

/** One opaque placeholder per identity: counts stay exact; null stays null; an empty list stays empty. */
function placeholders(kind: "symbol" | "fact" | "warning", count: number): string[] {
  return Array.from({ length: count }, (_, index) => `<redacted ${kind} ${index + 1}>`);
}

const filePlaceholders = (list: string[] | null): string[] | null => (list === null ? null : redactedFileList(list.length));
const symbolPlaceholders = (list: string[] | null): string[] | null => (list === null ? null : placeholders("symbol", list.length));
const factPlaceholders = (list: string[] | null): string[] | null => (list === null ? null : placeholders("fact", list.length));

/** Plugin-owned text per error code; a caught Error.message is never copied into durable external evidence. */
const FIXED_ERROR_TEXT: Record<RetrievalPrecisionRecallErrorCode, string> = {
  "ground-truth-invalid": "The case ground truth was invalid.",
  "project-group-inconsistent": "The case source configuration was inconsistent.",
  "project-index-failed": "The my-dev-kit index could not be prepared.",
  "retrieval-failed": "The retrieval did not complete."
};

/** Only identity lists change; every number, availability and fixed-vocabulary reason is carried through untouched. */
function projectQuality(quality: RetrievalQualityMetricsV1): RetrievalQualityMetricsV1 {
  return {
    ...quality,
    file: {
      ...quality.file,
      relevantRetrievedFiles: filePlaceholders(quality.file.relevantRetrievedFiles),
      irrelevantRetrievedFiles: filePlaceholders(quality.file.irrelevantRetrievedFiles),
      missedFiles: filePlaceholders(quality.file.missedFiles)
    },
    symbol: {
      ...quality.symbol,
      relevantRetrievedSymbols: symbolPlaceholders(quality.symbol.relevantRetrievedSymbols),
      irrelevantRetrievedSymbols: symbolPlaceholders(quality.symbol.irrelevantRetrievedSymbols),
      missedSymbols: symbolPlaceholders(quality.symbol.missedSymbols)
    },
    fact: {
      ...quality.fact,
      coveredFactIds: factPlaceholders(quality.fact.coveredFactIds),
      uncoveredFactIds: factPlaceholders(quality.fact.uncoveredFactIds)
    }
  };
}

/**
 * Projects case evidence for durable persistence of an external-local run. Redacts file, symbol and fact identity
 * lists, the case title, and all retrieval warning prose; keeps logical ids, locality, statuses, numbers and
 * fixed-vocabulary evidence. It performs no metric calculation.
 */
export function projectRetrievalEvidenceForExternalLocalPersistence(
  evidence: readonly RetrievalPrecisionRecallCaseEvidenceV1[]
): RetrievalPrecisionRecallCaseEvidenceV1[] {
  return evidence.map((entry) => {
    const cloned = structuredClone(entry);
    return {
      ...cloned,
      caseName: REDACTED_CASE_TITLE,
      retrieval:
        cloned.retrieval === null
          ? null
          : { ...cloned.retrieval, warnings: placeholders("warning", cloned.retrieval.warnings.length) },
      quality: cloned.quality === null ? null : projectQuality(cloned.quality),
      errors: cloned.errors.map((error) => ({ code: error.code, message: FIXED_ERROR_TEXT[error.code] })),
      identityRedaction: { ...RETRIEVAL_IDENTITY_REDACTION }
    };
  });
}

/**
 * Defense in depth: fails closed if a known private file path, case title, or warning text survived projection.
 * It deliberately does not substring-search short symbol or fact identifiers, which would collide with ordinary words.
 */
export function assertExternalLocalProjectionIsPrivate(
  projected: unknown,
  privateValues: { filePaths: readonly string[]; caseTitles: readonly string[]; warnings: readonly string[] }
): void {
  const serialized = JSON.stringify(projected);
  const candidates = [...privateValues.filePaths, ...privateValues.caseTitles, ...privateValues.warnings].filter((value) => value.length > 0);
  const leaked = candidates.some((value) => serialized.includes(value) || serialized.includes(JSON.stringify(value).slice(1, -1)));
  if (leaked) {
    throw new Error("External-local privacy projection check failed; no durable output was written.");
  }
}

const GENERIC_ISSUE_TEXT: Record<string, string> = {
  WORK_ROOT_INSIDE_TARGET: "the output directory must be outside the local subject repository",
  BEFORE_SNAPSHOT_FAILED: "the target snapshot before execution could not be captured",
  AFTER_SNAPSHOT_FAILED: "the target snapshot after execution could not be captured",
  SCRATCH_CLEANUP_FAILED: "the private scratch could not be removed",
  GUIDED_EXCLUSION_LIMIT: "the guided-index exclusions exceeded the safe limit",
  GUIDED_EXCLUSION_UNREPRESENTABLE: "the guided-index exclusions could not be expressed exactly"
};

/**
 * Safe, persistable description of an external-local failure: issue codes, logical case ids, counts and mutation
 * kinds only. The issue messages built by the execution seam are safe by construction and are included for the
 * three case-scoped codes; nothing else (no file name, symbol, fact id, path, or caught error text) can appear.
 */
export function describeRetrievalLocalSubjectFailureForPersistence(error: LocalSubjectExecutionError): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const issue of error.issues) {
    if (issue.code === "EXECUTION_FAILED" || issue.code === "GROUND_TRUTH_INVALID" || issue.code === "RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE") {
      if (!seen.has(issue.message)) {
        seen.add(issue.message);
        parts.push(issue.message.replace(/\.$/, ""));
      }
      continue;
    }
    if (seen.has(issue.code)) continue;
    seen.add(issue.code);
    if (issue.code === "TARGET_MUTATED") {
      const kinds = [...new Set((error.immutability?.mutations ?? []).map((mutation) => mutation.kind))].sort();
      parts.push(`the target changed during execution${kinds.length > 0 ? ` (${kinds.join(", ")})` : ""}; it was not restored`);
    } else {
      parts.push(GENERIC_ISSUE_TEXT[issue.code] ?? `issue ${issue.code}`);
    }
  }
  return `Local subject execution failed (${error.code}): ${parts.join("; ")}.`;
}

/** Fixed message for any non-LocalSubjectExecutionError thrown inside the external path: no caught text is exposed. */
export const UNEXPECTED_EXTERNAL_FAILURE_MESSAGE =
  "Local subject execution failed (EXECUTION_FAILED): execution failed before completing (details withheld).";
