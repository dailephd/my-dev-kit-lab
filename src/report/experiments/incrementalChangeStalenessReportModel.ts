// v0.6.2 Batch 5 -- plugin-specific presentation model types only. No projection logic, no HTML,
// no text rendering, and no recomputation live here; see buildIncrementalChangeStalenessReport.ts
// and renderIncrementalChangeStalenessHtml.ts for those responsibilities.

import type { IncrementalChangeStalenessComparisonV1 } from "../../experiments/plugins/incrementalChangeStaleness/execution.js";
import type {
  IncrementalChangeStalenessLifecycleSummaryV1,
  IncrementalChangeStalenessTreatmentSummaryV1
} from "../../experiments/plugins/incrementalChangeStaleness/executionArtifact.js";

export const INCREMENTAL_CHANGE_STALENESS_REPORT_SCHEMA_VERSION = "my-dev-kit-lab-incremental-change-staleness-report-v1";

/** Reused from the persisted Batch 4 execution artifact; the report never redefines this shape. */
export type IncrementalChangeStalenessReportLifecycleV1 = IncrementalChangeStalenessLifecycleSummaryV1;

/** Reused from the persisted Batch 4 execution artifact; the report never redefines this shape. */
export type IncrementalChangeStalenessReportTreatmentV1 = IncrementalChangeStalenessTreatmentSummaryV1;

/**
 * One scenario's report presentation. Treatment order is always stale-index then full-refresh
 * (fields, not an array) so both sides stay independently visible; see Section 12/34 of the frozen
 * batch plan. `status: "failed"` scenarios keep both treatment fields null rather than fabricating
 * evidence (Section 27).
 */
export type IncrementalChangeStalenessReportScenarioV1 = {
  scenarioId: string;
  category: string;
  benchmarkProjectId: string;
  baseCaseId: string;
  status: "ready" | "failed";
  failureReason: string | null;
  query: string | null;
  answerPolicy: string;
  expectedFiles: string[];
  expectedSymbols: string[];
  lifecycle: IncrementalChangeStalenessReportLifecycleV1 | null;
  staleTreatment: IncrementalChangeStalenessReportTreatmentV1 | null;
  fullRefreshTreatment: IncrementalChangeStalenessReportTreatmentV1 | null;
  comparison: IncrementalChangeStalenessComparisonV1;
};

/**
 * Top-level plugin report section. Deliberately has no overall score, grade, winner, best-treatment,
 * safe-to-skip-reindex, or stale-risk-percent field (Section 8/24): the experiment reports scoped,
 * per-scenario evidence only.
 */
export type IncrementalChangeStalenessReportV1 = {
  schemaVersion: typeof INCREMENTAL_CHANGE_STALENESS_REPORT_SCHEMA_VERSION;
  pluginId: string;
  scenarioCount: number;
  readyScenarioCount: number;
  failedScenarioCount: number;
  observedStaleRegressionCount: number;
  noObservedStaleRegressionCount: number;
  inconclusiveCount: number;
  scenarios: IncrementalChangeStalenessReportScenarioV1[];
  limitations: string[];
};
