import type {
  WarmIndexNumberMetricV1,
  WarmIndexRawTaskMetricsV1,
  WarmIndexWarmTaskMetricsV1,
} from "../../experiments/plugins/warmIndexReuse/metrics.js";
import type { ExperimentRunStatus } from "../../experiments/types.js";

export const WARM_INDEX_REUSE_REPORT_SCHEMA_VERSION = "my-dev-kit-lab-warm-index-report-v1";

/** Bounded fake-agent evaluation state for one task side; values live in the metric fields. */
export type WarmIndexReuseReportAgentV1 = {
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
  /** null when the fake agent was not run for that side. */
  rawAgent: WarmIndexReuseReportAgentV1 | null;
  warmAgent: WarmIndexReuseReportAgentV1 | null;
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
};
