import { normalizeAgentDurationV091, normalizeAgentTokenUsageV091 } from "../../../agents/normalizeAgentTelemetry.js";
import { analyzeAgentSuccessTreatment } from "./analysis.js";
import type { AgentSuccessTaskV1 } from "../../../evaluation/agentSuccess/index.js";
import type { CampaignCheckpointV2 } from "./campaignRecovery.js";
import type { AgentSuccessMetricV1 } from "./types.js";

export const CAMPAIGN_QUANTITIES = ["finalTaskSuccess", "initialTaskSuccess", "firstDuration", "finalDuration", "totalDuration", "firstTokens", "finalTokens", "totalTokens", "taskCheckPassRate", "regressionCheckPassRate", "regressionFailureCount"] as const;
export type CampaignQuantity = typeof CAMPAIGN_QUANTITIES[number];
export const QUALITY_REASONS = {
  NO_MATCHED_OBSERVATIONS: "No validated matched observations are available; no mean or delta can be constructed.",
  SELECTED_CASES_EXCLUDED: "Selected cases without usable measurements on both sides are excluded. Values describe only the matched subset.",
  TOKEN_FIELD_PROVENANCE_UNPROVEN: "The recorded channel cannot prove direct measurement of every token field, including parser-derived totals.",
  ESTIMATED_TOKENS: "Text-size estimates are not measured provider usage or billing evidence.",
  UNATTRIBUTED_TOKENS: "The telemetry channel has no verified provider attribution.",
  MISSING_ATTEMPT_MEASUREMENT: "At least one contributing attempt has no measurement; no complete total is fabricated.",
  NOT_APPLICABLE: "This execution mode has no provider measurements."
} as const;
export type QualityReason = keyof typeof QUALITY_REASONS;
export type CampaignComparisonEvidence = {
  quantity: CampaignQuantity; basis: "first-attempt" | "final-attempt" | "total-across-attempts";
  measurementBasis: "trusted-task-evaluation" | "trusted-check-evaluation" | "lab-wall-clock" | "recorded-token-channel";
  quality: "strong" | "partial" | "unavailable"; selectedCaseCount: number; matchedCaseIds: string[]; excludedCaseIds: string[];
  unit: "ratio" | "ms" | "tokens" | "count";
  rawFullFileMean: number | null; contextPackMean: number | null; meanDifference: number | null;
  reasons: QualityReason[];
  reasonExplanations: string[];
};
export function campaignAttemptTelemetry(e: NonNullable<CampaignCheckpointV2["units"][number]["completion"]>["evidence"]) {
  return (e.attempts?.map(a => a.evidence) ?? [e]).map((a, index) => {
    const t = a.agentTokenUsage;
    return { attemptNumber: index + 1, providerInvoked: a.realAgent?.providerInvoked === true,
      duration: normalizeAgentDurationV091(a.realAgent?.providerInvoked ? a.timing.agentDurationMs : null),
      tokens: normalizeAgentTokenUsageV091({ source: t?.source ?? "unavailable", ...(t?.totalTokens == null ? {} : { totalTokens: t.totalTokens }), ...(t?.inputTokens == null ? {} : { inputTokens: t.inputTokens }), ...(t?.outputTokens == null ? {} : { outputTokens: t.outputTokens }) }, t?.reliability ?? "unavailable"),
      tokenInterpretation: t?.source === "estimated-from-text" ? "estimated" as const : t?.totalTokens == null ? "unavailable" as const : "recorded-with-channel-provenance" as const };
  });
}
/** Only established analysis metrics are selected. Pending and historical epochs never enter scientific analysis. */
export function classifyCampaignEvidence(cp: CampaignCheckpointV2, tasks: readonly AgentSuccessTaskV1[]): CampaignComparisonEvidence[] {
  const entries = tasks.map((task, i) => cp.units.slice(i * 2, i * 2 + 2).map(u => u.state === "completed" && u.completion ? { analysis: analyzeAgentSuccessTreatment(task, u.completion.evidence), telemetry: campaignAttemptTelemetry(u.completion.evidence) } : null));
  const numeric = (m: AgentSuccessMetricV1 | undefined): number | null => m?.availability !== "available" ? null : typeof m.value === "boolean" ? Number(m.value) : typeof m.value === "number" && Number.isFinite(m.value) ? m.value : null;
  return CAMPAIGN_QUANTITIES.map(quantity => {
    const basis = quantity.startsWith("first") || quantity === "initialTaskSuccess" ? "first-attempt" as const : quantity.startsWith("total") ? "total-across-attempts" as const : "final-attempt" as const;
    const token = quantity.endsWith("Tokens"), duration = quantity.endsWith("Duration");
    const measurementBasis = token ? "recorded-token-channel" as const : duration ? "lab-wall-clock" as const : quantity.endsWith("TaskSuccess") ? "trusted-task-evaluation" as const : "trusted-check-evaluation" as const;
    const reasons = new Set<QualityReason>();
    const matched: Array<{ id: string; raw: number; pack: number }> = [];
    entries.forEach((sides, i) => {
      const values = sides.map(side => {
        if (!side) return null;
        const { metrics: m, repair: r } = side.analysis;
        if (quantity === "finalTaskSuccess") return numeric(m.taskSuccess);
        if (quantity === "initialTaskSuccess") return numeric(r?.initialAttemptTaskSuccess ?? m.taskSuccess);
        if (!token && !duration) return numeric(m[quantity as "taskCheckPassRate" | "regressionCheckPassRate" | "regressionFailureCount"]);
        const selected = basis === "first-attempt" ? side.telemetry.slice(0, 1) : basis === "final-attempt" ? side.telemetry.slice(-1) : side.telemetry.filter(a => a.providerInvoked);
        if (selected.length === 0 || selected.some(a => !a.providerInvoked)) return null;
        const metric = duration ? basis === "first-attempt" ? r?.firstAttemptProviderDurationMs ?? m.agentDurationMs : basis === "final-attempt" ? m.agentDurationMs : r?.totalProviderDurationMs ?? m.agentDurationMs : basis === "first-attempt" ? r?.firstAttemptProviderTokens ?? m.agentTotalTokens : basis === "final-attempt" ? m.agentTotalTokens : r?.totalProviderTokens ?? m.agentTotalTokens;
        const value = numeric(metric);
        if (value === null && basis === "total-across-attempts") reasons.add("MISSING_ATTEMPT_MEASUREMENT");
        return value;
      });
      if (values[0] !== null && values[1] !== null) {
        matched.push({ id: tasks[i]!.id, raw: values[0]!, pack: values[1]! });
        if (token) for (const side of sides) {
          const attempts = basis === "first-attempt" ? side!.telemetry.slice(0, 1) : basis === "final-attempt" ? side!.telemetry.slice(-1) : side!.telemetry.filter(a => a.providerInvoked);
          reasons.add("TOKEN_FIELD_PROVENANCE_UNPROVEN");
          for (const a of attempts) { if (a.tokens.evidenceLevel === "estimated") reasons.add("ESTIMATED_TOKENS"); if (a.tokens.classificationReason === "unattributed-source" || a.tokens.source === "unavailable") reasons.add("UNATTRIBUTED_TOKENS"); }
        }
      }
    });
    const matchedCaseIds = matched.map(m => m.id), excludedCaseIds = tasks.map(t => t.id).filter(id => !matchedCaseIds.includes(id));
    if (matched.length === 0) reasons.add("NO_MATCHED_OBSERVATIONS");
    if (excludedCaseIds.length) reasons.add("SELECTED_CASES_EXCLUDED");
    if ((token || duration) && cp.identity.config.providerId === "deterministic-fixture") reasons.add("NOT_APPLICABLE");
    const mean = (pick: (m: typeof matched[number]) => number) => matched.length ? matched.reduce((n, m) => n + pick(m), 0) / matched.length : null;
    return { quantity, basis, measurementBasis, unit: token ? "tokens" : duration ? "ms" : quantity === "regressionFailureCount" ? "count" : "ratio", quality: matched.length === 0 ? "unavailable" : excludedCaseIds.length || token ? "partial" : "strong", selectedCaseCount: tasks.length, matchedCaseIds, excludedCaseIds, rawFullFileMean: mean(m => m.raw), contextPackMean: mean(m => m.pack), meanDifference: mean(m => m.pack - m.raw), reasons: [...reasons], reasonExplanations: [...reasons].map(r => QUALITY_REASONS[r]) };
  });
}
