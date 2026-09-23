import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexAdapter, parseAgentCommandTemplate, parseCodexFinalAnswer } from "../../src/agents/index.js";
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

  describe("v0.5.2 Batch 2 -- stdin prompt transport", () => {
    it("keeps legacy buildCommand unchanged when promptTransport is absent", async () => {
      const promptVariant = await loadPromptVariant();
      const command = codexAdapter.buildCommand({
        runId: "codex-legacy",
        agentId: "codex",
        promptVariant,
        promptText: "hello",
        cwd: process.cwd(),
        outDir: process.cwd()
      });
      expect(command.args).toEqual(["exec", "--json", "hello"]);
    });

    it("builds the exact frozen stdin invocation", async () => {
      const promptVariant = await loadPromptVariant();
      const command = codexAdapter.buildCommand({
        runId: "codex-stdin",
        agentId: "codex",
        promptVariant,
        promptText: "the real prompt text",
        cwd: process.cwd(),
        outDir: process.cwd(),
        promptTransport: "stdin"
      });
      expect(command.command).toBe("codex");
      expect(command.args).toEqual([
        "exec",
        "--json",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        "-"
      ]);
      expect(command.stdinText).toBe("the real prompt text");
      expect(command.args.join(" ")).not.toContain("the real prompt text");
    });

    it("rejects stdin transport combined with a command template", async () => {
      const promptVariant = await loadPromptVariant();
      expect(() =>
        codexAdapter.buildCommand({
          runId: "codex-stdin-template",
          agentId: "codex",
          promptVariant,
          promptText: "hello",
          cwd: process.cwd(),
          outDir: process.cwd(),
          promptTransport: "stdin",
          commandTemplate: parseAgentCommandTemplate("node fake-cli.js --prompt {prompt}")
        })
      ).toThrow("stdin prompt transport cannot be combined with a command template");
    });
  });

  describe("v0.5.2 Batch 2 -- Codex JSONL final-answer parsing", () => {
    function jsonl(...events: unknown[]): string {
      return events.map((event) => JSON.stringify(event)).join("\n");
    }

    it("selects the LAST completed agent_message from a deterministic event sequence", () => {
      const text = jsonl(
        { type: "thread.started", thread_id: "t1" },
        { type: "item.completed", item: { type: "command_execution", command: "ls" } },
        { type: "item.completed", item: { type: "agent_message", text: "first draft answer" } },
        { type: "item.completed", item: { type: "agent_message", text: "final agent answer" } },
        { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }
      );
      const result = parseCodexFinalAnswer(text);
      expect(result.finalAnswerText).toBe("final agent answer");
      expect(result.finalAnswerParseStatus).toBe("parsed");
    });

    it("returns empty when a recognized JSONL event stream has no completed agent_message", () => {
      const text = jsonl(
        { type: "thread.started", thread_id: "t1" },
        { type: "item.completed", item: { type: "command_execution", command: "ls" } }
      );
      const result = parseCodexFinalAnswer(text);
      expect(result.finalAnswerText).toBe("");
      expect(result.finalAnswerParseStatus).toBe("empty");
    });

    it("preserves the legacy plain-text fallback for non-JSONL output", () => {
      const result = parseCodexFinalAnswer("  plain text answer  \n");
      expect(result.finalAnswerText).toBe("plain text answer");
      expect(result.finalAnswerParseStatus).toBe("parsed");

      const empty = parseCodexFinalAnswer("   \n  ");
      expect(empty.finalAnswerText).toBe("");
      expect(empty.finalAnswerParseStatus).toBe("empty");
    });

    it("does not let malformed noise around valid JSONL replace the recognized final message", () => {
      const text = [
        "not json at all",
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "real answer" } }),
        "{also not json",
        ""
      ].join("\n");
      const result = parseCodexFinalAnswer(text);
      expect(result.finalAnswerText).toBe("real answer");
      expect(result.finalAnswerParseStatus).toBe("parsed");
    });
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

  it("runs a host-platform fake Codex executable through stdin transport end to end", async () => {
    function writeStdinCodexExecutable(filePath: string): void {
      const script =
        "const args = process.argv.slice(1); if (args.includes('--version')) { console.log('codex 1.0.0-fake'); process.exit(0); } " +
        "let data = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { data += c; }); " +
        "process.stdin.on('end', () => { " +
        "console.log(JSON.stringify({ type: 'thread.started' })); " +
        "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'stdin-chars:' + data.length } })); " +
        "console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 } })); " +
        "});";
      if (process.platform === "win32") {
        // "--" stops node's own flag parsing so dashed args (e.g. --ephemeral) reach the script
        // as plain argv instead of being rejected as unknown node options.
        writeFileSync(filePath, `@echo off\r\nnode -e "${script.replace(/"/g, '\\"')}" -- %*\r\n`, "utf8");
        return;
      }
      const unixScript = script.replace(/process\.argv\.slice\(1\)/g, "process.argv.slice(2)");
      writeFileSync(filePath, `#!/usr/bin/env node\n${unixScript}\n`, "utf8");
      chmodSync(filePath, 0o755);
    }

    const outDir = mkdtempSync(path.join(os.tmpdir(), "codex-stdin-agent-"));
    const binRoot = mkdtempSync(path.join(os.tmpdir(), "codex-stdin-bin-"));
    const binDir = path.join(binRoot, "bin with spaces");
    tempDirs.push(outDir, binRoot);
    mkdirSync(binDir, { recursive: true });
    const shimName = process.platform === "win32" ? "codex.cmd" : "codex";
    writeStdinCodexExecutable(path.join(binDir, shimName));
    const promptVariant = await loadPromptVariant();
    const nodeBinDir = path.dirname(process.execPath);
    const joinedPath = `${binDir}${path.delimiter}${nodeBinDir}`;
    const promptText = "a realistic evaluation prompt";
    const result = await codexAdapter.runPrompt({
      runId: "codex-stdin-e2e",
      agentId: "codex",
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
    expect(result.tokenUsage.totalTokens).toBe(9);
    expect(result.args.join(" ")).not.toContain(promptText);
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
    const nodeBinDir = path.dirname(process.execPath);
    const joinedPath = `${binDir}${path.delimiter}${nodeBinDir}`;
    const result = await codexAdapter.runPrompt({
      runId: "codex-cmd-space",
      agentId: "codex",
      promptVariant,
      promptText: promptVariant.promptText,
      cwd: process.cwd(),
      outDir,
      commandTemplate: parseAgentCommandTemplate("codex {prompt}"),
      env: { Path: joinedPath, PATH: joinedPath }
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
