import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "../types.js";

export const fakeAgentAdapter: AgentAdapter = {
  id: "fake-agent",
  displayName: "Fake Agent",
  surface: "simulated",
  async isAvailable() {
    return true;
  },
  buildCommand() {
    return { command: "fake-agent", args: [] };
  },
  async runPrompt(request) {
    const started = Date.now();
    const mode = request.env?.FAKE_AGENT_MODE ?? "success";
    await mkdir(request.outDir, { recursive: true });
    const stdoutPath = path.join(request.outDir, "fake-agent.stdout.txt");
    const stderrPath = path.join(request.outDir, "fake-agent.stderr.txt");
    const telemetryPath = path.join(request.outDir, "fake-agent.telemetry.json");

    const failed = mode === "failure";
    const missingUsage = mode === "missing-token-usage";
    const invalidOutput = mode === "invalid-output";
    const finalAnswerText = invalidOutput ? "Simulated unstructured output without scoreable fields." : buildFakeAnswer(request, missingUsage);
    await writeFile(stdoutPath, `${finalAnswerText}\n`, "utf8");
    await writeFile(stderrPath, failed ? "Simulated fake-agent failure.\n" : "", "utf8");

    const ended = Date.now();
    const result: AgentRunResult = {
      runId: request.runId,
      agentId: "fake-agent",
      displayName: "Fake Agent",
      surface: "simulated",
      promptVariantId: request.promptVariant.id,
      promptStrategy: request.promptVariant.strategy,
      promptComplexityLevel: request.promptVariant.complexityLevel,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(ended).toISOString(),
      durationMs: ended - started,
      status: failed ? "failed" : "completed",
      exitCode: failed ? 1 : 0,
      command: "fake-agent",
      args: [],
      cwd: request.cwd,
      stdoutPath,
      stderrPath,
      telemetryPath,
      finalAnswerText,
      finalAnswerParseStatus: invalidOutput ? "empty" : "parsed",
      tokenUsage: missingUsage
        ? { source: "unavailable", rawText: finalAnswerText }
        : {
            inputTokens: request.promptVariant.promptMetrics.promptEstimatedTokens,
            outputTokens: 128,
            totalTokens: request.promptVariant.promptMetrics.promptEstimatedTokens + 128,
            source: "agent-reported",
            rawText: finalAnswerText
          },
      tokenUsageSource: missingUsage ? "unavailable" : "agent-reported",
      tokenUsageReliability: missingUsage ? "unavailable" : "high",
      warnings: missingUsage ? ["Token usage was intentionally omitted by fake-agent mode."] : [],
      errors: failed ? ["Simulated fake-agent failure."] : []
    };

    await writeFile(
      telemetryPath,
      `${JSON.stringify({ commandId: "fake-agent", exitCode: result.exitCode, durationMs: result.durationMs }, null, 2)}\n`,
      "utf8"
    );
    return result;
  },
  parseTokenUsage() {
    return {
      tokenUsage: { source: "agent-reported" },
      tokenUsageSource: "agent-reported",
      tokenUsageReliability: "high",
      warnings: []
    };
  },
  parseFinalAnswer(text) {
    const trimmed = text.trim();
    return {
      finalAnswerText: trimmed,
      finalAnswerParseStatus: trimmed ? "parsed" : "empty"
    };
  }
};

function buildFakeAnswer(request: AgentRunRequest, missingUsage: boolean): string {
  const facts = request.promptVariant.expectedAnswerKey.expectedFacts.slice(0, 2).map((fact) => fact.id);
  const tokenLines = missingUsage
    ? ""
    : [
        `tokenUsage: inputTokens=${request.promptVariant.promptMetrics.promptEstimatedTokens}, outputTokens=128, totalTokens=${
          request.promptVariant.promptMetrics.promptEstimatedTokens + 128
        }`,
        "tokenUsageSource: agent-reported"
      ].join("\n");

  return [
    "answer: Simulated benchmark answer from fake-agent.",
    `relevantFiles: ${request.promptVariant.expectedAnswerKey.expectedFiles.join(", ")}`,
    `relevantSymbols: ${request.promptVariant.expectedAnswerKey.expectedSymbols.join(", ")}`,
    `expectedFactsFound: ${facts.join(", ")}`,
    "confidence: high",
    tokenLines,
    `executionTime: simulated-${request.promptVariant.complexityLevel}`,
    "notes: Deterministic fake-agent output for tests."
  ]
    .filter(Boolean)
    .join("\n");
}
