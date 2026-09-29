// v0.6.3 -- plugin-specific presentation model for the four-treatment V2 execution artifact. Types only:
// projection lives in buildIncrementalChangeStalenessReportV2.ts, rendering in the text/HTML renderers.

import type {
  IncrementalChangeStalenessExecutionSummaryV2,
  IncrementalChangeStalenessLifecycleSummaryV2,
  IncrementalChangeStalenessTreatmentSummaryV2
} from "../../experiments/plugins/incrementalChangeStaleness/executionArtifactV2.js";
import type { IncrementalChangeStalenessReferenceComparisonV2 } from "../../experiments/plugins/incrementalChangeStaleness/executionV2.js";

export const INCREMENTAL_CHANGE_STALENESS_REPORT_SCHEMA_VERSION_V2 = "my-dev-kit-lab-incremental-change-staleness-report-v2";

/** Reused from the persisted V2 execution artifact; the report never redefines these shapes. */
export type IncrementalChangeStalenessReportLifecycleV2 = IncrementalChangeStalenessLifecycleSummaryV2;
export type IncrementalChangeStalenessReportTreatmentV2 = IncrementalChangeStalenessTreatmentSummaryV2;
export type IncrementalChangeStalenessReportReferenceComparisonV2 = IncrementalChangeStalenessReferenceComparisonV2;

/**
 * One scenario. Treatments and comparisons are ordered collections identified by explicit ids
 * (`treatmentId`, `candidateTreatmentId` / `referenceTreatmentId`), never by fixed fields. A failed
 * scenario keeps `treatments` empty rather than fabricating evidence.
 */
export type IncrementalChangeStalenessReportScenarioV2 = {
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
  lifecycle: IncrementalChangeStalenessReportLifecycleV2 | null;
  treatments: IncrementalChangeStalenessReportTreatmentV2[];
  referenceComparisons: IncrementalChangeStalenessReportReferenceComparisonV2[];
};

/**
 * Deliberately has no overall score, grade, winner, best/recommended treatment, safe-to-skip-refresh, or
 * risk-percent field: the report presents scoped, per-scenario, descriptive evidence only.
 */
export type IncrementalChangeStalenessReportV2 = {
  schemaVersion: typeof INCREMENTAL_CHANGE_STALENESS_REPORT_SCHEMA_VERSION_V2;
  pluginId: string;
  summary: IncrementalChangeStalenessExecutionSummaryV2;
  scenarios: IncrementalChangeStalenessReportScenarioV2[];
  limitations: string[];
};
