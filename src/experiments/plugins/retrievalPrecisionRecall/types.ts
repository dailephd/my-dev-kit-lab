import type {
  RetrievalCommandEvidenceV1,
  RetrievalEvidenceAvailability,
  RetrievalQualityMetricsV1
} from "../../../evaluation/retrievalQuality/index.js";
import type { ExperimentRunStatus } from "../../types.js";

export type RetrievalPrecisionRecallErrorCode =
  | "ground-truth-invalid"
  | "project-group-inconsistent"
  | "project-index-failed"
  | "retrieval-failed";

export type RetrievalPrecisionRecallErrorV1 = {
  code: RetrievalPrecisionRecallErrorCode;
  /** Bounded and path-redacted. */
  message: string;
};

/**
 * Context-free retrieval summary. It deliberately omits contextText, raw stdout/stderr, command lines,
 * and every machine-local path; the normalized command evidence comes from retrieval-evidence-v1.
 */
export type RetrievalPrecisionRecallRetrievalSummaryV1 = {
  skipped: boolean;
  durationMs: number;
  totalEstimatedTokens: number;
  tokenCountMethod: string;
  warnings: string[];
  evidenceAvailability: RetrievalEvidenceAvailability | "missing";
  evidenceAvailabilityReason: string | null;
  retrievedFileCount: number | null;
  retrievedSymbolCount: number | null;
  commands: RetrievalCommandEvidenceV1[];
};

/**
 * COMPLETED: retrieval evidence available and metrics calculated. PARTIAL: retrieval returned but its evidence
 * was partial/unavailable/missing. FAILED: no retrieval measurement exists (index, ground truth, or execution error).
 */
/**
 * Present only on external-local durable case evidence: states which identity classes were withheld, so a consumer
 * reading "<redacted file 1>" knows it is one withheld identity, not a literal file name and not "no file".
 */
export type RetrievalPrecisionRecallIdentityRedactionV1 = {
  fileIdentities: "redacted";
  symbolIdentities: "redacted";
  factIdentities: "redacted";
  warningText: "redacted";
  caseTitle: "redacted";
};

export type RetrievalPrecisionRecallCaseEvidenceV1 = {
  caseId: string;
  caseName: string;
  benchmarkProject: string;
  taskLocality: string | null;
  status: ExperimentRunStatus;
  retrieval: RetrievalPrecisionRecallRetrievalSummaryV1 | null;
  quality: RetrievalQualityMetricsV1 | null;
  errors: RetrievalPrecisionRecallErrorV1[];
  /** Absent for bundled cases, which keep their real benchmark identities. */
  identityRedaction?: RetrievalPrecisionRecallIdentityRedactionV1;
};

export type RetrievalPrecisionRecallRatioAggregateV1 = {
  availableCount: number;
  unavailableCount: number;
  notApplicableCount: number;
  /** Macro mean over available per-case values only; null when none are available. */
  meanValue: number | null;
};

export type RetrievalPrecisionRecallTokenAggregateV1 = {
  availableCount: number;
  unavailableCount: number;
  totalTokens: number | null;
  meanTokens: number | null;
  minTokens: number | null;
  maxTokens: number | null;
};

export const RETRIEVAL_PRECISION_RECALL_RATIO_KEYS = [
  "filePrecision",
  "fileRecall",
  "symbolPrecision",
  "symbolRecall",
  "factCoverage",
  "irrelevantContextRatio"
] as const;

export type RetrievalPrecisionRecallRatioKey = (typeof RETRIEVAL_PRECISION_RECALL_RATIO_KEYS)[number];

export type RetrievalPrecisionRecallAggregateV1 = {
  runSummary: {
    projectCount: number;
    caseCount: number;
    completedCaseCount: number;
    partialCaseCount: number;
    failedCaseCount: number;
    /** Failed cases have no retrieval result and are counted in none of the three evidence counts. */
    retrievalEvidenceAvailableCaseCount: number;
    retrievalEvidencePartialCaseCount: number;
    retrievalEvidenceUnavailableCaseCount: number;
  };
  ratios: Record<RetrievalPrecisionRecallRatioKey, RetrievalPrecisionRecallRatioAggregateV1>;
  tokens: RetrievalPrecisionRecallTokenAggregateV1;
  /** Task-instance occurrence sums; identical paths in different projects or cases are never deduplicated. */
  occurrences: {
    totalMissedFileOccurrences: number;
    totalMissedSymbolOccurrences: number;
    totalUncoveredFactOccurrences: number;
    totalIrrelevantRetrievedFileOccurrences: number;
    totalIrrelevantRetrievedSymbolOccurrences: number;
    /** Cases whose identity lists were computable; the totals above exclude the remaining cases. */
    fileOccurrenceEvidenceCaseCount: number;
    symbolOccurrenceEvidenceCaseCount: number;
    factOccurrenceEvidenceCaseCount: number;
  };
};
