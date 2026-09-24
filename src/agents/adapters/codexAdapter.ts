import { runMeasuredCommand } from "../../core/runMeasuredCommand.js";
import { applyPromptToCommandTemplate } from "../runAgentPrompt.js";
import { parseAgentTokenUsage } from "../parseAgentTokenUsage.js";
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
 * answer -- never the raw JSONL. Falls back to the legacy plain-text behavior when no event-shaped
 * line is found, so non-JSONL Codex output (and existing tests) keep working unchanged.
 */
export function parseCodexFinalAnswer(text: string): AgentFinalAnswerParseResult {
  let sawEventLine = false;
  let lastAgentMessageText: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmedLine);
    } catch {
      // Agent output can mix JSONL with incidental non-JSON noise; ignore malformed lines.
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
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
  const available = await adapter.isAvailable(request);
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
    commandString: command.command,
    extraArgs: command.args,
    cwd: request.commandTemplate?.cwd ?? request.cwd,
    outDir: request.outDir,
    env: request.env,
    timeoutMs: request.timeoutMs,
    stdinText: command.stdinText
  });
  const ended = Date.now();
  const combinedOutput = `${measured.stdout}\n${measured.stderr}`;
  const parsedAnswer = adapter.parseFinalAnswer(measured.stdout || measured.stderr);
  const parsedUsage = adapter.parseTokenUsage(combinedOutput);
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
    errors: measured.ok ? [] : [measured.error ?? "Agent command failed."]
  };
}
