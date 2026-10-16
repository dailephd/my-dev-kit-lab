import { runMeasuredCommand } from "../../core/runMeasuredCommand.js";
import { applyPromptToCommandTemplate } from "../runAgentPrompt.js";
import { parseAgentTokenUsage } from "../parseAgentTokenUsage.js";
import { trustedProviderLaunch } from "../providerBuildObservation.js";
import type { AgentAdapter, AgentFinalAnswerParseResult, AgentRunRequest, AgentRunResult } from "../types.js";

// v0.5.2 Batch 2 -- frozen stdin invocation for the real-agent evaluation transport. Every flag
// here is planner-owned; do not add sandbox/model/approval-policy flags in this batch.
const CODEX_STDIN_ARGS = [
  "exec",
  "--json",
  "--ephemeral",
  "--skip-git-repo-check",
  "--ignore-user-config",
  "--ignore-rules",
  "-"
];

export const codexAdapter: AgentAdapter = {
  id: "codex",
  displayName: "Codex",
  surface: "cli",
  async isAvailable(request) {
    if (request.commandTemplate) {
      return true;
    }
    const check = await runMeasuredCommand({
      commandId: "codex-availability",
      commandString: "codex",
      extraArgs: ["--version"],
      cwd: request.cwd,
      outDir: request.outDir,
      env: request.env
    });
    return check.ok;
  },
  buildCommand(request) {
    if (request.promptTransport === "stdin" && request.commandTemplate) {
      throw new Error("codex agent: stdin prompt transport cannot be combined with a command template.");
    }
    if (request.commandTemplate) {
      return applyPromptToCommandTemplate(request.commandTemplate, request.promptText);
    }
    if (request.promptTransport === "stdin") {
      return { command: "codex", args: [...CODEX_STDIN_ARGS], stdinText: request.promptText };
    }
    return { command: "codex", args: ["exec", "--json", request.promptText] };
  },
  async runPrompt(request) {
    return runCliAgent(request, this);
  },
  parseTokenUsage: parseAgentTokenUsage,
  parseFinalAnswer: parseCodexFinalAnswer
};

/**
 * Recognizes a Codex JSONL event stream (at least one line parses to an object with a string
 * `type`) and, when recognized, uses the LAST `item.completed` `agent_message` text as the final
 * answer -- never the raw JSONL. JSON-shaped output without an answer stays empty. Plain text
 * retains the legacy fallback. A single formatted JSON event is supported as well.
 */
export function parseCodexFinalAnswer(text: string): AgentFinalAnswerParseResult {
  let sawEventLine = /^[\s]*[\[{]/.test(text);
  let lastAgentMessageText: string | null = null;

  const candidates = function* (): Iterable<string> {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) yield trimmed;
    for (const match of text.matchAll(/[^\r\n]+/g)) if (match[0].trim() !== trimmed) yield match[0];
  };
  for (const line of candidates()) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmedLine);
    } catch {
      // Agent output can mix JSONL with incidental non-JSON noise; ignore malformed lines.
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    sawEventLine = true;
    if (Array.isArray(parsed)) continue;
    const event = parsed as Record<string, unknown>;
    if (typeof event.type !== "string") continue;
    sawEventLine = true;
    if (event.type === "item.completed") {
      const item = event.item;
      if (item && typeof item === "object" && (item as Record<string, unknown>).type === "agent_message") {
        const itemText = (item as Record<string, unknown>).text;
        if (typeof itemText === "string") {
          lastAgentMessageText = itemText;
        }
      }
    }
  }

  if (sawEventLine) {
    const finalAnswerText = lastAgentMessageText ?? "";
    return { finalAnswerText, finalAnswerParseStatus: finalAnswerText ? "parsed" : "empty" };
  }

  const trimmed = text.trim();
  return { finalAnswerText: trimmed, finalAnswerParseStatus: trimmed ? "parsed" : "empty" };
}

export async function runCliAgent(request: AgentRunRequest, adapter: AgentAdapter): Promise<AgentRunResult> {
  const started = Date.now();
  const command = adapter.buildCommand(request);
  if (request.trustedExecutable && (request.commandTemplate || request.promptTransport !== "stdin" || adapter.id === "fake-agent")) throw new Error("INVALID_TRUSTED_PROVIDER_REQUEST");
  const launch = request.trustedExecutable ? await trustedProviderLaunch(request.trustedExecutable, adapter.id as "codex" | "claude") : null;
  const available = launch !== null || await adapter.isAvailable(request);
  if (!available) {
    const ended = Date.now();
    const status = request.requireAvailable ? "failed" : "skipped";
    const message = `${adapter.displayName} CLI was not available.`;
    return {
      runId: request.runId,
      agentId: adapter.id,
      displayName: adapter.displayName,
      surface: adapter.surface,
      promptVariantId: request.promptVariant.id,
      promptStrategy: request.promptVariant.strategy,
      promptComplexityLevel: request.promptVariant.complexityLevel,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(ended).toISOString(),
      durationMs: ended - started,
      status,
      exitCode: null,
      command: command.command,
      args: command.args,
      cwd: request.cwd,
      finalAnswerText: "",
      finalAnswerParseStatus: "empty",
      tokenUsage: { source: "unavailable" },
      tokenUsageSource: "unavailable",
      tokenUsageReliability: "unavailable",
      warnings: status === "skipped" ? [message] : [],
      errors: status === "failed" ? [message] : []
    };
  }

  const measured = await runMeasuredCommand({
    commandId: `${adapter.id}-agent-run`,
    ...(launch ? { executable: launch.executable, args: [...launch.prefix, ...command.args], resolveCommand: false } : { commandString: command.command, extraArgs: command.args }),
    cwd: request.commandTemplate?.cwd ?? request.cwd,
    outDir: request.outDir,
    env: request.env,
    timeoutMs: request.timeoutMs,
    stdinText: command.stdinText,
    ...(launch ? { stdoutMaxBytes: 8 * 1024 * 1024, stderrMaxBytes: 1024 * 1024 } : {}),
    // PATH-resolved providers can be Windows .cmd shims too. Always request tree termination
    // for provider timeouts; trustedExecutable only controls additional output bounds.
    terminateProcessTree: true
  });
  const ended = Date.now();
  const combinedOutput = `${measured.stdout}\n${measured.stderr}`;
  const parsedAnswer = adapter.parseFinalAnswer(measured.stdout || measured.stderr);
  const parsedUsage = adapter.parseTokenUsage(combinedOutput);
  // Bound campaigns require process-channel diagnostics. Never search final agent message/patch bodies.
  const condition = launch ? trustedProcessCondition(measured.stdout, measured.stderr, measured.timedOut === true) : null;
  return {
    runId: request.runId,
    agentId: adapter.id,
    displayName: adapter.displayName,
    surface: adapter.surface,
    promptVariantId: request.promptVariant.id,
    promptStrategy: request.promptVariant.strategy,
    promptComplexityLevel: request.promptVariant.complexityLevel,
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(ended).toISOString(),
    durationMs: ended - started,
    status: measured.ok ? "completed" : "failed",
    exitCode: measured.exitCode,
    command: measured.executable,
    args: measured.args,
    cwd: request.commandTemplate?.cwd ?? request.cwd,
    stdoutPath: measured.stdoutPath,
    stderrPath: measured.stderrPath,
    telemetryPath: measured.telemetryPath,
    finalAnswerText: parsedAnswer.finalAnswerText,
    finalAnswerParseStatus: parsedAnswer.finalAnswerParseStatus,
    tokenUsage: parsedUsage.tokenUsage,
    tokenUsageSource: parsedUsage.tokenUsageSource,
    tokenUsageReliability: parsedUsage.tokenUsageReliability,
    warnings: parsedUsage.warnings,
    errors: [...(measured.ok ? [] : [measured.error ?? "Agent command failed."]), ...(condition === "limit" ? ["Provider rate limit reached."] : condition === "timeout" ? ["Provider command timed out."] : [])]
  };
}

function trustedProcessCondition(stdout: string, stderr: string, timedOut: boolean): "limit" | "timeout" | null {
  if (timedOut) return "timeout";
  const diagnostics: string[] = [];
  const isPatch = (text: string) => /^(?:diff --git |@@ |\+\+\+ |--- )/m.test(text);
  // Non-interactive CLI diagnostic lines, not arbitrary substrings or diff additions.
  if (!isPatch(stderr)) diagnostics.push(...stderr.split(/\r?\n/).filter(line => /^(?:error:\s*)?(?:rate limit (?:exceeded|reached)|usage limit (?:exceeded|reached)|quota (?:exceeded|exhausted)|too many requests|you(?:'ve| have) (?:hit|reached) (?:your |the )?(?:usage |session |rate )?limit)/i.test(line.trim())));
  for (const line of stdout.split(/\r?\n/).slice(0, 1000)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (!event || typeof event !== "object") continue;
      if (event.type !== "error" && event.type !== "turn.failed" && event.is_error !== true) continue;
      const error = event.error;
      const message = typeof error === "string" ? error : error && typeof error === "object" ? (error as Record<string, unknown>).message : event.message;
      if (typeof message === "string" && message.length <= 2048 && !isPatch(message)) diagnostics.push(message);
    } catch { /* Not a structured error event; agent output is deliberately not diagnostic evidence. */ }
  }
  return diagnostics.some(text => /\b(?:rate\s+limit|usage\s+limit|quota|too many requests|session\s+limit)\b/i.test(text)) ? "limit" : null;
}
