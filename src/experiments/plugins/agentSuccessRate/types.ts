/**
 * Plugin-local typed metric. The generic ExperimentMetric has no availability or reason, so absent measurements
 * would otherwise be indistinguishable from zero. Flattening to ExperimentMetric happens only in metrics.ts.
 */
export type AgentSuccessMetricAvailability = "available" | "unavailable" | "not-applicable";

/** `boolean` and `tokens` are justified additions: task flags are not counts, and token usage is a distinct quantity. */
export type AgentSuccessMetricUnit = "count" | "ratio" | "lines" | "ms" | "boolean" | "tokens";

export type AgentSuccessMetricV1 = {
  id: string;
  availability: AgentSuccessMetricAvailability;
  /** Finite number or boolean when available; always null otherwise. */
  value: number | boolean | null;
  unit: AgentSuccessMetricUnit;
  /** Non-empty for unavailable and not-applicable metrics; null when available. */
  reason: string | null;
};

/** Three-valued truth used by scoring: an unknown component can never produce a claimed success. */
export type Tri = true | false | "unknown";
