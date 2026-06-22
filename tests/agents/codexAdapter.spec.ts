import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
  function writeHostCodexExecutable(filePath: string, totalTokens: number): void {
    const output = `console.log('{\\\"usage\\\":{\\\"input_tokens\\\":${Math.max(totalTokens - 3, 1)},\\\"output_tokens\\\":3,\\\"total_tokens\\\":${totalTokens}}}')`;
    if (process.platform === "win32") {
      writeFileSync(filePath, `@echo off\r\n"${process.execPath}" -e "${output}"\r\n`, "utf8");
      return;
    }
    writeFileSync(filePath, `#!/usr/bin/env node\n${output}\n`, "utf8");
    chmodSync(filePath, 0o755);
  }

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

  it("supports double-brace prompt placeholders in command template overrides", async () => {
    const promptVariant = await loadPromptVariant();
    const command = codexAdapter.buildCommand({
      runId: "codex-build",
      agentId: "codex",
      promptVariant,
      promptText: "hello",
      cwd: process.cwd(),
      outDir: process.cwd(),
      commandTemplate: parseAgentCommandTemplate("codex exec --json {{prompt}}")
    });
    expect(command.args).toEqual(["exec", "--json", "hello"]);
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

  it("runs through a host-platform codex executable via command template", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "codex-agent-"));
    const binRoot = mkdtempSync(path.join(os.tmpdir(), "codex-bin-"));
    const binDir = path.join(binRoot, "bin with spaces");
    tempDirs.push(outDir, binRoot);
    mkdirSync(binDir, { recursive: true });
    const shimName = process.platform === "win32" ? "codex.cmd" : "codex";
    writeHostCodexExecutable(path.join(binDir, shimName), 10);
    const promptVariant = await loadPromptVariant();
    const nodeBinDir = path.dirname(process.execPath);
    const joinedPath = `${binDir}${path.delimiter}${nodeBinDir}`;
    const result = await codexAdapter.runPrompt({
      runId: "codex-cmd",
      agentId: "codex",
      promptVariant,
      promptText: promptVariant.promptText,
      cwd: process.cwd(),
      outDir,
      commandTemplate: parseAgentCommandTemplate("codex {prompt}"),
      env: { Path: joinedPath, PATH: joinedPath }
    });
    expect(result.status).toBe("completed");
    expect(result.tokenUsage.totalTokens).toBe(10);
    if (process.platform === "win32") {
      expect(result.command.toLowerCase()).toContain("cmd");
      expect(result.args.some((arg) => arg.includes("codex.cmd"))).toBe(true);
    } else {
      expect(result.command).toBe("codex");
      expect(result.args.some((arg) => arg.includes("codex.cmd"))).toBe(false);
    }
  });

  it("runs through a host-platform codex executable stored in a path with spaces", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "codex-agent-"));
    const rootDir = mkdtempSync(path.join(os.tmpdir(), "codex bin root-"));
    const binDir = path.join(rootDir, "bin with spaces");
    tempDirs.push(outDir, rootDir);
    mkdirSync(binDir, { recursive: true });
    const shimName = process.platform === "win32" ? "codex.cmd" : "codex";
    writeHostCodexExecutable(path.join(binDir, shimName), 13);
    const promptVariant = await loadPromptVariant();
    const result = await codexAdapter.runPrompt({
      runId: "codex-cmd-space",
      agentId: "codex",
      promptVariant,
      promptText: promptVariant.promptText,
      cwd: process.cwd(),
      outDir,
      commandTemplate: parseAgentCommandTemplate("codex {prompt}"),
      env: { Path: binDir, PATH: binDir }
    });

    expect(result.status).toBe("completed");
    expect(result.tokenUsage.totalTokens).toBe(13);
    if (process.platform === "win32") {
      expect(result.args.some((arg) => arg.includes("codex.cmd"))).toBe(true);
    } else {
      expect(result.command).toBe("codex");
    }
  });
});
