import type { ExperimentRun } from "../../experiments/index.js";
import type { WarmIndexAgentSideEvidenceV1 } from "../../experiments/plugins/warmIndexReuse/fakeAgentEvaluation.js";
import type { WarmIndexReuseRun } from "../../experiments/plugins/warmIndexReuse/plugin.js";
import {
  WARM_INDEX_REUSE_REPORT_SCHEMA_VERSION,
  type WarmIndexReuseReportAgentV1,
  type WarmIndexReuseReportProjectV1,
  type WarmIndexReuseReportV1,
} from "./warmIndexReuseReportModel.js";

const WARM_INDEX_REUSE_PLUGIN_ID = "warm-index-reuse";

const COST_MODEL = [
  "Index construction is a one-time cost per benchmark project; task retrieval is the repeated warm cost.",
  "Cold start: for the first task in a project, the cumulative warm component duration is the one-time index build plus the first retrieval.",
  "Warm reuse: later tasks do not rebuild the index; their warm operation duration is retrieval only.",
  "Amortized index build duration after N tasks is the index build duration divided by N.",
  "Raw cumulative duration sums one raw-context construction per task; warm cumulative component duration includes one index build plus each warm retrieval once.",
  "Cumulative durations are sums of measured components, not wall-clock or end-to-end latency, and are not presented as a speedup.",
];

const LIMITATIONS = [
  "Context estimated-token counts use the existing character-based estimate and are not provider billing telemetry.",
  "Agent evidence comes from the deterministic fake agent only; real agents such as Codex or Claude are not run by warm-index-reuse in v0.5.0.",
  "Fake-agent correctness is deterministic benchmark-harness evidence from the existing answer-key scorer, not a measure of real-model correctness.",
  "Fake-agent token totals are simulated harness telemetry, not provider billing telemetry; estimated context tokens are a separate character-based context-size estimate.",
  "Component-duration sums are not equivalent to provider end-to-end latency.",
  "Failed or missing prefix measurements make cumulative metrics unavailable; missing values are never treated as zero.",
  "No composite score, winner, ranking, or break-even task is calculated.",
];

/**
 * Presents the warm-index metrics already calculated on the run. It performs no amortization,
 * cumulative, or availability calculation of its own.
 */
export function buildWarmIndexReuseReport(run: ExperimentRun): WarmIndexReuseReportV1 | null {
  if (run.pluginId !== WARM_INDEX_REUSE_PLUGIN_ID) return null;

  const candidate = run as Partial<WarmIndexReuseRun>;
  const executions = candidate.projectExecutions ?? [];
  const metricProjects = candidate.warmIndexMetrics?.projects ?? [];
  const agentProjects = candidate.agentEvidence;
  if (executions.length !== metricProjects.length) {
    throw new Error("Invalid warm-index report source: project executions and metrics are inconsistent.");
  }

  const projects = executions.map((execution, projectIndex): WarmIndexReuseReportProjectV1 => {
    const metrics = metricProjects[projectIndex];
    if (
      metrics.benchmarkProject !== execution.benchmarkProject ||
      metrics.tasks.length !== execution.tasks.length ||
      metrics.tasks.some((task, taskIndex) => task.caseId !== execution.tasks[taskIndex].caseId)
    ) {
      throw new Error("Invalid warm-index report source: project executions and metrics are inconsistent.");
    }
    return {
      benchmarkProject: execution.benchmarkProject,
      sessionKey: execution.sessionKey,
      status: execution.status,
      sessionPrepared: metrics.sessionPrepared,
      indexBuildDurationMs: metrics.indexBuildDurationMs,
      taskCount: metrics.tasks.length,
      tasks: metrics.tasks.map((task, taskIndex) => {
        const agents = agentProjects?.[projectIndex]?.tasks[taskIndex];
        return {
          taskOrdinal: task.taskOrdinal,
          caseId: task.caseId,
          rawStatus: execution.tasks[taskIndex].rawStatus,
          warmStatus: execution.tasks[taskIndex].warmStatus,
          raw: task.raw,
          warm: task.warm,
          rawAgent: toReportAgent(agents?.raw ?? null),
          warmAgent: toReportAgent(agents?.warm ?? null),
        };
      }),
    };
  });

  const sides = projects.flatMap((project) => project.tasks.flatMap((task) => [task.raw, task.warm]));
  return {
    schemaVersion: WARM_INDEX_REUSE_REPORT_SCHEMA_VERSION,
    summary: {
      projectCount: projects.length,
      taskCount: projects.reduce((sum, project) => sum + project.taskCount, 0),
      preparedSessionProjectCount: projects.filter((project) => project.sessionPrepared).length,
      incompleteProjectCount: projects.filter((project) => project.status !== "completed").length,
      agentSideCount: sides.length,
      agentCorrectnessAvailableCount: sides.filter((side) => side.agentCorrectness.availability === "available").length,
      agentTotalTokensAvailableCount: sides.filter((side) => side.agentTotalTokens.availability === "available").length,
    },
    costModel: [...COST_MODEL],
    limitations: [...LIMITATIONS],
    projects,
  };
}

function toReportAgent(agent: WarmIndexAgentSideEvidenceV1 | null): WarmIndexReuseReportAgentV1 | null {
  if (!agent) return null;
  return {
    status: agent.status,
    passed: agent.correctness.passed,
    tokenUsageSource: agent.tokenUsage.source,
    tokenUsageReliability: agent.tokenUsage.reliability,
    warnings: [...agent.warnings],
    errors: [...agent.errors],
  };
}
