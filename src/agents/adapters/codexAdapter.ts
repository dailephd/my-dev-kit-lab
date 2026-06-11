import { runMeasuredCommand } from "../../core/runMeasuredCommand.js";
import { applyPromptToCommandTemplate } from "../runAgentPrompt.js";
import { parseAgentTokenUsage } from "../parseAgentTokenUsage.js";
import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "../types.js";

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
    if (request.commandTemplate) {
      return applyPromptToCommandTemplate(request.commandTemplate, request.promptText);
    }
    return { command: "codex", args: ["exec", "--json", request.promptText] };
  },
  async runPrompt(request) {
    return runCliAgent(request, this);
  },
  parseTokenUsage: parseAgentTokenUsage,
  parseFinalAnswer(text) {
    const trimmed = text.trim();
    return { finalAnswerText: trimmed, finalAnswerParseStatus: trimmed ? "parsed" : "empty" };
  }
};

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
    env: request.env
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
    command: command.command,
    args: command.args,
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
