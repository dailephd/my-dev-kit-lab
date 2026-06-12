import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runControlledExperimentCommand } from "../../src/commands/runControlledExperimentCommand.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("run-controlled-experiment fake-agent integration", () => {
  it("runs both strategies and writes experiment artifacts without report, screenshot, or gallery output", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "controlled-integration-"));
    tempDirs.push(outDir);
    const code = await runControlledExperimentCommand([
      "--cases",
      "examples/token-savings-cases.json",
      "--case",
      "todo-ts-create-task",
      "--agents",
      "fake-agent",
      "--strategies",
      "raw-full-file,my-dev-kit-guided",
      "--complexities",
      "short",
      "--out",
      outDir
    ]);
    expect(code).toBe(0);
    const runsPayload = JSON.parse(await readFile(path.join(outDir, "experiment-runs.json"), "utf8"));
    const comparisonsPayload = JSON.parse(await readFile(path.join(outDir, "experiment-comparisons.json"), "utf8"));
    expect(runsPayload.runs).toHaveLength(2);
    expect(new Set(runsPayload.runs.map((run: { promptStrategy: string }) => run.promptStrategy))).toEqual(
      new Set(["raw-full-file", "my-dev-kit-guided"])
    );
    expect(comparisonsPayload.comparisons).toHaveLength(1);
    expect(existsSync(path.join(outDir, "runs", runsPayload.runs[0].runId, "correctness-score.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "token-savings-report.html"))).toBe(false);
    expect(existsSync(path.join(outDir, "token-savings-report.png"))).toBe(false);
    expect(existsSync(path.join(outDir, "gallery-manifest.json"))).toBe(false);
  });
});
