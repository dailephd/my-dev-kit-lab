import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMyDevKitRetrievalFromIndex } from "../../../src/evaluation/runMyDevKitRetrieval.js";
import type { EvaluationCase } from "../../../src/evaluation/types.js";

const fakeKitPath = path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js");

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const evaluationCase: EvaluationCase = {
  id: "todo-ts-create-task",
  title: "Case",
  benchmarkProject: "todo-ts",
  targetRoot: "benchmarks/projects/todo-ts",
  absoluteTargetRoot: path.resolve(process.cwd(), "benchmarks/projects/todo-ts"),
  sourceRoots: ["src", "tests"],
  query: "create task",
  expectedFiles: ["src/taskService.ts"],
  expectedSymbols: ["createTask"],
  rawIncludeGlobs: ["src/**/*"]
};

const symbol = { id: "symbol:src/taskService.ts#createTask", kind: "symbol", label: "createTask", path: "src/taskService.ts", symbolName: "createTask" };
const store = { id: "file:src/store.ts", kind: "file", label: "store.ts", path: "src/store.ts" };

/** A stand-in for the published my-dev-kit CLI that emits its v1 JSON shapes. */
function writeUpstreamShapedKit(dir: string, options: { searchResults?: unknown[]; failOn?: string } = {}): string {
  const searchResults = options.searchResults ?? [{ ...symbol, nodeId: symbol.id, score: 9 }];
  const script = path.join(dir, "upstream-shaped-kit.mjs");
  writeFileSync(
    script,
    [
      `const command = process.argv[2];`,
      `if (command === ${JSON.stringify(options.failOn ?? "")}) { process.stderr.write("forced failure"); process.exit(1); }`,
      `if (command === "search") console.log(JSON.stringify({ artifactKind: "my-dev-kit-v1-search-result", version: "1.0.0", results: ${JSON.stringify(searchResults)} }));`,
      `else if (command === "lookup") console.log(JSON.stringify({ status: "found", node: ${JSON.stringify(symbol)}, neighbors: [${JSON.stringify(store)}], incomingEdges: [], outgoingEdges: [] }));`,
      `else if (command === "slice") console.log(JSON.stringify({ artifactKind: "my-dev-kit-v1-graph-slice", version: "1.0.0", nodes: [${JSON.stringify(symbol)}, ${JSON.stringify(store)}], edges: [] }));`,
      `else if (command === "source") process.stdout.write("1 // mentions src/not-evidence.ts and symbol:src/not-evidence.ts#ghost");`,
      `else process.exit(1);`
    ].join("\n")
  );
  return `node ${script}`;
}

async function retrieve(kitCommand: string) {
  const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-evidence-"));
  tempDirs.push(outDir);
  return runMyDevKitRetrievalFromIndex({ evaluationCase, kitCommand, indexDir: path.join(outDir, "index"), commandsDir: path.join(outDir, "commands"), requireKit: true });
}

describe("runMyDevKitRetrievalFromIndex retrieval evidence", () => {
  it("TST-B1-010 exposes normalized evidence additively while legacy fields keep their semantics", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "kit-evidence-kit-"));
    tempDirs.push(dir);
    const result = await retrieve(writeUpstreamShapedKit(dir));

    expect(result.skipped).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.commands.map((command) => command.commandId)).toEqual(["search", "lookup", "slice", "source"]);
    expect(result.selectedNodeId).toBe(symbol.id);
    expect(result.selectedFile).toBe("src/taskService.ts");
    expect(result.selectedSymbol).toBe("createTask");
    expect(result.filesRead).toEqual(["src/taskService.ts"]);
    expect(result.contextText).toContain("not-evidence.ts");

    expect(result.retrievalEvidence).toEqual({
      schemaVersion: "retrieval-evidence-v1",
      availability: "available",
      files: [
        { path: "src/store.ts", surfacedBy: ["lookup", "slice"] },
        { path: "src/taskService.ts", surfacedBy: ["search", "lookup", "slice", "source"] }
      ],
      symbols: [{ name: "createTask", nodeId: symbol.id, file: "src/taskService.ts", surfacedBy: ["search", "lookup", "slice", "source"] }],
      commands: [
        { family: "search", succeeded: true, parseState: "parsed", fileEvidenceCount: 1, symbolEvidenceCount: 1, rejectedIdentityCount: 0 },
        { family: "lookup", succeeded: true, parseState: "parsed", fileEvidenceCount: 2, symbolEvidenceCount: 1, rejectedIdentityCount: 0 },
        { family: "slice", succeeded: true, parseState: "parsed", fileEvidenceCount: 2, symbolEvidenceCount: 1, rejectedIdentityCount: 0 },
        { family: "source", succeeded: true, parseState: "selection-attributed", fileEvidenceCount: 1, symbolEvidenceCount: 1, rejectedIdentityCount: 0 }
      ]
    });
    expect(JSON.stringify(result.retrievalEvidence)).not.toContain("not-evidence");
  });

  it("TST-B1-010 reports a failed lookup as partial evidence without changing legacy warnings", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "kit-evidence-kit-"));
    tempDirs.push(dir);
    const result = await retrieve(writeUpstreamShapedKit(dir, { failOn: "lookup" }));
    expect(result.warnings).toEqual(["my-dev-kit lookup command failed."]);
    expect(result.retrievalEvidence?.availability).toBe("partial");
    expect(result.retrievalEvidence?.commands.find((command) => command.family === "lookup")).toMatchObject({ succeeded: false, parseState: "command-failed" });
  });

  it("TST-B1-004 reports a skipped no-candidate retrieval as available-and-empty, not unavailable", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "kit-evidence-kit-"));
    tempDirs.push(dir);
    const result = await retrieve(writeUpstreamShapedKit(dir, { searchResults: [] }));
    expect(result.skipped).toBe(true);
    expect(result.retrievalEvidence).toMatchObject({ availability: "available", files: [], symbols: [] });
    expect(result.retrievalEvidence?.commands.map((command) => command.family)).toEqual(["search"]);
  });

  it("TST-B1-005 fails closed on the legacy fake CLI shape while legacy retrieval fields are unchanged", async () => {
    const result = await retrieve(`node ${fakeKitPath}`);
    expect(result.skipped).toBe(false);
    // The shared fake CLI emits the pre-v1 shape; the lifecycle's own lenient candidate reading is untouched.
    expect(result.selectedNodeId).toBe("unknown");
    expect(result.filesRead).toEqual(["unknown"]);
    expect(result.retrievalEvidence).toMatchObject({ availability: "unavailable", availabilityReason: "search-evidence-unavailable", files: [], symbols: [] });
  });

  it("TST-B1-006 reports a failed search as unavailable evidence", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "kit-evidence-kit-"));
    tempDirs.push(dir);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "kit-evidence-"));
    tempDirs.push(outDir);
    const result = await runMyDevKitRetrievalFromIndex({
      evaluationCase,
      kitCommand: writeUpstreamShapedKit(dir, { failOn: "search" }),
      indexDir: path.join(outDir, "index"),
      commandsDir: path.join(outDir, "commands"),
      requireKit: false
    });
    expect(result.skipped).toBe(true);
    expect(result.retrievalEvidence).toMatchObject({ availability: "unavailable", files: [] });
    expect(result.retrievalEvidence?.commands).toMatchObject([{ family: "search", succeeded: false, parseState: "command-failed" }]);
  });
});
