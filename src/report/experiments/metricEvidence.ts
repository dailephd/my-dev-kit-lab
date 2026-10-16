// Report-presentation projection of metric evidence. It reads an already built PluginExperimentReport and
// produces display views and deterministic caveats. It never recalculates a scientific value, never converts
// unavailable or not-applicable evidence to zero, and never mutates its input. Provenance and reliability are
// taken only from evidence the report carries; anything else stays explicitly `unknown`.

import type { ExperimentMetricValue } from "../../experiments/index.js";
import { RAW_FULL_FILE_VARIANT_ID, WARM_INDEX_REUSE_VARIANT_ID } from "../../experiments/plugins/warmIndexReuse/plugin.js";
import type { WarmIndexNumberMetricV1 } from "../../experiments/plugins/warmIndexReuse/metrics.js";
import type { ExperimentRun } from "../../experiments/index.js";
import type { AgentSuccessCaseEvidenceV1 } from "../../experiments/plugins/agentSuccessRate/executionTypes.js";
import { attemptEvidenceOf } from "../../experiments/plugins/agentSuccessRate/attemptEvidence.js";
import type { PluginExperimentReport } from "./experimentReportModel.js";
import {
  pluginLocalMetricId,
  resolveMetricDescriptor,
  type MetricDescriptorV1,
} from "./metricGlossary.js";

export type MetricEvidenceAvailability = "available" | "unavailable" | "not-applicable";
export type MetricProvenance = "provider-reported" | "agent-reported" | "estimated" | "measured" | "derived" | "unknown";
export type MetricReliability = "high" | "medium" | "low" | "unavailable" | "unknown";

export type MetricEvidenceViewV1 = {
  metricId: string;
  pluginId: string;
  displayName: string;
  value: ExperimentMetricValue;
  unit: string | null;
  availability: MetricEvidenceAvailability;
  /** null means no reason was recorded; a reason is never invented. */
  reason: string | null;
  provenance: MetricProvenance;
  reliability: MetricReliability;
  variantId: string | null;
  caseId: string | null;
  /** In-document glossary anchor; null when the metric has no glossary descriptor. */
  glossaryAnchor: string | null;
};

export type MetricCaveatKind =
  | "metric-unavailable"
  | "metric-not-applicable"
  | "estimated-not-provider-usage"
  | "telemetry-provenance-unknown"
  | "telemetry-reliability-low"
  | "telemetry-reliability-unknown"
  | "telemetry-partial"
  | "glossary-missing";

export type MetricCaveatV1 = {
  id: string;
  kind: MetricCaveatKind;
  severity: "info" | "warning";
  pluginId: string;
  metricId: string | null;
  text: string;
};

const KIND_ORDER: readonly MetricCaveatKind[] = [
  "metric-unavailable",
  "metric-not-applicable",
  "telemetry-partial",
  "telemetry-provenance-unknown",
  "telemetry-reliability-low",
  "telemetry-reliability-unknown",
  "estimated-not-provider-usage",
  "glossary-missing",
];

/**
 * Producer token-telemetry evidence that exists at report-build time but is not carried in report.json. It is
 * supplied out of band to the renderers; without it provenance and reliability stay explicitly unknown.
 */
export type AttemptTelemetryEvidence = {
  caseId: string;
  treatmentId: string;
  attemptNumber: number;
  providerInvoked: boolean;
  /** Recorded token source (TokenUsageSource) or null when the attempt recorded no token usage. */
  tokenSource: string | null;
  tokenReliability: string | null;
  totalTokensAvailable: boolean;
};

export type MetricReportEvidence = { agentSuccessAttempts?: readonly AttemptTelemetryEvidence[] };

/** Collects per-attempt telemetry already recorded in agent-success execution evidence. Pure; no I/O. */
export function collectMetricReportEvidence(run: ExperimentRun): MetricReportEvidence {
  // Only the agent-success-rate plugin records per-attempt token telemetry in this shape.
  if (run.pluginId !== "agent-success-rate") return {};
  const cases = (run as unknown as { caseExecutionEvidence?: AgentSuccessCaseEvidenceV1[] }).caseExecutionEvidence;
  if (!Array.isArray(cases)) return {};
  const attempts: AttemptTelemetryEvidence[] = [];
  for (const entry of cases) {
    if (!entry || !Array.isArray(entry.treatments)) continue;
    for (const treatment of entry.treatments) {
      attemptEvidenceOf(treatment).forEach((evidence, index) => {
        const usage = evidence.agentTokenUsage;
        attempts.push({
          caseId: entry.caseId,
          treatmentId: treatment.treatmentId,
          attemptNumber: index + 1,
          providerInvoked: evidence.realAgent?.providerInvoked === true,
          tokenSource: usage ? usage.source : null,
          tokenReliability: usage ? usage.reliability : null,
          totalTokensAvailable: usage !== null && typeof usage.totalTokens === "number"
        });
      });
    }
  }
  return { agentSuccessAttempts: attempts };
}

const MAX_LISTED = 10;
const MAX_REASONS = 3;
const AGENT_SUCCESS_PREFIX = "agent-success-rate.";
const DESCRIPTION_PATTERN = /^(available|unavailable|not-applicable)(?::\s*([\s\S]*))?$/;

type Telemetry = { provenance: MetricProvenance; reliability: MetricReliability };

function provenanceOfTokenSource(source: string): MetricProvenance {
  switch (source) {
    case "provider-reported":
      return "provider-reported";
    case "agent-reported":
    case "cli-json":
      return "agent-reported";
    case "estimated-from-text":
      return "estimated";
    default:
      // "otel" is unattributed telemetry and "unavailable" carries no source: neither is assumed.
      return "unknown";
  }
}

function reliabilityOf(value: string | null | undefined): MetricReliability {
  return value === "high" || value === "medium" || value === "low" || value === "unavailable" ? value : "unknown";
}

function basisProvenance(descriptor: MetricDescriptorV1 | null): MetricProvenance {
  switch (descriptor?.measurementBasis) {
    case "measured":
      return "measured";
    case "estimated":
      return "estimated";
    case "derived":
    case "verification-verdict":
    case "answer-key-set-measure":
      return "derived";
    default:
      return "unknown";
  }
}

function isTokenTelemetry(descriptor: MetricDescriptorV1 | null): boolean {
  return descriptor?.measurementBasis === "agent-token-telemetry";
}

function telemetryKey(variantId: string | null, caseId: string | null): string {
  return `${variantId ?? ""}\u0000${caseId ?? ""}`;
}

/** Per variant/case token telemetry that the warm-index report already carries. */
function warmIndexTelemetry(report: PluginExperimentReport): Map<string, Telemetry> {
  const result = new Map<string, Telemetry>();
  for (const project of report.warmIndexReuse?.projects ?? []) {
    for (const task of project.tasks) {
      for (const [variantId, agent] of [
        [RAW_FULL_FILE_VARIANT_ID, task.rawAgent],
        [WARM_INDEX_REUSE_VARIANT_ID, task.warmAgent],
      ] as const) {
        if (!agent) continue;
        result.set(telemetryKey(variantId, task.caseId), {
          provenance: provenanceOfTokenSource(agent.tokenUsageSource),
          reliability: reliabilityOf(agent.tokenUsageReliability),
        });
      }
    }
  }
  return result;
}

function commonValue<T extends string>(values: readonly T[], unknownValue: T): T {
  if (values.length === 0) return unknownValue;
  const first = values[0] as T;
  return values.every((value) => value === first) ? first : unknownValue;
}

/**
 * Aggregate telemetry across contributing measurements. Provenance and reliability are attributed only when every
 * contributor is known and identical; any missing or differing contributor leaves the aggregate unknown.
 */
function aggregateTelemetry(parts: ReadonlyArray<Telemetry | null>): Telemetry {
  if (parts.length === 0 || parts.some((part) => part === null)) return { provenance: "unknown", reliability: "unknown" };
  const known = parts as Telemetry[];
  const provenance = commonValue(known.map((part) => part.provenance), "unknown" as MetricProvenance);
  const reliability = commonValue(known.map((part) => part.reliability), "unknown" as MetricReliability);
  return { provenance, reliability };
}

/** Cumulative warm-index token telemetry per variant/case: the strict prefix of tasks 1..N in the project. */
function warmIndexCumulativeTelemetry(report: PluginExperimentReport): Map<string, Telemetry> {
  const result = new Map<string, Telemetry>();
  for (const project of report.warmIndexReuse?.projects ?? []) {
    const tasks = [...project.tasks].sort((a, b) => a.taskOrdinal - b.taskOrdinal);
    for (const [variantId, pick] of [
      [RAW_FULL_FILE_VARIANT_ID, (task: (typeof tasks)[number]) => task.rawAgent],
      [WARM_INDEX_REUSE_VARIANT_ID, (task: (typeof tasks)[number]) => task.warmAgent]
    ] as const) {
      const parts: Array<Telemetry | null> = [];
      for (const task of tasks) {
        const agent = pick(task);
        parts.push(agent ? { provenance: provenanceOfTokenSource(agent.tokenUsageSource), reliability: reliabilityOf(agent.tokenUsageReliability) } : null);
        result.set(telemetryKey(variantId, task.caseId), aggregateTelemetry(parts));
      }
    }
  }
  return result;
}

function agentSuccessTelemetry(
  localId: string,
  caseId: string | null,
  variantId: string | null,
  evidence: MetricReportEvidence | undefined
): Telemetry | null {
  if (!evidence?.agentSuccessAttempts || caseId === null || variantId === null) return null;
  const attempts = evidence.agentSuccessAttempts
    .filter((attempt) => attempt.caseId === caseId && attempt.treatmentId === variantId)
    .sort((a, b) => a.attemptNumber - b.attemptNumber);
  if (attempts.length === 0) return null;
  const one = (attempt: AttemptTelemetryEvidence | undefined): Telemetry | null =>
    attempt && attempt.providerInvoked && attempt.totalTokensAvailable && attempt.tokenSource !== null
      ? { provenance: provenanceOfTokenSource(attempt.tokenSource), reliability: reliabilityOf(attempt.tokenReliability) }
      : null;
  switch (localId) {
    case "firstAttemptProviderTokens":
      return one(attempts[0]);
    case "agentTotalTokens":
    case "finalAttemptProviderTokens":
      return one(attempts[attempts.length - 1]);
    case "totalProviderTokens":
      // Cumulative over the attempts that actually ran provider processes.
      return aggregateTelemetry(attempts.filter((attempt) => attempt.providerInvoked).map(one));
    default:
      return null;
  }
}

function warmUnavailableAgentTokenViews(report: PluginExperimentReport, telemetry: Map<string, Telemetry>): MetricEvidenceViewV1[] {
  const pluginId = report.plugin.id;
  const descriptor = resolveMetricDescriptor(pluginId, "agent-total-tokens");
  const views: MetricEvidenceViewV1[] = [];
  for (const project of report.warmIndexReuse?.projects ?? []) {
    for (const task of project.tasks) {
      for (const [variantId, metric] of [
        [RAW_FULL_FILE_VARIANT_ID, task.raw?.agentTotalTokens],
        [WARM_INDEX_REUSE_VARIANT_ID, task.warm?.agentTotalTokens],
      ] as const) {
        const measurement = metric as WarmIndexNumberMetricV1 | undefined;
        if (!measurement || measurement.availability === "available") continue;
        const known = telemetry.get(telemetryKey(variantId, task.caseId));
        views.push({
          metricId: "agent-total-tokens",
          pluginId,
          displayName: descriptor?.displayName ?? "Agent total tokens",
          value: null,
          unit: measurement.unit ?? null,
          availability: measurement.availability,
          reason: measurement.reason,
          provenance: known?.provenance ?? "unknown",
          reliability: known?.reliability ?? "unknown",
          variantId,
          caseId: task.caseId,
          glossaryAnchor: descriptor?.anchor ?? null,
        });
      }
    }
  }
  return views;
}

/** Builds one evidence view per rendered metric, preserving report order. Pure; never mutates the report. */
export function buildMetricEvidenceViews(report: PluginExperimentReport, evidence?: MetricReportEvidence): MetricEvidenceViewV1[] {
  const pluginId = report.plugin.id;
  const telemetry = warmIndexTelemetry(report);
  const cumulative = warmIndexCumulativeTelemetry(report);
  const views: MetricEvidenceViewV1[] = report.metrics.map((metric) => {
    const descriptor = resolveMetricDescriptor(pluginId, metric.id);
    const parsed = metric.id.startsWith(AGENT_SUCCESS_PREFIX) && metric.description ? DESCRIPTION_PATTERN.exec(metric.description) : null;
    let availability: MetricEvidenceAvailability = metric.value === null ? "unavailable" : "available";
    let reason: string | null = null;
    if (parsed) {
      availability = parsed[1] as MetricEvidenceAvailability;
      reason = parsed[2] !== undefined && parsed[2].trim() !== "" ? parsed[2].trim() : null;
      if (availability === "available") reason = null;
    }
    const localId = pluginLocalMetricId(pluginId, metric.id);
    const key = telemetryKey(metric.variantId ?? null, metric.caseId ?? null);
    const tokenMetric = isTokenTelemetry(descriptor);
    const known: Telemetry | null | undefined = !tokenMetric
      ? null
      : pluginId === "agent-success-rate"
        ? agentSuccessTelemetry(localId, metric.caseId ?? null, metric.variantId ?? null, evidence)
        : localId.startsWith("cumulative-")
          ? cumulative.get(key)
          : telemetry.get(key);
    return {
      metricId: metric.id,
      pluginId,
      displayName: descriptor?.displayName ?? metric.name,
      value: metric.value,
      unit: metric.unit ?? descriptor?.unit ?? null,
      availability,
      reason,
      provenance: tokenMetric ? (known ? known.provenance : "unknown") : basisProvenance(descriptor),
      reliability: tokenMetric && known ? known.reliability : "unknown",
      variantId: metric.variantId ?? null,
      caseId: metric.caseId ?? null,
      glossaryAnchor: descriptor?.anchor ?? null,
    };
  });
  return [...views, ...warmUnavailableAgentTokenViews(report, telemetry)];
}

type Group = { pluginId: string; metricId: string; displayName: string; views: MetricEvidenceViewV1[] };

function groupByMetric(views: readonly MetricEvidenceViewV1[]): Group[] {
  const groups = new Map<string, Group>();
  for (const view of views) {
    const key = `${view.pluginId}\u0000${view.metricId}`;
    const group = groups.get(key) ?? { pluginId: view.pluginId, metricId: view.metricId, displayName: view.displayName, views: [] };
    group.views.push(view);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function boundedList(values: readonly string[], limit: number): string {
  const sorted = values.map((value) => value.replace(/[.s]+$/, "")).sort();
  const shown = sorted.slice(0, limit).join("; ");
  return sorted.length > limit ? `${shown}; and ${sorted.length - limit} more` : shown;
}

function label(group: Group): string {
  return `"${group.displayName}" (${group.metricId})`;
}

/**
 * Deterministic, de-duplicated caveats derived from the views and from evidence the report already carries.
 * Caveats supplement the report's own warnings and never change a scientific conclusion.
 */
export function buildMetricEvidenceCaveats(report: PluginExperimentReport, views: readonly MetricEvidenceViewV1[]): MetricCaveatV1[] {
  const byId = new Map<string, MetricCaveatV1>();
  const add = (caveat: MetricCaveatV1): void => {
    if (!byId.has(caveat.id)) byId.set(caveat.id, caveat);
  };

  for (const group of groupByMetric(views)) {
    const total = group.views.length;
    const descriptor = resolveMetricDescriptor(group.pluginId, group.metricId);
    const base = { pluginId: group.pluginId, metricId: group.metricId };
    const unavailable = group.views.filter((view) => view.availability === "unavailable");
    if (unavailable.length > 0) {
      const reasons = [...new Set(unavailable.map((view) => view.reason).filter((reason): reason is string => reason !== null))];
      add({
        ...base,
        id: `metric-unavailable:${group.pluginId}:${group.metricId}`,
        kind: "metric-unavailable",
        severity: "warning",
        text:
          `${label(group)} is unavailable for ${unavailable.length} of ${total} measurement(s); unavailable is not zero.` +
          (reasons.length > 0 ? ` Recorded reason(s): ${boundedList(reasons, MAX_REASONS)}.` : " No reason was recorded."),
      });
    }
    const notApplicable = group.views.filter((view) => view.availability === "not-applicable");
    if (notApplicable.length > 0) {
      const reasons = [...new Set(notApplicable.map((view) => view.reason).filter((reason): reason is string => reason !== null))];
      add({
        ...base,
        id: `metric-not-applicable:${group.pluginId}:${group.metricId}`,
        kind: "metric-not-applicable",
        severity: "info",
        text:
          `${label(group)} is not applicable for ${notApplicable.length} of ${total} measurement(s); this is not a zero or a failure.` +
          (reasons.length > 0 ? ` Recorded reason(s): ${boundedList(reasons, MAX_REASONS)}.` : " No reason was recorded."),
      });
    }
    const estimated = group.views.filter((view) => view.provenance === "estimated" && view.availability === "available");
    if (estimated.length > 0) {
      add({
        ...base,
        id: `estimated-not-provider-usage:${group.pluginId}:${group.metricId}`,
        kind: "estimated-not-provider-usage",
        severity: "info",
        text: `${label(group)} is an estimate; it is not provider-reported usage and must not be compared to provider token totals.`,
      });
    }
    if (isTokenTelemetry(descriptor)) {
      const available = group.views.filter((view) => view.availability === "available");
      if (available.some((view) => view.provenance === "unknown")) {
        add({
          ...base,
          id: `telemetry-provenance-unknown:${group.pluginId}:${group.metricId}`,
          kind: "telemetry-provenance-unknown",
          severity: "warning",
          text: `${label(group)}: the token telemetry source and reliability are not recorded in this report; the value is neither assumed provider-reported nor estimated.`,
        });
      } else if (available.some((view) => view.reliability === "unknown")) {
        add({
          ...base,
          id: `telemetry-reliability-unknown:${group.pluginId}:${group.metricId}`,
          kind: "telemetry-reliability-unknown",
          severity: "warning",
          text: `${label(group)}: the token telemetry reliability is not recorded in this report.`,
        });
      }
      const weak = group.views.filter((view) => view.reliability === "low" || view.reliability === "unavailable");
      if (weak.length > 0) {
        const levels = [...new Set(weak.map((view) => view.reliability))].sort().join(", ");
        add({
          ...base,
          id: `telemetry-reliability-low:${group.pluginId}:${group.metricId}`,
          kind: "telemetry-reliability-low",
          severity: "warning",
          text: `${label(group)}: ${weak.length} of ${total} measurement(s) carry ${levels} telemetry reliability; interpret token comparisons cautiously.`,
        });
      }
    }
  }

  const tokenStatus = report.warmIndexReuse?.agentCampaign?.tokenEvidenceStatus;
  if (tokenStatus === "partial" || tokenStatus === "unavailable") {
    add({
      pluginId: report.plugin.id,
      metricId: null,
      id: `telemetry-partial:${report.plugin.id}`,
      kind: "telemetry-partial",
      severity: "warning",
      text:
        tokenStatus === "partial"
          ? "Token evidence for the agent campaign is partial: some agent sides reported no token total, and missing totals are not zero."
          : "Token evidence for the agent campaign is unavailable: no agent side reported a token total, and missing totals are not zero.",
    });
  }

  const pluginId = report.plugin.id;
  const missing = new Set<string>();
  for (const view of views) {
    if (view.glossaryAnchor === null) missing.add(pluginLocalMetricId(pluginId, view.metricId));
  }
  if (missing.size > 0) {
    const ids = [...missing].sort();
    const shown = ids.slice(0, MAX_LISTED).join(", ");
    add({
      pluginId,
      metricId: null,
      id: `glossary-missing:${pluginId}`,
      kind: "glossary-missing",
      severity: "info",
      text:
        `Glossary metadata is missing for ${ids.length} rendered metric(s): ${shown}` +
        (ids.length > MAX_LISTED ? `, and ${ids.length - MAX_LISTED} more` : "") +
        ". They are shown without a definition or glossary link.",
    });
  }

  return [...byId.values()].sort((a, b) => {
    const rank = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (rank !== 0) return rank;
    if (a.pluginId !== b.pluginId) return a.pluginId < b.pluginId ? -1 : 1;
    const am = a.metricId ?? "";
    const bm = b.metricId ?? "";
    if (am !== bm) return am < bm ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

