import { mkdtempSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentPromptCommand } from "../../src/commands/runAgentPromptCommand.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function baseArgs(outDir: string): string[] {
  return [
    "--agent",
    "fake-agent",
    "--cases",
    "examples/token-savings-cases.json",
    "--case",
    "todo-ts-create-task",
    "--strategy",
    "raw-full-file",
    "--complexity",
    "short",
    "--out",
    outDir
  ];
}

describe("runAgentPromptCommand", () => {
  it("runs fake-agent with one case and writes artifacts", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "agent-command-"));
    tempDirs.push(outDir);
    expect(await runAgentPromptCommand(baseArgs(outDir))).toBe(0);
    expect(existsSync(path.join(outDir, "prompt.txt"))).toBe(true);
    expect(existsSync(path.join(outDir, "agent-run-result.json"))).toBe(true);
  });

  it("supports my-dev-kit-guided strategy and multi-step complexity", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "agent-command-"));
    tempDirs.push(outDir);
    const args = baseArgs(outDir);
    args[args.indexOf("raw-full-file")] = "my-dev-kit-guided";
    args[args.indexOf("short")] = "multi-step";
    expect(await runAgentPromptCommand(args)).toBe(0);
  });

  it("fails clearly for missing case files, missing case IDs, and invalid agents", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "agent-command-"));
    tempDirs.push(outDir);
    expect(await runAgentPromptCommand(["--agent", "fake-agent", "--cases", "missing.json", "--case", "x", "--strategy", "raw-full-file", "--complexity", "short", "--out", outDir])).toBe(1);
    expect(await runAgentPromptCommand([...baseArgs(outDir), "--case", "missing-case"])).toBe(1);
    expect(await runAgentPromptCommand(["--agent", "unknown", "--cases", "examples/token-savings-cases.json", "--case", "todo-ts-create-task", "--strategy", "raw-full-file", "--complexity", "short", "--out", outDir])).toBe(1);
  });
});
