import type { AgentTokenUsage, AgentTokenUsageParseResult, TokenUsageReliability, TokenUsageSource } from "./types.js";

type UsageAccumulator = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
};

const numberFields: Record<keyof UsageAccumulator, string[]> = {
  inputTokens: ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"],
  outputTokens: ["output_tokens", "outputTokens", "completion_tokens", "completionTokens"],
  cachedInputTokens: [
    "cached_input_tokens",
    "cachedInputTokens",
    "cacheReadInputTokens",
    "cache_creation_input_tokens",
    "cacheCreationInputTokens"
  ],
  reasoningTokens: ["reasoning_tokens", "reasoningTokens"],
  totalTokens: ["total_tokens", "totalTokens"]
};

export function parseAgentTokenUsage(text: string): AgentTokenUsageParseResult {
  const warnings: string[] = [];
  const jsonUsage = parseJsonUsage(text, warnings);
  if (jsonUsage.found) {
    return buildResult(jsonUsage.usage, "cli-json", text, warnings);
  }

  const plainTextUsage = jsonUsage.structured ? { found: false, usage: {} } : parsePlainTextUsage(text);
  if (plainTextUsage.found) {
    return buildResult(plainTextUsage.usage, "agent-reported", text, warnings);
  }

  warnings.push("Token usage was not found in agent output.");
  return {
    tokenUsage: { source: "unavailable", rawText: text },
    tokenUsageSource: "unavailable",
    tokenUsageReliability: "unavailable",
    warnings
  };
}

function parseJsonUsage(text: string, warnings: string[]): { found: boolean; usage: UsageAccumulator; structured: boolean } {
  let usage: UsageAccumulator | undefined;
  let structured = false;
  let visited = 0;
  const warn = (message: string): void => { if (!warnings.includes(message)) warnings.push(message); };
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== "object") return;
    if (++visited > 2048 || depth > 16) {
      warn("Token usage traversal limit reached; additional envelopes were ignored.");
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) { if (visited > 2048) break; visit(child, depth + 1); }
      return;
    }
    const record = value as Record<string, unknown>;
    const local: UsageAccumulator = {};
    for (const [key, aliases] of Object.entries(numberFields) as Array<[keyof UsageAccumulator, string[]]>) {
      for (const alias of aliases) {
        const count = record[alias];
        if (count === undefined) continue;
        if (typeof count !== "number" || !Number.isFinite(count) || !Number.isInteger(count) || count < 0) {
          warn("Invalid token count ignored in agent output.");
          continue;
        }
        if (local[key] !== undefined && local[key] !== count) warn("Conflicting token aliases; legacy maximum precedence retained within one usage record.");
        local[key] = Math.max(local[key] ?? 0, count);
      }
    }
    if (hasAnyUsage(local)) {
      if (usage === undefined) usage = local;
      else if (JSON.stringify(usage) !== JSON.stringify(local)) warn("Multiple token usage records; first valid record retained without combining attempts.");
    }
    // Supported envelope traversal only: patch/tool payload objects are not usage metadata.
    for (const key of ["usage", "token_usage", "tokenUsage", "response", "message", "data", "event", "result"]) {
      if (visited > 2048) break;
      visit(record[key], depth + 1);
    }
  };
  let candidates = 0;
  for (const candidate of collectJsonCandidates(text)) {
    if (++candidates > 4096) { warn("Token usage candidate limit reached; additional lines were ignored."); break; }
    try {
      const value: unknown = JSON.parse(candidate);
      structured = true;
      visit(value, 0);
    } catch {
      // Agent output is often mixed JSONL plus text; malformed lines are ignored.
    }
  }
  return { found: usage !== undefined, usage: usage ?? {}, structured };
}

function* collectJsonCandidates(text: string): Iterable<string> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    yield trimmed;
  }
  for (const match of text.matchAll(/[^\r\n]+/g)) {
    const lineTrimmed = match[0].trim();
    if (lineTrimmed !== trimmed && (lineTrimmed.startsWith("{") || lineTrimmed.startsWith("["))) {
      yield lineTrimmed;
    }
  }
}

function parsePlainTextUsage(text: string): { found: boolean; usage: UsageAccumulator } {
  const usage: UsageAccumulator = {};
  const patterns: Array<[keyof UsageAccumulator, RegExp]> = [
    ["inputTokens", /(?:input|prompt)\s+tokens?\s*[:=]\s*(\d+)/i],
    ["outputTokens", /(?:output|completion)\s+tokens?\s*[:=]\s*(\d+)/i],
    ["cachedInputTokens", /cached\s+input\s+tokens?\s*[:=]\s*(\d+)/i],
    ["reasoningTokens", /reasoning\s+tokens?\s*[:=]\s*(\d+)/i],
    ["totalTokens", /total\s+tokens?\s*[:=]\s*(\d+)/i]
  ];

  for (const [key, pattern] of patterns) {
    const match = text.match(new RegExp(pattern.source.replace("(\\d+)", "(\\d+)(?![\\d.eE])"), pattern.flags));
    if (match?.[1]) {
      const count = Number(match[1]);
      if (Number.isFinite(count) && Number.isInteger(count)) usage[key] = count;
    }
  }

  return { found: hasAnyUsage(usage), usage };
}

function hasAnyUsage(usage: UsageAccumulator): boolean {
  return Object.values(usage).some((value) => typeof value === "number");
}

function buildResult(
  usage: UsageAccumulator,
  source: TokenUsageSource,
  rawText: string,
  warnings: string[]
): AgentTokenUsageParseResult {
  if (usage.totalTokens === undefined && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)) {
    usage.totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.reasoningTokens ?? 0);
  }

  const reliability = determineReliability(usage, source);
  if (reliability !== "high") {
    warnings.push("Token usage was partial in agent output.");
  }

  const tokenUsage: AgentTokenUsage = {
    ...usage,
    source,
    rawText
  };
  return {
    tokenUsage,
    tokenUsageSource: source,
    tokenUsageReliability: reliability,
    warnings
  };
}

function determineReliability(usage: UsageAccumulator, source: TokenUsageSource): TokenUsageReliability {
  const complete = usage.totalTokens !== undefined && (usage.inputTokens !== undefined || usage.outputTokens !== undefined);
  if (source === "cli-json") {
    return complete ? "high" : "medium";
  }
  return complete ? "medium" : "low";
}
