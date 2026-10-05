import type {
  RetrievalQueryStrategyEvidenceAvailability,
  RetrievalQueryStrategyEvidenceStepV1,
  RetrievalQueryStrategyEvidenceV1
} from "../../../evaluation/retrievalQueryStrategyEvidence.js";
import type { RetrievalQueryStrategyId } from "../../../evaluation/retrievalQueryStrategies.js";
import type { ExperimentRunStatus } from "../../types.js";

export type RetrievalQueryStrategyComparisonErrorCode =
  | "ground-truth-invalid"
  | "project-group-inconsistent"
  | "project-index-failed"
  | "strategy-index-copy-failed"
  | "strategy-index-cleanup-failed"
  | "retrieval-failed";

export type RetrievalQueryStrategyComparisonErrorV1 = {
  code: RetrievalQueryStrategyComparisonErrorCode;
  message: string;
};

/** Bounded retrieval summary. Holds no contextText, raw stdout/stderr, command lines, or machine-local paths. */
export type RetrievalQueryStrategyTreatmentSummaryV1 = {
  skipped: boolean;
  durationMs: number;
  totalEstimatedTokens: number;
  tokenCountMethod: string;
  warnings: string[];
  evidenceAvailability: RetrievalQueryStrategyEvidenceAvailability;
  evidenceAvailabilityReason: string | null;
  retrievedFileCount: number;
  retrievedSymbolCount: number;
  steps: RetrievalQueryStrategyEvidenceStepV1[];
};

export type RetrievalQueryStrategyTreatmentEvidenceV1 = {
  strategyId: RetrievalQueryStrategyId;
  status: ExperimentRunStatus;
  retrieval: RetrievalQueryStrategyTreatmentSummaryV1 | null;
  evidence: RetrievalQueryStrategyEvidenceV1 | null;
  errors: RetrievalQueryStrategyComparisonErrorV1[];
};

/** Stamped on every externally projected case so placeholders are never mistaken for real values. */
export type RetrievalQueryStrategyIdentityRedactionV1 = {
  fileIdentities: "redacted";
  symbolIdentities: "redacted";
  factIdentities: "redacted";
  warningText: "redacted";
  caseTitle: "redacted";
  semanticNodeIds: "redacted";
};

/** One case with exactly seven treatments, in RETRIEVAL_QUERY_STRATEGY_IDS order. */
export type RetrievalQueryStrategyComparisonCaseEvidenceV1 = {
  caseId: string;
  caseName: string;
  benchmarkProject: string;
  taskLocality: string | null;
  treatments: RetrievalQueryStrategyTreatmentEvidenceV1[];
  /** Present only on privacy-projected external-local evidence; bundled cases leave it absent. */
  identityRedaction?: RetrievalQueryStrategyIdentityRedactionV1;
};
