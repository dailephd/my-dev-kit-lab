import type { ExperimentMetric } from "../../types.js";
import type { WarmIndexProjectSummaryV1, WarmIndexTaskSummaryV1 } from "./executionArtifact.js";
import type {
  WarmIndexAgentSideEvidenceV1,
  WarmIndexProjectAgentEvidenceV1,
  WarmIndexTaskAgentEvidenceV1,
} from "./fakeAgentEvaluation.js";

// ---------------------------------------------------------------------------
// Warm-index metric owner. Every warm-index formula (amortization, cumulative
// prefix sums, availability) is calculated here exactly once, as a pure
// transform over the bounded Prompt 2 execution summaries. Reports render
// these results; they never recalculate them.
// ---------------------------------------------------------------------------

export const WARM_INDEX_METRICS_SCHEMA_VERSION = "my-dev-kit-lab-warm-index-metrics-v1";

export type WarmIndexMetricAvailability = "available" | "unavailable" | "not-applicable";
export type WarmIndexMetricUnit = "ms" | "characters" | "estimated-tokens" | "tokens" | "score";
export type WarmIndexMetricSource = "measured" | "derived" | "estimated-chars-div-4" | "agent";

/**
 * available: finite value, null reason. unavailable / not-applicable: null value, non-empty
 * reason. Missing evidence is never represented as zero.
 */
export type WarmIndexNumberMetricV1 = {
  availability: WarmIndexMetricAvailability;
  value: number | null;
  unit: WarmIndexMetricUnit;
  source: WarmIndexMetricSource;
  reason: string | null;
  /** Token-count method behind estimated-token values; null for every other metric. */
  tokenCountMethod: string | null;
};

export type WarmIndexRawTaskMetricsV1 = {
  contextCharacters: WarmIndexNumberMetricV1;
  contextEstimatedTokens: WarmIndexNumberMetricV1;
  operationDurationMs: WarmIndexNumberMetricV1;
  cumulativeDurationMs: WarmIndexNumberMetricV1;
  cumulativeEstimatedContextTokens: WarmIndexNumberMetricV1;
  agentCorrectness: WarmIndexNumberMetricV1;
  agentTotalTokens: WarmIndexNumberMetricV1;
  cumulativeAgentTotalTokens: WarmIndexNumberMetricV1;
};

export type WarmIndexWarmTaskMetricsV1 = {
  contextCharacters: WarmIndexNumberMetricV1;
  contextEstimatedTokens: WarmIndexNumberMetricV1;
  retrievalDurationMs: WarmIndexNumberMetricV1;
  amortizedIndexBuildDurationMs: WarmIndexNumberMetricV1;
  cumulativeComponentDurationMs: WarmIndexNumberMetricV1;
  cumulativeEstimatedContextTokens: WarmIndexNumberMetricV1;
  agentCorrectness: WarmIndexNumberMetricV1;
  agentTotalTokens: WarmIndexNumberMetricV1;
  cumulativeAgentTotalTokens: WarmIndexNumberMetricV1;
};

export type WarmIndexTaskMetricsV1 = {
  caseId: string;
  /** 1-based position within the benchmark-project group; the amortization denominator. */
  taskOrdinal: number;
  raw: WarmIndexRawTaskMetricsV1;
  warm: WarmIndexWarmTaskMetricsV1;
};

export type WarmIndexProjectMetricsV1 = {
  benchmarkProject: string;
  sessionKey: string;
  sessionPrepared: boolean;
  indexBuildDurationMs: WarmIndexNumberMetricV1;
  tasks: WarmIndexTaskMetricsV1[];
};

export type WarmIndexMetricsV1 = {
  schemaVersion: typeof WARM_INDEX_METRICS_SCHEMA_VERSION;
  projects: WarmIndexProjectMetricsV1[];
};

const NO_AGENT_EVIDENCE_REASON = "No fake-agent evaluation evidence was supplied for this task.";
const AGENT_NOT_RUN_REASON = "The fake agent was not run because this side produced no context evidence.";

export function availableMetric(
  value: number,
  unit: WarmIndexMetricUnit,
  source: WarmIndexMetricSource,
  tokenCountMethod: string | null = null
): WarmIndexNumberMetricV1 {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return unavailableMetric(unit, source, `Invalid input: expected a finite number but received ${String(value)}.`, tokenCountMethod);
  }
  return { availability: "available", value, unit, source, reason: null, tokenCountMethod };
}

export function unavailableMetric(
  unit: WarmIndexMetricUnit,
  source: WarmIndexMetricSource,
  reason: string,
  tokenCountMethod: string | null = null
): WarmIndexNumberMetricV1 {
  return { availability: "unavailable", value: null, unit, source, reason: requireReason(reason), tokenCountMethod };
}

export function notApplicableMetric(
  unit: WarmIndexMetricUnit,
  source: WarmIndexMetricSource,
  reason: string
): WarmIndexNumberMetricV1 {
  return { availability: "not-applicable", value: null, unit, source, reason: requireReason(reason), tokenCountMethod: null };
}

function requireReason(reason: string): string {
  if (!reason.trim()) {
    throw new Error("Unavailable and not-applicable warm-index metrics require a reason.");
  }
  return reason;
}

/** Strict-prefix running sum: once one ordinal lacks evidence, every later ordinal stays unavailable. */
class PrefixSum {
  private total: number;
  private brokenReason: string | null;
  private method: string | null = null;

  constructor(
    private readonly unit: WarmIndexMetricUnit,
    private readonly source: WarmIndexMetricSource,
    start: { value: number } | { unavailableReason: string }
  ) {
    this.total = "value" in start ? start.value : 0;
    this.brokenReason = "unavailableReason" in start ? start.unavailableReason : null;
  }

  add(direct: WarmIndexNumberMetricV1, label: string): WarmIndexNumberMetricV1 {
    if (this.brokenReason === null) {
      if (direct.availability !== "available" || direct.value === null) {
        this.brokenReason = `${label} evidence is missing or invalid; the cumulative prefix is incomplete from this task onward.`;
      } else if (this.method !== null && direct.tokenCountMethod !== this.method) {
        this.brokenReason = `${label} uses token-count method ${String(direct.tokenCountMethod)} but earlier tasks used ${this.method}; mixed methods are not summed.`;
      } else {
        this.method = direct.tokenCountMethod;
        this.total += direct.value;
      }
    }
    return this.brokenReason === null
      ? availableMetric(this.total, this.unit, this.source, this.method)
      : unavailableMetric(this.unit, this.source, this.brokenReason, this.method);
  }
}

function indexBuildMetric(project: WarmIndexProjectSummaryV1): WarmIndexNumberMetricV1 {
  if (project.buildDurationMs === null) {
    return unavailableMetric(
      "ms",
      "measured",
      project.errors.length > 0
        ? "No index setup was attempted because the project group was structurally inconsistent."
        : "No index build evidence was recorded for this project."
    );
  }
  // A failed build is still a measured command duration; it is only excluded from warm costs below.
  return availableMetric(project.buildDurationMs, "ms", "measured");
}

/**
 * Fake-agent correctness and total tokens come only from bounded fake-agent evidence. Missing
 * token telemetry stays unavailable; estimated context tokens are never substituted.
 */
function agentSideMetrics(
  evidence: WarmIndexAgentSideEvidenceV1 | null | undefined
): Pick<WarmIndexRawTaskMetricsV1, "agentCorrectness" | "agentTotalTokens"> {
  if (evidence === undefined || evidence === null) {
    const reason = evidence === undefined ? NO_AGENT_EVIDENCE_REASON : AGENT_NOT_RUN_REASON;
    return {
      agentCorrectness: unavailableMetric("score", "agent", reason),
      agentTotalTokens: unavailableMetric("tokens", "agent", reason),
    };
  }
  const correctnessScore = evidence.correctness.score;
  const agentCorrectness =
    evidence.correctness.available && correctnessScore !== null
      ? availableMetric(correctnessScore, "score", "agent")
      : unavailableMetric(
          "score",
          "agent",
          `Fake-agent output was not scoreable (status ${evidence.status})${evidence.errors[0] ? `: ${evidence.errors[0]}` : "."}`
        );
  const agentTotalTokens =
    evidence.tokenUsage.totalTokens !== null
      ? availableMetric(evidence.tokenUsage.totalTokens, "tokens", "agent")
      : unavailableMetric(
          "tokens",
          "agent",
          `The fake agent did not report total tokens (token usage source ${evidence.tokenUsage.source}).`
        );
  return { agentCorrectness, agentTotalTokens };
}

function assertAgentEvidenceAligned(
  project: WarmIndexProjectSummaryV1,
  evidence: WarmIndexProjectAgentEvidenceV1 | undefined
): void {
  if (!evidence) return;
  const aligned =
    evidence.benchmarkProject === project.benchmarkProject &&
    evidence.tasks.length === project.tasks.length &&
    evidence.tasks.every((task, index) => task.caseId === project.tasks[index].caseId);
  if (!aligned) {
    throw new Error(`Fake-agent evidence is not aligned with the execution summary for ${project.benchmarkProject}.`);
  }
}

export function calculateWarmIndexProjectMetrics(
  project: WarmIndexProjectSummaryV1,
  agentEvidence?: WarmIndexProjectAgentEvidenceV1
): WarmIndexProjectMetricsV1 {
  assertAgentEvidenceAligned(project, agentEvidence);
  const indexBuildDurationMs = indexBuildMetric(project);
  const buildUsable = project.sessionPrepared && indexBuildDurationMs.availability === "available";
  const noSessionReason = project.sessionPrepared
    ? "Index build duration is unavailable, so warm index cost cannot be calculated."
    : "No valid warm index session was prepared for this project, so the index build cost is not charged to warm tasks.";

  const rawDuration = new PrefixSum("ms", "measured", { value: 0 });
  const rawTokens = new PrefixSum("estimated-tokens", "estimated-chars-div-4", { value: 0 });
  // The one-time build is charged exactly once, as the starting value of the warm prefix.
  const warmDuration = new PrefixSum(
    "ms",
    "derived",
    buildUsable ? { value: indexBuildDurationMs.value as number } : { unavailableReason: noSessionReason }
  );
  const warmTokens = new PrefixSum("estimated-tokens", "estimated-chars-div-4", { value: 0 });
  // Fake-agent token totals accumulate separately from estimated context tokens.
  const rawAgentTokens = new PrefixSum("tokens", "agent", { value: 0 });
  const warmAgentTokens = new PrefixSum("tokens", "agent", { value: 0 });

  const tasks = project.tasks.map((task, index): WarmIndexTaskMetricsV1 => {
    const taskOrdinal = index + 1;
    const label = (side: string) => `Task ${taskOrdinal} (${task.caseId}) ${side}`;
    const raw = rawDirect(task);
    const warm = warmDirect(task);
    const taskAgentEvidence: WarmIndexTaskAgentEvidenceV1 | undefined = agentEvidence?.tasks[index];
    const rawAgent = agentSideMetrics(agentEvidence ? taskAgentEvidence?.raw ?? null : undefined);
    const warmAgent = agentSideMetrics(agentEvidence ? taskAgentEvidence?.warm ?? null : undefined);
    return {
      caseId: task.caseId,
      taskOrdinal,
      raw: {
        ...raw,
        cumulativeDurationMs: rawDuration.add(raw.operationDurationMs, label("raw duration")),
        cumulativeEstimatedContextTokens: rawTokens.add(raw.contextEstimatedTokens, label("raw estimated context tokens")),
        ...rawAgent,
        cumulativeAgentTotalTokens: rawAgentTokens.add(rawAgent.agentTotalTokens, label("raw fake-agent total tokens")),
      },
      warm: {
        ...warm,
        // Amortized build cost after N tasks = build duration / N.
        amortizedIndexBuildDurationMs: buildUsable
          ? availableMetric((indexBuildDurationMs.value as number) / taskOrdinal, "ms", "derived")
          : unavailableMetric("ms", "derived", noSessionReason),
        cumulativeComponentDurationMs: warmDuration.add(warm.retrievalDurationMs, label("warm retrieval duration")),
        cumulativeEstimatedContextTokens: warmTokens.add(warm.contextEstimatedTokens, label("warm estimated context tokens")),
        ...warmAgent,
        cumulativeAgentTotalTokens: warmAgentTokens.add(warmAgent.agentTotalTokens, label("warm fake-agent total tokens")),
      },
    };
  });

  return {
    benchmarkProject: project.benchmarkProject,
    sessionKey: project.sessionKey,
    sessionPrepared: project.sessionPrepared,
    indexBuildDurationMs,
    tasks,
  };
}

function rawDirect(task: WarmIndexTaskSummaryV1) {
  const raw = task.rawBaseline;
  if (!raw) {
    const reason = `No raw baseline evidence was produced (raw status ${task.rawStatus}).`;
    return {
      contextCharacters: unavailableMetric("characters", "measured", reason),
      contextEstimatedTokens: unavailableMetric("estimated-tokens", "estimated-chars-div-4", reason),
      operationDurationMs: unavailableMetric("ms", "measured", reason),
    };
  }
  return {
    contextCharacters: availableMetric(raw.totalChars, "characters", "measured"),
    contextEstimatedTokens: availableMetric(raw.totalEstimatedTokens, "estimated-tokens", "estimated-chars-div-4", raw.tokenCountMethod),
    operationDurationMs: availableMetric(raw.durationMs, "ms", "measured"),
  };
}

function warmDirect(task: WarmIndexTaskSummaryV1) {
  const warm = task.warmRetrieval;
  if (!warm) {
    const reason = `No warm retrieval was run for this task (warm status ${task.warmStatus}).`;
    return {
      contextCharacters: unavailableMetric("characters", "measured", reason),
      contextEstimatedTokens: unavailableMetric("estimated-tokens", "estimated-chars-div-4", reason),
      retrievalDurationMs: unavailableMetric("ms", "measured", reason),
    };
  }
  // A skipped retrieval still carries measured values; its skipped status stays on the outcome.
  return {
    contextCharacters: availableMetric(warm.totalChars, "characters", "measured"),
    contextEstimatedTokens: availableMetric(warm.totalEstimatedTokens, "estimated-tokens", "estimated-chars-div-4", warm.tokenCountMethod),
    retrievalDurationMs: availableMetric(warm.durationMs, "ms", "measured"),
  };
}

/** Pure, order-preserving calculation; ordinals and cumulative state restart for every project. */
export function calculateWarmIndexMetrics(
  projects: readonly WarmIndexProjectSummaryV1[],
  agentEvidence?: readonly WarmIndexProjectAgentEvidenceV1[]
): WarmIndexMetricsV1 {
  if (agentEvidence && agentEvidence.length !== projects.length) {
    throw new Error("Fake-agent evidence is not aligned with the execution summaries.");
  }
  return {
    schemaVersion: WARM_INDEX_METRICS_SCHEMA_VERSION,
    projects: projects.map((project, index) => calculateWarmIndexProjectMetrics(project, agentEvidence?.[index])),
  };
}

type GenericMetricSpec = {
  id: string;
  name: string;
  description: string;
  metric: WarmIndexNumberMetricV1;
};

/** Generic outcome metrics: only available numeric values are emitted, never placeholder zeros. */
export function toRawOutcomeMetrics(task: WarmIndexTaskMetricsV1, variantId: string): ExperimentMetric[] {
  return toExperimentMetrics(task.caseId, variantId, [
    { id: "context-character-count", name: "Context characters", description: "Characters in the raw full-file context.", metric: task.raw.contextCharacters },
    { id: "context-estimated-token-count", name: "Estimated context tokens", description: "Character-based estimate of raw context tokens; not provider token usage.", metric: task.raw.contextEstimatedTokens },
    { id: "operation-duration-ms", name: "Operation duration", description: "Measured raw full-file context construction duration.", metric: task.raw.operationDurationMs },
    { id: "cumulative-component-duration-ms", name: "Cumulative component duration", description: "Sum of raw context construction durations for tasks 1..N in this project.", metric: task.raw.cumulativeDurationMs },
    { id: "cumulative-context-estimated-token-count", name: "Cumulative estimated context tokens", description: "Sum of raw estimated context tokens for tasks 1..N in this project; not provider token usage.", metric: task.raw.cumulativeEstimatedContextTokens },
    ...agentSpecs(task.raw),
  ]);
}

export function toWarmOutcomeMetrics(task: WarmIndexTaskMetricsV1, variantId: string): ExperimentMetric[] {
  return toExperimentMetrics(task.caseId, variantId, [
    { id: "context-character-count", name: "Context characters", description: "Characters in the retrieved my-dev-kit context.", metric: task.warm.contextCharacters },
    { id: "context-estimated-token-count", name: "Estimated context tokens", description: "Character-based estimate of retrieved context tokens; not provider token usage.", metric: task.warm.contextEstimatedTokens },
    { id: "operation-duration-ms", name: "Operation duration", description: "Measured retrieval-only duration (search, lookup, slice, source); excludes index build.", metric: task.warm.retrievalDurationMs },
    { id: "cumulative-component-duration-ms", name: "Cumulative component duration", description: "One index build plus retrieval durations for tasks 1..N in this project; a component sum, not wall-clock latency.", metric: task.warm.cumulativeComponentDurationMs },
    { id: "cumulative-context-estimated-token-count", name: "Cumulative estimated context tokens", description: "Sum of retrieved estimated context tokens for tasks 1..N in this project; not provider token usage.", metric: task.warm.cumulativeEstimatedContextTokens },
    { id: "amortized-index-build-duration-ms", name: "Amortized index build duration", description: "Index build duration divided by this task's ordinal within its project.", metric: task.warm.amortizedIndexBuildDurationMs },
    ...agentSpecs(task.warm),
  ]);
}

function agentSpecs(side: Pick<WarmIndexRawTaskMetricsV1, "agentCorrectness" | "agentTotalTokens" | "cumulativeAgentTotalTokens">): GenericMetricSpec[] {
  return [
    { id: "agent-correctness-score", name: "Fake-agent correctness score", description: "Deterministic fake-agent correctness from the existing benchmark answer-key scorer; not real-model correctness.", metric: side.agentCorrectness },
    { id: "agent-total-tokens", name: "Fake-agent total tokens", description: "Simulated fake-agent harness token total; not provider billing telemetry.", metric: side.agentTotalTokens },
    { id: "cumulative-agent-total-tokens", name: "Cumulative fake-agent total tokens", description: "Sum of simulated fake-agent token totals for tasks 1..N in this project; not provider billing telemetry.", metric: side.cumulativeAgentTotalTokens },
  ];
}

function toExperimentMetrics(caseId: string, variantId: string, specs: GenericMetricSpec[]): ExperimentMetric[] {
  return specs
    .filter((spec) => spec.metric.availability === "available" && spec.metric.value !== null)
    .map((spec) => ({
      id: spec.id,
      name: spec.name,
      value: spec.metric.value,
      unit: spec.metric.unit,
      description: spec.description,
      variantId,
      caseId,
    }));
}

/** Run-level metrics are limited to direct counts. */
export function toRunLevelMetrics(metrics: WarmIndexMetricsV1): ExperimentMetric[] {
  return [
    { id: "warm-index-project-count", name: "Warm-index project count", value: metrics.projects.length, unit: "count", description: "Benchmark-project groups in this run." },
    {
      id: "warm-index-task-count",
      name: "Warm-index task count",
      value: metrics.projects.reduce((sum, project) => sum + project.tasks.length, 0),
      unit: "count",
      description: "Tasks evaluated across all benchmark-project groups.",
    },
    {
      id: "warm-index-session-prepared-project-count",
      name: "Prepared warm-index session count",
      value: metrics.projects.filter((project) => project.sessionPrepared).length,
      unit: "count",
      description: "Benchmark-project groups for which exactly one warm index session was prepared.",
    },
  ];
}
