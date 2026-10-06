import type { RetrievalQualityRatioMetricV1 } from "../../evaluation/retrievalQuality/index.js";
import type { ExperimentRunStatus } from "../../experiments/index.js";
import type {
  ContextPackGenerationComparisonV1,
  ContextPackGenerationScopeAnalysisV1
} from "../../experiments/plugins/contextPackGeneration/analysisTypes.js";
import type { ContextPackGenerationMethodologyV1 } from "../../experiments/plugins/contextPackGeneration/analysisArtifact.js";
import type { ContextPackGenerationTreatmentId } from "../../experiments/plugins/contextPackGeneration/metadata.js";
import type {
  ContextPackAvailability,
  ContextPackEvidenceNoteCode,
  ContextPackFileReason,
  ContextPackSectionId,
  ContextPackTestOrigin
} from "../../experiments/plugins/contextPackGeneration/types.js";

export const CONTEXT_PACK_GENERATION_REPORT_SCHEMA_VERSION = "my-dev-kit-lab-context-pack-generation-report-v1";

/** Report-presentation limits only. They never change the experimental pack limits and are not CLI configuration. */
export const PACK_PREVIEW_MAX_FILES = 5;
export const PACK_PREVIEW_MAX_SYMBOLS = 5;
export const PACK_PREVIEW_MAX_SOURCE_SLICES = 3;
export const PACK_PREVIEW_MAX_SOURCE_LINES_PER_SLICE = 12;
export const PACK_PREVIEW_MAX_CALL_RELATIONSHIPS = 5;
export const PACK_PREVIEW_MAX_TESTS = 5;
export const PACK_PREVIEW_MAX_EVIDENCE_NOTES = 5;

export type ContextPackGenerationReportTreatmentV1 = {
  treatmentId: ContextPackGenerationTreatmentId;
  executionStatus: ExperimentRunStatus;
  availability: ContextPackAvailability | null;
  fileF1: RetrievalQualityRatioMetricV1;
  symbolF1: RetrievalQualityRatioMetricV1;
  factCoverage: RetrievalQualityRatioMetricV1;
  estimatedTokens: number | null;
  tokenCountMethod: string | null;
};

export type ContextPackGenerationReportCaseV1 = {
  caseId: string;
  caseName: string;
  benchmarkProject: string;
  taskLocality: string | null;
  /** Always [raw-full-file, context-pack]. */
  treatments: ContextPackGenerationReportTreatmentV1[];
  comparison: ContextPackGenerationComparisonV1;
};

/** A bounded display list: the shown items, the stored total, and how many the preview omitted. */
export type ContextPackPreviewListV1<T> = { items: T[]; totalCount: number; omittedCount: number };

export type ContextPackPreviewSectionSummaryV1 = {
  id: ContextPackSectionId;
  availability: ContextPackAvailability;
  reason: string | null;
  itemCount: number;
  estimatedTokens: number;
};

export type ContextPackPreviewSourceSliceV1 = {
  file: string;
  symbolName: string | null;
  startLine: number;
  endLine: number;
  /** Stored line count of the slice in the pack. */
  lineCount: number;
  boundaryKnown: boolean;
  /** Experiment-policy truncation recorded on the pack slice; never changed by the preview. */
  truncated: boolean;
  /** First lines of the stored slice, at most PACK_PREVIEW_MAX_SOURCE_LINES_PER_SLICE. */
  previewText: string;
  previewLineCount: number;
  /** True only when this report preview shows fewer lines than the stored slice. Independent of `truncated`. */
  previewTruncated: boolean;
};

/** Why a preview body is absent. Section summaries still come from persisted execution evidence. */
export type ContextPackPreviewStatus = "available" | "no-pack-produced" | "pack-artifact-unavailable";

export type ContextPackGenerationReportPreviewV1 = {
  caseId: string;
  status: ContextPackPreviewStatus;
  packArtifactPath: string | null;
  packAvailability: ContextPackAvailability | null;
  /** Section order: task, files, symbols, sourceSlices, callRelationships, tests, evidenceNotes. */
  sections: ContextPackPreviewSectionSummaryV1[];
  task: { title: string; summary: string } | null;
  files: ContextPackPreviewListV1<{ path: string; rank: number; reason: ContextPackFileReason }> | null;
  symbols: ContextPackPreviewListV1<{ name: string; file: string | null; line: number | null; nodeId: string | null }> | null;
  sourceSlices: ContextPackPreviewListV1<ContextPackPreviewSourceSliceV1> | null;
  callRelationships: ContextPackPreviewListV1<{ fromNodeId: string; toNodeId: string }> | null;
  tests: ContextPackPreviewListV1<{ path: string; how: ContextPackTestOrigin }> | null;
  evidenceNotes: ContextPackPreviewListV1<ContextPackEvidenceNoteCode> | null;
};

export type ContextPackGenerationReportArtifactRefV1 = { id: string; path: string | null; caseId: string | null };

export type ContextPackGenerationReportV1 = {
  schemaVersion: typeof CONTEXT_PACK_GENERATION_REPORT_SCHEMA_VERSION;
  experiment: { pluginId: string; target: string };
  /** Always [raw-full-file, context-pack]. */
  treatmentOrder: ContextPackGenerationTreatmentId[];
  methodology: ContextPackGenerationMethodologyV1;
  cases: ContextPackGenerationReportCaseV1[];
  /** Order: overall, localized, cross-module, broad-change. Copied from the persisted analysis. */
  scopes: ContextPackGenerationScopeAnalysisV1[];
  previews: ContextPackGenerationReportPreviewV1[];
  artifacts: ContextPackGenerationReportArtifactRefV1[];
  limitations: string[];
};
