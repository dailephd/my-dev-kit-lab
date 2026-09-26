import type { AgentId } from "../../agents/types.js";
import type {
  AffectedNeighborhoodEvidenceStatus,
  AffectedNeighborhoodTaskUnresolvedV1,
  AffectedTaskRelationship,
  ReindexRecommendation,
} from "../../evaluation/affectedNeighborhood.js";
import type { IndexFreshnessStatus, IndexFreshnessUnresolvedReason } from "../../evaluation/indexFreshness.js";
import type { IndexSnapshotStatus } from "../../evaluation/indexSnapshot.js";
import type {
  WarmIndexNumberMetricV1,
  WarmIndexRawTaskMetricsV1,
  WarmIndexWarmTaskMetricsV1,
} from "../../experiments/plugins/warmIndexReuse/metrics.js";
import type { ExperimentRunStatus } from "../../experiments/types.js";

export const WARM_INDEX_REUSE_REPORT_SCHEMA_VERSION = "my-dev-kit-lab-warm-index-report-v1";

/** Report presentation limits; the full persisted lists stay in warm-index-execution.json. */
export const MAX_REPORT_FRESHNESS_CHANGES = 20;
export const MAX_REPORT_FRESHNESS_UNRESOLVED = 10;
export const MAX_REPORT_AFFECTED_NODES = 20;
export const MAX_REPORT_AFFECTED_EDGES = 20;
export const MAX_REPORT_AFFECTED_TASK_UNRESOLVED = 10;
export const MAX_REPORT_AFFECTED_TASK_AMBIGUOUS = 10;
export const MAX_REPORT_AFFECTED_WARNINGS = 10;

/** A confirmed change; hashes and sizes are deliberately not part of the report presentation. */
export type WarmIndexReuseReportFreshnessChangeV1 = {
  path: string;
  changeType: "modified" | "missing";
};

export type WarmIndexReuseReportFreshnessUnresolvedV1 = {
  path: string | null;
  reasonCode: IndexFreshnessUnresolvedReason;
  message: string;
};

/** `totalCount` is the persisted list length; `items` holds at most the report display limit. */
export type WarmIndexReuseReportBoundedListV1<T> = {
  totalCount: number;
  displayedCount: number;
  omittedCount: number;
  items: T[];
};

/**
 * Bounded presentation of the persisted per-task freshness assessment. Observational evidence
 * over files the index snapshot represents; never an execution, provider, or retrieval verdict.
 */
export type WarmIndexReuseReportFreshnessV1 = {
  status: IndexFreshnessStatus;
  assessedAt: string;
  baselineSnapshotStatus: IndexSnapshotStatus;
  indexedFileCount: number;
  comparableFileCount: number;
  unchangedFileCount: number;
  changedFileCount: number;
  missingFileCount: number;
  unresolvedFileCount: number;
  changes: WarmIndexReuseReportBoundedListV1<WarmIndexReuseReportFreshnessChangeV1>;
  unresolved: WarmIndexReuseReportBoundedListV1<WarmIndexReuseReportFreshnessUnresolvedV1>;
  warnings: string[];
};

/** Direct presentation counts (not ExperimentMetric entries): unassessed means no assessment is present. */
export type WarmIndexReuseReportFreshnessSummaryV1 = {
  assessedTaskCount: number;
  unassessedTaskCount: number;
  freshTaskCount: number;
  staleTaskCount: number;
  partiallyStaleTaskCount: number;
  unknownTaskCount: number;
};

/**
 * Bounded presentation of one persisted affected-neighborhood assessment (v0.6.1). Numeric fields
 * are the warm-side metric objects from the metric owner, never re-derived here. The categorical
 * relationship and recommendation are observational evidence about this bounded analysis only.
 */
export type WarmIndexReuseReportAffectedNeighborhoodV1 = {
  status: AffectedNeighborhoodEvidenceStatus;
  freshnessStatus: IndexFreshnessStatus;
  seedMappingStatus: AffectedNeighborhoodEvidenceStatus;
  graphEvidenceStatus: AffectedNeighborhoodEvidenceStatus;
  neighborhoodStatus: AffectedNeighborhoodEvidenceStatus;
  metrics: {
    changedFileCount: WarmIndexNumberMetricV1;
    changedSymbolCount: WarmIndexNumberMetricV1;
    affectedNodeCount: WarmIndexNumberMetricV1;
    affectedEdgeCount: WarmIndexNumberMetricV1;
    taskOverlapCount: WarmIndexNumberMetricV1;
    taskOverlapPercent: WarmIndexNumberMetricV1;
  };
  taskMappingStatus: AffectedNeighborhoodEvidenceStatus;
  resolvableTaskNodeCount: number;
  relationship: AffectedTaskRelationship;
  reindexRecommendation: ReindexRecommendation;
  /** Fixed neutral wording for the recommendation category. */
  recommendationExplanation: string;
  /** `totalCount` values are the persisted totals, not the displayed lengths. */
  affectedNodeIds: WarmIndexReuseReportBoundedListV1<string>;
  participatingEdgeIds: WarmIndexReuseReportBoundedListV1<string>;
  unresolvedTaskMappings: WarmIndexReuseReportBoundedListV1<AffectedNeighborhoodTaskUnresolvedV1>;
  ambiguousTaskSymbols: WarmIndexReuseReportBoundedListV1<{ name: string; candidateNodeIds: string[] }>;
  warnings: WarmIndexReuseReportBoundedListV1<{ code: string; message: string }>;
};

/** Presentation counts over persisted per-task evidence; not ExperimentMetric entries. */
export type WarmIndexReuseReportAffectedNeighborhoodSummaryV1 = {
  assessedTaskCount: number;
  unassessedTaskCount: number;
  completeAssessmentCount: number;
  partialAssessmentCount: number;
  unavailableAssessmentCount: number;
  relatedTaskCount: number;
  unrelatedTaskCount: number;
  unknownRelationshipTaskCount: number;
  recommendedReindexCount: number;
  notIndicatedReindexCount: number;
  unknownReindexRecommendationCount: number;
};

/** Bounded agent evaluation state for one task side; values live in the metric fields. */
export type WarmIndexReuseReportAgentV1 = {
  agentId: AgentId;
  status: string;
  passed: boolean | null;
  tokenUsageSource: string;
  tokenUsageReliability: string;
  warnings: string[];
  errors: string[];
};

export type WarmIndexReuseReportTaskV1 = {
  taskOrdinal: number;
  caseId: string;
  rawStatus: ExperimentRunStatus;
  warmStatus: ExperimentRunStatus;
  raw: WarmIndexRawTaskMetricsV1;
  warm: WarmIndexWarmTaskMetricsV1;
  /** null when the agent was not run for that side (no usable context evidence). */
  rawAgent: WarmIndexReuseReportAgentV1 | null;
  warmAgent: WarmIndexReuseReportAgentV1 | null;
  /**
   * Additive (v0.6.0 Batch 3): freshness immediately before this task's warm retrieval. null means
   * no assessment is present (for example a pre-v0.6.0 run) and is not the same as `unknown`.
   */
  indexFreshness: WarmIndexReuseReportFreshnessV1 | null;
  /**
   * Additive (v0.6.1): null means no assessment is present (not performed, or a pre-v0.6.1 run)
   * and is not the same as an assessment whose status is `unavailable`.
   */
  affectedNeighborhood: WarmIndexReuseReportAffectedNeighborhoodV1 | null;
};

export type WarmIndexReuseReportProjectV1 = {
  benchmarkProject: string;
  sessionKey: string;
  status: ExperimentRunStatus;
  sessionPrepared: boolean;
  indexBuildDurationMs: WarmIndexNumberMetricV1;
  taskCount: number;
  tasks: WarmIndexReuseReportTaskV1[];
};

/** The selected agent identity for the whole report: legacy deterministic fake agent or a real provider. */
export type WarmIndexReuseReportAgentIdentityV1 = {
  id: AgentId;
  mode: "deterministic-fake" | "real-provider";
};

export type WarmIndexAgentEvidenceStatus = "complete" | "partial" | "unavailable";
export type WarmIndexTokenEvidenceStatus = "complete" | "partial" | "unavailable";

export type WarmIndexCampaignOutcomeCountsV1 = {
  completed: number;
  failed: number;
  timeout: number;
  invalidOutput: number;
  agentUnavailable: number;
  agentLimitReached: number;
  skipped: number;
};

export type WarmIndexReuseReportCampaignV1 = {
  presetId: string;
  agentId: "codex" | "claude";
  timeoutMs: number;
  selectedCaseCount: number;
  scheduledSideCount: number;
  executedSideCount: number;
  notRunForMissingContextCount: number;
  outcomeCounts: WarmIndexCampaignOutcomeCountsV1;
  agentEvidenceStatus: WarmIndexAgentEvidenceStatus;
  tokenEvidenceStatus: WarmIndexTokenEvidenceStatus;
};

export type WarmIndexReuseReportV1 = {
  schemaVersion: typeof WARM_INDEX_REUSE_REPORT_SCHEMA_VERSION;
  summary: {
    projectCount: number;
    taskCount: number;
    preparedSessionProjectCount: number;
    incompleteProjectCount: number;
    agentSideCount: number;
    agentCorrectnessAvailableCount: number;
    agentTotalTokensAvailableCount: number;
  };
  /** Cold-versus-warm cost-model explanation, in reading order. */
  costModel: string[];
  limitations: string[];
  projects: WarmIndexReuseReportProjectV1[];
  /**
   * Additive (v0.5.2 Batch 4): always populated by the current report builder. Older serialized
   * v1 reports predate this field; consumers that read raw JSON (for example plot data) must
   * treat its absence as legacy fake-agent evidence rather than rejecting the report.
   */
  agent: WarmIndexReuseReportAgentIdentityV1;
  /** null for legacy non-campaign runs; populated for real-agent campaign runs. */
  agentCampaign: WarmIndexReuseReportCampaignV1 | null;
  /**
   * Additive (v0.6.0 Batch 3): always populated by the current report builder. Older serialized v1
   * reports predate this field and per-task `indexFreshness`; consumers must treat absence as
   * "no freshness assessment", not as an error.
   */
  indexFreshnessSummary: WarmIndexReuseReportFreshnessSummaryV1;
  /**
   * Additive (v0.6.1): always populated by the current builder. Older serialized v1 reports
   * predate this field and per-task `affectedNeighborhood`; absence means "not assessed".
   */
  affectedNeighborhoodSummary: WarmIndexReuseReportAffectedNeighborhoodSummaryV1;
};
