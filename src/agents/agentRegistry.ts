import { claudeAdapter } from "./adapters/claudeAdapter.js";
import { codexAdapter } from "./adapters/codexAdapter.js";
import { fakeAgentAdapter } from "./adapters/fakeAgentAdapter.js";
import type { AgentAdapter, AgentId } from "./types.js";

export const agentAdapters: Record<AgentId, AgentAdapter> = {
  codex: codexAdapter,
  claude: claudeAdapter,
  "fake-agent": fakeAgentAdapter
};

export function getAgentAdapter(agentId: AgentId): AgentAdapter {
  const adapter = agentAdapters[agentId];
  if (!adapter) {
    throw new Error(`Unknown agent adapter: ${agentId}`);
  }
  return adapter;
}

export function parseAgentId(value: string): AgentId {
  if (value === "codex" || value === "claude" || value === "fake-agent") {
    return value;
  }
  throw new Error(`Invalid agent id: ${value}`);
}
