import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { countEstimatedTokens, countTextChars } from "../../src/core/countTokens.js";
import {
  buildMyDevKitIndex,
  runMyDevKitRetrieval,
  runMyDevKitRetrievalFromIndex
} from "../../src/evaluation/runMyDevKitRetrieval.js";
import type { EvaluationCase } from "../../src/evaluation/types.js";

const fakeKitPath = path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js");
const fakeKitCommand = `node ${fakeKitPath}`;
const fakeCreateTaskSource =
  "1 export class TaskService {\n2   createTask(title: string) {\n3     return this.store.create(title.trim());\n4   }\n5 }";

// Wraps the shared fake CLI so one subcommand fails (or search returns a node-less candidate).
function writeFakeKitVariant(dir: string, options: { failOn?: string; searchWithoutNode?: boolean }): string {
  const scriptPath = path.join(dir, "fake-kit-variant.mjs");
  writeFileSync(
    scriptPath,
    [
      `const command = process.argv[2];`,
      `if (command === ${JSON.stringify(options.failOn ?? "")}) { process.stderr.write("forced failure"); process.exit(1); }`,
      options.searchWithoutNode
        ? `if (command === "search") { console.log(JSON.stringify({ results: [{ file: "src/taskService.ts" }] })); process.exit(0); }`
        : "",
      `await import(${JSON.stringify(pathToFileURL(fakeKitPath).href)});`
    ].join("\n")
  );
  return `node ${scriptPath}`;
}

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

  it("keeps the legacy index failure warning and records only the index command when requireKit is false", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-run-"));
    tempDirs.push(outDir);
    const result = await runMyDevKitRetrieval({
      evaluationCase: baseCase,
      kitCommand: "definitely-not-a-real-command",
      outputDir: outDir,
      requireKit: false
    });
    expect(result.warnings).toEqual(["my-dev-kit index command was unavailable or failed."]);
    expect(result.commands.map((command) => command.commandId)).toEqual(["index"]);
    expect(result.contextText).toBe("");
    expect(result.totalEstimatedTokens).toBe(0);
  });

  it("reports total lifecycle duration including index construction and uses the case-specific index", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-run-"));
    tempDirs.push(outDir);
    const result = await runMyDevKitRetrieval({
      evaluationCase: baseCase,
      kitCommand: fakeKitCommand,
      outputDir: outDir,
      requireKit: true
    });
    const [indexCommand, ...retrievalCommands] = result.commands;
    const indexDir = path.join(outDir, "indexes", baseCase.id);
    expect(indexCommand.args.slice(-2)).toEqual([indexDir, "--json"]);
    for (const command of retrievalCommands) {
      expect(command.args.slice(command.args.indexOf("--index"), command.args.indexOf("--index") + 2)).toEqual(["--index", indexDir]);
    }
    const commandTotal = result.commands.reduce((sum, command) => sum + command.durationMs, 0);
    expect(result.durationMs).toBeGreaterThanOrEqual(commandTotal);
  });

  it("delegates to the split lifecycle: legacy output matches index build plus prepared-index retrieval", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-run-"));
    tempDirs.push(outDir);
    const legacy = await runMyDevKitRetrieval({
      evaluationCase: baseCase,
      kitCommand: fakeKitCommand,
      outputDir: path.join(outDir, "legacy"),
      requireKit: true
    });
    const indexDir = path.join(outDir, "split", "indexes", baseCase.id);
    const commandsDir = path.join(outDir, "split", "commands", baseCase.id);
    const build = await buildMyDevKitIndex({ target: baseCase, kitCommand: fakeKitCommand, indexDir, commandsDir, requireKit: true });
    const split = await runMyDevKitRetrievalFromIndex({ evaluationCase: baseCase, kitCommand: fakeKitCommand, indexDir, commandsDir, requireKit: true });

    const comparable = (result: typeof legacy) => ({
      caseId: result.caseId,
      skipped: result.skipped,
      warnings: result.warnings,
      contextText: result.contextText,
      filesRead: result.filesRead,
      totalChars: result.totalChars,
      totalEstimatedTokens: result.totalEstimatedTokens,
      selectedNodeId: result.selectedNodeId,
      selectedFile: result.selectedFile,
      selectedSymbol: result.selectedSymbol
    });
    expect(comparable(legacy)).toEqual(comparable(split));
    expect(Object.keys(legacy)).toEqual(Object.keys(split));
    expect(legacy.commands.map((command) => command.commandId)).toEqual([
      build.command.commandId,
      ...split.commands.map((command) => command.commandId)
    ]);
  });
});

describe("buildMyDevKitIndex", () => {
  it("runs exactly one index command with the target root, repeated source roots, output dir, and JSON mode", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-index-"));
    tempDirs.push(outDir);
    const indexDir = path.join(outDir, "indexes", baseCase.id);
    const commandsDir = path.join(outDir, "commands", baseCase.id);
    const result = await buildMyDevKitIndex({ target: baseCase, kitCommand: fakeKitCommand, indexDir, commandsDir, requireKit: true });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.indexDir).toBe(indexDir);
    expect(result.command.commandId).toBe("index");
    expect(result.command.args.slice(-10)).toEqual([
      "index",
      "--root",
      baseCase.absoluteTargetRoot,
      "--src",
      "src",
      "--src",
      "tests",
      "--out",
      indexDir,
      "--json"
    ]);
    expect(result.durationMs).toBe(result.command.durationMs);
    expect(existsSync(path.join(indexDir, "manifest.json"))).toBe(true);
    expect(existsSync(result.command.telemetryPath)).toBe(true);
  });

  it("throws on index failure when requireKit is true", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-index-"));
    tempDirs.push(outDir);
    await expect(
      buildMyDevKitIndex({
        target: baseCase,
        kitCommand: "definitely-not-a-real-command",
        indexDir: path.join(outDir, "index"),
        commandsDir: path.join(outDir, "commands"),
        requireKit: true
      })
    ).rejects.toThrow();
  });

  it("returns a failed build with a warning when requireKit is false", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-index-"));
    tempDirs.push(outDir);
    const result = await buildMyDevKitIndex({
      target: baseCase,
      kitCommand: "definitely-not-a-real-command",
      indexDir: path.join(outDir, "index"),
      commandsDir: path.join(outDir, "commands"),
      requireKit: false
    });
    expect(result.ok).toBe(false);
    expect(result.warnings).toEqual(["my-dev-kit index command was unavailable or failed."]);
    expect(result.command.ok).toBe(false);
  });
});

describe("runMyDevKitRetrievalFromIndex", () => {
  async function prepareIndex(kitCommand = fakeKitCommand) {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-prepared-"));
    tempDirs.push(outDir);
    const indexDir = path.join(outDir, "indexes", baseCase.id);
    await buildMyDevKitIndex({
      target: baseCase,
      kitCommand,
      indexDir,
      commandsDir: path.join(outDir, "index-commands"),
      requireKit: true
    });
    return { outDir, indexDir, commandsDir: path.join(outDir, "commands", baseCase.id) };
  }

  it("never invokes index and preserves successful retrieval semantics", async () => {
    const { indexDir, commandsDir } = await prepareIndex();
    const result = await runMyDevKitRetrievalFromIndex({
      evaluationCase: baseCase,
      kitCommand: fakeKitCommand,
      indexDir,
      commandsDir,
      requireKit: true
    });

    expect(result.commands.map((command) => command.commandId)).toEqual(["search", "lookup", "slice", "source"]);
    expect(result.commands.flatMap((command) => command.args)).not.toContain("index");
    expect(result.commands.at(-1)?.args.slice(-4)).toEqual(["--max-lines", "160", "--format", "numbered"]);
    expect(result.skipped).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.selectedNodeId).toBe("todo-ts:createTask");
    expect(result.selectedFile).toBe("src/taskService.ts");
    expect(result.selectedSymbol).toBe("createTask");
    expect(result.contextText).toBe(fakeCreateTaskSource);
    expect(result.filesRead).toEqual(["src/taskService.ts"]);
    expect(result.totalChars).toBe(countTextChars(fakeCreateTaskSource));
    expect(result.totalEstimatedTokens).toBe(countEstimatedTokens(fakeCreateTaskSource));
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reuses one prepared index across repeated retrievals without re-indexing", async () => {
    const { indexDir, commandsDir } = await prepareIndex();
    const results = [];
    for (const id of ["task-a", "task-b"]) {
      results.push(
        await runMyDevKitRetrievalFromIndex({
          evaluationCase: { ...baseCase, id },
          kitCommand: fakeKitCommand,
          indexDir,
          commandsDir: path.join(commandsDir, id),
          requireKit: true
        })
      );
    }
    for (const result of results) {
      expect(result.commands.map((command) => command.commandId)).not.toContain("index");
      expect(result.selectedNodeId).toBe("todo-ts:createTask");
    }
  });

  it("skips lookup, slice, and source and warns when the search candidate has no node id", async () => {
    const { outDir, indexDir, commandsDir } = await prepareIndex();
    const kitCommand = writeFakeKitVariant(outDir, { searchWithoutNode: true });
    const result = await runMyDevKitRetrievalFromIndex({ evaluationCase: baseCase, kitCommand, indexDir, commandsDir, requireKit: true });

    expect(result.commands.map((command) => command.commandId)).toEqual(["search"]);
    expect(result.warnings).toEqual(["No my-dev-kit node id was available after search."]);
    expect(result.selectedNodeId).toBeUndefined();
    expect(result.filesRead).toEqual(["src/taskService.ts"]);
    // Context falls back to the raw search output, as in v0.4.9.
    expect(result.contextText).toBe(result.commands[0].stdout);
  });

  it("returns a skipped result on search failure when requireKit is false and throws when it is true", async () => {
    const { outDir, indexDir, commandsDir } = await prepareIndex();
    const kitCommand = writeFakeKitVariant(outDir, { failOn: "search" });
    const result = await runMyDevKitRetrievalFromIndex({ evaluationCase: baseCase, kitCommand, indexDir, commandsDir, requireKit: false });
    expect(result.skipped).toBe(true);
    expect(result.warnings).toEqual(["my-dev-kit search command failed."]);
    expect(result.commands.map((command) => command.commandId)).toEqual(["search"]);

    await expect(
      runMyDevKitRetrievalFromIndex({ evaluationCase: baseCase, kitCommand, indexDir, commandsDir, requireKit: true })
    ).rejects.toThrow();
  });

  it.each([
    { failOn: "lookup", warning: "my-dev-kit lookup command failed.", context: fakeCreateTaskSource },
    { failOn: "slice", warning: "my-dev-kit slice command failed.", context: fakeCreateTaskSource },
    { failOn: "source", warning: "my-dev-kit source command failed.", context: "slice" }
  ])("warns but continues when $failOn fails, keeping context precedence", async ({ failOn, warning, context }) => {
    const { outDir, indexDir, commandsDir } = await prepareIndex();
    const kitCommand = writeFakeKitVariant(outDir, { failOn });
    const result = await runMyDevKitRetrievalFromIndex({ evaluationCase: baseCase, kitCommand, indexDir, commandsDir, requireKit: true });

    expect(result.commands.map((command) => command.commandId)).toEqual(["search", "lookup", "slice", "source"]);
    expect(result.warnings).toEqual([warning]);
    expect(result.skipped).toBe(false);
    if (context === "slice") {
      expect(result.contextText).toBe(result.commands[2].stdout);
    } else {
      expect(result.contextText).toBe(context);
    }
  });
});
