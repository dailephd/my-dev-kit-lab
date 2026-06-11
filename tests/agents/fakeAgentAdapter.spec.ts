import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fakeAgentAdapter } from "../../src/agents/index.js";
import { loadPromptVariant } from "./testHelpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("fakeAgentAdapter", () => {
  it("returns a deterministic completed result with token usage", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "fake-agent-"));
    tempDirs.push(outDir);
    const promptVariant = await loadPromptVariant();
    const result = await fakeAgentAdapter.runPrompt({
      runId: "run-1",
      agentId: "fake-agent",
      promptVariant,
      promptText: promptVariant.promptText,
      cwd: process.cwd(),
      outDir
    });
    expect(result.status).toBe("completed");
    expect(result.finalAnswerText).toContain("Simulated benchmark answer");
    expect(result.tokenUsage.totalTokens).toBe(promptVariant.promptMetrics.promptEstimatedTokens + 128);
    expect(result.tokenUsageReliability).toBe("high");
  });

  it("supports missing token usage mode", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "fake-agent-"));
    tempDirs.push(outDir);
    const promptVariant = await loadPromptVariant();
    const result = await fakeAgentAdapter.runPrompt({
      runId: "run-2",
      agentId: "fake-agent",
      promptVariant,
      promptText: promptVariant.promptText,
      cwd: process.cwd(),
      outDir,
      env: { FAKE_AGENT_MODE: "missing-token-usage" }
    });
    expect(result.status).toBe("completed");
    expect(result.tokenUsageSource).toBe("unavailable");
    expect(result.warnings[0]).toContain("omitted");
  });

  it("supports failure mode without external commands", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "fake-agent-"));
    tempDirs.push(outDir);
    const promptVariant = await loadPromptVariant();
    const result = await fakeAgentAdapter.runPrompt({
      runId: "run-3",
      agentId: "fake-agent",
      promptVariant,
      promptText: promptVariant.promptText,
      cwd: process.cwd(),
      outDir,
      env: { FAKE_AGENT_MODE: "failure" }
    });
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.errors[0]).toContain("Simulated");
  });
});
