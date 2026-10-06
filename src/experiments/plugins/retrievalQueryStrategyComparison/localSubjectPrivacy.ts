import { compareCodeUnits } from "../../../evaluation/indexSnapshot.js";
import type { RetrievalQualityMetricsV1 } from "../../../evaluation/retrievalQuality/index.js";
import type { RetrievalQueryStrategyEvidenceV1 } from "../../../evaluation/retrievalQueryStrategyEvidence.js";
import { LocalSubjectExecutionError } from "../contextWindowScaling/localSubjectErrors.js";
import { redactedFileList } from "../contextWindowScaling/localSubjectPrivacy.js";
import type { RetrievalQueryStrategyComparisonAnalysisV1 } from "./analysisTypes.js";
import type {
  RetrievalQueryStrategyComparisonCaseEvidenceV1,
  RetrievalQueryStrategyComparisonErrorCode,
  RetrievalQueryStrategyIdentityRedactionV1,
  RetrievalQueryStrategyTreatmentEvidenceV1
} from "./types.js";

/** Single fixed placeholder for a withheld case title. */
export const RETRIEVAL_QUERY_STRATEGY_REDACTED_CASE_TITLE = "<redacted case title>";

/** The one V1 marker stamped on every externally projected case. */
export const RETRIEVAL_QUERY_STRATEGY_IDENTITY_REDACTION: RetrievalQueryStrategyIdentityRedactionV1 = {
  fileIdentities: "redacted",
  symbolIdentities: "redacted",
  factIdentities: "redacted",
  warningText: "redacted",
  caseTitle: "redacted",
  semanticNodeIds: "redacted"
};

export const RETRIEVAL_QUERY_STRATEGY_PRIVACY_FAILURE_MESSAGE =
  "External-local retrieval-query-strategy-comparison privacy projection failed; no durable output was written.";

export const RETRIEVAL_QUERY_STRATEGY_UNEXPECTED_EXTERNAL_FAILURE_MESSAGE =
  "Local subject retrieval-query-strategy comparison failed (EXECUTION_FAILED): execution failed before completing (details withheld).";

/** One opaque placeholder per identity: counts stay exact; null stays null; an empty list stays empty. */
function placeholders(kind: "symbol" | "fact" | "warning", count: number): string[] {
  return Array.from({ length: count }, (_, index) => `<redacted ${kind} ${index + 1}>`);
}

const filePlaceholders = (list: string[] | null): string[] | null => (list === null ? null : redactedFileList(list.length));
const symbolPlaceholders = (list: string[] | null): string[] | null => (list === null ? null : placeholders("symbol", list.length));
const factPlaceholders = (list: string[] | null): string[] | null => (list === null ? null : placeholders("fact", list.length));

/** Plugin-owned text per error code; a caught Error.message is never copied into durable external evidence. */
const FIXED_COMPARISON_ERROR_TEXT: Record<RetrievalQueryStrategyComparisonErrorCode, string> = {
  "ground-truth-invalid": "The case ground truth was invalid.",
  "project-group-inconsistent": "The case source configuration was inconsistent.",
  "project-index-failed": "The my-dev-kit index could not be prepared.",
  "strategy-index-copy-failed": "The isolated semantic-strategy index could not be prepared.",
  "retrieval-failed": "The retrieval strategy did not complete.",
  "strategy-index-cleanup-failed": "The isolated semantic-strategy index could not be removed."
};

function projectEvidence(evidence: RetrievalQueryStrategyEvidenceV1): RetrievalQueryStrategyEvidenceV1 {
  // One deterministic mapping per treatment over every file identity the evidence exposes.
  const identities = new Set<string>();
  for (const file of evidence.files) identities.add(file.path);
  for (const symbol of evidence.symbols) {
    if (symbol.file !== null) identities.add(symbol.file);
  }
  const mapping = new Map<string, string>();
  [...identities].sort(compareCodeUnits).forEach((identity, index) => mapping.set(identity, `<redacted file ${index + 1}>`));
  return {
    ...evidence,
    files: evidence.files.map((file) => ({ path: mapping.get(file.path) as string })),
    symbols: evidence.symbols.map((symbol, index) => ({
      name: `<redacted symbol ${index + 1}>`,
      nodeId: null,
      file: symbol.file === null ? null : (mapping.get(symbol.file) as string)
    })),
    steps: evidence.steps.map((step) => ({ ...step }))
  };
}

function projectTreatment(treatment: RetrievalQueryStrategyTreatmentEvidenceV1): RetrievalQueryStrategyTreatmentEvidenceV1 {
  return {
    ...treatment,
    retrieval:
      treatment.retrieval === null
        ? null
        : {
            ...treatment.retrieval,
            warnings: placeholders("warning", treatment.retrieval.warnings.length),
            steps: treatment.retrieval.steps.map((step) => ({ ...step }))
          },
    evidence: treatment.evidence === null ? null : projectEvidence(treatment.evidence),
    errors: treatment.errors.map((error) => ({ code: error.code, message: FIXED_COMPARISON_ERROR_TEXT[error.code] }))
  };
}

/**
 * Projects identity-bearing seven-treatment execution evidence into privacy-safe durable evidence. It performs no
 * metric calculation and changes no count or availability.
 */
export function projectRetrievalQueryStrategyExecutionForExternalLocalPersistence(
  evidence: readonly RetrievalQueryStrategyComparisonCaseEvidenceV1[]
): RetrievalQueryStrategyComparisonCaseEvidenceV1[] {
  return evidence.map((entry) => {
    const cloned = structuredClone(entry);
    return {
      caseId: cloned.caseId,
      caseName: RETRIEVAL_QUERY_STRATEGY_REDACTED_CASE_TITLE,
      benchmarkProject: cloned.benchmarkProject,
      taskLocality: cloned.taskLocality,
      treatments: cloned.treatments.map(projectTreatment),
      identityRedaction: { ...RETRIEVAL_QUERY_STRATEGY_IDENTITY_REDACTION }
    };
  });
}

/** Only identity lists change; every number, availability and fixed-vocabulary reason is carried through untouched. */
function projectRetrievalQualityMetricsForExternalPersistence(quality: RetrievalQualityMetricsV1): RetrievalQualityMetricsV1 {
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
 * Preserves every numeric scientific value and the strategy interpretation; replaces only the private identity lists
 * inside per-treatment quality. F1, means, Pareto fronts and the best strategy are never recalculated.
 */
export function projectRetrievalQueryStrategyAnalysisForExternalLocalPersistence(
  analysis: RetrievalQueryStrategyComparisonAnalysisV1
): RetrievalQueryStrategyComparisonAnalysisV1 {
  const cloned = structuredClone(analysis);
  return {
    cases: cloned.cases.map((entry) => ({
      ...entry,
      treatments: entry.treatments.map((treatment) => ({
        ...treatment,
        quality: treatment.quality === null ? null : projectRetrievalQualityMetricsForExternalPersistence(treatment.quality)
      }))
    })),
    scopes: cloned.scopes
  };
}

/**
 * Defense in depth: fails closed if a known private file path, case title, warning, or root survived projection. It
 * deliberately does not substring-search short symbol or fact identifiers, which would collide with ordinary words.
 */
export function assertRetrievalQueryStrategyExternalProjectionIsPrivate(
  projected: unknown,
  privateValues: {
    filePaths: readonly string[];
    caseTitles: readonly string[];
    warnings: readonly string[];
    privateRoots: readonly string[];
  }
): void {
  const serialized = JSON.stringify(projected);
  const variants = (value: string): string[] => {
    const forward = value.replace(/\\/g, "/");
    const backward = value.replace(/\//g, "\\");
    return [value, forward, backward].flatMap((entry) => [entry, JSON.stringify(entry).slice(1, -1)]);
  };
  const candidates = [...privateValues.filePaths, ...privateValues.caseTitles, ...privateValues.warnings, ...privateValues.privateRoots].filter(
    (value) => value.length > 0
  );
  if (candidates.some((value) => variants(value).some((variant) => serialized.includes(variant)))) {
    throw new Error(RETRIEVAL_QUERY_STRATEGY_PRIVACY_FAILURE_MESSAGE);
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
 * Safe, persistable description of an external-local failure: issue codes, counts and mutation kinds only. Execution
 * issue messages are fixed text by construction; nothing else (no path, identity, title, or caught text) can appear.
 */
export function describeRetrievalQueryStrategyLocalSubjectFailureForPersistence(error: LocalSubjectExecutionError): string {
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
  return `Local subject retrieval-query-strategy comparison failed (${error.code}): ${parts.join("; ")}.`;
}
