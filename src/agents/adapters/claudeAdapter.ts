import { runCliAgent } from "./codexAdapter.js";
import { applyPromptToCommandTemplate } from "../runAgentPrompt.js";
import { parseAgentTokenUsage } from "../parseAgentTokenUsage.js";
import { runMeasuredCommand } from "../../core/runMeasuredCommand.js";
import type { AgentAdapter } from "../types.js";

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
    if (request.commandTemplate) {
      return applyPromptToCommandTemplate(request.commandTemplate, request.promptText);
    }
    return { command: "claude", args: ["-p", request.promptText] };
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
