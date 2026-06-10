import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRawFullFileBaseline } from "../../src/evaluation/runRawFullFileBaseline.js";
import type { EvaluationCase } from "../../src/evaluation/types.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createCase(): EvaluationCase {
  const dir = mkdtempSync(path.join(os.tmpdir(), "raw-baseline-"));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
  writeFileSync(path.join(dir, "src", "task.ts"), "export const x = 1;");
  writeFileSync(path.join(dir, "node_modules", "x", "skip.ts"), "skip");
  return {
    id: "case-1",
    title: "Case",
    benchmarkProject: "todo-ts",
    targetRoot: dir,
    absoluteTargetRoot: dir,
    sourceRoots: ["src"],
    query: "x",
    expectedFiles: ["src/task.ts"],
    expectedSymbols: ["x"],
    rawIncludeGlobs: ["src/**/*"]
  };
}

describe("runRawFullFileBaseline", () => {
  it("reads matching files, ignores excluded directories, and records chars and tokens", async () => {
    const result = await runRawFullFileBaseline(createCase());
    expect(result.filesIncluded).toEqual(["src/task.ts"]);
    expect(result.totalFiles).toBe(1);
    expect(result.totalChars).toBeGreaterThan(0);
    expect(result.totalEstimatedTokens).toBeGreaterThan(0);
  });

  it("fails clearly for missing targetRoot", async () => {
    const evaluationCase = createCase();
    await rm(evaluationCase.absoluteTargetRoot, { recursive: true, force: true });
    await expect(runRawFullFileBaseline(evaluationCase)).rejects.toThrow("Target root does not exist");
  });

  it("prevents path traversal", async () => {
    const evaluationCase = createCase();
    evaluationCase.rawIncludeGlobs = ["../outside/**/*"];
    await expect(runRawFullFileBaseline(evaluationCase)).rejects.toThrow();
  });
});
