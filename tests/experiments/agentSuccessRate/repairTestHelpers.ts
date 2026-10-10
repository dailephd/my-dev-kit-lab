import { readFileSync } from "node:fs";
import path from "node:path";
import type { AgentRunRequest, AgentRunResult } from "../../../src/agents/types.js";
import { FIX_PATCH } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
import { PROTECTED_PATCH, README_PATCH, makeTask, makeToolRoot, runAgentSuccess } from "./agentSuccessRateTestHelpers.js";
import { fakeAgentResult, makeSeamAgent, makeSourceBackedKit, type SeamAgent } from "./realAgentTestHelpers.js";

export { FIX_PATCH, PROTECTED_PATCH, README_PATCH, makeTask, makeToolRoot, makeSourceBackedKit };

export const MODES = ["raw-full-file", "context-pack"] as const;
export const REFERENCE_MARKER = "REFERENCE_PATCH_MARKER_5e6d";
/** A syntactically valid reference patch that would NOT solve the task; if it were ever used the task would fail. */
export const DECOY_REFERENCE_PATCH = README_PATCH.replace("+extra", `+${REFERENCE_MARKER}`);
export const GOOD_ANSWER = `Here is the fix\n\n\`\`\`diff\n${FIX_PATCH}\`\`\`\n`;
/** Applies cleanly, touches an allowed file, but does not make the task check pass. */
export const NOOP_PATCH = ["diff --git a/src/other.cjs b/src/other.cjs", "--- a/src/other.cjs", "+++ b/src/other.cjs", "@@ -1 +1,2 @@", " module.exports.id = (x) => x;", "+// harmless comment", ""].join("\n");
export const NOOP_ANSWER = `\`\`\`diff\n${NOOP_PATCH}\`\`\`\n`;
/** Not a diff at all. */
export const MALFORMED_ANSWER = "I think you should change the add function to use plus.";

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const readJson = (outDir: string, file: string): Json => JSON.parse(readFileSync(path.join(outDir, ...file.split("/")), "utf8")) as Json;

export function treatmentOf(execution: Json, caseId: string, treatmentId: string): Json {
  return execution.cases.find((entry: Json) => entry.caseId === caseId).treatments.find((entry: Json) => entry.treatmentId === treatmentId);
}
export function analysisTreatmentOf(analysis: Json, caseId: string, treatmentId: string): Json {
  return analysis.analysis.cases.find((entry: Json) => entry.caseId === caseId).treatments.find((entry: Json) => entry.treatmentId === treatmentId);
}

export const usage = (totalTokens: number): Partial<AgentRunResult> => ({
  tokenUsage: { source: "provider-reported", totalTokens, inputTokens: totalTokens - 10, outputTokens: 10 },
  tokenUsageSource: "provider-reported",
  tokenUsageReliability: "high"
});

/** What a scripted provider does for one prompt. */
export type ScriptedResponse = { answer: string; tokens?: number | null } | { outcome: "unavailable" | "timeout" | "limit" | "empty" | "throw" };

export type PromptFacts = { caseId: string; mode: string; attempt: number; prompt: string };

export function promptFacts(request: AgentRunRequest): PromptFacts {
  const prompt = request.promptText;
  const repair = /^# Repair attempt (\d+) of \d+$/m.exec(prompt);
  return {
    caseId: (/^Case ID: (.+)$/m.exec(prompt) ?? [])[1] ?? "unknown",
    mode: (/^Context mode: (.+)$/m.exec(prompt) ?? [])[1] ?? "unknown",
    attempt: repair ? Number(repair[1]) : 1,
    prompt
  };
}

/** A deterministic scripted provider keyed by case, treatment and attempt. No process is started, nothing is billed. */
export function makeScriptedProvider(script: (facts: PromptFacts) => ScriptedResponse): SeamAgent & { facts: PromptFacts[] } {
  const facts: PromptFacts[] = [];
  const seam = makeSeamAgent((request) => {
    const fact = promptFacts(request);
    facts.push(fact);
    const response = script(fact);
    if ("outcome" in response) {
      switch (response.outcome) {
        case "throw":
          return "throw";
        case "unavailable":
          return fakeAgentResult({ status: "skipped", warnings: ["Agent executable not available"], finalAnswerText: "" });
        case "timeout":
          return fakeAgentResult({ status: "failed", errors: ["Agent command timed out after 30000ms"], finalAnswerText: "" });
        case "limit":
          return fakeAgentResult({ status: "failed", errors: ["usage limit reached"], finalAnswerText: "" });
        case "empty":
          return fakeAgentResult({ finalAnswerText: "   " });
      }
    }
    return fakeAgentResult({ finalAnswerText: response.answer, ...(response.tokens === null ? {} : usage(response.tokens ?? 100)) });
  });
  return Object.assign(seam, { facts });
}

export async function runRepair(args: {
  tasks: unknown;
  provider: SeamAgent;
  repairAttempts?: number;
  providerId?: "codex" | "claude";
  toolRoot?: string;
  outputRoot?: string;
  config?: Record<string, unknown>;
  extraInputs?: Record<string, unknown>;
}) {
  const toolRoot = args.toolRoot ?? makeToolRoot();
  const kit = makeSourceBackedKit();
  const { run, outDir } = await runAgentSuccess({
    toolRoot,
    tasks: args.tasks,
    outputRoot: args.outputRoot,
    config: {
      agentId: args.providerId ?? "codex",
      includeRealAgents: true,
      timeoutMs: 30_000,
      ...(args.repairAttempts === undefined ? {} : { repairAttempts: args.repairAttempts }),
      ...args.config
    },
    extraInputs: { agentSuccessContextDependencies: kit.dependencies, agentSuccessRunAgent: args.provider.runAgent, ...args.extraInputs }
  });
  return {
    run,
    outDir,
    toolRoot,
    execution: readJson(outDir, "agent-success-rate-execution.json"),
    analysis: readJson(outDir, "agent-success-rate-analysis.json")
  };
}

export { makeScriptedProviderTask as taskNamed };
function makeScriptedProviderTask(id: string) {
  return makeTask({ id }, DECOY_REFERENCE_PATCH);
}
