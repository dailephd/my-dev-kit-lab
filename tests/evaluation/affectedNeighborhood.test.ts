import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFFECTED_NEIGHBORHOOD_SEED_MAPPING_SCHEMA_VERSION,
  assessAffectedNeighborhood,
  interpretCodeGraphForNeighborhood,
  loadAffectedNeighborhoodGraphEvidence,
  lookupFileNode,
  lookupSymbolNode,
  lookupSymbolRecordNode,
  mapAffectedNeighborhoodSeeds,
  mapAffectedNeighborhoodTask,
  traverseAffectedNeighborhood,
  type AffectedNeighborhoodEvidenceStatus,
  type AffectedNeighborhoodGraphEvidenceV1,
  type AffectedNeighborhoodGraphNodeV1,
  type AffectedNeighborhoodSeedMappingV1,
} from "../../src/evaluation/affectedNeighborhood.js";
import { readEvaluationCases } from "../../src/evaluation/readEvaluationCases.js";
import { assessIndexFreshness, type IndexFreshnessAssessmentV1 } from "../../src/evaluation/indexFreshness.js";
import type { IndexSnapshotV1 } from "../../src/evaluation/indexSnapshot.js";
import { capture, cleanupTempDirs, makeFixture, writeIndex, type Fixture } from "./indexSnapshotTestHelpers.js";

afterEach(cleanupTempDirs);

type SymbolSpec = Record<string, string[]>;
const DEFAULT_SYMBOLS: SymbolSpec = { "src/a.ts": ["a", "helper"], "src/nested/b.ts": ["b"], "tests/a.test.ts": [] };

type GraphNode = Record<string, unknown>;
type GraphEdge = Record<string, unknown>;

function buildGraph(symbols: SymbolSpec): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const [file, names] of Object.entries(symbols)) {
    nodes.push({ id: `file:${file}`, kind: "file", label: path.basename(file), path: file });
    for (const name of names) {
      nodes.push({ id: `symbol:${file}#${name}`, kind: "symbol", label: name, path: file });
      edges.push({ id: `file:${file}--defines-->symbol:${file}#${name}`, source: `file:${file}`, target: `symbol:${file}#${name}`, kind: "defines" });
    }
  }
  return { nodes, edges };
}

type IndexOptions = {
  symbols?: SymbolSpec;
  /** Symbol-index records; defaults to one record per symbol name of `symbols`. */
  symbolRecords?: Record<string, Array<Record<string, unknown>>>;
  graph?: { nodes: GraphNode[]; edges: GraphEdge[] } | null;
  codeGraphContent?: unknown;
  manifestArtifacts?: Record<string, unknown>;
  /** Overrides the symbol-index `schemaVersion` (the helper default is the my-dev-kit 1.13 value, "2"). */
  symbolSchemaVersion?: unknown;
};

/** Writes a real-shaped manifest, symbol index (with symbols), and code graph for the fixture. */
function writeGraphIndex(fixture: Fixture, options: IndexOptions = {}): void {
  const symbols = options.symbols ?? DEFAULT_SYMBOLS;
  const listed = Object.keys(symbols);
  const files = listed.map((p) => ({
    path: p,
    language: "typescript",
    symbols: options.symbolRecords?.[p] ?? symbols[p].map((name) => ({ name, kind: "function" })),
  }));
  writeIndex(fixture, listed, {
    symbolIndex: { files, ...("symbolSchemaVersion" in options ? { schemaVersion: options.symbolSchemaVersion } : {}) },
    manifest: { artifacts: options.manifestArtifacts ?? { symbolIndex: "symbol-index.json", codeGraph: "code-graph.json" } },
  });
  if (options.graph !== null) {
    const graph = options.graph ?? buildGraph(symbols);
    writeFileSync(
      path.join(fixture.indexDir, "code-graph.json"),
      JSON.stringify(options.codeGraphContent ?? { artifactKind: "code-graph", schemaVersion: "1.0.0", nodes: graph.nodes, edges: graph.edges })
    );
  }
}

async function prepare(options: IndexOptions = {}, files: Record<string, string> = {}) {
  const fixture = makeFixture(files);
  writeGraphIndex(fixture, options);
  const snapshot = await capture(fixture);
  const graph = await loadAffectedNeighborhoodGraphEvidence({ indexDir: fixture.indexDir, sourceRoots: fixture.sourceRoots, indexSnapshot: snapshot });
  return { fixture, snapshot, graph };
}

const assess = (fixture: Fixture, snapshot: IndexSnapshotV1 | null) =>
  assessIndexFreshness({ snapshot, targetRoot: fixture.targetRoot, sourceRoots: fixture.sourceRoots });

const abs = (fixture: Fixture, relative: string) => path.join(fixture.targetRoot, relative);
const map = (snapshot: IndexSnapshotV1, freshness: IndexFreshnessAssessmentV1, graph: AffectedNeighborhoodGraphEvidenceV1) =>
  mapAffectedNeighborhoodSeeds({ indexSnapshot: snapshot, freshness, graph });

function hashTree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else result[path.relative(root, full)] = `${createHash("sha256").update(readFileSync(full)).digest("hex")}:${statSync(full).mtimeMs}`;
    }
  };
  walk(root);
  return result;
}

describe("loadAffectedNeighborhoodGraphEvidence", () => {
  // TST-B1-001
  it("loads membership, symbols, nodes, and edges from the manifest-referenced artifacts", async () => {
    const { graph } = await prepare();

    expect(graph.status).toBe("complete");
    expect(graph.unavailable).toBeNull();
    expect(graph.manifest).toEqual({ path: "manifest.json", artifactKind: "my-dev-kit-v1-manifest", schemaVersion: "1.0.0" });
    expect(graph.symbolIndex).toEqual({ path: "symbol-index.json", schemaVersion: "2" });
    expect(graph.codeGraph).toEqual({ path: "code-graph.json", artifactKind: "code-graph", schemaVersion: "1.0.0" });
    expect(graph.indexedFilePaths).toEqual(["src/a.ts", "src/nested/b.ts", "tests/a.test.ts"]);
    expect([...graph.symbolFiles.keys()]).toEqual(["src/a.ts", "src/nested/b.ts", "tests/a.test.ts"]);
    expect(graph.symbolFiles.get("src/a.ts")?.symbolNames).toEqual(["a", "helper"]);
    expect(graph.nodes.size).toBe(3 + 3);
    expect(graph.warnings).toEqual([]);
  });

  it("follows the manifest artifact locations instead of guessing file names", async () => {
    const fixture = makeFixture();
    writeGraphIndex(fixture, { manifestArtifacts: { symbolIndex: "symbol-index.json", codeGraph: "graphs/renamed-graph.json" }, graph: null });
    mkdirSync(path.join(fixture.indexDir, "graphs"));
    writeFileSync(
      path.join(fixture.indexDir, "graphs", "renamed-graph.json"),
      JSON.stringify({ artifactKind: "code-graph", schemaVersion: "1.0.0", ...buildGraph(DEFAULT_SYMBOLS) })
    );
    // A decoy at the conventional name must not be read.
    writeFileSync(path.join(fixture.indexDir, "code-graph.json"), "not json");
    const snapshot = await capture(fixture);

    const graph = await loadAffectedNeighborhoodGraphEvidence({ indexDir: fixture.indexDir, sourceRoots: fixture.sourceRoots, indexSnapshot: snapshot });

    expect(graph.status).toBe("complete");
    expect(graph.codeGraph?.path).toBe("graphs/renamed-graph.json");
  });

  // TST-B1-002
  it("preserves the upstream file and symbol node IDs exactly", async () => {
    const { graph } = await prepare();

    expect([...graph.nodes.keys()]).toEqual(
      [
        "file:src/a.ts",
        "file:src/nested/b.ts",
        "file:tests/a.test.ts",
        "symbol:src/a.ts#a",
        "symbol:src/a.ts#helper",
        "symbol:src/nested/b.ts#b",
      ].sort()
    );
    expect(lookupFileNode(graph, "src/a.ts")).toEqual({ ok: true, nodeId: "file:src/a.ts" });
    expect(lookupSymbolNode(graph, "src/a.ts", "helper")).toEqual({ ok: true, nodeId: "symbol:src/a.ts#helper" });
  });

  // TST-B1-003
  it("preserves edges generically, including an unfamiliar edge kind, without filtering", async () => {
    const graph = buildGraph(DEFAULT_SYMBOLS);
    graph.edges.push({ id: "e-novel", source: "file:src/a.ts", target: "file:src/nested/b.ts", kind: "totally-new-relationship" });
    graph.edges.push({ id: "e-imports", source: "file:tests/a.test.ts", target: "file:src/a.ts", kind: "imports", label: "import" });
    const { graph: evidence } = await prepare({ graph });

    expect(evidence.status).toBe("complete");
    expect(evidence.edges).toContainEqual({ id: "e-novel", source: "file:src/a.ts", target: "file:src/nested/b.ts", kind: "totally-new-relationship" });
    expect(evidence.edges).toContainEqual({ id: "e-imports", source: "file:tests/a.test.ts", target: "file:src/a.ts", kind: "imports" });
    expect(evidence.edges.length).toBe(graph.edges.length);
    expect(evidence.edges.map((edge) => edge.id)).toEqual(evidence.edges.map((edge) => edge.id).sort());
  });

  it("collapses identical repeated edge records but flags conflicting ones", () => {
    const base = buildGraph({ "src/a.ts": ["a"] });
    const repeated = interpretCodeGraphForNeighborhood({
      artifactKind: "code-graph",
      schemaVersion: "1.0.0",
      nodes: base.nodes,
      edges: [...base.edges, ...base.edges],
    });
    expect(repeated.ok && repeated.value.duplicateEdgeRecordCount).toBe(1);
    expect(repeated.ok && repeated.value.warnings).toEqual([]);

    const conflicting = interpretCodeGraphForNeighborhood({
      artifactKind: "code-graph",
      schemaVersion: "1.0.0",
      nodes: base.nodes,
      edges: [...base.edges, { ...base.edges[0], target: "file:src/a.ts" }],
    });
    expect(conflicting.ok && conflicting.value.warnings.map((warning) => warning.code)).toEqual(["conflicting-duplicate-edge-id"]);
  });

  it("drops structurally invalid nodes and edges with warnings and reports partial evidence", async () => {
    const graph = buildGraph(DEFAULT_SYMBOLS);
    graph.nodes.push({ kind: "file" });
    graph.edges.push({ id: "e-bad" }, { id: "e-dangling", source: "file:src/a.ts", target: "file:nowhere.ts", kind: "imports" });
    const { graph: evidence } = await prepare({ graph });

    expect(evidence.status).toBe("partial");
    expect(evidence.warnings.map((warning) => warning.code)).toEqual(["dangling-edge", "invalid-edge-entry", "invalid-node-entry"]);
    expect(evidence.edges.some((edge) => edge.id === "e-dangling")).toBe(false);
    expect(evidence.nodes.size).toBe(6);
  });

  // TST-B1-013
  it("is unavailable for a missing symbol index and does not throw", async () => {
    const fixture = makeFixture();
    writeGraphIndex(fixture);
    const snapshot = await capture(fixture);
    rmSync(path.join(fixture.indexDir, "symbol-index.json"));

    const graph = await loadAffectedNeighborhoodGraphEvidence({ indexDir: fixture.indexDir, sourceRoots: fixture.sourceRoots, indexSnapshot: snapshot });

    expect(graph.status).toBe("unavailable");
    expect(graph.unavailable?.code).toBe("symbol-index-missing");
    expect(graph.indexedFilePaths).toEqual([]);
    expect(graph.nodes.size).toBe(0);
  });

  it("is unavailable when the snapshot never accepted the index contract", async () => {
    const fixture = makeFixture();
    const snapshot = await capture(fixture);
    const graph = await loadAffectedNeighborhoodGraphEvidence({ indexDir: fixture.indexDir, sourceRoots: fixture.sourceRoots, indexSnapshot: snapshot });

    expect(snapshot.status).toBe("unavailable");
    expect(graph.status).toBe("unavailable");
    expect(graph.unavailable?.code).toBe("index-snapshot-unavailable");
  });

  it.each([
    ["missing file", (indexDir: string) => rmSync(path.join(indexDir, "code-graph.json")), "code-graph-missing"],
    ["malformed JSON", (indexDir: string) => writeFileSync(path.join(indexDir, "code-graph.json"), "{oops"), "code-graph-unreadable"],
    [
      "unsupported artifact",
      (indexDir: string) => writeFileSync(path.join(indexDir, "code-graph.json"), JSON.stringify({ artifactKind: "code-graph", schemaVersion: "9.0.0", nodes: [], edges: [] })),
      "code-graph-unsupported",
    ],
  ])("keeps symbol evidence but has no nodes when the code graph is a %s", async (_label, breakGraph, expectedCode) => {
    const fixture = makeFixture();
    writeGraphIndex(fixture);
    const snapshot = await capture(fixture);
    breakGraph(fixture.indexDir);

    const graph = await loadAffectedNeighborhoodGraphEvidence({ indexDir: fixture.indexDir, sourceRoots: fixture.sourceRoots, indexSnapshot: snapshot });

    expect(graph.status).toBe("partial");
    expect(graph.codeGraph).toBeNull();
    expect(graph.nodes.size).toBe(0);
    expect(graph.warnings.map((warning) => warning.code)).toEqual([expectedCode]);
    expect(graph.symbolFiles.get("src/a.ts")?.symbolNames).toEqual(["a", "helper"]);
  });

  // TST-B1-014
  it("rejects a manifest artifact path that escapes the index directory without reading it", async () => {
    const fixture = makeFixture();
    writeGraphIndex(fixture, { manifestArtifacts: { symbolIndex: "symbol-index.json", codeGraph: "../outside-graph.json" }, graph: null });
    const outside = path.join(path.dirname(fixture.indexDir), "outside-graph.json");
    writeFileSync(outside, JSON.stringify({ artifactKind: "code-graph", schemaVersion: "1.0.0", ...buildGraph(DEFAULT_SYMBOLS) }));
    const snapshot = await capture(fixture);

    const graph = await loadAffectedNeighborhoodGraphEvidence({ indexDir: fixture.indexDir, sourceRoots: fixture.sourceRoots, indexSnapshot: snapshot });

    expect(graph.status).toBe("partial");
    expect(graph.codeGraph).toBeNull();
    expect(graph.nodes.size).toBe(0);
    expect(graph.warnings.map((warning) => warning.code)).toEqual(["code-graph-path-escapes-index"]);
  });

  it("does not read an escaping symbol index path", async () => {
    const fixture = makeFixture();
    writeGraphIndex(fixture);
    const snapshot = await capture(fixture);
    writeFileSync(
      path.join(fixture.indexDir, "manifest.json"),
      JSON.stringify({
        artifactKind: "my-dev-kit-v1-manifest",
        version: "1.0.0",
        projectRoot: fixture.targetRoot.replace(/\\/g, "/"),
        sourceRoots: fixture.sourceRoots,
        artifacts: { symbolIndex: "../symbol-index.json", codeGraph: "code-graph.json" },
      })
    );

    const graph = await loadAffectedNeighborhoodGraphEvidence({ indexDir: fixture.indexDir, sourceRoots: fixture.sourceRoots, indexSnapshot: snapshot });

    expect(graph.status).toBe("unavailable");
    expect(graph.unavailable?.code).toBe("artifact-path-escapes-index");
  });

  it("does not recurse the index or read cache-metadata.json", async () => {
    const fixture = makeFixture();
    writeGraphIndex(fixture);
    writeFileSync(path.join(fixture.indexDir, "cache-metadata.json"), "{not json");
    const snapshot = await capture(fixture);

    const graph = await loadAffectedNeighborhoodGraphEvidence({ indexDir: fixture.indexDir, sourceRoots: fixture.sourceRoots, indexSnapshot: snapshot });

    expect(graph.status).toBe("complete");
  });
});

describe("mapAffectedNeighborhoodSeeds", () => {
  // TST-B1-004
  it("maps a fresh index to a complete empty result", async () => {
    const { fixture, snapshot, graph } = await prepare();
    const freshness = await assess(fixture, snapshot);

    const result = map(snapshot, freshness, graph);

    expect(freshness.status).toBe("fresh");
    expect(result).toMatchObject({
      schemaVersion: AFFECTED_NEIGHBORHOOD_SEED_MAPPING_SCHEMA_VERSION,
      status: "complete",
      freshnessStatus: "fresh",
      graphEvidenceStatus: "complete",
      changedFileCount: 0,
      changedSymbolCount: 0,
      mappedChangedFileNodeCount: 0,
      mappedChangedSymbolNodeCount: 0,
      seedNodeCount: 0,
      seedNodeIds: [],
      changedFiles: [],
      changedSymbols: [],
      unresolvedCount: 0,
    });
  });

  // TST-B1-005
  it("maps a modified indexed file and its baseline symbols to same-file nodes", async () => {
    const { fixture, snapshot, graph } = await prepare();
    writeFileSync(abs(fixture, "src/a.ts"), "export const a = 99;\n");
    const freshness = await assess(fixture, snapshot);

    const result = map(snapshot, freshness, graph);

    expect(result.status).toBe("complete");
    expect(result.changedFileCount).toBe(1);
    expect(result.changedSymbolCount).toBe(2);
    expect(result.mappedChangedFileNodeCount).toBe(1);
    expect(result.mappedChangedSymbolNodeCount).toBe(2);
    expect(result.seedNodeCount).toBe(3);
    expect(result.seedNodeIds).toEqual(["file:src/a.ts", "symbol:src/a.ts#a", "symbol:src/a.ts#helper"]);
    expect(result.changedFiles).toEqual([
      { path: "src/a.ts", changeType: "modified", expectedNodeId: "file:src/a.ts", resolvedNodeId: "file:src/a.ts", status: "mapped", unresolvedReason: null },
    ]);
    expect(result.changedSymbols.map((entry) => entry.expectedNodeId)).toEqual(["symbol:src/a.ts#a", "symbol:src/a.ts#helper"]);
  });

  // TST-B1-006
  it("still maps a confirmed-missing indexed file from baseline artifacts", async () => {
    const { fixture, snapshot, graph } = await prepare();
    rmSync(abs(fixture, "src/nested/b.ts"));
    const freshness = await assess(fixture, snapshot);

    const result = map(snapshot, freshness, graph);

    expect(freshness.missingFileCount).toBe(1);
    expect(result.status).toBe("complete");
    expect(result.changedFileCount).toBe(1);
    expect(result.changedFiles[0]).toMatchObject({ path: "src/nested/b.ts", changeType: "missing", resolvedNodeId: "file:src/nested/b.ts" });
    expect(result.seedNodeIds).toEqual(["file:src/nested/b.ts", "symbol:src/nested/b.ts#b"]);
  });

  // TST-B1-007
  it("does not seed a new file that is beneath a source root but absent from the snapshot", async () => {
    const { fixture, snapshot, graph } = await prepare();
    writeFileSync(abs(fixture, "src/brand-new.ts"), "export const fresh = 1;\n");
    const freshness = await assess(fixture, snapshot);

    const result = map(snapshot, freshness, graph);

    expect(freshness.status).toBe("fresh");
    expect(result.status).toBe("complete");
    expect(result.changedFileCount).toBe(0);
    expect(result.seedNodeIds).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("brand-new");
  });

  it("rejects a change entry for a path the snapshot does not represent", async () => {
    const { fixture, snapshot, graph } = await prepare();
    const freshness = await assess(fixture, snapshot);
    const forged: IndexFreshnessAssessmentV1 = {
      ...freshness,
      status: "stale",
      changedFileCount: 1,
      changes: [
        { path: "src/not-indexed.ts", changeType: "modified", baselineSha256: "0".repeat(64), baselineSizeBytes: 1, baselineModifiedAt: "x", currentSha256: "1".repeat(64), currentSizeBytes: 1, currentModifiedAt: "x" },
      ],
    };

    const result = map(snapshot, forged, graph);

    expect(result.changedFileCount).toBe(0);
    expect(result.seedNodeIds).toEqual([]);
    expect(result.unresolved).toEqual([{ subject: "changed-file", path: "src/not-indexed.ts", name: null, reason: "not-in-index-snapshot" }]);
    expect(result.status).toBe("partial");
  });

  // TST-B1-008
  it("keeps successful mappings but stays partial when freshness is partially stale", async () => {
    const { fixture, snapshot, graph } = await prepare();
    writeFileSync(abs(fixture, "src/a.ts"), "export const a = 5;\n");
    rmSync(abs(fixture, "src/nested/b.ts"));
    mkdirSync(abs(fixture, "src/nested/b.ts"));
    const freshness = await assess(fixture, snapshot);

    const result = map(snapshot, freshness, graph);

    expect(freshness.status).toBe("partially-stale");
    expect(result.status).toBe("partial");
    expect(result.freshnessStatus).toBe("partially-stale");
    expect(result.changedFileCount).toBe(1);
    expect(result.seedNodeIds).toEqual(["file:src/a.ts", "symbol:src/a.ts#a", "symbol:src/a.ts#helper"]);
    expect(result.warnings.map((warning) => warning.code)).toContain("freshness-partially-stale");
    expect(result.unresolvedCount).toBe(0);
  });

  // TST-B1-009
  it("is unavailable, with no invented changes, when freshness is unknown", async () => {
    const { snapshot, graph, fixture } = await prepare();
    const freshness = await assess(fixture, null);

    const result = map(snapshot, freshness, graph);

    expect(freshness.status).toBe("unknown");
    expect(result.status).toBe("unavailable");
    expect(result.changedFileCount).toBeNull();
    expect(result.changedSymbolCount).toBeNull();
    expect(result.changedFiles).toEqual([]);
    expect(result.seedNodeIds).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["freshness-unknown"]);
  });

  // TST-B1-010
  it("counts a changed file whose graph file node is absent but reports it unresolved and partial", async () => {
    const graph = buildGraph(DEFAULT_SYMBOLS);
    graph.nodes = graph.nodes.filter((node) => node.id !== "file:src/a.ts");
    graph.edges = graph.edges.filter((edge) => edge.source !== "file:src/a.ts");
    const { fixture, snapshot, graph: evidence } = await prepare({ graph });
    writeFileSync(abs(fixture, "src/a.ts"), "export const a = 2;\n");
    const freshness = await assess(fixture, snapshot);

    const result = map(snapshot, freshness, evidence);

    expect(result.status).toBe("partial");
    expect(result.changedFileCount).toBe(1);
    expect(result.mappedChangedFileNodeCount).toBe(0);
    expect(result.changedFiles[0]).toMatchObject({ resolvedNodeId: null, status: "unresolved", unresolvedReason: "graph-node-missing" });
    expect(result.unresolved).toContainEqual({ subject: "changed-file", path: "src/a.ts", name: null, reason: "graph-node-missing" });
    // Symbols of the file are still mapped.
    expect(result.mappedChangedSymbolNodeCount).toBe(2);
  });

  // TST-B1-011
  it("counts a baseline symbol with no same-file graph node and never falls back to a same-named symbol elsewhere", async () => {
    const graph = buildGraph({ ...DEFAULT_SYMBOLS, "src/nested/b.ts": ["b", "helper"] });
    graph.nodes = graph.nodes.filter((node) => node.id !== "symbol:src/a.ts#helper");
    graph.edges = graph.edges.filter((edge) => edge.target !== "symbol:src/a.ts#helper");
    const { fixture, snapshot, graph: evidence } = await prepare({ graph });
    writeFileSync(abs(fixture, "src/a.ts"), "export const a = 3;\n");
    const freshness = await assess(fixture, snapshot);

    const result = map(snapshot, freshness, evidence);

    expect(result.status).toBe("partial");
    expect(result.changedSymbolCount).toBe(2);
    expect(result.mappedChangedSymbolNodeCount).toBe(1);
    expect(result.seedNodeIds).not.toContain("symbol:src/nested/b.ts#helper");
    expect(result.changedSymbols.find((entry) => entry.name === "helper")).toMatchObject({
      expectedNodeId: "symbol:src/a.ts#helper",
      resolvedNodeId: null,
      unresolvedReason: "graph-node-missing",
    });
    expect(result.unresolved).toContainEqual({ subject: "changed-symbol", path: "src/a.ts", name: "helper", reason: "graph-node-missing" });
  });

  it("does not resolve a symbol identity to a node of the wrong kind", async () => {
    const graph = buildGraph(DEFAULT_SYMBOLS);
    graph.nodes = graph.nodes.map((node) => (node.id === "symbol:src/a.ts#a" ? { ...node, kind: "frontend-fact" } : node));
    const { fixture, snapshot, graph: evidence } = await prepare({ graph });
    writeFileSync(abs(fixture, "src/a.ts"), "export const a = 3;\n");

    const result = map(snapshot, await assess(fixture, snapshot), evidence);

    expect(result.changedSymbols.find((entry) => entry.name === "a")?.unresolvedReason).toBe("graph-node-kind-mismatch");
  });

  // TST-B1-012
  it("counts a same-file same-name duplicate symbol record once, maps it once, and reports the duplicate", async () => {
    const { fixture, snapshot, graph: evidence } = await prepare({
      symbolRecords: { "src/a.ts": [{ name: "a", kind: "function" }, { name: "a", kind: "function" }, { name: "helper", kind: "function" }] },
    });
    writeFileSync(abs(fixture, "src/a.ts"), "export const a = 4;\n");

    const result = map(snapshot, await assess(fixture, snapshot), evidence);

    expect(evidence.symbolFiles.get("src/a.ts")).toEqual({ symbolNames: ["a", "helper"], duplicateSymbolNames: ["a"] });
    expect(result.status).toBe("complete");
    expect(result.changedSymbolCount).toBe(2);
    expect(result.seedNodeIds.filter((id) => id === "symbol:src/a.ts#a")).toHaveLength(1);
    expect(result.warnings).toEqual([expect.objectContaining({ code: "duplicate-symbol-records", path: "src/a.ts" })]);
  });

  it("preserves a changed file that has no baseline symbol-index record without inferring symbols", async () => {
    const { fixture, snapshot, graph: evidence } = await prepare({ symbolRecords: { "src/a.ts": [] } });
    // A malformed symbol list keeps membership but yields no record.
    const symbolIndexPath = path.join(fixture.indexDir, "symbol-index.json");
    const raw = JSON.parse(readFileSync(symbolIndexPath, "utf8"));
    raw.files[0].symbols = "not-an-array";
    writeFileSync(symbolIndexPath, JSON.stringify(raw));
    const reloaded = await loadAffectedNeighborhoodGraphEvidence({ indexDir: fixture.indexDir, sourceRoots: fixture.sourceRoots, indexSnapshot: snapshot });
    writeFileSync(abs(fixture, "src/a.ts"), "export const a = 6;\n");

    const result = map(snapshot, await assess(fixture, snapshot), reloaded);

    expect(evidence.status).toBe("complete");
    expect(reloaded.status).toBe("partial");
    expect(result.status).toBe("partial");
    expect(result.changedFileCount).toBe(1);
    expect(result.changedSymbolCount).toBe(0);
    expect(result.changedSymbols).toEqual([]);
    expect(result.unresolved).toContainEqual({ subject: "symbol-index-record", path: "src/a.ts", name: null, reason: "symbol-index-record-missing" });
  });

  it("is unavailable but still counts changed files and baseline symbol identities when the code graph is not loaded", async () => {
    const fixture = makeFixture();
    writeGraphIndex(fixture, { graph: null });
    const snapshot = await capture(fixture);
    const evidence = await loadAffectedNeighborhoodGraphEvidence({ indexDir: fixture.indexDir, sourceRoots: fixture.sourceRoots, indexSnapshot: snapshot });
    writeFileSync(abs(fixture, "src/a.ts"), "export const a = 7;\n");

    const result = map(snapshot, await assess(fixture, snapshot), evidence);

    expect(evidence.status).toBe("partial");
    expect(result.status).toBe("unavailable");
    expect(result.changedFileCount).toBe(1);
    expect(result.changedSymbolCount).toBe(2);
    expect(result.mappedChangedFileNodeCount).toBe(0);
    expect(result.seedNodeIds).toEqual([]);
    expect(result.changedFiles[0].unresolvedReason).toBe("graph-unavailable");
  });

  it("makes changed-symbol count null and mapping unavailable when graph evidence is unavailable", async () => {
    const fixture = makeFixture();
    writeGraphIndex(fixture);
    const snapshot = await capture(fixture);
    rmSync(path.join(fixture.indexDir, "symbol-index.json"));
    const evidence = await loadAffectedNeighborhoodGraphEvidence({ indexDir: fixture.indexDir, sourceRoots: fixture.sourceRoots, indexSnapshot: snapshot });
    writeFileSync(abs(fixture, "src/a.ts"), "export const a = 8;\n");

    const result = map(snapshot, await assess(fixture, snapshot), evidence);

    expect(result.status).toBe("unavailable");
    expect(result.graphEvidenceStatus).toBe("unavailable");
    expect(result.changedFileCount).toBe(1);
    expect(result.changedSymbolCount).toBeNull();
  });

  it("does not truncate counts when the unresolved list is bounded, and marks truncated freshness partial", async () => {
    const names = Array.from({ length: 70 }, (_, index) => `s${String(index).padStart(2, "0")}`);
    const graph = buildGraph({ "src/a.ts": names, "src/nested/b.ts": [], "tests/a.test.ts": [] });
    graph.nodes = graph.nodes.filter((node) => node.kind === "file");
    graph.edges = [];
    const { fixture, snapshot, graph: evidence } = await prepare({ symbols: { "src/a.ts": names, "src/nested/b.ts": [], "tests/a.test.ts": [] }, graph });
    writeFileSync(abs(fixture, "src/a.ts"), "export const a = 9;\n");
    const freshness = await assess(fixture, snapshot);

    const result = map(snapshot, { ...freshness, changesTruncated: true, changedFileCount: 5 }, evidence);

    expect(result.changedSymbolCount).toBe(70);
    expect(result.unresolvedCount).toBe(70);
    expect(result.unresolved).toHaveLength(50);
    expect(result.unresolvedTruncated).toBe(true);
    expect(result.changedFileCount).toBe(5);
    expect(result.changesTruncated).toBe(true);
    expect(result.status).toBe("partial");
    expect(result.warnings.map((warning) => warning.code)).toContain("freshness-changes-truncated");
  });

  // TST-B1-015
  it("produces equivalent ordered evidence for repeated input regardless of artifact ordering", async () => {
    const forward = await prepare();
    const reversedGraph = buildGraph(DEFAULT_SYMBOLS);
    reversedGraph.nodes.reverse();
    reversedGraph.edges.reverse();
    const reversed = await prepare({ graph: reversedGraph });
    for (const scenario of [forward, reversed]) {
      writeFileSync(abs(scenario.fixture, "src/a.ts"), "export const a = 10;\n");
      writeFileSync(abs(scenario.fixture, "src/nested/b.ts"), "export const b = 11;\n");
    }
    const freshnessForward = await assess(forward.fixture, forward.snapshot);
    const freshnessReversed = await assess(reversed.fixture, reversed.snapshot);

    const first = map(forward.snapshot, freshnessForward, forward.graph);
    const second = map(forward.snapshot, freshnessForward, forward.graph);
    const fromReversed = map(reversed.snapshot, freshnessReversed, reversed.graph);

    expect(second).toEqual(first);
    expect(fromReversed.seedNodeIds).toEqual(first.seedNodeIds);
    expect(fromReversed.changedSymbols).toEqual(first.changedSymbols);
    expect([...reversed.graph.nodes.keys()]).toEqual([...forward.graph.nodes.keys()]);
    expect(reversed.graph.edges).toEqual(forward.graph.edges);
    expect(first.seedNodeIds).toEqual([...first.seedNodeIds].sort());
  });

  it("never modifies the target or the index while loading and mapping", async () => {
    const { fixture, snapshot } = await prepare();
    const targetBefore = hashTree(fixture.targetRoot);
    const indexBefore = hashTree(fixture.indexDir);

    const graph = await loadAffectedNeighborhoodGraphEvidence({ indexDir: fixture.indexDir, sourceRoots: fixture.sourceRoots, indexSnapshot: snapshot });
    map(snapshot, await assess(fixture, snapshot), graph);

    expect(hashTree(fixture.targetRoot)).toEqual(targetBefore);
    expect(hashTree(fixture.indexDir)).toEqual(indexBefore);
  });
});

// ---------------------------------------------------------------------------------------------
// v0.6.1 Batch 2: one-hop neighborhood, task mapping, overlap, relationship, recommendation.
// ---------------------------------------------------------------------------------------------

type EdgeSpec = [id: string, source: string, target: string, kind?: string];

/** Synthetic baseline graph evidence. Keeps the given node/edge order so output ordering is tested. */
function synth(nodeIds: string[], edges: EdgeSpec[], status: AffectedNeighborhoodEvidenceStatus = "complete"): AffectedNeighborhoodGraphEvidenceV1 {
  const nodes = new Map<string, AffectedNeighborhoodGraphNodeV1>();
  for (const id of nodeIds) {
    nodes.set(id, { id, kind: id.startsWith("file:") ? "file" : "symbol", path: null, label: null });
  }
  const usable = status !== "unavailable";
  return {
    schemaVersion: "my-dev-kit-lab-affected-neighborhood-graph-evidence-v1",
    status,
    unavailable: usable ? null : { code: "graph-evidence-load-failed", message: "synthetic" },
    indexRoot: "synthetic",
    manifest: null,
    symbolIndex: null,
    codeGraph: usable ? { path: "code-graph.json", artifactKind: "code-graph", schemaVersion: "1.0.0" } : null,
    indexedFilePaths: [],
    symbolFiles: new Map(),
    nodes: usable ? nodes : new Map(),
    edges: usable ? edges.map(([id, source, target, kind]) => ({ id, source, target, kind: kind ?? "calls" })) : [],
    duplicateEdgeRecordCount: 0,
    warningCount: 0,
    warnings: [],
    warningsTruncated: false,
  };
}

function seedsOf(
  seedNodeIds: string[],
  status: AffectedNeighborhoodEvidenceStatus = "complete",
  freshnessStatus: AffectedNeighborhoodSeedMappingV1["freshnessStatus"] = "stale"
): AffectedNeighborhoodSeedMappingV1 {
  return {
    schemaVersion: AFFECTED_NEIGHBORHOOD_SEED_MAPPING_SCHEMA_VERSION,
    status,
    freshnessStatus,
    graphEvidenceStatus: "complete",
    changedFileCount: status === "unavailable" ? null : seedNodeIds.length,
    changedSymbolCount: status === "unavailable" ? null : 0,
    mappedChangedFileNodeCount: seedNodeIds.length,
    mappedChangedSymbolNodeCount: 0,
    seedNodeCount: seedNodeIds.length,
    changesTruncated: false,
    changedFiles: [],
    changedSymbols: [],
    seedNodeIds,
    unresolvedCount: 0,
    unresolved: [],
    unresolvedTruncated: false,
    warningCount: 0,
    warnings: [],
    warningsTruncated: false,
  };
}

const NODES = [
  "file:src/a.ts",
  "file:src/b.ts",
  "file:src/c.ts",
  "symbol:src/a.ts#foo",
  "symbol:src/a.ts#dup",
  "symbol:src/b.ts#dup",
  "symbol:src/b.ts#bar",
  "symbol:src/c.ts#foo",
];

describe("traverseAffectedNeighborhood", () => {
  // TST-B2-001
  it("reaches neighbors along both edge directions without creating reverse edges", () => {
    const graph = synth(["s", "A", "B"], [["e-out", "s", "A", "calls"], ["e-in", "B", "s", "calls"]]);

    const result = traverseAffectedNeighborhood(graph, ["s"]);

    expect(result.affectedNodeIds).toEqual(["A", "B", "s"]);
    expect(result.participatingEdgeIds).toEqual(["e-in", "e-out"]);
    expect(graph.edges).toEqual([
      { id: "e-out", source: "s", target: "A", kind: "calls" },
      { id: "e-in", source: "B", target: "s", kind: "calls" },
    ]);
  });

  // TST-B2-002
  it("stops after exactly one hop", () => {
    const graph = synth(["s", "A", "B"], [["e1", "s", "A"], ["e2", "A", "B"]]);

    const result = traverseAffectedNeighborhood(graph, ["s"]);

    expect(result.affectedNodeIds).toEqual(["A", "s"]);
    expect(result.participatingEdgeIds).toEqual(["e1"]);
  });

  // TST-B2-003
  it("lets every valid edge kind participate equally, including an unfamiliar one", () => {
    const kinds = ["defines", "exports", "calls", "imports", "totally-new-kind"];
    const graph = synth(
      ["s", ...kinds.map((_, index) => `n${index}`)],
      kinds.map((kind, index): EdgeSpec => [`e${index}`, index % 2 === 0 ? "s" : `n${index}`, index % 2 === 0 ? `n${index}` : "s", kind])
    );

    const result = traverseAffectedNeighborhood(graph, ["s"]);

    expect(result.affectedNodeIds).toEqual(["n0", "n1", "n2", "n3", "n4", "s"]);
    expect(result.participatingEdgeIds).toEqual(["e0", "e1", "e2", "e3", "e4"]);
  });

  // TST-B2-004
  it("counts a node reached through several edges and seeds once", () => {
    const graph = synth(["s1", "s2", "X"], [["e1", "s1", "X"], ["e2", "s1", "X", "imports"], ["e3", "X", "s2"]]);

    const result = traverseAffectedNeighborhood(graph, ["s1", "s2"]);

    expect(result.affectedNodeIds).toEqual(["X", "s1", "s2"]);
    expect(result.participatingEdgeIds).toEqual(["e1", "e2", "e3"]);
  });

  // TST-B2-005
  it("counts only edges incident to a seed, not the induced subgraph of affected nodes", () => {
    const graph = synth(
      ["s1", "s2", "n1", "n2"],
      [["seed-seed", "s1", "s2"], ["seed-neighbor", "s1", "n1"], ["s2-neighbor", "s2", "n2"], ["neighbor-neighbor", "n1", "n2"]]
    );

    const result = traverseAffectedNeighborhood(graph, ["s1", "s2"]);

    expect(result.affectedNodeIds).toEqual(["n1", "n2", "s1", "s2"]);
    expect(result.participatingEdgeIds).toEqual(["s2-neighbor", "seed-neighbor", "seed-seed"]);
    expect(result.participatingEdgeIds).not.toContain("neighbor-neighbor");
  });

  it("ignores a seed ID that is not a node of the graph", () => {
    const graph = synth(["s", "A"], [["e1", "s", "A"]]);

    expect(traverseAffectedNeighborhood(graph, ["ghost"])).toEqual({ affectedNodeIds: [], participatingEdgeIds: [] });
  });
});

describe("mapAffectedNeighborhoodTask", () => {
  const graph = synth(NODES, []);
  const mapTask = (expectedFiles: unknown, expectedSymbols: unknown, evidence = graph) =>
    mapAffectedNeighborhoodTask({ graph: evidence, expectedFiles, expectedSymbols });

  // TST-B2-009
  it("maps expected files only to exact file nodes and keeps a missing file unresolved", () => {
    const result = mapTask(["src/a.ts", "src/nope.ts", "a.ts"], []);

    expect(result.resolvedFiles).toEqual([{ path: "src/a.ts", nodeId: "file:src/a.ts" }]);
    expect(result.unresolved).toEqual([
      { subject: "expected-file", name: "a.ts", reason: "graph-node-missing" },
      { subject: "expected-file", name: "src/nope.ts", reason: "graph-node-missing" },
    ]);
    expect(result.resolvedTaskNodeIds).toEqual(["file:src/a.ts"]);
    expect(result.status).toBe("partial");
  });

  // TST-B2-010
  it("resolves an expected symbol that has exactly one candidate among the expected files", () => {
    const result = mapTask(["src/a.ts", "src/b.ts"], ["foo", "bar"]);

    expect(result.resolvedSymbols).toEqual([
      { name: "bar", nodeId: "symbol:src/b.ts#bar" },
      { name: "foo", nodeId: "symbol:src/a.ts#foo" },
    ]);
    expect(result.status).toBe("complete");
  });

  // TST-B2-011
  it("leaves a symbol unresolved, with no global fallback, when no expected file defines it", () => {
    // `foo` also exists in src/c.ts, which is not an expected file.
    const result = mapTask(["src/b.ts"], ["foo"]);

    expect(result.resolvedSymbols).toEqual([]);
    expect(result.unresolved).toEqual([{ subject: "expected-symbol", name: "foo", reason: "graph-node-missing" }]);
    expect(result.resolvedTaskNodeIds).toEqual(["file:src/b.ts"]);
    expect(result.status).toBe("partial");
  });

  // TST-B2-012
  it("reports a symbol found in several expected files as ambiguous and adds no node", () => {
    const result = mapTask(["src/a.ts", "src/b.ts"], ["dup"]);

    expect(result.ambiguousSymbols).toEqual([{ name: "dup", candidateNodeIds: ["symbol:src/a.ts#dup", "symbol:src/b.ts#dup"] }]);
    expect(result.resolvedSymbols).toEqual([]);
    expect(result.resolvedTaskNodeIds).toEqual(["file:src/a.ts", "file:src/b.ts"]);
    expect(result.status).toBe("partial");
  });

  // TST-B2-013
  it("does not let duplicate expected metadata inflate anything", () => {
    const result = mapTask(["src/a.ts", "./src/a.ts", "src\\a.ts"], ["foo", "foo"]);

    expect(result.expectedFiles).toEqual(["src/a.ts"]);
    expect(result.expectedSymbols).toEqual(["foo"]);
    expect(result.duplicateEntryCount).toBe(3);
    expect(result.resolvableTaskNodeCount).toBe(2);
    expect(result.status).toBe("complete");
  });

  // TST-B2-014
  it("counts a node once when distinct metadata resolves to the same node identity", () => {
    // File `src/a.ts` and, under the same normalization, `./src/a.ts` are one node; a symbol never re-adds its file.
    const result = mapTask(["src/a.ts", "./src/a.ts"], ["foo"]);

    expect(result.resolvedTaskNodeIds).toEqual(["file:src/a.ts", "symbol:src/a.ts#foo"]);
    expect(new Set(result.resolvedTaskNodeIds).size).toBe(result.resolvedTaskNodeIds.length);
  });

  // TST-B2-015
  it("uses only unique resolved file nodes and unambiguous symbol nodes as the denominator", () => {
    const result = mapTask(["src/a.ts", "src/b.ts", "src/missing.ts"], ["foo", "dup", "bar", "ghost"]);

    expect(result.resolvedTaskNodeIds).toEqual(["file:src/a.ts", "file:src/b.ts", "symbol:src/a.ts#foo", "symbol:src/b.ts#bar"]);
    expect(result.resolvableTaskNodeCount).toBe(4);
    expect(result.unresolvedCount).toBe(2);
    expect(result.ambiguousCount).toBe(1);
  });

  it("is unavailable, not empty-complete, when nothing resolves or the graph or metadata is unusable", () => {
    expect(mapTask(["src/missing.ts"], []).status).toBe("unavailable");
    expect(mapTask([], []).status).toBe("unavailable");
    expect(mapTask(["src/a.ts"], [], synth(NODES, [], "unavailable")).status).toBe("unavailable");
    expect(mapTask("src/a.ts", []).status).toBe("unavailable");
    expect(mapTask([42, ""], []).unresolved.map((entry) => entry.reason)).toEqual(["invalid-entry", "invalid-entry"]);
  });

  it("caps a complete task mapping at partial when the graph evidence is partial", () => {
    expect(mapTask(["src/a.ts"], [], synth(NODES, [], "partial")).status).toBe("partial");
  });
});

describe("assessAffectedNeighborhood", () => {
  const task = { expectedFiles: ["src/a.ts", "src/b.ts"], expectedSymbols: ["foo"] };
  const assess2 = (graph: AffectedNeighborhoodGraphEvidenceV1, seedMapping: AffectedNeighborhoodSeedMappingV1, t = task) =>
    assessAffectedNeighborhood({ graph, seedMapping, task: t });

  // TST-B2-006, TST-B2-021
  it("gives a fresh, complete, empty neighborhood and an unrelated / not-indicated task", () => {
    const result = assess2(synth(NODES, [["e", "file:src/a.ts", "symbol:src/a.ts#foo"]]), seedsOf([], "complete", "fresh"));

    expect(result).toMatchObject({
      status: "complete",
      neighborhoodStatus: "complete",
      affectedNodeCount: 0,
      affectedEdgeCount: 0,
      affectedNodeIds: [],
      participatingEdgeIds: [],
      taskOverlapCount: 0,
      taskOverlapNodeIds: [],
      taskOverlapPercent: 0,
      relationship: "unrelated",
      reindexRecommendation: "not-indicated",
    });
    expect(result.taskMapping.resolvableTaskNodeCount).toBe(3);
  });

  // Planner decision (v0.6.1 Batch 3): there is no freshness-specific recommendation exception.
  it("keeps a fresh complete empty neighborhood with incomplete task mapping at unknown / unknown, never not-indicated", () => {
    const graph = synth(NODES, [["e", "file:src/a.ts", "symbol:src/a.ts#foo"]]);

    const result = assess2(graph, seedsOf([], "complete", "fresh"), { expectedFiles: ["src/a.ts", "src/gone.ts"], expectedSymbols: ["foo", "ghost"] });

    expect(result).toMatchObject({ freshnessStatus: "fresh", seedMappingStatus: "complete", neighborhoodStatus: "complete", affectedNodeCount: 0, taskOverlapCount: 0 });
    expect(result.taskMapping.status).toBe("partial");
    expect(result.relationship).toBe("unknown");
    expect(result.reindexRecommendation).toBe("unknown");
    expect(result.status).toBe("partial");
  });

  // TST-B2-007
  it("preserves the positive neighborhood of resolved seeds when seed mapping is partial", () => {
    const graph = synth(NODES, [["e1", "file:src/c.ts", "symbol:src/c.ts#foo"]]);

    const result = assess2(graph, seedsOf(["file:src/c.ts"], "partial"));

    expect(result.neighborhoodStatus).toBe("partial");
    expect(result.affectedNodeIds).toEqual(["file:src/c.ts", "symbol:src/c.ts#foo"]);
    expect(result.affectedNodeCount).toBe(2);
    expect(result.affectedEdgeCount).toBe(1);
    expect(result.status).toBe("partial");
  });

  // TST-B2-008
  it("does not traverse or fabricate zero counts when seed mapping or graph evidence is unavailable", () => {
    const fromSeeds = assess2(synth(NODES, [["e", "file:src/a.ts", "file:src/b.ts"]]), seedsOf([], "unavailable", "unknown"));
    const fromGraph = assess2(synth(NODES, [], "unavailable"), seedsOf(["file:src/a.ts"], "complete"));

    for (const result of [fromSeeds, fromGraph]) {
      expect(result.status).toBe("unavailable");
      expect(result.neighborhoodStatus).toBe("unavailable");
      expect(result.affectedNodeCount).toBeNull();
      expect(result.affectedEdgeCount).toBeNull();
      expect(result.affectedNodeIds).toEqual([]);
      expect(result.taskOverlapCount).toBeNull();
      expect(result.taskOverlapPercent).toBeNull();
      expect(result.relationship).toBe("unknown");
      expect(result.reindexRecommendation).toBe("unknown");
    }
    expect(fromSeeds.changedFileCount).toBeNull();
  });

  // TST-B2-016
  it("computes overlap as the affected / resolved-task intersection and its percentage over the resolvable denominator", () => {
    const graph = synth(NODES, [["e1", "file:src/a.ts", "symbol:src/a.ts#foo"], ["e2", "file:src/c.ts", "symbol:src/c.ts#foo"]]);

    const result = assess2(graph, seedsOf(["symbol:src/a.ts#foo"]));

    expect(result.affectedNodeIds).toEqual(["file:src/a.ts", "symbol:src/a.ts#foo"]);
    expect(result.taskMapping.resolvedTaskNodeIds).toEqual(["file:src/a.ts", "file:src/b.ts", "symbol:src/a.ts#foo"]);
    expect(result.taskOverlapNodeIds).toEqual(["file:src/a.ts", "symbol:src/a.ts#foo"]);
    expect(result.taskOverlapCount).toBe(2);
    expect(result.taskOverlapPercent).toBe((2 / 3) * 100);
    expect(result.relationship).toBe("related");
    expect(result.reindexRecommendation).toBe("recommended");
    expect(result.status).toBe("complete");
  });

  // TST-B2-017
  it("gives a null percentage, never zero, when no task node resolves", () => {
    const result = assess2(synth(NODES, [["e", "file:src/a.ts", "file:src/b.ts"]]), seedsOf(["file:src/a.ts"]), {
      expectedFiles: ["src/missing.ts"],
      expectedSymbols: [],
    });

    expect(result.taskMapping.resolvableTaskNodeCount).toBe(0);
    expect(result.taskOverlapPercent).toBeNull();
    expect(result.taskOverlapCount).toBeNull();
    expect(result.relationship).toBe("unknown");
    expect(result.status).toBe("unavailable");
  });

  // TST-B2-018
  it("is related and recommended on positive overlap even when task mapping is partial", () => {
    const graph = synth(NODES, [["e", "file:src/a.ts", "symbol:src/a.ts#foo"]]);

    const result = assess2(graph, seedsOf(["file:src/a.ts"]), { expectedFiles: ["src/a.ts", "src/missing.ts"], expectedSymbols: ["ghost", "dup"] });

    expect(result.taskMapping.status).toBe("partial");
    expect(result.status).toBe("partial");
    expect(result.taskOverlapCount).toBe(1);
    expect(result.relationship).toBe("related");
    expect(result.reindexRecommendation).toBe("recommended");
    // The percentage covers only the resolvable subset.
    expect(result.taskOverlapPercent).toBe((1 / 2) * 100);
  });

  // TST-B2-019
  it("is unrelated and not-indicated for complete zero overlap", () => {
    const graph = synth(NODES, [["e", "file:src/c.ts", "symbol:src/c.ts#foo"]]);

    const result = assess2(graph, seedsOf(["file:src/c.ts"]));

    expect(result.status).toBe("complete");
    expect(result.taskOverlapCount).toBe(0);
    expect(result.relationship).toBe("unrelated");
    expect(result.reindexRecommendation).toBe("not-indicated");
  });

  // TST-B2-020
  it.each([
    ["partially-stale seed evidence", () => assess2(synth(NODES, []), seedsOf(["file:src/c.ts"], "partial", "partially-stale"))],
    ["partial graph", () => assess2(synth(NODES, [], "partial"), seedsOf(["file:src/c.ts"]))],
    ["an unresolved expected file", () => assess2(synth(NODES, []), seedsOf(["file:src/c.ts"]), { expectedFiles: ["src/a.ts", "src/gone.ts"], expectedSymbols: [] })],
    ["an unresolved expected symbol", () => assess2(synth(NODES, []), seedsOf(["file:src/c.ts"]), { expectedFiles: ["src/a.ts"], expectedSymbols: ["ghost"] })],
    ["an ambiguous expected symbol", () => assess2(synth(NODES, []), seedsOf(["file:src/c.ts"]), { expectedFiles: ["src/a.ts", "src/b.ts"], expectedSymbols: ["dup"] })],
    ["zero resolvable task nodes", () => assess2(synth(NODES, []), seedsOf(["file:src/c.ts"]), { expectedFiles: ["src/gone.ts"], expectedSymbols: [] })],
    ["unavailable seed mapping", () => assess2(synth(NODES, []), seedsOf([], "unavailable", "unknown"))],
  ])("classifies zero observed overlap under %s as unknown, not unrelated", (_label, run) => {
    const result = run();

    expect(result.taskOverlapCount === null || result.taskOverlapCount === 0).toBe(true);
    expect(result.relationship).toBe("unknown");
    expect(result.reindexRecommendation).toBe("unknown");
    expect(result.status).not.toBe("complete");
  });

  // TST-B2-022
  it("keeps a confirmed positive overlap as related / recommended when the graph is partial", () => {
    const graph = synth(NODES, [["e", "file:src/a.ts", "symbol:src/a.ts#foo"]], "partial");

    const result = assess2(graph, seedsOf(["file:src/a.ts"]));

    expect(result.status).toBe("partial");
    expect(result.graphEvidenceStatus).toBe("partial");
    expect(result.relationship).toBe("related");
    expect(result.reindexRecommendation).toBe("recommended");
  });

  it("does not embed the graph and reports bounded diagnostics with untruncated counts", () => {
    const many = Array.from({ length: 70 }, (_, index) => `s${String(index).padStart(2, "0")}`);
    const result = assess2(synth(NODES, []), seedsOf([]), { expectedFiles: ["src/a.ts"], expectedSymbols: many });

    expect(result.taskMapping.unresolvedCount).toBe(70);
    expect(result.taskMapping.unresolved).toHaveLength(50);
    expect(result.taskMapping.unresolvedTruncated).toBe(true);
    expect(JSON.stringify(result)).not.toContain("symbol:src/c.ts#foo");
  });

  // TST-B2-023
  it("produces equivalent output regardless of graph, edge, task, and seed ordering", () => {
    const edges: EdgeSpec[] = [
      ["e1", "file:src/a.ts", "symbol:src/a.ts#foo"],
      ["e2", "file:src/b.ts", "file:src/a.ts", "imports"],
      ["e3", "file:src/c.ts", "file:src/b.ts", "novel"],
      ["e4", "symbol:src/b.ts#bar", "file:src/b.ts"],
    ];
    const seeds = ["file:src/a.ts", "file:src/c.ts"];
    const forward = assess2(synth(NODES, edges), seedsOf(seeds), { expectedFiles: ["src/a.ts", "src/b.ts", "src/gone.ts"], expectedSymbols: ["foo", "bar", "dup", "ghost"] });
    const reversed = assess2(synth([...NODES].reverse(), [...edges].reverse()), seedsOf([...seeds].reverse()), {
      expectedFiles: ["src/gone.ts", "src/b.ts", "src/a.ts"],
      expectedSymbols: ["ghost", "dup", "bar", "foo"],
    });

    expect(reversed).toEqual(forward);
    expect(assess2(synth(NODES, edges), seedsOf(seeds), task)).toEqual(assess2(synth(NODES, edges), seedsOf(seeds), task));
    expect(forward.affectedNodeIds).toEqual([...forward.affectedNodeIds].sort());
    expect(forward.participatingEdgeIds).toEqual([...forward.participatingEdgeIds].sort());
  });

  // TST-B2-024
  it("never mutates the graph evidence, seed mapping, or task metadata it is given", () => {
    const graph = synth(NODES, [["e1", "file:src/a.ts", "symbol:src/a.ts#foo"], ["e2", "file:src/b.ts", "file:src/a.ts"]]);
    const seedMapping = seedsOf(["file:src/a.ts"]);
    const expectedFiles = Object.freeze(["src/b.ts", "src/a.ts", "src/a.ts"]);
    const expectedSymbols = Object.freeze(["foo", "foo"]);
    Object.freeze(seedMapping.seedNodeIds);
    Object.freeze(graph.edges);
    const before = structuredClone({ graph, seedMapping, expectedFiles, expectedSymbols });

    assessAffectedNeighborhood({ graph, seedMapping, task: { expectedFiles, expectedSymbols } });

    expect(structuredClone({ graph, seedMapping, expectedFiles, expectedSymbols })).toEqual(before);
  });
});

describe("affected-neighborhood assessment against real my-dev-kit 1.12.4 graph evidence and the warm-index corpus", () => {
  const fixtureDir = path.resolve(process.cwd(), "tests/fixtures/affected-neighborhood/task-workflow-medium-ts-1.12.4");
  const targetRoot = path.resolve(process.cwd(), "benchmarks/projects/task-workflow-medium-ts");

  async function loadRealEvidence() {
    const indexDir = mkdtempSync(path.join(os.tmpdir(), "affected-neighborhood-real-"));
    realIndexDirs.push(indexDir);
    copyFileSync(path.join(fixtureDir, "symbol-index.json"), path.join(indexDir, "symbol-index.json"));
    copyFileSync(path.join(fixtureDir, "code-graph.json"), path.join(indexDir, "code-graph.json"));
    writeFileSync(
      path.join(indexDir, "manifest.json"),
      JSON.stringify({
        artifactKind: "my-dev-kit-v1-manifest",
        version: "1.0.0",
        projectRoot: targetRoot.replace(/\\/g, "/"),
        sourceRoots: ["src", "tests"],
        artifacts: { symbolIndex: "symbol-index.json", codeGraph: "code-graph.json" },
      })
    );
    const snapshot = await capture({ targetRoot, indexDir, sourceRoots: ["src", "tests"] });
    const graph = await loadAffectedNeighborhoodGraphEvidence({ indexDir, sourceRoots: ["src", "tests"], indexSnapshot: snapshot });
    return { snapshot, graph };
  }
  const realIndexDirs: string[] = [];
  afterEach(() => {
    for (const dir of realIndexDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  // TST-B2-025
  it("keeps unresolved expected symbols explicit for localized, cross-module, and broad tasks and never resolves them globally", async () => {
    const { graph } = await loadRealEvidence();
    const cases = await readEvaluationCases(path.resolve(process.cwd(), "benchmarks/contracts/warm-index-benchmark-cases.json"), process.cwd());
    const byId = (id: string) => cases.find((benchmarkCase) => benchmarkCase.id === id) as (typeof cases)[number];
    const mapCase = (id: string) => mapAffectedNeighborhoodTask({ graph, expectedFiles: byId(id).expectedFiles, expectedSymbols: byId(id).expectedSymbols });

    expect(graph.status).toBe("complete");

    const localized = mapCase("warm-medium-complete-idempotent");
    expect(localized.status).toBe("complete");
    expect(localized.resolvableTaskNodeCount).toBe(4);

    const crossModule = mapCase("warm-medium-import-dedupe");
    expect(crossModule.status).toBe("partial");
    expect(crossModule.resolvableTaskNodeCount).toBe(5);
    expect(crossModule.unresolved).toEqual([
      { subject: "expected-symbol", name: "createTask", reason: "graph-node-missing" },
      { subject: "expected-symbol", name: "findDuplicate", reason: "graph-node-missing" },
    ]);
    // `createTask` exists elsewhere in the graph; it must not be picked up.
    expect([...graph.nodes.keys()].some((id) => id.endsWith("#createTask"))).toBe(true);
    expect(crossModule.resolvedTaskNodeIds.some((id) => id.endsWith("#createTask"))).toBe(false);

    const broad = mapCase("warm-medium-broad-workflow-map");
    expect(broad.status).toBe("complete");
    expect(broad.resolvableTaskNodeCount).toBe(14);
  });

  it("treats a fresh index as unrelated only for tasks whose mapping is complete", async () => {
    const { graph } = await loadRealEvidence();
    const cases = await readEvaluationCases(path.resolve(process.cwd(), "benchmarks/contracts/warm-index-benchmark-cases.json"), process.cwd());
    const relationships = new Map(
      ["warm-medium-complete-idempotent", "warm-medium-import-dedupe", "warm-medium-broad-workflow-map"].map((id) => {
        const benchmarkCase = cases.find((candidate) => candidate.id === id) as (typeof cases)[number];
        const result = assessAffectedNeighborhood({ graph, seedMapping: seedsOf([], "complete", "fresh"), task: benchmarkCase });
        return [id, [result.relationship, result.reindexRecommendation]] as const;
      })
    );

    expect(relationships.get("warm-medium-complete-idempotent")).toEqual(["unrelated", "not-indicated"]);
    expect(relationships.get("warm-medium-broad-workflow-map")).toEqual(["unrelated", "not-indicated"]);
    // Its mapping is partial (unresolved expected symbols), so zero overlap is unknown.
    expect(relationships.get("warm-medium-import-dedupe")).toEqual(["unknown", "unknown"]);
  });

  it("finds related overlap for a real changed file through the real graph", async () => {
    const { snapshot, graph } = await loadRealEvidence();
    const freshness = {
      schemaVersion: "my-dev-kit-lab-index-freshness-v1",
      status: "stale",
      assessedAt: "2026-01-01T00:00:00.000Z",
      baselineSnapshotStatus: "complete",
      indexedFileCount: snapshot.indexedFileCount,
      comparableFileCount: snapshot.indexedFileCount,
      unchangedFileCount: snapshot.indexedFileCount - 1,
      changedFileCount: 1,
      missingFileCount: 0,
      unresolvedFileCount: 0,
      changes: [
        {
          path: "src/store/taskStore.ts",
          changeType: "modified",
          baselineSha256: "0".repeat(64),
          baselineSizeBytes: 1,
          baselineModifiedAt: "x",
          currentSha256: "1".repeat(64),
          currentSizeBytes: 1,
          currentModifiedAt: "x",
        },
      ],
      changesTruncated: false,
      unresolved: [],
      unresolvedTruncated: false,
      warnings: [],
    } as IndexFreshnessAssessmentV1;
    const seedMapping = mapAffectedNeighborhoodSeeds({ indexSnapshot: snapshot, freshness, graph });
    const cases = await readEvaluationCases(path.resolve(process.cwd(), "benchmarks/contracts/warm-index-benchmark-cases.json"), process.cwd());
    const benchmarkCase = cases.find((candidate) => candidate.id === "warm-medium-complete-idempotent") as (typeof cases)[number];

    const result = assessAffectedNeighborhood({ graph, seedMapping, task: benchmarkCase });

    expect(seedMapping.status).toBe("complete");
    expect(result.taskOverlapNodeIds).toContain("file:src/store/taskStore.ts");
    expect(result.relationship).toBe("related");
    expect(result.reindexRecommendation).toBe("recommended");
  });
});

// ---------------------------------------------------------------------------------------------
// v0.9.4: my-dev-kit 1.14.0 (symbol-index schema 3, code graph 1.1.0) compatibility.
//
// Schema 3 persists each symbol's actual graph `nodeId`. Same-named members therefore have distinct
// `symbolq:` identities that cannot be reconstructed as `symbol:<file>#<name>`. The symbol records
// below are copied from real my-dev-kit 1.14.0 index output (Python `Worker.run`, Rust trait-declared
// and impl-defined `run`); only the Rust file path is shortened to fit this fixture's source roots.
// ---------------------------------------------------------------------------------------------
const PY_FILE = "src/worker.py";
const PY_WORKER = "symbol:src/worker.py#Worker";
const PY_RUN = "symbolq:src%2Fworker.py#python%2Fclass%3AWorker#run#0";
const PY_RECORDS = [
  { name: "Worker", kind: "class", location: { file: PY_FILE, line: 1, endLine: 3 }, exported: true, signature: "class Worker:", nodeId: PY_WORKER },
  {
    name: "run",
    kind: "method",
    location: { file: PY_FILE, line: 2, endLine: 3 },
    exported: false,
    signature: "def run(self):",
    ownerKey: "python/class:Worker",
    qualifiedName: "Worker.run",
    nodeId: PY_RUN,
  },
];

const RS_FILE = "src/tasks.rs";
const RS_RUNNER = "symbol:src/tasks.rs#Runner";
const RS_WORKER = "symbol:src/tasks.rs#Worker";
const RS_RUN_TRAIT = "symbolq:src%2Ftasks.rs#rust%3Atrait_item%3ARunner%401%3A0#run#0";
const RS_RUN_IMPL = "symbolq:src%2Ftasks.rs#rust%3Aimpl%3AWorker%3Atrait%3ARunner%4017%3A263#run#0";
const RS_RECORDS = [
  { name: "Runner", kind: "trait", location: { file: RS_FILE, line: 1, endLine: 4 }, exported: false, signature: "pub trait Runner", nodeId: RS_RUNNER },
  {
    name: "run",
    kind: "method",
    location: { file: RS_FILE, line: 3, endLine: 3 },
    exported: false,
    signature: "fn run(&self) -> u32;",
    ownerKey: "rust:trait_item:Runner@1:0",
    qualifiedName: "rust:trait_item:Runner@1:0::run",
    nodeId: RS_RUN_TRAIT,
  },
  { name: "Worker", kind: "struct", location: { file: RS_FILE, line: 6, endLine: 9 }, exported: false, signature: "pub struct Worker", nodeId: RS_WORKER },
  {
    name: "run",
    kind: "method",
    location: { file: RS_FILE, line: 18, endLine: 20 },
    exported: false,
    signature: "fn run(&self) -> u32",
    ownerKey: "rust:impl:Worker:trait:Runner@17:263",
    qualifiedName: "rust:impl:Worker:trait:Runner@17:263::run",
    nodeId: RS_RUN_IMPL,
  },
];

type Record3 = { name: string; nodeId?: unknown } & Record<string, unknown>;
const SCHEMA3_FILES: Record<string, Record3[]> = { [PY_FILE]: PY_RECORDS, [RS_FILE]: RS_RECORDS };
const SCHEMA3_SOURCES = { [PY_FILE]: "class Worker:\n    def run(self):\n        pass\n", [RS_FILE]: "pub trait Runner {\n    fn run(&self) -> u32;\n}\n" };

/** A real-shaped code graph for the given symbol records: persisted node IDs, never name-derived ones. */
function graphOfRecords(files: Record<string, Record3[]>): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const [file, records] of Object.entries(files)) {
    nodes.push({ id: `file:${file}`, kind: "file", label: path.basename(file), path: file });
    for (const record of records) {
      if (typeof record.nodeId !== "string" || record.nodeId === "") continue;
      nodes.push({ id: record.nodeId, kind: "symbol", label: record.name, path: file });
      edges.push({ id: `file:${file}--defines-->${record.nodeId}`, source: `file:${file}`, target: record.nodeId, kind: "defines" });
    }
  }
  return { nodes, edges };
}

function schema3Options(files: Record<string, Record3[]> = SCHEMA3_FILES, extra: Partial<IndexOptions> = {}): IndexOptions {
  return {
    symbols: Object.fromEntries(Object.entries(files).map(([file, records]) => [file, records.map((record) => record.name)])),
    symbolRecords: files,
    symbolSchemaVersion: "3",
    graph: graphOfRecords(files),
    codeGraphContent: { artifactKind: "code-graph", schemaVersion: "1.1.0", ...graphOfRecords(files) },
    ...extra,
  };
}

const prepare3 = (options: IndexOptions = schema3Options(), sources: Record<string, string> = SCHEMA3_SOURCES) => prepare(options, sources);

describe("my-dev-kit 1.14.0 symbol-index schema 3 and code graph 1.1.0", () => {
  it("accepts schema 2 and schema 3 and reports the version it read", async () => {
    const v2 = await prepare();
    const v3 = await prepare3();

    expect(v2.graph.symbolIndex).toEqual({ path: "symbol-index.json", schemaVersion: "2" });
    expect(v3.graph.symbolIndex).toEqual({ path: "symbol-index.json", schemaVersion: "3" });
    expect(v3.graph.codeGraph).toEqual({ path: "code-graph.json", artifactKind: "code-graph", schemaVersion: "1.1.0" });
    expect(v3.graph.status).toBe("complete");
    expect(v3.graph.warnings).toEqual([]);
  });

  it("keeps schema-2 evidence exactly as before: names are the identities and no per-record data is added", async () => {
    const { graph } = await prepare();

    expect(graph.symbolFiles.get("src/a.ts")).toEqual({ symbolNames: ["a", "helper"], duplicateSymbolNames: [] });
    expect(lookupSymbolNode(graph, "src/a.ts", "helper")).toEqual({ ok: true, nodeId: "symbol:src/a.ts#helper" });
  });

  it("keeps a repeated schema-2 name as one identity, as in my-dev-kit 1.13", async () => {
    const { fixture, snapshot, graph } = await prepare({ symbolRecords: { "src/a.ts": [{ name: "a" }, { name: "a" }, { name: "helper" }], "src/nested/b.ts": [{ name: "b" }], "tests/a.test.ts": [] } });
    writeFileSync(abs(fixture, "src/a.ts"), "export const a = 99;\n");

    const result = map(snapshot, await assess(fixture, snapshot), graph);

    expect(graph.symbolFiles.get("src/a.ts")?.duplicateSymbolNames).toEqual(["a"]);
    expect(result.changedSymbolCount).toBe(2);
    expect(result.seedNodeIds).toEqual(["file:src/a.ts", "symbol:src/a.ts#a", "symbol:src/a.ts#helper"]);
    expect(result.warnings).toEqual([expect.objectContaining({ code: "duplicate-symbol-records", path: "src/a.ts" })]);
  });

  it("maps ordinary schema-3 symbols through their persisted node IDs", async () => {
    const { fixture, snapshot, graph } = await prepare3();
    writeFileSync(abs(fixture, PY_FILE), "class Worker:\n    def run(self):\n        return 1\n");

    const result = map(snapshot, await assess(fixture, snapshot), graph);

    expect(result.changedFiles).toEqual([
      { path: PY_FILE, changeType: "modified", expectedNodeId: `file:${PY_FILE}`, resolvedNodeId: `file:${PY_FILE}`, status: "mapped", unresolvedReason: null },
    ]);
    expect(result.changedSymbols.find((entry) => entry.name === "Worker")).toMatchObject({ expectedNodeId: PY_WORKER, resolvedNodeId: PY_WORKER, status: "mapped" });
  });

  it("maps a qualified Python member to its persisted symbolq identity, never to symbol:<file>#<name>", async () => {
    const { fixture, snapshot, graph } = await prepare3();
    writeFileSync(abs(fixture, PY_FILE), "class Worker:\n    def run(self):\n        return 1\n");

    const result = map(snapshot, await assess(fixture, snapshot), graph);

    expect(result.status).toBe("complete");
    expect(result.seedNodeIds).toEqual([`file:${PY_FILE}`, PY_RUN, PY_WORKER].sort());
    expect(result.changedSymbols.find((entry) => entry.name === "run")).toEqual({
      path: PY_FILE,
      name: "run",
      expectedNodeId: PY_RUN,
      resolvedNodeId: PY_RUN,
      status: "mapped",
      unresolvedReason: null,
    });
    expect(result.seedNodeIds).not.toContain(`symbol:${PY_FILE}#run`);
    expect(graph.nodes.has(`symbol:${PY_FILE}#run`)).toBe(false);
  });

  it("keeps distinct same-named Rust impl members as separate identities and seeds", async () => {
    const { fixture, snapshot, graph } = await prepare3();
    writeFileSync(abs(fixture, RS_FILE), "pub trait Runner {\n    fn run(&self) -> u32;\n}\n// changed\n");

    const result = map(snapshot, await assess(fixture, snapshot), graph);

    expect(graph.symbolFiles.get(RS_FILE)?.symbolNames).toEqual(["Runner", "Worker", "run"]);
    expect(graph.symbolFiles.get(RS_FILE)?.sameNameSymbolNames).toEqual(["run"]);
    expect(graph.symbolFiles.get(RS_FILE)?.duplicateSymbolNames).toEqual([]);
    expect(result.status).toBe("complete");
    expect(result.changedSymbolCount).toBe(4);
    expect(result.mappedChangedSymbolNodeCount).toBe(4);
    expect(result.changedSymbols.filter((entry) => entry.name === "run").map((entry) => entry.resolvedNodeId)).toEqual([RS_RUN_IMPL, RS_RUN_TRAIT]);
    expect(result.seedNodeIds).toEqual([`file:${RS_FILE}`, RS_RUN_IMPL, RS_RUN_TRAIT, RS_RUNNER, RS_WORKER].sort());
    expect(result.warnings.map((warning) => warning.code)).not.toContain("duplicate-symbol-records");
  });

  it("resolves a qualified owner by its exact persisted node ID and nothing else", async () => {
    const { graph } = await prepare3();
    const impl = graph.symbolFiles.get(RS_FILE)?.records?.find((record) => record.nodeId === RS_RUN_IMPL);

    expect(impl).toEqual({ name: "run", nodeId: RS_RUN_IMPL, persisted: true });
    expect(lookupSymbolRecordNode(graph, RS_FILE, impl as NonNullable<typeof impl>)).toEqual({ ok: true, nodeId: RS_RUN_IMPL });
    // The upstream file+name identity does not exist for a qualified member and is not fabricated.
    expect(lookupSymbolNode(graph, RS_FILE, "run")).toEqual({ ok: false, expectedNodeId: `symbol:${RS_FILE}#run`, reason: "graph-node-missing" });
  });

  it("reports a simple name with several identities as ambiguous, and resolves an exact node ID or unique name", async () => {
    const { graph } = await prepare3();

    const result = mapAffectedNeighborhoodTask({ graph, expectedFiles: [RS_FILE], expectedSymbols: ["run", RS_RUN_IMPL, "Worker", "absent"] });

    expect(result.ambiguousSymbols).toEqual([{ name: "run", candidateNodeIds: [RS_RUN_IMPL, RS_RUN_TRAIT].sort() }]);
    expect(result.resolvedSymbols).toEqual([
      { name: RS_RUN_IMPL, nodeId: RS_RUN_IMPL },
      { name: "Worker", nodeId: RS_WORKER },
    ].sort((left, right) => (left.name < right.name ? -1 : 1)));
    expect(result.unresolved).toEqual([{ subject: "expected-symbol", name: "absent", reason: "graph-node-missing" }]);
    expect(result.resolvedTaskNodeIds).not.toContain(RS_RUN_TRAIT);
    expect(result.status).toBe("partial");
  });

  it("treats the same simple name in two expected files as ambiguous, not as the first match", async () => {
    const { graph } = await prepare3();

    const result = mapAffectedNeighborhoodTask({ graph, expectedFiles: [PY_FILE, RS_FILE], expectedSymbols: ["Worker"] });

    expect(result.ambiguousSymbols).toEqual([{ name: "Worker", candidateNodeIds: [PY_WORKER, RS_WORKER].sort() }]);
    expect(result.resolvedSymbols).toEqual([]);
    // Only the two exact file nodes resolve; neither ambiguous candidate is added.
    expect(result.resolvedTaskNodeIds).toEqual([`file:${PY_FILE}`, `file:${RS_FILE}`].sort());
  });

  it("never guesses an identity for a schema-3 record without a persisted nodeId", async () => {
    const records = RS_RECORDS.map((record) => (record.nodeId === RS_RUN_IMPL ? { ...record, nodeId: undefined } : record));
    const { fixture, snapshot, graph } = await prepare3(schema3Options({ [RS_FILE]: records }), { [RS_FILE]: SCHEMA3_SOURCES[RS_FILE] });
    writeFileSync(abs(fixture, RS_FILE), "pub trait Runner {\n    fn run(&self) -> u32;\n}\n// changed\n");

    const result = map(snapshot, await assess(fixture, snapshot), graph);

    expect(graph.status).toBe("partial");
    expect(graph.warnings).toEqual([expect.objectContaining({ code: "symbol-node-id-missing", subject: `${RS_FILE}#run` })]);
    expect(graph.symbolFiles.get(RS_FILE)?.records).toContainEqual({ name: "run", nodeId: RS_RUN_TRAIT, persisted: true });
    expect(graph.symbolFiles.get(RS_FILE)?.records).toContainEqual({ name: "run", nodeId: null, persisted: true });
    expect(result.status).toBe("partial");
    expect(result.changedSymbolCount).toBe(4);
    expect(result.mappedChangedSymbolNodeCount).toBe(3);
    const missing = result.changedSymbols.find((entry) => entry.resolvedNodeId === null);
    expect(missing).toEqual({ path: RS_FILE, name: "run", expectedNodeId: "", resolvedNodeId: null, status: "unresolved", unresolvedReason: "symbol-node-id-missing" });
    expect(result.seedNodeIds).not.toContain(RS_RUN_IMPL);
    expect(result.seedNodeIds.some((id) => id.includes("impl%3AWorker"))).toBe(false);
    expect(result.unresolved).toContainEqual({ subject: "changed-symbol", path: RS_FILE, name: "run", reason: "symbol-node-id-missing" });

    // A same-name identity with no persisted ID cannot be excluded, so the one mappable `run` is not trusted as the owner.
    const task = mapAffectedNeighborhoodTask({ graph, expectedFiles: [RS_FILE], expectedSymbols: ["run"] });
    expect(task.resolvedSymbols).toEqual([]);
    expect(task.unresolved).toEqual([{ subject: "expected-symbol", name: "run", reason: "symbol-node-id-missing" }]);
    expect(mapAffectedNeighborhoodTask({ graph, expectedFiles: [RS_FILE], expectedSymbols: [RS_RUN_TRAIT] }).resolvedSymbols).toEqual([{ name: RS_RUN_TRAIT, nodeId: RS_RUN_TRAIT }]);
  });

  it.each([null, 7, "", {}])("treats a non-string persisted nodeId %j as missing, not as an identity", async (nodeId) => {
    const records = PY_RECORDS.map((record) => (record.name === "run" ? { ...record, nodeId } : record));
    const { graph } = await prepare3(schema3Options({ [PY_FILE]: records }), { [PY_FILE]: SCHEMA3_SOURCES[PY_FILE] });

    expect(graph.warnings.map((warning) => warning.code)).toEqual(["symbol-node-id-missing"]);
    expect(graph.symbolFiles.get(PY_FILE)?.records).toContainEqual({ name: "run", nodeId: null, persisted: true });
  });

  it("leaves a persisted identity whose graph endpoint is missing unresolved and unseeded", async () => {
    const files = { [PY_FILE]: PY_RECORDS };
    const full = graphOfRecords(files);
    const graphWithoutRun = { nodes: full.nodes.filter((node) => node.id !== PY_RUN), edges: full.edges.filter((edge) => edge.target !== PY_RUN) };
    const { fixture, snapshot, graph } = await prepare3(schema3Options(files, { graph: graphWithoutRun, codeGraphContent: { artifactKind: "code-graph", schemaVersion: "1.1.0", ...graphWithoutRun } }), { [PY_FILE]: SCHEMA3_SOURCES[PY_FILE] });
    writeFileSync(abs(fixture, PY_FILE), "class Worker:\n    def run(self):\n        return 1\n");

    const result = map(snapshot, await assess(fixture, snapshot), graph);

    expect(result.status).toBe("partial");
    expect(result.seedNodeIds).toEqual([`file:${PY_FILE}`, PY_WORKER].sort());
    expect(result.changedSymbols.find((entry) => entry.name === "run")).toMatchObject({ expectedNodeId: PY_RUN, resolvedNodeId: null, unresolvedReason: "graph-node-missing" });
    expect(mapAffectedNeighborhoodTask({ graph, expectedFiles: [PY_FILE], expectedSymbols: ["run"] }).unresolved).toEqual([
      { subject: "expected-symbol", name: "run", reason: "graph-node-missing" },
    ]);
  });

  it("does not select a node that belongs to another file, even when the persisted ID names it", async () => {
    const stolen = PY_RECORDS.map((record) => (record.name === "run" ? { ...record, nodeId: "symbol:src/other.py#run" } : record));
    const graphIn = graphOfRecords({ [PY_FILE]: PY_RECORDS });
    graphIn.nodes.push({ id: "symbol:src/other.py#run", kind: "symbol", label: "run", path: "src/other.py" });
    const { fixture, snapshot, graph } = await prepare3(
      schema3Options({ [PY_FILE]: stolen }, { graph: graphIn, codeGraphContent: { artifactKind: "code-graph", schemaVersion: "1.1.0", ...graphIn } }),
      { [PY_FILE]: SCHEMA3_SOURCES[PY_FILE] }
    );
    writeFileSync(abs(fixture, PY_FILE), "class Worker:\n    def run(self):\n        return 1\n");

    const result = map(snapshot, await assess(fixture, snapshot), graph);

    expect(result.seedNodeIds).not.toContain("symbol:src/other.py#run");
    expect(result.changedSymbols.find((entry) => entry.name === "run")).toMatchObject({ resolvedNodeId: null, unresolvedReason: "graph-node-path-mismatch" });
    expect(mapAffectedNeighborhoodTask({ graph, expectedFiles: [PY_FILE], expectedSymbols: ["run"] }).unresolved).toEqual([
      { subject: "expected-symbol", name: "run", reason: "graph-node-path-mismatch" },
    ]);
  });

  it("keeps the first record of a duplicated graph node ID and warns instead of merging identities", async () => {
    const graphIn = graphOfRecords({ [PY_FILE]: PY_RECORDS });
    graphIn.nodes.push({ id: PY_RUN, kind: "symbol", label: "run", path: "src/elsewhere.py" });
    const { graph } = await prepare3(schema3Options({ [PY_FILE]: PY_RECORDS }, { graph: graphIn, codeGraphContent: { artifactKind: "code-graph", schemaVersion: "1.1.0", ...graphIn } }), {
      [PY_FILE]: SCHEMA3_SOURCES[PY_FILE],
    });

    expect(graph.status).toBe("partial");
    expect(graph.warnings).toEqual([expect.objectContaining({ code: "duplicate-node-id", subject: PY_RUN })]);
    expect(graph.nodes.get(PY_RUN)?.path).toBe(PY_FILE);
  });

  it("collapses an identical repeated schema-3 record but still warns", async () => {
    const records = [...PY_RECORDS, PY_RECORDS[1]];
    const { fixture, snapshot, graph } = await prepare3(schema3Options({ [PY_FILE]: records }), { [PY_FILE]: SCHEMA3_SOURCES[PY_FILE] });
    writeFileSync(abs(fixture, PY_FILE), "class Worker:\n    def run(self):\n        return 1\n");

    const result = map(snapshot, await assess(fixture, snapshot), graph);

    expect(graph.symbolFiles.get(PY_FILE)?.duplicateSymbolNames).toEqual(["run"]);
    expect(result.changedSymbolCount).toBe(2);
    expect(result.warnings).toEqual([expect.objectContaining({ code: "duplicate-symbol-records", path: PY_FILE })]);
  });

  it.each([
    ["missing", undefined],
    ["a number", 3],
    ["null", null],
    ["empty", ""],
    ["a different type", ["3"]],
  ])("rejects a corrupt symbol-index schemaVersion (%s) as unsupported evidence", async (_label, version) => {
    const { graph } = await prepare3(schema3Options(SCHEMA3_FILES, { symbolSchemaVersion: version }));

    expect(graph.status).toBe("unavailable");
    // The index snapshot (which also reads the symbol index) may already reject a non-string version.
    expect(["index-snapshot-unavailable", "symbol-index-unsupported"]).toContain(graph.unavailable?.code);
    expect(graph.indexedFilePaths).toEqual([]);
    expect(graph.symbolFiles.size).toBe(0);
  });

  it.each(["1", "4", "3.0", "2.0.0", "v3", " 3", "03"])("rejects the unknown symbol-index schemaVersion %j", async (version) => {
    const { graph } = await prepare3(schema3Options(SCHEMA3_FILES, { symbolSchemaVersion: version }));

    expect(graph.status).toBe("unavailable");
    expect(graph.unavailable).toMatchObject({ code: "symbol-index-unsupported", message: expect.stringContaining("supported version") });
  });

  it("derives membership only from the persisted symbol index and never from unselected files", async () => {
    const { fixture, snapshot, graph } = await prepare3(undefined, { ...SCHEMA3_SOURCES, "scripts/unselected.py": "class Hidden:\n    pass\n" });
    writeFileSync(abs(fixture, "scripts/unselected.py"), "class Hidden:\n    pass\n# changed\n");

    const result = map(snapshot, await assess(fixture, snapshot), graph);

    expect(graph.indexedFilePaths).toEqual([PY_FILE, RS_FILE].sort());
    expect(result.changedFiles).toEqual([]);
    expect(result.seedNodeIds).toEqual([]);
    expect(result.status).toBe("complete");
  });

  it("accepts code graph 1.x and rejects an unsupported major version", async () => {
    const supported = await prepare3(schema3Options(SCHEMA3_FILES, { codeGraphContent: { artifactKind: "code-graph", schemaVersion: "1.1.0", ...graphOfRecords(SCHEMA3_FILES) } }));
    const unsupported = await prepare3(schema3Options(SCHEMA3_FILES, { codeGraphContent: { artifactKind: "code-graph", schemaVersion: "2.0.0", ...graphOfRecords(SCHEMA3_FILES) } }));

    expect(supported.graph.codeGraph?.schemaVersion).toBe("1.1.0");
    expect(supported.graph.nodes.has(RS_RUN_IMPL)).toBe(true);
    expect(unsupported.graph.status).toBe("partial");
    expect(unsupported.graph.codeGraph).toBeNull();
    expect(unsupported.graph.warnings).toEqual([expect.objectContaining({ code: "code-graph-unsupported" })]);
  });

  it("resolves qualified symbols completely, so an unchanged-file task is classified instead of left unknown", async () => {
    const { fixture, snapshot, graph } = await prepare3();
    writeFileSync(abs(fixture, RS_FILE), "pub trait Runner {\n    fn run(&self) -> u32;\n}\n// changed\n");
    const seedMapping = map(snapshot, await assess(fixture, snapshot), graph);

    const exact = assessAffectedNeighborhood({ graph, seedMapping, task: { expectedFiles: [RS_FILE], expectedSymbols: [RS_RUN_IMPL] } });
    const unchangedFile = assessAffectedNeighborhood({ graph, seedMapping, task: { expectedFiles: [PY_FILE], expectedSymbols: ["run", "Worker"] } });

    expect(exact.relationship).toBe("related");
    expect(exact.taskOverlapNodeIds).toContain(RS_RUN_IMPL);
    expect(exact.taskOverlapNodeIds).not.toContain(RS_RUN_TRAIT);
    // Before schema-3 support `run` could not be found in this file at all, which left the task "unknown".
    expect(unchangedFile.taskMapping.status).toBe("complete");
    expect(unchangedFile.taskMapping.resolvedSymbols).toEqual([
      { name: "Worker", nodeId: PY_WORKER },
      { name: "run", nodeId: PY_RUN },
    ]);
    expect(unchangedFile.relationship).toBe("unrelated");
  });
});
