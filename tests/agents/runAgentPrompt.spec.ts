import { mkdtempSync, existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentPrompt } from "../../src/agents/index.js";
import { loadPromptVariant } from "./testHelpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runAgentPrompt", () => {
  it("runs fake-agent and writes prompt and result artifacts", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "agent-run-"));
    tempDirs.push(outDir);
    const promptVariant = await loadPromptVariant("my-dev-kit-guided", "multi-step");
    const result = await runAgentPrompt({
      runId: "agent-run",
      agentId: "fake-agent",
      promptVariant,
      promptText: promptVariant.promptText,
      cwd: process.cwd(),
      outDir
    });
    expect(result.status).toBe("completed");
    expect(result.promptStrategy).toBe("my-dev-kit-guided");
    expect(result.promptComplexityLevel).toBe("multi-step");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(existsSync(path.join(outDir, "prompt.txt"))).toBe(true);
    expect(existsSync(path.join(outDir, "agent-run-result.json"))).toBe(true);
    const saved = JSON.parse(await readFile(path.join(outDir, "agent-run-result.json"), "utf8")) as { agentId: string };
    expect(saved.agentId).toBe("fake-agent");
  });
});
