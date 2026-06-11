import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeAdapter, parseAgentCommandTemplate } from "../../src/agents/index.js";
import { loadPromptVariant } from "./testHelpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("claudeAdapter", () => {
  it("builds default command template", async () => {
    const promptVariant = await loadPromptVariant();
    const command = claudeAdapter.buildCommand({
      runId: "claude-build",
      agentId: "claude",
      promptVariant,
      promptText: "hello",
      cwd: process.cwd(),
      outDir: process.cwd()
    });
    expect(command.command).toBe("claude");
    expect(command.args).toEqual(["-p", "hello"]);
  });

  it("supports command template override", async () => {
    const promptVariant = await loadPromptVariant();
    const command = claudeAdapter.buildCommand({
      runId: "claude-build",
      agentId: "claude",
      promptVariant,
      promptText: "hello",
      cwd: process.cwd(),
      outDir: process.cwd(),
      commandTemplate: parseAgentCommandTemplate("node fake-claude.js {prompt}")
    });
    expect(command.command).toBe("node");
    expect(command.args).toEqual(["fake-claude.js", "hello"]);
  });

  it("parses token usage from fake Claude-like text output", () => {
    const result = claudeAdapter.parseTokenUsage("input tokens: 14\noutput tokens: 9\ntotal tokens: 23");
    expect(result.tokenUsage.inputTokens).toBe(14);
    expect(result.tokenUsage.totalTokens).toBe(23);
  });

  it("returns skipped when unavailable and requireAvailable is false", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "claude-agent-"));
    tempDirs.push(outDir);
    const promptVariant = await loadPromptVariant();
    const result = await claudeAdapter.runPrompt({
      runId: "claude-skip",
      agentId: "claude",
      promptVariant,
      promptText: promptVariant.promptText,
      cwd: process.cwd(),
      outDir,
      env: { PATH: "" }
    });
    expect(result.status).toBe("skipped");
    expect(result.warnings[0]).toContain("not available");
  });

  it("returns failed when unavailable and requireAvailable is true", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "claude-agent-"));
    tempDirs.push(outDir);
    const promptVariant = await loadPromptVariant();
    const result = await claudeAdapter.runPrompt({
      runId: "claude-fail",
      agentId: "claude",
      promptVariant,
      promptText: promptVariant.promptText,
      cwd: process.cwd(),
      outDir,
      env: { PATH: "" },
      requireAvailable: true
    });
    expect(result.status).toBe("failed");
    expect(result.errors[0]).toContain("not available");
  });
});
