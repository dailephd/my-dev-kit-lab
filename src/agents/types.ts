import type { PromptComplexityLevel, PromptStrategy, PromptVariant } from "../prompts/types.js";

export type AgentId = "codex" | "claude" | "fake-agent";

export type AgentSurface = "cli" | "sdk" | "api" | "otel" | "simulated";

export type AgentRunStatus = "completed" | "failed" | "skipped";

export type FinalAnswerParseStatus = "parsed" | "empty";

export type TokenUsageSource =
  | "provider-reported"
  | "agent-reported"
  | "cli-json"
  | "otel"
  | "estimated-from-text"
  | "unavailable";

export type TokenUsageReliability = "high" | "medium" | "low" | "unavailable";

export type AgentTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  rawText?: string;
  source: TokenUsageSource;
};

export type AgentTokenUsageParseResult = {
  tokenUsage: AgentTokenUsage;
  tokenUsageSource: TokenUsageSource;
  tokenUsageReliability: TokenUsageReliability;
  warnings: string[];
};

export type AgentCommandTemplate = {
  command: string;
  args: string[];
  promptPlaceholder: string;
  cwd?: string;
};

export type AgentBuiltCommand = {
  command: string;
  args: string[];
};

export type AgentRunRequest = {
  runId: string;
  agentId: AgentId;
  promptVariant: PromptVariant;
  promptText: string;
  cwd: string;
  outDir: string;
  commandTemplate?: AgentCommandTemplate;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  requireAvailable?: boolean;
};

export type AgentRunResult = {
  runId: string;
  agentId: AgentId;
  displayName: string;
  surface: AgentSurface;
  promptVariantId: string;
  promptStrategy: PromptStrategy;
  promptComplexityLevel: PromptComplexityLevel;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: AgentRunStatus;
  exitCode: number | null;
  command: string;
  args: string[];
  cwd: string;
  stdoutPath?: string;
  stderrPath?: string;
  telemetryPath?: string;
  finalAnswerText: string;
  finalAnswerParseStatus: FinalAnswerParseStatus;
  tokenUsage: AgentTokenUsage;
  tokenUsageSource: TokenUsageSource;
  tokenUsageReliability: TokenUsageReliability;
  warnings: string[];
  errors: string[];
};

export type AgentFinalAnswerParseResult = {
  finalAnswerText: string;
  finalAnswerParseStatus: FinalAnswerParseStatus;
};

export type AgentAdapter = {
  id: AgentId;
  displayName: string;
  surface: AgentSurface;
  isAvailable(request: AgentRunRequest): Promise<boolean>;
  buildCommand(request: AgentRunRequest): AgentBuiltCommand;
  runPrompt(request: AgentRunRequest): Promise<AgentRunResult>;
  parseTokenUsage(text: string): AgentTokenUsageParseResult;
  parseFinalAnswer(text: string): AgentFinalAnswerParseResult;
};
