import path from "node:path";
import type { MeasuredCommandResult, RunMeasuredCommandOptions } from "../../../src/core/runMeasuredCommand.js";
import type { EvaluationCase, MyDevKitIndexBuildResult, RawFullFileBaselineResult } from "../../../src/evaluation/types.js";
import type { ContextPackGenerationDependencies } from "../../../src/experiments/plugins/contextPackGeneration/index.js";
import { makeEvaluationCase } from "../retrievalPrecisionRecall/retrievalPrecisionRecallTestHelpers.js";

export { makeEvaluationCase };

export const SOURCE_TEXT_SENTINEL = "SENTINEL_SOURCE_LINE_from_my_dev_kit_source";

export type FakeNode = { id: string; kind: "file" | "symbol"; path: string; symbolName?: string; line?: number };
export type FakeEdge = { source: string; target: string; kind: string };

export type FakeKitWorld = {
  /** Raw search results in upstream order. */
  search: Array<{ kind: string; nodeId: string; path: string; label: string }>;
  lookup?: (nodeId: string) => { node: FakeNode } | null;
  slice?: (nodeId: string) => { nodes: FakeNode[]; edges: FakeEdge[] } | null;
  /** Source by explicit file range. */
  sourceRange?: (file: string, start: number, end: number) => { content: string; endLine: number; eof: boolean } | null;
  /** Source by node (preview). */
  sourceNode?: (nodeId: string) => { startLine: number; endLine: number; content: string; boundaryKnown: boolean; eof: boolean } | null;
  failSearch?: boolean;
};

export type RecordedCommand = { commandId: string; args: string[] };

export function symbolIndexOf(files: Array<{ path: string; lineCount: number; symbols: Array<[string, number]> }>): unknown {
  return {
    schemaVersion: "2",
    fileCount: files.length,
    files: files.map((file) => ({
      path: file.path,
      language: "typescript",
      lineCount: file.lineCount,
      imports: [],
      exports: [],
      symbols: file.symbols.map(([name, line]) => ({ name, kind: "function", location: { file: file.path, line }, exported: true, signature: `function ${name}` }))
    }))
  };
}

function commandResult(commandId: string, args: string[], ok: boolean, stdout: string): MeasuredCommandResult {
  return {
    commandId,
    commandString: "fake-kit",
    executable: "fake-kit",
    args,
    cwd: process.cwd(),
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:00.001Z",
    durationMs: 1,
    exitCode: ok ? 0 : 1,
    stdout,
    stderr: "",
    stdoutPath: "stdout.txt",
    stderrPath: "stderr.txt",
    telemetryPath: "telemetry.json",
    ok
  };
}

const argAfter = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

export type FakeHarness = {
  dependencies: ContextPackGenerationDependencies;
  commands: RecordedCommand[];
  events: string[];
  indexBuilds: Array<{ indexDir: string; absoluteTargetRoot: string; callGraph: boolean | undefined }>;
};

export function makeHarness(args: {
  world: FakeKitWorld | ((evaluationCase: EvaluationCase | null) => FakeKitWorld);
  symbolIndex?: unknown | (() => Promise<unknown>);
  raw?: (evaluationCase: EvaluationCase) => Partial<RawFullFileBaselineResult> | "throw";
  indexOk?: (absoluteTargetRoot: string) => boolean;
  events?: string[];
}): FakeHarness {
  const commands: RecordedCommand[] = [];
  const events = args.events ?? [];
  const indexBuilds: FakeHarness["indexBuilds"] = [];
  const resolveWorld = (queryHint: string | null): FakeKitWorld => (typeof args.world === "function" ? args.world(null) : args.world);
  const caseByQuery = new Map<string, EvaluationCase>();

  const dependencies: ContextPackGenerationDependencies = {
    buildIndex: async (options) => {
      events.push(`index:${path.basename(options.target.absoluteTargetRoot)}`);
      indexBuilds.push({ indexDir: options.indexDir, absoluteTargetRoot: options.target.absoluteTargetRoot, callGraph: options.callGraph });
      const ok = args.indexOk ? args.indexOk(options.target.absoluteTargetRoot) : true;
      return { ok, indexDir: options.indexDir, durationMs: 1, warnings: [], mode: { kind: "full" }, incrementalRefresh: null, command: commandResult("index", [], ok, "") } as MyDevKitIndexBuildResult;
    },
    runCommand: async (options: RunMeasuredCommandOptions) => {
      const extra = [...(options.extraArgs ?? [])];
      const family = extra[0];
      commands.push({ commandId: options.commandId, args: extra });
      events.push(`cmd:${options.commandId}`);
      if (family === "index") return commandResult(options.commandId, extra, true, "{}");
      const world = resolveWorld(null);
      if (family === "search") {
        if (world.failSearch) return commandResult(options.commandId, extra, false, "");
        const results = world.search.map((hit, index) => ({ id: hit.nodeId, kind: hit.kind, label: hit.label, nodeId: hit.nodeId, path: hit.path, score: 100 - index }));
        return commandResult(options.commandId, extra, true, JSON.stringify({ artifactKind: "my-dev-kit-v1-search-result", results }));
      }
      const nodeId = argAfter(extra, "--node");
      if (family === "lookup") {
        const found = world.lookup?.(nodeId as string) ?? null;
        return found ? commandResult(options.commandId, extra, true, JSON.stringify({ status: "found", node: found.node, incomingEdges: [], outgoingEdges: [] })) : commandResult(options.commandId, extra, false, "");
      }
      if (family === "slice") {
        const found = world.slice?.(nodeId as string) ?? null;
        return found ? commandResult(options.commandId, extra, true, JSON.stringify({ focusNodeId: nodeId, nodes: found.nodes, edges: found.edges })) : commandResult(options.commandId, extra, false, "");
      }
      if (family === "source") {
        if (nodeId !== undefined) {
          const found = world.sourceNode?.(nodeId) ?? null;
          if (!found) return commandResult(options.commandId, extra, false, "");
          return commandResult(
            options.commandId,
            extra,
            true,
            JSON.stringify({ status: "ok", mode: "node", startLine: found.startLine, endLine: found.endLine, content: found.content, continuationCursor: { eof: found.eof, symbolBoundaryKnown: found.boundaryKnown, reason: found.boundaryKnown ? "window-capped" : "symbol-end-unknown" } })
          );
        }
        const file = argAfter(extra, "--file") as string;
        const start = Number(argAfter(extra, "--start"));
        const end = Number(argAfter(extra, "--end"));
        const found = world.sourceRange?.(file, start, end) ?? null;
        if (!found) return commandResult(options.commandId, extra, false, "");
        return commandResult(
          options.commandId,
          extra,
          true,
          JSON.stringify({ status: "ok", mode: "line-range", startLine: start, endLine: found.endLine, content: found.content, continuationCursor: { eof: found.eof, symbolBoundaryKnown: true, reason: "window-capped" } })
        );
      }
      return commandResult(options.commandId, extra, false, "");
    },
    runRawBaseline: async (evaluationCase) => {
      events.push(`raw:${evaluationCase.id}`);
      caseByQuery.set(evaluationCase.query, evaluationCase);
      const override = args.raw ? args.raw(evaluationCase) : {};
      if (override === "throw") throw new Error("raw baseline exploded with C:\\secret\\path");
      return {
        caseId: evaluationCase.id,
        targetRoot: evaluationCase.absoluteTargetRoot,
        filesIncluded: ["src/a.ts", "src/b.ts", "src/c.ts"],
        totalFiles: 3,
        totalChars: 4000,
        totalEstimatedTokens: 1000,
        tokenCountMethod: "estimated_chars_div_4",
        contextText: "raw",
        durationMs: 1,
        ...override
      } as RawFullFileBaselineResult;
    },
    readSymbolIndex: async () => {
      const value = args.symbolIndex;
      if (typeof value === "function") return value();
      return value ?? symbolIndexOf([]);
    },
    probeVersion: async () => ({ name: "my-dev-kit", version: "1.12.5", availability: "available", reason: null }) as never
  };
  return { dependencies, commands, events, indexBuilds };
}

/** Standard two-file world used by most tests: symbol A in src/a.ts and symbol B in src/b.ts, plus one test file. */
export function standardWorld(overrides: Partial<FakeKitWorld> = {}): FakeKitWorld {
  const a: FakeNode = { id: "symbol:src/a.ts#A", kind: "symbol", path: "src/a.ts", symbolName: "A", line: 1 };
  const b: FakeNode = { id: "symbol:src/b.ts#B", kind: "symbol", path: "src/b.ts", symbolName: "B", line: 5 };
  return {
    search: [
      { kind: "symbol", nodeId: a.id, path: "src/a.ts", label: "A" },
      { kind: "symbol", nodeId: b.id, path: "src/b.ts", label: "B" },
      { kind: "file", nodeId: "file:tests/a.test.ts", path: "tests/a.test.ts", label: "a.test.ts" }
    ],
    lookup: (nodeId) => ({ node: nodeId === a.id ? a : nodeId === b.id ? b : { id: nodeId, kind: "file", path: nodeId.replace(/^file:/, "") } }),
    slice: (nodeId) => ({
      nodes: [a, b, { id: "file:tests/a.test.ts", kind: "file", path: "tests/a.test.ts" }],
      edges: [
        { source: a.id, target: b.id, kind: "calls" },
        { source: "file:src/a.ts", target: a.id, kind: "defines" },
        { source: "file:src/a.ts", target: a.id, kind: "exports" },
        { source: nodeId, target: "file:src/c.ts", kind: "imports" }
      ]
    }),
    sourceRange: (file, start, end) => {
      const last = Math.min(end, 40);
      return { content: Array.from({ length: last - start + 1 }, (_, i) => `${SOURCE_TEXT_SENTINEL} ${file} L${start + i}`).join("\n"), endLine: last, eof: last >= 40 };
    },
    sourceNode: () => null,
    ...overrides
  };
}

export const STANDARD_SYMBOL_INDEX = symbolIndexOf([
  { path: "src/a.ts", lineCount: 30, symbols: [["A", 1], ["A2", 12]] },
  { path: "src/b.ts", lineCount: 300, symbols: [["B", 5]] },
  { path: "src/c.ts", lineCount: 10, symbols: [["C", 1]] }
]);
