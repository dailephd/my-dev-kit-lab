import type { AgentId } from "../../agents/types.js";
import type { ExperimentRun } from "../../experiments/index.js";
import type { WarmIndexAgentSideEvidenceV1 } from "../../experiments/plugins/warmIndexReuse/agentEvaluation.js";
import type { WarmIndexReuseRun } from "../../experiments/plugins/warmIndexReuse/plugin.js";
import {
  WARM_INDEX_REUSE_REPORT_SCHEMA_VERSION,
  type WarmIndexAgentEvidenceStatus,
  type WarmIndexCampaignOutcomeCountsV1,
  type WarmIndexReuseReportAgentIdentityV1,
  type WarmIndexReuseReportAgentV1,
  type WarmIndexReuseReportCampaignV1,
  type WarmIndexReuseReportProjectV1,
  type WarmIndexReuseReportV1,
  type WarmIndexTokenEvidenceStatus,
} from "./warmIndexReuseReportModel.js";

const WARM_INDEX_REUSE_PLUGIN_ID = "warm-index-reuse";

const COMMON_LIMITATIONS = [
  "Context estimated-token counts use the character-based estimate and are not provider billing telemetry.",
  "Correctness is deterministic answer-key scoring, not semantic LLM judging.",
  "Component-duration sums are not equivalent to provider end-to-end latency.",
  "Failed or missing prefix measurements make cumulative metrics unavailable; missing values are never treated as zero.",
  "No composite score, winner, ranking, or break-even task is calculated.",
];

const FAKE_AGENT_LIMITATIONS = [
  "Agent evidence is deterministic simulated fake-agent evidence.",
  "Fake-agent total tokens are simulated harness telemetry, not provider billing telemetry.",
];

const CODEX_CAMPAIGN_LIMITATIONS = [
  "Agent evidence comes from Codex CLI campaign execution over the exact runner-supplied benchmark contexts.",
  "Token totals are CLI-exposed adapter telemetry when available.",
  "Token evidence must be interpreted using tokenUsageSource/tokenUsageReliability.",
  "Context estimates are never substituted for missing agent token totals.",
];

const CLAUDE_CAMPAIGN_LIMITATIONS = [
  "Agent evidence comes from Claude CLI campaign execution over the exact runner-supplied benchmark contexts.",
  "Token totals are used when exposed by the CLI output.",
  "Token totals may be unavailable for some CLI/version/run outcomes.",
  "Unavailable token totals remain unavailable and are never replaced by zero or a context estimate.",
];

const COST_MODEL = [
  "Index construction is a one-time cost per benchmark project; task retrieval is the repeated warm cost.",
  "Cold start: for the first task in a project, the cumulative warm component duration is the one-time index build plus the first retrieval.",
  "Warm reuse: later tasks do not rebuild the index; their warm operation duration is retrieval only.",
  "Amortized index build duration after N tasks is the index build duration divided by N.",
  "Raw cumulative duration sums one raw-context construction per task; warm cumulative component duration includes one index build plus each warm retrieval once.",
  "Cumulative durations are sums of measured components, not wall-clock or end-to-end latency, and are not presented as a speedup.",
];

const OUTCOME_STATUS_TO_COUNT_KEY: Record<string, keyof WarmIndexCampaignOutcomeCountsV1> = {
  completed: "completed",
  failed: "failed",
  timeout: "timeout",
  "invalid-output": "invalidOutput",
  "agent-unavailable": "agentUnavailable",
  "agent-limit-reached": "agentLimitReached",
  skipped: "skipped",
};

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

  const campaignPreset = readString(run.metadata?.campaignPreset);
  const campaignAgentId = readString(run.metadata?.campaignAgentId);
  const campaignTimeoutMs = readNumber(run.metadata?.campaignTimeoutMs);
  if (campaignAgentId !== undefined && campaignAgentId !== "codex" && campaignAgentId !== "claude") {
    throw new Error(`Invalid warm-index report source: unsupported campaign agent id ${campaignAgentId}.`);
  }
  const isCampaign = campaignPreset !== undefined;

  const allSides: Array<WarmIndexAgentSideEvidenceV1 | null> = [];

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
        const rawEvidence = agents?.raw ?? null;
        const warmEvidence = agents?.warm ?? null;
        allSides.push(rawEvidence, warmEvidence);
        return {
          taskOrdinal: task.taskOrdinal,
          caseId: task.caseId,
          rawStatus: execution.tasks[taskIndex].rawStatus,
          warmStatus: execution.tasks[taskIndex].warmStatus,
          raw: task.raw,
          warm: task.warm,
          rawAgent: toReportAgent(rawEvidence),
          warmAgent: toReportAgent(warmEvidence),
        };
      }),
    };
  });

  const agentIdentity = deriveAgentIdentity({ isCampaign, campaignAgentId, sides: allSides });
  const agentCampaign = isCampaign
    ? buildCampaignSummary({
        presetId: campaignPreset!,
        agentId: agentIdentity.id as "codex" | "claude",
        timeoutMs: campaignTimeoutMs ?? 0,
        selectedCaseCount: projects.reduce((sum, project) => sum + project.taskCount, 0),
        sides: allSides,
      })
    : null;

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
    limitations: buildLimitations(agentIdentity),
    projects,
    agent: agentIdentity,
    agentCampaign,
  };
}

function deriveAgentIdentity(args: {
  isCampaign: boolean;
  campaignAgentId: string | undefined;
  sides: Array<WarmIndexAgentSideEvidenceV1 | null>;
}): WarmIndexReuseReportAgentIdentityV1 {
  const nonNullAgentIds = new Set(args.sides.filter((side): side is WarmIndexAgentSideEvidenceV1 => side !== null).map((side) => side.agentId));

  if (!args.isCampaign) {
    if ([...nonNullAgentIds].some((agentId) => agentId !== "fake-agent")) {
      throw new Error(
        `Invalid warm-index report source: a legacy non-campaign run must not contain non-fake agent evidence, found ${[...nonNullAgentIds].join(", ")}.`
      );
    }
    return { id: "fake-agent", mode: "deterministic-fake" };
  }

  const campaignAgentId = args.campaignAgentId as AgentId | undefined;
  if (!campaignAgentId) {
    throw new Error("Invalid warm-index report source: a campaign run must carry a campaignAgentId.");
  }
  for (const agentId of nonNullAgentIds) {
    if (agentId !== campaignAgentId) {
      throw new Error(
        `Invalid warm-index report source: campaign metadata says ${campaignAgentId} but agent evidence contains ${agentId}.`
      );
    }
  }
  return { id: campaignAgentId, mode: "real-provider" };
}

function buildCampaignSummary(args: {
  presetId: string;
  agentId: "codex" | "claude";
  timeoutMs: number;
  selectedCaseCount: number;
  sides: Array<WarmIndexAgentSideEvidenceV1 | null>;
}): WarmIndexReuseReportCampaignV1 {
  const scheduledSideCount = args.selectedCaseCount * 2;
  const executedSides = args.sides.filter((side): side is WarmIndexAgentSideEvidenceV1 => side !== null);
  const executedSideCount = executedSides.length;
  const notRunForMissingContextCount = scheduledSideCount - executedSideCount;

  const outcomeCounts: WarmIndexCampaignOutcomeCountsV1 = {
    completed: 0,
    failed: 0,
    timeout: 0,
    invalidOutput: 0,
    agentUnavailable: 0,
    agentLimitReached: 0,
    skipped: 0,
  };
  for (const side of executedSides) {
    const key = OUTCOME_STATUS_TO_COUNT_KEY[side.status];
    if (!key) {
      throw new Error(`Invalid warm-index report source: unsupported campaign agent status "${side.status}".`);
    }
    outcomeCounts[key] += 1;
  }

  const tokenAvailableSideCount = executedSides.filter(
    (side) => typeof side.tokenUsage.totalTokens === "number" && Number.isFinite(side.tokenUsage.totalTokens)
  ).length;

  const agentEvidenceStatus: WarmIndexAgentEvidenceStatus =
    executedSideCount === 0
      ? "unavailable"
      : executedSideCount === scheduledSideCount && outcomeCounts.completed === executedSideCount
        ? "complete"
        : "partial";

  const tokenEvidenceStatus: WarmIndexTokenEvidenceStatus =
    executedSideCount === 0
      ? "unavailable"
      : tokenAvailableSideCount === 0
        ? "unavailable"
        : tokenAvailableSideCount === executedSideCount
          ? "complete"
          : "partial";

  return {
    presetId: args.presetId,
    agentId: args.agentId,
    timeoutMs: args.timeoutMs,
    selectedCaseCount: args.selectedCaseCount,
    scheduledSideCount,
    executedSideCount,
    notRunForMissingContextCount,
    outcomeCounts,
    agentEvidenceStatus,
    tokenEvidenceStatus,
  };
}

function buildLimitations(agent: WarmIndexReuseReportAgentIdentityV1): string[] {
  if (agent.mode === "deterministic-fake") {
    return [...COMMON_LIMITATIONS, ...FAKE_AGENT_LIMITATIONS];
  }
  const providerLimitations = agent.id === "codex" ? CODEX_CAMPAIGN_LIMITATIONS : CLAUDE_CAMPAIGN_LIMITATIONS;
  return [...COMMON_LIMITATIONS, ...providerLimitations];
}

function toReportAgent(agent: WarmIndexAgentSideEvidenceV1 | null): WarmIndexReuseReportAgentV1 | null {
  if (!agent) return null;
  return {
    agentId: agent.agentId,
    status: agent.status,
    passed: agent.correctness.passed,
    tokenUsageSource: agent.tokenUsage.source,
    tokenUsageReliability: agent.tokenUsage.reliability,
    warnings: [...agent.warnings],
    errors: [...agent.errors],
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
