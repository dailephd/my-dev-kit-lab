import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeAdapter, parseAgentCommandTemplate, parseClaudeFinalAnswer } from "../../src/agents/index.js";
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

  describe("v0.5.2 Batch 2 -- stdin prompt transport", () => {
    it("keeps legacy buildCommand unchanged when promptTransport is absent", async () => {
      const promptVariant = await loadPromptVariant();
      const command = claudeAdapter.buildCommand({
        runId: "claude-legacy",
        agentId: "claude",
        promptVariant,
        promptText: "hello",
        cwd: process.cwd(),
        outDir: process.cwd()
      });
      expect(command.args).toEqual(["-p", "hello"]);
    });

    it("builds the exact frozen stdin invocation", async () => {
      const promptVariant = await loadPromptVariant();
      const command = claudeAdapter.buildCommand({
        runId: "claude-stdin",
        agentId: "claude",
        promptVariant,
        promptText: "the real prompt text",
        cwd: process.cwd(),
        outDir: process.cwd(),
        promptTransport: "stdin"
      });
      expect(command.command).toBe("claude");
      expect(command.args).toEqual([
        "--restricted",
        "-p",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--tools",
        "",
        "--disallowedTools",
        "mcp__*"
      ]);
      expect(command.stdinText).toBe("the real prompt text");
      expect(command.args.join(" ")).not.toContain("the real prompt text");
    });

    it("rejects stdin transport combined with a command template", async () => {
      const promptVariant = await loadPromptVariant();
      expect(() =>
        claudeAdapter.buildCommand({
          runId: "claude-stdin-template",
          agentId: "claude",
          promptVariant,
          promptText: "hello",
          cwd: process.cwd(),
          outDir: process.cwd(),
          promptTransport: "stdin",
          commandTemplate: parseAgentCommandTemplate("node fake-claude.js {prompt}")
        })
      ).toThrow("stdin prompt transport cannot be combined with a command template");
    });
  });

  describe("v0.5.2 Batch 2 -- Claude JSON final-answer parsing", () => {
    it("parses the result field from a JSON envelope", () => {
      const result = parseClaudeFinalAnswer(
        JSON.stringify({
          result: "final benchmark answer",
          session_id: "fixture",
          usage: { input_tokens: 10, output_tokens: 5 }
        })
      );
      expect(result.finalAnswerText).toBe("final benchmark answer");
      expect(result.finalAnswerParseStatus).toBe("parsed");
    });

    it("returns empty for valid JSON with a missing result field, never the raw envelope", () => {
      const result = parseClaudeFinalAnswer(JSON.stringify({ session_id: "fixture" }));
      expect(result.finalAnswerText).toBe("");
      expect(result.finalAnswerParseStatus).toBe("empty");
    });

    it("preserves the legacy plain-text fallback for non-JSON output", () => {
      const result = parseClaudeFinalAnswer("  plain text answer  \n");
      expect(result.finalAnswerText).toBe("plain text answer");
      expect(result.finalAnswerParseStatus).toBe("parsed");

      const empty = parseClaudeFinalAnswer("   \n  ");
      expect(empty.finalAnswerText).toBe("");
      expect(empty.finalAnswerParseStatus).toBe("empty");
    });
  });

  describe("v0.5.2 Batch 2 -- Claude token-usage boundary", () => {
    it("parses nested JSON usage fields through the existing generic token parser", () => {
      const result = claudeAdapter.parseTokenUsage(
        JSON.stringify({ result: "answer", usage: { input_tokens: 10, output_tokens: 5 } })
      );
      expect(result.tokenUsage.inputTokens).toBe(10);
      expect(result.tokenUsage.outputTokens).toBe(5);
      expect(result.tokenUsageSource).toBe("cli-json");
    });

    it("reports token usage as unavailable (never zero) for valid JSON without usage", () => {
      const result = claudeAdapter.parseTokenUsage(JSON.stringify({ result: "answer", session_id: "fixture" }));
      expect(result.tokenUsageSource).toBe("unavailable");
      expect(result.tokenUsageReliability).toBe("unavailable");
      expect(result.tokenUsage.totalTokens).toBeUndefined();
    });
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

  it("runs a host-platform fake Claude executable through stdin transport end to end", async () => {
    function writeStdinClaudeExecutable(filePath: string): void {
      const script =
        "const args = process.argv.slice(1); if (args.includes('--version')) { console.log('claude 1.0.0-fake'); process.exit(0); } " +
        "let data = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { data += c; }); " +
        "process.stdin.on('end', () => { " +
        "console.log(JSON.stringify({ result: 'stdin-chars:' + data.length, session_id: 'fixture', usage: { input_tokens: 7, output_tokens: 2 } })); " +
        "});";
      if (process.platform === "win32") {
        // "--" stops node's own flag parsing so dashed args (e.g. --restricted) reach the script
        // as plain argv instead of being rejected as unknown node options.
        writeFileSync(filePath, `@echo off\r\nnode -e "${script.replace(/"/g, '\\"')}" -- %*\r\n`, "utf8");
        return;
      }
      const unixScript = script.replace(/process\.argv\.slice\(1\)/g, "process.argv.slice(2)");
      writeFileSync(filePath, `#!/usr/bin/env node\n${unixScript}\n`, "utf8");
      chmodSync(filePath, 0o755);
    }

    const outDir = mkdtempSync(path.join(os.tmpdir(), "claude-stdin-agent-"));
    const binRoot = mkdtempSync(path.join(os.tmpdir(), "claude-stdin-bin-"));
    const binDir = path.join(binRoot, "bin with spaces");
    tempDirs.push(outDir, binRoot);
    mkdirSync(binDir, { recursive: true });
    const shimName = process.platform === "win32" ? "claude.cmd" : "claude";
    writeStdinClaudeExecutable(path.join(binDir, shimName));
    const promptVariant = await loadPromptVariant();
    const nodeBinDir = path.dirname(process.execPath);
    const joinedPath = `${binDir}${path.delimiter}${nodeBinDir}`;
    const promptText = "a realistic evaluation prompt";
    const result = await claudeAdapter.runPrompt({
      runId: "claude-stdin-e2e",
      agentId: "claude",
      promptVariant,
      promptText,
      cwd: process.cwd(),
      outDir,
      promptTransport: "stdin",
      env: { Path: joinedPath, PATH: joinedPath }
    });

    expect(result.status).toBe("completed");
    expect(result.finalAnswerText).toBe(`stdin-chars:${promptText.length}`);
    expect(result.finalAnswerParseStatus).toBe("parsed");
    expect(result.tokenUsage.inputTokens).toBe(7);
    expect(result.tokenUsage.outputTokens).toBe(2);
    expect(result.args.join(" ")).not.toContain(promptText);
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
