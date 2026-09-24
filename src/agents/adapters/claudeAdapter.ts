import { runCliAgent } from "./codexAdapter.js";
import { applyPromptToCommandTemplate } from "../runAgentPrompt.js";
import { parseAgentTokenUsage } from "../parseAgentTokenUsage.js";
import { runMeasuredCommand } from "../../core/runMeasuredCommand.js";
import type { AgentAdapter, AgentFinalAnswerParseResult } from "../types.js";

// v0.5.2 Batch 2 -- frozen stdin invocation for the real-agent evaluation transport. Every flag
// here is planner-owned; --bare is intentionally not used (it changes auth behavior and still
// exposes Bash/read/edit tools unless separately constrained).
const CLAUDE_STDIN_ARGS = [
  "--restricted",
  "-p",
  "--output-format",
  "json",
  "--no-session-persistence",
  "--tools",
  "",
  "--disallowedTools",
  "mcp__*"
];

export const claudeAdapter: AgentAdapter = {
  id: "claude",
  displayName: "Claude",
  surface: "cli",
  async isAvailable(request) {
    if (request.commandTemplate) {
      return true;
    }
    const check = await runMeasuredCommand({
      commandId: "claude-availability",
      commandString: "claude",
      extraArgs: ["--version"],
      cwd: request.cwd,
      outDir: request.outDir,
      env: request.env
    });
    return check.ok;
  },
  buildCommand(request) {
    if (request.promptTransport === "stdin" && request.commandTemplate) {
      throw new Error("claude agent: stdin prompt transport cannot be combined with a command template.");
    }
    if (request.commandTemplate) {
      return applyPromptToCommandTemplate(request.commandTemplate, request.promptText);
    }
    if (request.promptTransport === "stdin") {
      return { command: "claude", args: [...CLAUDE_STDIN_ARGS], stdinText: request.promptText };
    }
    return { command: "claude", args: ["-p", request.promptText] };
  },
  async runPrompt(request) {
    return runCliAgent(request, this);
  },
  parseTokenUsage: parseAgentTokenUsage,
  parseFinalAnswer: parseClaudeFinalAnswer
};

/**
 * Parses a single JSON result envelope (`{ "result": "..." }`) when stdout is valid JSON, never
 * the raw envelope itself. Falls back to the legacy plain-text behavior when stdout is not valid
 * JSON, so existing argv-mode text output keeps working unchanged.
 */
export function parseClaudeFinalAnswer(text: string): AgentFinalAnswerParseResult {
  const trimmedInput = text.trim();
  if (trimmedInput) {
    try {
      const parsed: unknown = JSON.parse(trimmedInput);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const payload = parsed as Record<string, unknown>;
        if (typeof payload.result === "string") {
          const resultText = payload.result.trim();
          return { finalAnswerText: resultText, finalAnswerParseStatus: resultText ? "parsed" : "empty" };
        }
        // Valid JSON object without a string result: empty, never the raw envelope.
        return { finalAnswerText: "", finalAnswerParseStatus: "empty" };
      }
    } catch {
      // Not valid JSON; fall through to the legacy plain-text behavior below.
    }
  }
  return { finalAnswerText: trimmedInput, finalAnswerParseStatus: trimmedInput ? "parsed" : "empty" };
}
