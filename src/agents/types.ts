import type { PromptComplexityLevel, PromptStrategy, PromptVariant } from "../prompts/types.js";
import type { TrustedProviderExecutable } from "./providerBuildObservation.js";

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

/** Evidence channel, independent of legacy reliability and numeric availability. */
export type AgentTelemetryEvidenceLevelV091 =
  | "provider-reported"
  | "cli-reported"
  | "parsed-from-output"
  | "unavailable"
  | "estimated";

export type AgentTokenTelemetryConditionV091 = "token-available" | "token-unavailable";

/** No raw output is retained. Reasons are fixed codes, never provider-supplied text. */
export type NormalizedAgentTokenUsageV091 = {
  source: TokenUsageSource;
  reliability: TokenUsageReliability;
  evidenceLevel: AgentTelemetryEvidenceLevelV091;
  classificationReason: "unattributed-source" | "source-unavailable" | null;
  /** Available means at least one count is valid; it does not assert completeness. */
  numericAvailability: "available" | "unavailable";
  condition: AgentTokenTelemetryConditionV091;
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  numericReasons: Record<
    "totalTokens" | "inputTokens" | "outputTokens" | "cachedInputTokens" | "reasoningTokens",
    "missing-token-count" | "invalid-token-count" | null
  >;
};

export type AgentDurationSourceV091 = "lab-wall-clock" | "unavailable";

/** Current timing is measured by the Lab, including the provider availability check. */
export type NormalizedAgentDurationV091 =
  | { durationMs: number; source: Extract<AgentDurationSourceV091, "lab-wall-clock">; reason: null }
  | { durationMs: null; source: Extract<AgentDurationSourceV091, "unavailable">; reason: "missing-duration" | "invalid-duration" };

/** Inherited nonexecution states are retained. Token absence is never a provider outcome. */
export type AgentProviderOutcomeV091 =
  | "completed"
  | "failed"
  | "timeout"
  | "invalid-output"
  | "agent-unavailable"
  | "agent-limit-reached"
  | "skipped"
  | "not-invoked";

/** Independent dimensions only; task success and evaluation completeness belong to consumers. */
export type NormalizedAgentTelemetryV091 = {
  providerStatus: AgentProviderOutcomeV091;
  tokenUsage: NormalizedAgentTokenUsageV091;
  duration: NormalizedAgentDurationV091;
};

export type AgentCommandTemplate = {
  command: string;
  args: string[];
  promptPlaceholder: string;
  cwd?: string;
};

/** How the prompt reaches the provider process. Omitted/"argv" preserves existing behavior. */
export type AgentPromptTransport = "argv" | "stdin";

export type AgentBuiltCommand = {
  command: string;
  args: string[];
  /** Present only for stdin-transport commands; never duplicated into args. */
  stdinText?: string;
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
  /** Defaults to "argv" when omitted; every existing caller is unaffected. */
  promptTransport?: AgentPromptTransport;
  /** Internal inspected launch capability; cannot be supplied as a CLI command template. */
  trustedExecutable?: TrustedProviderExecutable;
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
