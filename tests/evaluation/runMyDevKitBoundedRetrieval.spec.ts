import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BOUNDED_SOURCE_PROTOCOL_ID,
  isBoundedRetrievalResult,
  planBoundedSourceCandidates,
  runMyDevKitBoundedRetrievalFromIndex,
  runMyDevKitRetrievalFromIndex
} from "../../src/evaluation/runMyDevKitRetrieval.js";
import type { EvaluationCase } from "../../src/evaluation/types.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type StubResult = Record<string, unknown>;

function fileResult(file: string, extra: StubResult = {}): StubResult {
  return { kind: "file", id: `file:${file}`, nodeId: `file:${file}`, path: file, label: file, score: 10, ...extra };
}

function symbolResult(file: string, name: string, extra: StubResult = {}): StubResult {
  return { kind: "symbol", id: `symbol:${file}#${name}`, nodeId: `symbol:${file}#${name}`, path: file, label: name, symbolName: name, score: 9, ...extra };
}

/** Test-local kit stub: structured search/lookup/slice output, per-node source failures, and an argv log. */
function writeStubKit(options: { results: StubResult[]; failSourceNodes?: string[]; failSearch?: boolean }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bounded-kit-"));
  tempDirs.push(dir);
  const logPath = path.join(dir, "argv.jsonl");
  const scriptPath = path.join(dir, "stub-kit.mjs");
  writeFileSync(
    scriptPath,
    [
      `import { appendFileSync } from "node:fs";`,
      `const argv = process.argv.slice(2);`,
      `appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(argv) + "\\n");`,
      `const value = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };`,
      `const results = ${JSON.stringify(options.results)};`,
      `const failSourceNodes = ${JSON.stringify(options.failSourceNodes ?? [])};`,
      `if (argv[0] === "search") {`,
      options.failSearch ? `  process.stderr.write("forced search failure"); process.exit(1);` : `  console.log(JSON.stringify({ artifactKind: "my-dev-kit-v1-search-result", version: "1.0.0", results })); process.exit(0);`,
      `}`,
      `if (argv[0] === "lookup") { console.log(JSON.stringify({ status: "found", node: results[0], neighbors: [] })); process.exit(0); }`,
      `if (argv[0] === "slice") { console.log(JSON.stringify({ artifactKind: "my-dev-kit-v1-graph-slice", version: "1.0.0", nodes: [] })); process.exit(0); }`,
      `if (argv[0] === "source") {`,
      `  const node = value("--node");`,
      `  if (failSourceNodes.includes(node)) { process.stderr.write("forced source failure"); process.exit(1); }`,
      `  process.stdout.write("1 | source for " + node); process.exit(0);`,
      `}`,
      `process.exit(0);`
    ].join("\n")
  );
  const argvLog = () =>
    readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  return { kitCommand: `node ${scriptPath}`, argvLog };
}

function evaluationCase(expectedFiles: string[]): EvaluationCase {
  return {
    id: "bounded-case",
    title: "Bounded case",
    benchmarkProject: "todo-ts",
    targetRoot: "benchmarks/projects/todo-ts",
    absoluteTargetRoot: path.resolve(process.cwd(), "benchmarks/projects/todo-ts"),
    sourceRoots: ["src"],
    query: "create task",
    expectedFiles,
    expectedSymbols: [],
    rawIncludeGlobs: ["src/**/*"]
  };
}

function workDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bounded-out-"));
  tempDirs.push(dir);
  return dir;
}

describe("planBoundedSourceCandidates", () => {
  it("plans distinct files in search rank order and ignores edges and other kinds", () => {
    const plan = planBoundedSourceCandidates(
      [
        { kind: "edge", id: "a--defines-->b" },
        symbolResult("src/a.ts", "alpha"),
        symbolResult("src/a.ts", "alphaTwo"),
        fileResult("src/b.ts"),
        { kind: "route", id: "route:/x", path: "src/c.ts" },
        fileResult("src/c.ts")
      ],
      8
    );
    expect(plan.candidates.map((candidate) => candidate.file)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(plan.candidates[0].nodeId).toBe("symbol:src/a.ts#alpha");
    expect(plan.eligibleFileCount).toBe(3);
    expect(plan.rejectedCount).toBe(0);
  });

  it("applies the fixed budget without hiding that more eligible files existed", () => {
    const results = ["a", "b", "c", "d", "e", "f"].map((name) => fileResult(`src/${name}.ts`));
    const plan = planBoundedSourceCandidates(results, 3);
    expect(plan.candidates.map((candidate) => candidate.file)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(plan.eligibleFileCount).toBe(6);
  });

  it("rejects unsafe file identities and entries without a node id instead of repairing them", () => {
    const plan = planBoundedSourceCandidates(
      [
        fileResult("../outside.ts"),
        fileResult("/abs/path.ts"),
        fileResult("C:/drive/path.ts"),
        { kind: "file", path: "src/no-id.ts" },
        fileResult("src/ok.ts"),
        symbolResult("src\\win.ts", "winSymbol")
      ],
      8
    );
    expect(plan.candidates.map((candidate) => candidate.file)).toEqual(["src/ok.ts", "src/win.ts"]);
    expect(plan.rejectedCount).toBe(4);
  });

  it("accepts the legacy kind-less search shape the historical lifecycle accepts", () => {
    const plan = planBoundedSourceCandidates([{ nodeId: "todo-ts:createTask", file: "src/taskService.ts", symbol: "createTask" }], 8);
    expect(plan.candidates).toEqual([{ file: "src/taskService.ts", nodeId: "todo-ts:createTask" }]);
  });

  it("returns an empty plan for a non-positive budget", () => {
    expect(planBoundedSourceCandidates([fileResult("src/a.ts")], 0).candidates).toEqual([]);
  });
});

describe("runMyDevKitBoundedRetrievalFromIndex", () => {
  it("sources each ranked distinct candidate once and reports only successfully sourced files as read", async () => {
    const kit = writeStubKit({ results: [symbolResult("src/a.ts", "alpha"), fileResult("src/b.ts"), fileResult("src/c.ts"), symbolResult("src/a.ts", "alphaTwo")] });
    const result = await runMyDevKitBoundedRetrievalFromIndex({
      evaluationCase: evaluationCase(["src/z-not-searched.ts"]),
      kitCommand: kit.kitCommand,
      indexDir: "index-dir",
      commandsDir: workDir(),
      requireKit: false
    });
    expect(isBoundedRetrievalResult(result)).toBe(true);
    expect(result.filesRead).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(result.commands.map((command) => command.commandId)).toEqual(["search", "lookup", "slice", "source", "source-candidate-2", "source-candidate-3"]);
    if (!isBoundedRetrievalResult(result)) throw new Error("expected bounded result");
    expect(result.boundedCoverage).toMatchObject({
      protocol: BOUNDED_SOURCE_PROTOCOL_ID,
      eligibleCandidateFileCount: 3,
      candidateBudgetExhausted: false,
      searchTruncated: false,
      rejectedCandidateCount: 0
    });
    expect(result.boundedCoverage.attempts.map((attempt) => attempt.sourced)).toEqual([true, true, true]);
    // The historical lifecycle ran exactly one source for the first candidate; no node is sourced twice.
    const sourced = kit.argvLog().filter((argv) => argv[0] === "source").map((argv) => argv[argv.indexOf("--node") + 1]);
    expect(sourced).toEqual(["symbol:src/a.ts#alpha", "file:src/b.ts", "file:src/c.ts"]);
    expect(result.contextText).toContain("source for file:src/b.ts");
  });

  it("requests an explicit bounded search limit and never mentions expected files, symbols or facts", async () => {
    const kit = writeStubKit({ results: [fileResult("src/a.ts")] });
    await runMyDevKitBoundedRetrievalFromIndex({
      evaluationCase: { ...evaluationCase(["src/secret-expected.ts"]), expectedSymbols: ["secretExpectedSymbol"] },
      kitCommand: kit.kitCommand,
      indexDir: "index-dir",
      commandsDir: workDir(),
      requireKit: false
    });
    const argv = kit.argvLog();
    const search = argv.find((entry) => entry[0] === "search")!;
    expect(search[search.indexOf("--limit") + 1]).toBe("40");
    expect(JSON.stringify(argv)).not.toContain("secret-expected");
    expect(JSON.stringify(argv)).not.toContain("secretExpectedSymbol");
  });

  it("selects identical commands regardless of the answer key (no answer-key injection into selection)", async () => {
    const results = [fileResult("src/a.ts"), fileResult("src/b.ts"), fileResult("src/c.ts")];
    const runWith = async (expectedFiles: string[]) => {
      const kit = writeStubKit({ results });
      const result = await runMyDevKitBoundedRetrievalFromIndex({
        evaluationCase: evaluationCase(expectedFiles),
        kitCommand: kit.kitCommand,
        indexDir: "index-dir",
        commandsDir: workDir(),
        requireKit: false
      });
      return { filesRead: result.filesRead, argv: kit.argvLog() };
    };
    const first = await runWith(["src/a.ts"]);
    const second = await runWith(["src/x.ts", "src/y.ts", "src/z.ts", "src/q.ts", "src/r.ts"]);
    expect(second).toEqual(first);
  });

  it("does not credit a candidate whose source command failed and keeps the others", async () => {
    const kit = writeStubKit({ results: [fileResult("src/a.ts"), fileResult("src/b.ts"), fileResult("src/c.ts")], failSourceNodes: ["file:src/b.ts"] });
    const result = await runMyDevKitBoundedRetrievalFromIndex({
      evaluationCase: evaluationCase([]),
      kitCommand: kit.kitCommand,
      indexDir: "index-dir",
      commandsDir: workDir(),
      requireKit: false
    });
    expect(result.filesRead).toEqual(["src/a.ts", "src/c.ts"]);
    expect(result.warnings.join(" ")).toContain("bounded candidate 2");
    if (!isBoundedRetrievalResult(result)) throw new Error("expected bounded result");
    expect(result.boundedCoverage.attempts.map((attempt) => [attempt.file, attempt.sourced])).toEqual([
      ["src/a.ts", true],
      ["src/b.ts", false],
      ["src/c.ts", true]
    ]);
  });

  it("does not credit the first candidate when its own source command failed", async () => {
    const kit = writeStubKit({ results: [fileResult("src/a.ts"), fileResult("src/b.ts")], failSourceNodes: ["file:src/a.ts"] });
    const result = await runMyDevKitBoundedRetrievalFromIndex({
      evaluationCase: evaluationCase([]),
      kitCommand: kit.kitCommand,
      indexDir: "index-dir",
      commandsDir: workDir(),
      requireKit: false
    });
    expect(result.filesRead).toEqual(["src/b.ts"]);
  });

  it("truncates at the candidate budget and records that more eligible files existed", async () => {
    const results = ["a", "b", "c", "d", "e"].map((name) => fileResult(`src/${name}.ts`));
    const kit = writeStubKit({ results });
    const result = await runMyDevKitBoundedRetrievalFromIndex({
      evaluationCase: evaluationCase([]),
      kitCommand: kit.kitCommand,
      indexDir: "index-dir",
      commandsDir: workDir(),
      requireKit: false,
      boundedSource: { maxSourceFiles: 2, searchLimit: 5 }
    });
    expect(result.filesRead).toEqual(["src/a.ts", "src/b.ts"]);
    if (!isBoundedRetrievalResult(result)) throw new Error("expected bounded result");
    expect(result.boundedCoverage).toMatchObject({ maxSourceFiles: 2, eligibleCandidateFileCount: 5, candidateBudgetExhausted: true, searchTruncated: true });
  });

  it("still declares the bounded protocol, with nothing sourced, when the search fails", async () => {
    const kit = writeStubKit({ results: [], failSearch: true });
    const result = await runMyDevKitBoundedRetrievalFromIndex({
      evaluationCase: evaluationCase([]),
      kitCommand: kit.kitCommand,
      indexDir: "index-dir",
      commandsDir: workDir(),
      requireKit: false
    });
    expect(result.skipped).toBe(true);
    expect(result.filesRead).toEqual([]);
    expect(isBoundedRetrievalResult(result)).toBe(true);
    expect(result.commands.some((command) => !command.ok)).toBe(true);
  });

  it("keeps default top-one retrieval unchanged: one source, no bounded coverage, no --limit", async () => {
    const kit = writeStubKit({ results: [symbolResult("src/a.ts", "alpha"), fileResult("src/b.ts")] });
    const result = await runMyDevKitRetrievalFromIndex({
      evaluationCase: evaluationCase(["src/a.ts", "src/b.ts"]),
      kitCommand: kit.kitCommand,
      indexDir: "index-dir",
      commandsDir: workDir(),
      requireKit: false
    });
    expect(result.filesRead).toEqual(["src/a.ts"]);
    expect(result.commands.map((command) => command.commandId)).toEqual(["search", "lookup", "slice", "source"]);
    expect(Object.keys(result)).not.toContain("boundedCoverage");
    expect(isBoundedRetrievalResult(result)).toBe(false);
    const search = kit.argvLog().find((entry) => entry[0] === "search")!;
    expect(search).not.toContain("--limit");
  });
});
