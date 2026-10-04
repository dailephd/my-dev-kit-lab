import type {
  RetrievalPrecisionRecallAggregateV1,
  RetrievalPrecisionRecallRatioKey
} from "../../experiments/plugins/retrievalPrecisionRecall/types.js";
import type { RetrievalEvidenceAvailability, RetrievalQualityMetricAvailability } from "../../evaluation/retrievalQuality/index.js";

export const RETRIEVAL_PRECISION_RECALL_REPORT_SCHEMA_VERSION = "my-dev-kit-lab-retrieval-precision-recall-report-v1";

/** Fixed human-facing bound for every identity list; the execution artifact keeps the complete lists. */
export const MAX_RETRIEVAL_REPORT_IDENTITIES = 20;

export type RetrievalPrecisionRecallReportBoundedListV1 = {
  totalCount: number;
  /** The first identities in deterministic Batch 2 order, at most MAX_RETRIEVAL_REPORT_IDENTITIES. */
  displayed: string[];
  displayedCount: number;
  omittedCount: number;
};

export type RetrievalPrecisionRecallReportMetricV1 = {
  availability: RetrievalQualityMetricAvailability;
  numerator: number | null;
  denominator: number | null;
  value: number | null;
  reason: string | null;
};

export type RetrievalPrecisionRecallReportCaseV1 = {
  caseId: string;
  caseName: string;
  benchmarkProject: string;
  taskLocality: string | null;
  status: string;
  evidenceAvailability: RetrievalEvidenceAvailability | "missing" | null;
  metrics: Record<RetrievalPrecisionRecallRatioKey, RetrievalPrecisionRecallReportMetricV1>;
  retrievedTokenCount: number | null;
  tokenCountMethod: string | null;
  /** null means the identity list could not be computed (unavailable evidence); it is never an empty list. */
  missedFiles: RetrievalPrecisionRecallReportBoundedListV1 | null;
  irrelevantRetrievedFiles: RetrievalPrecisionRecallReportBoundedListV1 | null;
  missedSymbols: RetrievalPrecisionRecallReportBoundedListV1 | null;
  irrelevantRetrievedSymbols: RetrievalPrecisionRecallReportBoundedListV1 | null;
  uncoveredFactIds: RetrievalPrecisionRecallReportBoundedListV1 | null;
  errors: string[];
};

export type RetrievalPrecisionRecallReportV1 = {
  schemaVersion: typeof RETRIEVAL_PRECISION_RECALL_REPORT_SCHEMA_VERSION;
  tokenCountMethod: string | null;
  runSummary: RetrievalPrecisionRecallAggregateV1["runSummary"];
  ratioSummaries: RetrievalPrecisionRecallAggregateV1["ratios"];
  tokenSummary: RetrievalPrecisionRecallAggregateV1["tokens"];
  occurrenceSummary: RetrievalPrecisionRecallAggregateV1["occurrences"];
  cases: RetrievalPrecisionRecallReportCaseV1[];
  limitations: string[];
};
