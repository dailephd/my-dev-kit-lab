import type { AgentSuccessRateRealAgentId } from "./config.js";
export const AGENT_TIMEOUT_PRESETS = Object.freeze({
  codex: Object.freeze({ standard: 240000, extended: 900000, maximum: 1800000 }),
  claude: Object.freeze({ standard: 240000, extended: 900000, maximum: 1800000 })
}) satisfies Record<AgentSuccessRateRealAgentId, Record<"standard" | "extended" | "maximum", number>>;
export type AgentTimeoutPreset = keyof typeof AGENT_TIMEOUT_PRESETS.codex;
export function resolveAgentTimeoutPreset(provider: AgentSuccessRateRealAgentId, preset: string): number {
  if (!Object.hasOwn(AGENT_TIMEOUT_PRESETS, provider) || !Object.hasOwn(AGENT_TIMEOUT_PRESETS[provider], preset)) throw new Error("--timeout-preset must be standard, extended or maximum for codex or claude.");
  return AGENT_TIMEOUT_PRESETS[provider][preset as AgentTimeoutPreset];
}
