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
  const jsonUsage = parseJsonUsage(text);
  if (jsonUsage.found) {
    return buildResult(jsonUsage.usage, "cli-json", text, warnings);
  }

  const plainTextUsage = parsePlainTextUsage(text);
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

function parseJsonUsage(text: string): { found: boolean; usage: UsageAccumulator } {
  const usage: UsageAccumulator = {};
  for (const candidate of collectJsonCandidates(text)) {
    try {
      mergeUsage(usage, extractUsage(JSON.parse(candidate)));
    } catch {
      // Agent output is often mixed JSONL plus text; malformed lines are ignored.
    }
  }
  return { found: hasAnyUsage(usage), usage };
}

function collectJsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  const candidates: string[] = [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    candidates.push(trimmed);
  }
  for (const line of text.split(/\r?\n/)) {
    const lineTrimmed = line.trim();
    if (lineTrimmed.startsWith("{") || lineTrimmed.startsWith("[")) {
      candidates.push(lineTrimmed);
    }
  }
  return [...new Set(candidates)];
}

function extractUsage(value: unknown): UsageAccumulator {
  const usage: UsageAccumulator = {};
  visit(value, usage);
  return usage;
}

function visit(value: unknown, usage: UsageAccumulator): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, usage));
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [usageKey, fieldNames] of Object.entries(numberFields) as Array<[keyof UsageAccumulator, string[]]>) {
    for (const fieldName of fieldNames) {
      const fieldValue = record[fieldName];
      if (typeof fieldValue === "number" && Number.isFinite(fieldValue)) {
        usage[usageKey] = Math.max(usage[usageKey] ?? 0, fieldValue);
      }
    }
  }

  for (const child of Object.values(record)) {
    visit(child, usage);
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
    const match = text.match(pattern);
    if (match?.[1]) {
      usage[key] = Number(match[1]);
    }
  }

  return { found: hasAnyUsage(usage), usage };
}

function mergeUsage(target: UsageAccumulator, source: UsageAccumulator): void {
  for (const key of Object.keys(numberFields) as Array<keyof UsageAccumulator>) {
    if (source[key] !== undefined) {
      target[key] = Math.max(target[key] ?? 0, source[key]);
    }
  }
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
