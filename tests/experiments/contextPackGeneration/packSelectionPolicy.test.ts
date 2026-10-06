import { describe, expect, it } from "vitest";
import {
  CONTEXT_PACK_SELECTION_POLICY_ID,
  GRAPH_DEPTH,
  MAX_CALL_RELATIONSHIPS,
  MAX_FILES,
  MAX_SEED_NODES,
  MAX_SOURCE_LINES_PER_SLICE,
  MAX_SOURCE_SLICES,
  MAX_SYMBOLS,
  MAX_TEST_FILES,
  MAX_TOTAL_SOURCE_LINES,
  SEARCH_RESULT_LIMIT,
  buildContextPackSelectionPolicy,
  isTestFilePath,
  selectCallRelationships,
  selectRelevantFiles,
  selectRelevantSymbols,
  selectSeedNodes,
  selectSourceSlices,
  selectTestFiles,
  type ContextPackSourceSliceCandidate
} from "../../../src/experiments/plugins/contextPackGeneration/index.js";

const lines = (count: number, prefix = "line"): string => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`).join("\n");
const slice = (overrides: Partial<ContextPackSourceSliceCandidate> = {}): ContextPackSourceSliceCandidate => ({
  file: "src/a.ts",
  nodeId: "symbol:src/a.ts#a",
  startLine: 1,
  endLine: 3,
  text: "a\nb\nc",
  boundaryKnown: true,
  rank: 1,
  ...overrides
});

describe("frozen selection policy", () => {
  it("records the exact constants", () => {
    expect(CONTEXT_PACK_SELECTION_POLICY_ID).toBe("bounded-multiseed-v1");
    expect(buildContextPackSelectionPolicy("1.12.5")).toEqual({
      id: "bounded-multiseed-v1",
      searchResultLimit: 12,
      maxSeedNodes: 8,
      graphDepth: 1,
      maxFiles: 12,
      maxSymbols: 16,
      maxSourceSlices: 8,
      maxSourceLinesPerSlice: 160,
      maxTotalSourceLines: 1280,
      maxTestFiles: 8,
      maxCallRelationships: 32,
      myDevKitVersion: "1.12.5"
    });
    expect([SEARCH_RESULT_LIMIT, MAX_SEED_NODES, GRAPH_DEPTH, MAX_FILES, MAX_SYMBOLS]).toEqual([12, 8, 1, 12, 16]);
    expect([MAX_SOURCE_SLICES, MAX_SOURCE_LINES_PER_SLICE, MAX_TOTAL_SOURCE_LINES, MAX_TEST_FILES, MAX_CALL_RELATIONSHIPS]).toEqual([8, 160, 1280, 8, 32]);
  });
});

describe("seed and file selection", () => {
  it("orders by origin priority, then rank, then code units, deduplicating first", () => {
    const result = selectSeedNodes([
      { nodeId: "b", origin: "graph", rank: 1 },
      { nodeId: "a", origin: "lookup", rank: 1 },
      { nodeId: "z", origin: "search", rank: 2 },
      { nodeId: "y", origin: "search", rank: 2 },
      { nodeId: "b", origin: "search", rank: 5 }
    ]);
    expect(result.items.map((seed) => seed.nodeId)).toEqual(["y", "z", "b", "a"]);
  });

  it("caps seeds at 8 and notes it", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({ nodeId: `n${String(i).padStart(2, "0")}`, origin: "search" as const, rank: i }));
    const result = selectSeedNodes(candidates);
    expect(result.items).toHaveLength(8);
    expect(result.items[0].nodeId).toBe("n00");
    expect(result.notes).toEqual(["seed-cap-reached"]);
  });

  it("preserves upstream ranking and merges duplicate files with provenance", () => {
    const result = selectRelevantFiles([
      { path: "src/b.ts", origin: "graph", rank: 1 },
      { path: "src/a.ts", origin: "search", rank: 2 },
      { path: "./src/b.ts", origin: "search", rank: 1 },
      { path: "src/c.ts", origin: "lookup", rank: 1 }
    ]);
    expect(result.items.map((file) => [file.path, file.reason, file.rank])).toEqual([
      ["src/b.ts", "search-candidate", 1],
      ["src/a.ts", "search-candidate", 2],
      ["src/c.ts", "lookup-evidence", 1]
    ]);
    expect(result.items[0].provenance.map((entry) => entry.command)).toEqual(["search", "slice"]);
  });

  it("is invariant to input order when rank evidence is equivalent", () => {
    const base = ["src/d.ts", "src/a.ts", "src/c.ts", "src/b.ts"].map((path) => ({ path, origin: "search" as const, rank: 1 }));
    const forward = selectRelevantFiles(base).items.map((f) => f.path);
    const reversed = selectRelevantFiles([...base].reverse()).items.map((f) => f.path);
    expect(forward).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
    expect(reversed).toEqual(forward);
  });

  it("uses code-unit, not locale, ordering", () => {
    const result = selectRelevantFiles(["src/b.ts", "src/B.ts", "src/a.ts", "src/Z.ts"].map((path) => ({ path, origin: "search" as const, rank: 1 })));
    expect(result.items.map((f) => f.path)).toEqual(["src/B.ts", "src/Z.ts", "src/a.ts", "src/b.ts"]);
  });

  it("marks test files as test-candidate and ignores unsafe paths with a note", () => {
    const result = selectRelevantFiles([
      { path: "tests/a.test.ts", origin: "search", rank: 1 },
      { path: "/abs/x.ts", origin: "search", rank: 2 },
      { path: "C:\\x.ts", origin: "search", rank: 3 }
    ]);
    expect(result.items.map((f) => f.reason)).toEqual(["test-candidate"]);
    expect(result.notes).toEqual(["invalid-repository-path-ignored"]);
  });

  it("caps files at 12 after deduplication", () => {
    const candidates = Array.from({ length: 14 }, (_, i) => ({ path: `src/f${String(i).padStart(2, "0")}.ts`, origin: "search" as const, rank: i }));
    const result = selectRelevantFiles([...candidates, ...candidates]);
    expect(result.items).toHaveLength(12);
    expect(result.notes).toEqual(["file-cap-reached"]);
  });
});

describe("symbol selection", () => {
  it("orders by priority/rank then file, name, nodeId and deduplicates by nodeId", () => {
    const result = selectRelevantSymbols([
      { name: "b", nodeId: "n2", file: "src/b.ts", origin: "search", rank: 1 },
      { name: "a", nodeId: "n1", file: "src/b.ts", origin: "search", rank: 1 },
      { name: "c", nodeId: "n3", file: "src/a.ts", origin: "search", rank: 1 },
      { name: "a", nodeId: "n1", file: "src/b.ts", origin: "graph", rank: 9, line: 4 },
      { name: "d", nodeId: null, file: null, origin: "lookup", rank: 1 }
    ]);
    expect(result.items.map((s) => s.name)).toEqual(["c", "a", "b", "d"]);
    expect(result.items[1].provenance.map((p) => p.command)).toEqual(["search", "slice"]);
  });

  it("caps symbols at 16", () => {
    const candidates = Array.from({ length: 18 }, (_, i) => ({ name: `s${String(i).padStart(2, "0")}`, nodeId: `n${i}`, file: "src/a.ts", origin: "search" as const, rank: i }));
    const result = selectRelevantSymbols(candidates);
    expect(result.items).toHaveLength(16);
    expect(result.notes).toEqual(["symbol-cap-reached"]);
  });
});

describe("call relationship and test selection", () => {
  it("keeps only calls, deduplicates and orders by from then to", () => {
    const result = selectCallRelationships([
      { fromNodeId: "b", toNodeId: "a", kind: "calls" },
      { fromNodeId: "a", toNodeId: "z", kind: "calls" },
      { fromNodeId: "a", toNodeId: "c", kind: "calls" },
      { fromNodeId: "a", toNodeId: "c", kind: "calls" },
      { fromNodeId: "a", toNodeId: "d", kind: "defines" },
      { fromNodeId: "a", toNodeId: "e", kind: "exports" }
    ]);
    expect(result.items.map((c) => `${c.fromNodeId}>${c.toNodeId}`)).toEqual(["a>c", "a>z", "b>a"]);
    expect(result.items.every((c) => c.kind === "calls")).toBe(true);
  });

  it("caps calls at 32", () => {
    const candidates = Array.from({ length: 34 }, (_, i) => ({ fromNodeId: `f${String(i).padStart(2, "0")}`, toNodeId: "t", kind: "calls" }));
    const result = selectCallRelationships(candidates);
    expect(result.items).toHaveLength(32);
    expect(result.notes).toEqual(["call-relationship-cap-reached"]);
  });

  it("recognizes repository test conventions", () => {
    for (const path of ["tests/a.ts", "test/a.ts", "src/__tests__/a.ts", "src/a.test.ts", "src/a.spec.tsx", "pkg/tests/deep/a.py"]) expect(isTestFilePath(path)).toBe(true);
    for (const path of ["src/a.ts", "src/contest.ts", "src/latest/a.ts", "src/a.test"]) expect(isTestFilePath(path)).toBe(false);
  });

  it("selects only test files, search before graph, deduplicated and capped at 8", () => {
    const result = selectTestFiles([
      { path: "src/not-a-test.ts", origin: "search-candidate" },
      { path: "tests/b.test.ts", origin: "graph-neighbor", rank: 1 },
      { path: "tests/a.test.ts", origin: "graph-neighbor", rank: 1 },
      { path: "tests/b.test.ts", origin: "search-candidate", rank: 4 }
    ]);
    expect(result.items.map((t) => [t.path, t.how])).toEqual([
      ["tests/b.test.ts", "search-candidate"],
      ["tests/a.test.ts", "graph-neighbor"]
    ]);
    const many = selectTestFiles(Array.from({ length: 10 }, (_, i) => ({ path: `tests/t${i}.test.ts`, origin: "search-candidate" as const, rank: i })));
    expect(many.items).toHaveLength(8);
    expect(many.notes).toEqual(["test-file-cap-reached"]);
  });
});

describe("source slice caps", () => {
  it("orders slices by file, start, end, nodeId", () => {
    const result = selectSourceSlices([
      slice({ file: "src/b.ts", nodeId: "x", rank: 1 }),
      slice({ file: "src/a.ts", startLine: 10, nodeId: "y", rank: 2 }),
      slice({ file: "src/a.ts", startLine: 2, nodeId: "z", rank: 3 })
    ]);
    expect(result.items.map((s) => `${s.file}:${s.startLine}`)).toEqual(["src/a.ts:2", "src/a.ts:10", "src/b.ts:1"]);
  });

  it("truncates a slice over the per-slice cap and keeps counts consistent", () => {
    const result = selectSourceSlices([slice({ startLine: 5, endLine: 204, text: lines(200) })]);
    const [only] = result.items;
    expect(only.lineCount).toBe(160);
    expect(only.startLine).toBe(5);
    expect(only.endLine).toBe(164);
    expect(only.truncated).toBe(true);
    expect(only.text.split("\n")).toHaveLength(160);
    expect(result.notes).toEqual(["source-slice-cap-reached"]);
  });

  it("fills exactly eight slices of 160 lines and drops a ninth by the slice-count cap", () => {
    const candidates = Array.from({ length: 9 }, (_, i) => slice({ file: `src/f${i}.ts`, nodeId: `n${i}`, text: lines(160), rank: i + 1 }));
    const result = selectSourceSlices(candidates);
    expect(result.items).toHaveLength(8);
    expect(result.items.reduce((sum, s) => sum + s.lineCount, 0)).toBe(1280);
    expect(result.items.map((s) => s.file)).not.toContain("src/f8.ts");
    expect(result.notes).toEqual(["source-slice-count-cap-reached"]);
  });

  it("truncates the crossing slice at the total cap, drops later slices, and keeps earlier ones in place", () => {
    const limits = { maxSourceSlices: 8, maxSourceLinesPerSlice: 160, maxTotalSourceLines: 250 };
    const result = selectSourceSlices(
      [
        slice({ file: "src/c.ts", nodeId: "c", text: lines(100), rank: 3 }),
        slice({ file: "src/a.ts", nodeId: "a", text: lines(100), rank: 1 }),
        slice({ file: "src/b.ts", nodeId: "b", text: lines(100), rank: 2 }),
        slice({ file: "src/d.ts", nodeId: "d", text: lines(100), rank: 4 })
      ],
      limits
    );
    expect(result.items.map((s) => [s.file, s.lineCount, s.truncated])).toEqual([
      ["src/a.ts", 100, false],
      ["src/b.ts", 100, false],
      ["src/c.ts", 50, true]
    ]);
    expect(result.items[2].endLine).toBe(50);
    expect(result.notes).toEqual(["total-source-line-cap-reached"]);
  });

  it("notes the total cap when it is reached and a further slice is dropped", () => {
    const limits = { maxSourceSlices: 8, maxSourceLinesPerSlice: 160, maxTotalSourceLines: 200 };
    const result = selectSourceSlices(
      [slice({ file: "src/a.ts", nodeId: "a", text: lines(100), rank: 1 }), slice({ file: "src/b.ts", nodeId: "b", text: lines(100), rank: 2 }), slice({ file: "src/c.ts", nodeId: "c", rank: 3 })],
      limits
    );
    expect(result.items).toHaveLength(2);
    expect(result.notes).toEqual(["total-source-line-cap-reached"]);
  });
  it("represents an unknown boundary and never reports it as known", () => {
    const result = selectSourceSlices([slice({ boundaryKnown: false, continuationAvailable: true })]);
    expect(result.items[0].boundaryKnown).toBe(false);
    expect(result.items[0].continuationAvailable).toBe(true);
    expect(result.notes).toEqual(["symbol-end-unknown"]);
  });

  it("normalizes line endings and ignores invalid slices with a note", () => {
    const result = selectSourceSlices([slice({ text: "a\r\nb\r\n" }), slice({ file: "src/x.ts", text: "" }), slice({ file: "../x.ts" })]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].text).toBe("a\nb");
    expect(result.items[0].lineCount).toBe(2);
    expect(result.items[0].endLine).toBe(2);
    expect(result.notes).toEqual(["invalid-repository-path-ignored", "invalid-source-slice-ignored"]);
  });

  it("deduplicates identical slices", () => {
    expect(selectSourceSlices([slice(), slice()]).items).toHaveLength(1);
  });
});
