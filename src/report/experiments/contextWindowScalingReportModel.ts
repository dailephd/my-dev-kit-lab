import type {
  BudgetTreatmentSummaryV1,
  CaseTreatmentContextSummaryV1,
  ContextWindowScalingRunSummaryV1,
  RelevantFileSummaryV1,
} from "../../experiments/plugins/contextWindowScaling/metrics.js";
import type { ContextWindowScalingTreatmentId } from "../../experiments/plugins/contextWindowScaling/metadata.js";
import type { RelevantFileEvidenceStatus } from "../../experiments/plugins/contextWindowScaling/relevantFiles.js";
import type { BudgetCellEvidence } from "../../experiments/plugins/contextWindowScaling/successEvidence.js";

export const CONTEXT_WINDOW_SCALING_REPORT_SCHEMA_VERSION = "my-dev-kit-lab-context-window-scaling-report-v1";

/** Presentation limit only; the full omitted identities stay in context-window-scaling-execution.json. */
export const MAX_REPORT_OMITTED_RELEVANT_FILES = 20;

/** `totalCount` is the persisted list length; `items` holds at most the display limit. */
export type ContextWindowScalingReportBoundedListV1<T> = {
  totalCount: number;
  displayedCount: number;
  omittedCount: number;
  truncated: boolean;
  items: T[];
};

export type ContextWindowScalingReportCaseTreatmentV1 = {
  caseId: string;
  caseName: string;
  variantId: ContextWindowScalingTreatmentId;
  contextStatus: CaseTreatmentContextSummaryV1["contextStatus"];
  characterCount: number | null;
  estimatedTokens: number | null;
  tokenCountMethod: string | null;
  observedFileCount: number | null;
  relevantFileStatus: RelevantFileEvidenceStatus;
  expectedRelevantFileCount: number;
  observedExpectedFileCount: number | null;
  omittedRelevantFileCount: number | null;
  /** Bounded display of the omitted identities; omittedRelevantFileCount is always the full count. */
  omittedRelevantFiles: ContextWindowScalingReportBoundedListV1<string>;
  relevantFileReason: string | null;
};

/** One row per case x treatment x budget; values are the persisted cell evidence. */
export type ContextWindowScalingReportCellV1 = {
  caseId: string;
  variantId: ContextWindowScalingTreatmentId;
  contextEstimatedTokens: number | null;
} & BudgetCellEvidence;

export type ContextWindowScalingReportV1 = {
  schemaVersion: typeof CONTEXT_WINDOW_SCALING_REPORT_SCHEMA_VERSION;
  budgets: number[];
  treatments: ContextWindowScalingTreatmentId[];
  tokenCountMethod: string | null;
  runSummary: ContextWindowScalingRunSummaryV1;
  budgetTreatmentSummaries: BudgetTreatmentSummaryV1[];
  caseTreatmentContexts: ContextWindowScalingReportCaseTreatmentV1[];
  caseBudgetCells: ContextWindowScalingReportCellV1[];
  relevantFileSummary: RelevantFileSummaryV1;
  interpretation: string[];
};
