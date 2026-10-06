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
  runMyDevKitRetrievalFromIndex,
  runMyDevKitRetrievalStrategyFromIndex
} from "../../src/evaluation/runMyDevKitRetrieval.js";
import {
  CORE_GRAPH_RETRIEVAL_QUERY_STRATEGY_IDS,
  RETRIEVAL_QUERY_STRATEGY_IDS,
  isCoreGraphRetrievalQueryStrategyId,
  type CoreGraphRetrievalQueryStrategyId
} from "../../src/evaluation/retrievalQueryStrategies.js";
import type { EvaluationCase, MyDevKitIndexBuildMode } from "../../src/evaluation/types.js";

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

describe("buildMyDevKitIndex build modes", () => {
  type Evidence = Record<string, unknown>;

  const appliedNeighborhood: Evidence = {
    requestedScope: "affected-neighborhood",
    appliedScope: "affected-neighborhood",
    selectionStatus: "applied",
    fallbackReason: null,
    seedFileCount: 1,
    seedSymbolCount: 2,
    affectedNodeCount: 5,
    affectedEdgeCount: 4,
    forcedNeighborReanalysisFileCount: 1,
    forcedNeighborSample: ["src/a.ts"],
    freshExtractionFileCount: 2,
    reusedFileCount: 8
  };
  const appliedChangedFiles: Evidence = {
    requestedScope: "changed-files",
    appliedScope: "changed-files",
    selectionStatus: "applied",
    fallbackReason: null,
    seedFileCount: null,
    seedSymbolCount: null,
    affectedNodeCount: null,
    affectedEdgeCount: null,
    forcedNeighborReanalysisFileCount: 0,
    forcedNeighborSample: [],
    freshExtractionFileCount: 1,
    reusedFileCount: 9
  };

  // Test-local fake kit whose `index` prints the given stdout (documented v1.12.5 JSON contract).
  function fakeIncrementalKit(dir: string, stdout: string): string {
    const scriptPath = path.join(dir, "fake-incremental-kit.mjs");
    writeFileSync(scriptPath, `process.stdout.write(${JSON.stringify(stdout)});\n`);
    return `node ${scriptPath}`;
  }

  async function build(
    mode: MyDevKitIndexBuildMode | undefined,
    payload: string | Evidence | undefined,
    requireKit = false
  ) {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-mode-"));
    tempDirs.push(outDir);
    const stdout = typeof payload === "string" ? payload : JSON.stringify(payload === undefined ? { ok: true } : { ok: true, incrementalRefresh: payload });
    return buildMyDevKitIndex({
      target: baseCase,
      kitCommand: fakeIncrementalKit(outDir, stdout),
      indexDir: path.join(outDir, "index"),
      commandsDir: path.join(outDir, "commands"),
      requireKit,
      ...(mode ? { mode } : {})
    });
  }

  const changedFiles: MyDevKitIndexBuildMode = { kind: "incremental", refreshScope: "changed-files" };
  const neighborhood: MyDevKitIndexBuildMode = { kind: "incremental", refreshScope: "affected-neighborhood" };

  it("omitted mode keeps the legacy full command shape and reports full mode without evidence", async () => {
    const result = await build(undefined, undefined);
    expect(result.ok).toBe(true);
    expect(result.mode).toEqual({ kind: "full" });
    expect(result.incrementalRefresh).toBeNull();
    expect(result.command.args).not.toContain("--incremental");
    expect(result.command.args).not.toContain("--refresh-scope");
    expect(result.command.args.slice(-3)).toEqual(["--out", result.indexDir, "--json"]);
  });

  it("changed-files mode requests the explicit scope and parses evidence", async () => {
    const result = await build(changedFiles, appliedChangedFiles);
    expect(result.command.args.slice(-6)).toEqual(["--out", result.indexDir, "--incremental", "--refresh-scope", "changed-files", "--json"]);
    expect(result.ok).toBe(true);
    expect(result.mode).toEqual(changedFiles);
    expect(result.incrementalRefresh).toEqual(appliedChangedFiles);
  });

  it("affected-neighborhood mode requests the explicit scope and preserves applied evidence unchanged", async () => {
    const result = await build(neighborhood, appliedNeighborhood);
    expect(result.command.args.slice(-6)).toEqual(["--out", result.indexDir, "--incremental", "--refresh-scope", "affected-neighborhood", "--json"]);
    expect(result.ok).toBe(true);
    expect(result.incrementalRefresh).toEqual(appliedNeighborhood);
  });

  it("keeps a truthful full fallback as successful evidence with the exact reason", async () => {
    const fallback = { ...appliedNeighborhood, appliedScope: "full", selectionStatus: "fallback-full", fallbackReason: "cache-missing", seedFileCount: null, seedSymbolCount: null, affectedNodeCount: null, affectedEdgeCount: null };
    const result = await build(neighborhood, fallback);
    expect(result.ok).toBe(true);
    expect(result.incrementalRefresh?.requestedScope).toBe("affected-neighborhood");
    expect(result.incrementalRefresh?.appliedScope).toBe("full");
    expect(result.incrementalRefresh?.selectionStatus).toBe("fallback-full");
    expect(result.incrementalRefresh?.fallbackReason).toBe("cache-missing");
  });

  it("keeps a no-change run as successful evidence", async () => {
    const noChange = { ...appliedChangedFiles, appliedScope: "none", selectionStatus: "not-needed", freshExtractionFileCount: 0, reusedFileCount: 10 };
    const result = await build(changedFiles, noChange);
    expect(result.ok).toBe(true);
    expect(result.incrementalRefresh?.appliedScope).toBe("none");
    expect(result.incrementalRefresh?.selectionStatus).toBe("not-needed");
  });

  it("does not claim success when incrementalRefresh is missing (warning without requireKit, throw with it)", async () => {
    const soft = await build(changedFiles, undefined);
    expect(soft.ok).toBe(false);
    expect(soft.incrementalRefresh).toBeNull();
    expect(soft.mode).toEqual(changedFiles);
    expect(soft.command.ok).toBe(true);
    expect(soft.warnings.join(" ")).toContain("no valid incrementalRefresh evidence");
    await expect(build(changedFiles, undefined, true)).rejects.toThrow("incrementalRefresh");
  });

  it("rejects non-JSON stdout for an incremental build", async () => {
    const result = await build(changedFiles, "not json");
    expect(result.ok).toBe(false);
    expect(result.warnings.join(" ")).toContain("not valid JSON");
  });

  const invalidCases: Array<[string, MyDevKitIndexBuildMode, Evidence]> = [
    ["requestedScope mismatch", changedFiles, appliedNeighborhood],
    ["unknown appliedScope", neighborhood, { ...appliedNeighborhood, appliedScope: "partial" }],
    ["unknown selectionStatus", neighborhood, { ...appliedNeighborhood, selectionStatus: "maybe" }],
    ["negative count", changedFiles, { ...appliedChangedFiles, reusedFileCount: -1 }],
    ["non-integer count", changedFiles, { ...appliedChangedFiles, freshExtractionFileCount: 1.5 }],
    ["wrong-type count", changedFiles, { ...appliedChangedFiles, forcedNeighborReanalysisFileCount: "0" }],
    ["non-string sample entry", changedFiles, { ...appliedChangedFiles, forcedNeighborSample: [1] }],
    ["fallback-full with changed-files appliedScope", neighborhood, { ...appliedNeighborhood, selectionStatus: "fallback-full", appliedScope: "changed-files", fallbackReason: "x" }],
    ["fallback-full with null reason", neighborhood, { ...appliedNeighborhood, selectionStatus: "fallback-full", appliedScope: "full", fallbackReason: null }],
    ["fallback-full with empty reason", neighborhood, { ...appliedNeighborhood, selectionStatus: "fallback-full", appliedScope: "full", fallbackReason: "" }],
    ["applied with a fallback reason", changedFiles, { ...appliedChangedFiles, fallbackReason: "x" }],
    ["applied with a different appliedScope", changedFiles, { ...appliedChangedFiles, appliedScope: "full" }],
    ["not-needed with full appliedScope", changedFiles, { ...appliedChangedFiles, selectionStatus: "not-needed", appliedScope: "full" }],
    ["applied neighborhood with null counts", neighborhood, { ...appliedNeighborhood, affectedNodeCount: null }]
  ];

  it.each(invalidCases)("rejects invalid evidence: %s", async (_name, mode, evidence) => {
    const result = await build(mode, evidence);
    expect(result.ok).toBe(false);
    expect(result.incrementalRefresh).toBeNull();
    expect(result.mode).toEqual(mode);
    expect(result.warnings).toHaveLength(1);
  });

  it("preserves process-failure behavior for an incremental request", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-mode-"));
    tempDirs.push(outDir);
    const result = await buildMyDevKitIndex({
      target: baseCase,
      kitCommand: "definitely-not-a-real-command",
      indexDir: path.join(outDir, "index"),
      commandsDir: path.join(outDir, "commands"),
      requireKit: false,
      mode: neighborhood
    });
    expect(result.ok).toBe(false);
    expect(result.mode).toEqual(neighborhood);
    expect(result.incrementalRefresh).toBeNull();
    expect(result.warnings).toEqual(["my-dev-kit index command was unavailable or failed."]);
  });
});

describe("retrieval query strategy contract", () => {
  it("TST-081-001: exposes the exact ordered strategy identities", () => {
    expect(RETRIEVAL_QUERY_STRATEGY_IDS).toEqual([
      "keyword-search",
      "symbol-lookup",
      "graph-neighborhood",
      "source-slice",
      "data-model-graph",
      "model-view-lineage",
      "combined-graph-guided"
    ]);
    expect(CORE_GRAPH_RETRIEVAL_QUERY_STRATEGY_IDS).toEqual([
      "keyword-search",
      "symbol-lookup",
      "graph-neighborhood",
      "source-slice",
      "combined-graph-guided"
    ]);
    for (const id of CORE_GRAPH_RETRIEVAL_QUERY_STRATEGY_IDS) {
      expect(isCoreGraphRetrievalQueryStrategyId(id)).toBe(true);
    }
    expect(isCoreGraphRetrievalQueryStrategyId("data-model-graph")).toBe(false);
    expect(isCoreGraphRetrievalQueryStrategyId("model-view-lineage")).toBe(false);
  });
});

describe("runMyDevKitRetrievalStrategyFromIndex", () => {
  const expectedCommands: Record<CoreGraphRetrievalQueryStrategyId, string[]> = {
    "keyword-search": ["search"],
    "symbol-lookup": ["search", "lookup"],
    "graph-neighborhood": ["search", "slice"],
    "source-slice": ["search", "source"],
    "combined-graph-guided": ["search", "lookup", "slice", "source"]
  };
  const strategies = CORE_GRAPH_RETRIEVAL_QUERY_STRATEGY_IDS;

  async function prepare() {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-strategy-"));
    tempDirs.push(outDir);
    const indexDir = path.join(outDir, "indexes", baseCase.id);
    await buildMyDevKitIndex({
      target: baseCase,
      kitCommand: fakeKitCommand,
      indexDir,
      commandsDir: path.join(outDir, "index-commands"),
      requireKit: true
    });
    return { outDir, indexDir, commandsDir: path.join(outDir, "commands", baseCase.id) };
  }

  async function run(
    strategyId: CoreGraphRetrievalQueryStrategyId,
    prepared: { indexDir: string; commandsDir: string },
    kitCommand = fakeKitCommand,
    requireKit = true
  ) {
    return runMyDevKitRetrievalStrategyFromIndex({
      strategyId,
      evaluationCase: baseCase,
      kitCommand,
      indexDir: prepared.indexDir,
      commandsDir: prepared.commandsDir,
      requireKit
    });
  }

  it.each(strategies)("TST-081-002: %s runs exactly its command sequence on the prepared index", async (strategyId) => {
    const prepared = await prepare();
    const result = await run(strategyId, prepared);
    expect(result.commands.map((command) => command.commandId)).toEqual(expectedCommands[strategyId]);
    for (const command of result.commands) {
      expect(command.args).not.toContain("index");
      expect(command.args[command.args.indexOf("--index") + 1]).toBe(prepared.indexDir);
    }
  });

  it("TST-081-003: applies the planner-defined context precedence", async () => {
    const prepared = await prepare();
    const keyword = await run("keyword-search", prepared);
    expect(keyword.contextText).toBe(keyword.commands[0].stdout);
    const lookup = await run("symbol-lookup", prepared);
    expect(lookup.contextText).toBe(lookup.commands[1].stdout);
    const slice = await run("graph-neighborhood", prepared);
    expect(slice.contextText).toBe(slice.commands[1].stdout);
    const source = await run("source-slice", prepared);
    expect(source.contextText).toBe(fakeCreateTaskSource);
    expect(source.contextText).toBe(source.commands[1].stdout);
    const combined = await run("combined-graph-guided", prepared);
    expect(combined.contextText).toBe(fakeCreateTaskSource);
  });

  it.each([
    { strategyId: "symbol-lookup", failOn: "lookup", commands: ["search", "lookup"] },
    { strategyId: "graph-neighborhood", failOn: "slice", commands: ["search", "slice"] },
    { strategyId: "source-slice", failOn: "source", commands: ["search", "source"] }
  ] as const)("TST-081-004: $strategyId falls back to search when $failOn fails without throwing", async ({ strategyId, failOn, commands }) => {
    const prepared = await prepare();
    const kitCommand = writeFakeKitVariant(prepared.outDir, { failOn });
    const result = await run(strategyId, prepared, kitCommand, true);
    expect(result.commands.map((command) => command.commandId)).toEqual(commands);
    expect(result.warnings).toEqual([`my-dev-kit ${failOn} command failed.`]);
    expect(result.contextText).toBe(result.commands[0].stdout);
    expect(result.skipped).toBe(false);
  });

  it.each(strategies)("TST-081-005: %s handles a search candidate without a node id", async (strategyId) => {
    const prepared = await prepare();
    const kitCommand = writeFakeKitVariant(prepared.outDir, { searchWithoutNode: true });
    const result = await run(strategyId, prepared, kitCommand);
    expect(result.commands.map((command) => command.commandId)).toEqual(["search"]);
    expect(result.warnings).toEqual(strategyId === "keyword-search" ? [] : ["No my-dev-kit node id was available after search."]);
    expect(result.contextText).toBe(result.commands[0].stdout);
    expect(result.selectedFile).toBe("src/taskService.ts");
  });

  it.each(strategies)("TST-081-006: %s evidence contains only executed command families", async (strategyId) => {
    const prepared = await prepare();
    const result = await run(strategyId, prepared);
    expect(result.retrievalEvidence?.commands.map((command) => command.family)).toEqual(expectedCommands[strategyId]);
  });

  it("TST-081-007: runMyDevKitRetrievalFromIndex is a combined-graph-guided compatibility wrapper", async () => {
    const prepared = await prepare();
    const wrapped = await runMyDevKitRetrievalFromIndex({
      evaluationCase: baseCase,
      kitCommand: fakeKitCommand,
      indexDir: prepared.indexDir,
      commandsDir: prepared.commandsDir,
      requireKit: true
    });
    const direct = await run("combined-graph-guided", prepared);
    const { durationMs: _a, commands: wrappedCommands, ...wrappedRest } = wrapped;
    const { durationMs: _b, commands: directCommands, ...directRest } = direct;
    expect(wrappedRest).toEqual(directRest);
    const shape = (commands: typeof wrappedCommands) =>
      commands.map((command) => ({ commandId: command.commandId, args: command.args, ok: command.ok }));
    expect(shape(wrappedCommands)).toEqual(shape(directCommands));
  });

  it.each(strategies)("TST-081-009: %s preserves search failure semantics", async (strategyId) => {
    const prepared = await prepare();
    const kitCommand = writeFakeKitVariant(prepared.outDir, { failOn: "search" });
    const skipped = await run(strategyId, prepared, kitCommand, false);
    expect(skipped.skipped).toBe(true);
    expect(skipped.warnings).toEqual(["my-dev-kit search command failed."]);
    expect(skipped.commands.map((command) => command.commandId)).toEqual(["search"]);
    await expect(run(strategyId, prepared, kitCommand, true)).rejects.toThrow();
  });

  it.each(strategies)("TST-081-010: %s selects candidates[0] regardless of the answer key", async (strategyId) => {
    const prepared = await prepare();
    const scriptPath = path.join(prepared.outDir, "fake-kit-two-candidates.mjs");
    writeFileSync(
      scriptPath,
      [
        `const command = process.argv[2];`,
        `if (command === "search") { console.log(JSON.stringify({ results: [`,
        `  { nodeId: "other:first", file: "src/unrelated.ts", symbol: "firstHit" },`,
        `  { nodeId: "todo-ts:createTask", file: "src/taskService.ts", symbol: "createTask" } ] })); process.exit(0); }`,
        `await import(${JSON.stringify(pathToFileURL(fakeKitPath).href)});`
      ].join("\n")
    );
    const result = await run(strategyId, prepared, `node ${scriptPath}`);
    expect(result.selectedNodeId).toBe("other:first");
    expect(result.selectedFile).toBe("src/unrelated.ts");
    expect(result.selectedSymbol).toBe("firstHit");
    for (const command of result.commands.slice(1)) {
      expect(command.args[command.args.indexOf("--node") + 1]).toBe("other:first");
    }
  });
});
