import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexAdapter, parseAgentCommandTemplate } from "../../src/agents/index.js";
import { loadPromptVariant } from "./testHelpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("codexAdapter", () => {
  it("builds default command template", async () => {
    const promptVariant = await loadPromptVariant();
    const command = codexAdapter.buildCommand({
      runId: "codex-build",
      agentId: "codex",
      promptVariant,
      promptText: "hello",
      cwd: process.cwd(),
      outDir: process.cwd()
    });
    expect(command.command).toBe("codex");
    expect(command.args).toEqual(["exec", "--json", "hello"]);
  });

  it("supports command template override", async () => {
    const promptVariant = await loadPromptVariant();
    const command = codexAdapter.buildCommand({
      runId: "codex-build",
      agentId: "codex",
      promptVariant,
      promptText: "hello",
      cwd: process.cwd(),
      outDir: process.cwd(),
      commandTemplate: parseAgentCommandTemplate("node fake-cli.js --prompt {prompt}")
    });
    expect(command.command).toBe("node");
    expect(command.args).toEqual(["fake-cli.js", "--prompt", "hello"]);
  });

  it("parses token usage from fake Codex JSONL output", () => {
    const result = codexAdapter.parseTokenUsage('{"type":"turn","usage":{"input_tokens":44,"output_tokens":11,"total_tokens":55}}');
    expect(result.tokenUsage.inputTokens).toBe(44);
    expect(result.tokenUsage.totalTokens).toBe(55);
  });

  it("returns skipped when unavailable and requireAvailable is false", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "codex-agent-"));
    tempDirs.push(outDir);
    const promptVariant = await loadPromptVariant();
    const result = await codexAdapter.runPrompt({
      runId: "codex-skip",
      agentId: "codex",
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
    const outDir = mkdtempSync(path.join(os.tmpdir(), "codex-agent-"));
    tempDirs.push(outDir);
    const promptVariant = await loadPromptVariant();
    const result = await codexAdapter.runPrompt({
      runId: "codex-fail",
      agentId: "codex",
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
