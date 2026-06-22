import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCommandString } from "../core/commandLine.js";
import { getAgentAdapter } from "./agentRegistry.js";
import type { AgentCommandTemplate, AgentRunRequest, AgentRunResult } from "./types.js";

export type RunAgentPromptOptions = AgentRunRequest;

export async function runAgentPrompt(options: RunAgentPromptOptions): Promise<AgentRunResult> {
  await mkdir(options.outDir, { recursive: true });
  await writeFile(path.join(options.outDir, "prompt.txt"), options.promptText, "utf8");
  const adapter = getAgentAdapter(options.agentId);
  const result = await adapter.runPrompt(options);
  await writeFile(path.join(options.outDir, "agent-run-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export function parseAgentCommandTemplate(template: string): AgentCommandTemplate {
  const parts = parseCommandString(template);
  return {
    command: parts.executable,
    args: parts.args,
    promptPlaceholder: "{prompt}"
  };
}

export function applyPromptToCommandTemplate(template: AgentCommandTemplate, promptText: string): { command: string; args: string[] } {
  let replaced = false;
  const args = template.args.map((arg) => {
    if (arg.includes(`{${template.promptPlaceholder}}`)) {
      replaced = true;
      return arg.replaceAll(`{${template.promptPlaceholder}}`, promptText);
    }
    if (arg.includes(template.promptPlaceholder)) {
      replaced = true;
      return arg.replaceAll(template.promptPlaceholder, promptText);
    }
    return arg;
  });
  if (!replaced) {
    args.push(promptText);
  }
  return { command: template.command, args };
}
