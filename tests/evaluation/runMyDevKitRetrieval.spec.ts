import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMyDevKitRetrieval } from "../../src/evaluation/runMyDevKitRetrieval.js";
import type { EvaluationCase } from "../../src/evaluation/types.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const baseCase: EvaluationCase = {
  id: "todo-ts-create-task",
  title: "Case",
  benchmarkProject: "todo-ts",
  targetRoot: "benchmarks/projects/todo-ts",
  absoluteTargetRoot: path.resolve(process.cwd(), "benchmarks/projects/todo-ts"),
  sourceRoots: ["src", "tests"],
  query: "create task deterministic id task-1",
  expectedFiles: ["src/taskService.ts"],
  expectedSymbols: ["createTask"],
  rawIncludeGlobs: ["src/**/*", "tests/**/*"]
};

describe("runMyDevKitRetrieval", () => {
  it("works with the fake my-dev-kit CLI and records command attempts", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-run-"));
    tempDirs.push(outDir);
    const result = await runMyDevKitRetrieval({
      evaluationCase: baseCase,
      kitCommand: `node ${path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js")}`,
      outputDir: outDir,
      requireKit: true
    });
    expect(result.skipped).toBe(false);
    expect(result.commands.map((command) => command.commandId)).toEqual(["index", "search", "lookup", "slice", "source"]);
    expect(result.selectedNodeId).toBe("todo-ts:createTask");
    expect(result.totalEstimatedTokens).toBeGreaterThan(0);
  });

  it("skips gracefully when no candidate is found", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-run-"));
    tempDirs.push(outDir);
    const result = await runMyDevKitRetrieval({
      evaluationCase: { ...baseCase, id: "missing", query: "none" },
      kitCommand: `${process.execPath} -e "console.log(JSON.stringify({results: []}))"`,
      outputDir: outDir,
      requireKit: false
    });
    expect(result.skipped).toBe(true);
  });

  it("skips gracefully when kit command is unavailable and requireKit is false", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-run-"));
    tempDirs.push(outDir);
    const result = await runMyDevKitRetrieval({
      evaluationCase: baseCase,
      kitCommand: "definitely-not-a-real-command",
      outputDir: outDir,
      requireKit: false
    });
    expect(result.skipped).toBe(true);
  });

  it("fails when kit command is unavailable and requireKit is true", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-run-"));
    tempDirs.push(outDir);
    await expect(
      runMyDevKitRetrieval({
        evaluationCase: baseCase,
        kitCommand: "definitely-not-a-real-command",
        outputDir: outDir,
        requireKit: true
      })
    ).rejects.toThrow();
  });
});
