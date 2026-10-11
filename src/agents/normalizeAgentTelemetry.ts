import type {
  AgentTelemetryEvidenceLevelV091,
  AgentTokenUsage,
  NormalizedAgentDurationV091,
  NormalizedAgentTokenUsageV091,
  TokenUsageReliability,
  TokenUsageSource
} from "./types.js";

const EVIDENCE_LEVEL: Record<TokenUsageSource, AgentTelemetryEvidenceLevelV091> = {
  "provider-reported": "provider-reported",
  "cli-json": "cli-reported",
  "agent-reported": "parsed-from-output",
  "estimated-from-text": "estimated",
  otel: "unavailable",
  unavailable: "unavailable"
};

function normalizeCount(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Classifies the legacy evidence channel, not the origin of each individual field.
 * Parser-derived totals are preserved; missing totals are never calculated here.
 * The existing contract has no verified OTel attribution, so its channel remains unavailable.
 */
export function normalizeAgentTokenUsageV091(
  usage: Readonly<AgentTokenUsage>,
  reliability: TokenUsageReliability
): NormalizedAgentTokenUsageV091 {
  const counts = {
    totalTokens: normalizeCount(usage.totalTokens),
    inputTokens: normalizeCount(usage.inputTokens),
    outputTokens: normalizeCount(usage.outputTokens),
    cachedInputTokens: normalizeCount(usage.cachedInputTokens),
    reasoningTokens: normalizeCount(usage.reasoningTokens)
  };
  const numericReasons = {} as NormalizedAgentTokenUsageV091["numericReasons"];
  for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
    numericReasons[key] = counts[key] !== null ? null : usage[key] == null ? "missing-token-count" : "invalid-token-count";
  }
  const hasCount = Object.values(counts).some((count) => count !== null);
  return {
    source: usage.source,
    reliability,
    evidenceLevel: EVIDENCE_LEVEL[usage.source],
    classificationReason: usage.source === "otel" ? "unattributed-source" : usage.source === "unavailable" ? "source-unavailable" : null,
    numericAvailability: hasCount ? "available" : "unavailable",
    condition: hasCount ? "token-available" : "token-unavailable",
    ...counts,
    numericReasons
  };
}

/** Accepts the current Lab wall-clock measurement, never provider-reported timing. */
export function normalizeAgentDurationV091(durationMs: number | null | undefined): NormalizedAgentDurationV091 {
  if (durationMs == null) {
    return { durationMs: null, source: "unavailable", reason: "missing-duration" };
  }
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return { durationMs: null, source: "unavailable", reason: "invalid-duration" };
  }
  return { durationMs, source: "lab-wall-clock", reason: null };
}
