import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentPromptCommand } from "../../src/commands/runAgentPromptCommand.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("run-agent-prompt fake-agent integration", () => {
  it("writes agent artifacts without report, screenshot, or gallery artifacts", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "agent-integration-"));
    tempDirs.push(outDir);
    const code = await runAgentPromptCommand([
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
    ]);
    expect(code).toBe(0);
    expect(existsSync(path.join(outDir, "prompt.txt"))).toBe(true);
    expect(existsSync(path.join(outDir, "agent-run-result.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "token-savings-report.html"))).toBe(false);
    expect(existsSync(path.join(outDir, "gallery-manifest.json"))).toBe(false);
    const result = JSON.parse(await readFile(path.join(outDir, "agent-run-result.json"), "utf8")) as {
      tokenUsage: { totalTokens?: number };
    };
    expect(result.tokenUsage.totalTokens).toBeGreaterThan(0);
  });
});
