import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFFECTED_NEIGHBORHOOD_SEED_MAPPING_SCHEMA_VERSION,
  interpretCodeGraphForNeighborhood,
  loadAffectedNeighborhoodGraphEvidence,
  lookupFileNode,
  lookupSymbolNode,
  mapAffectedNeighborhoodSeeds,
  type AffectedNeighborhoodGraphEvidenceV1,
} from "../../src/evaluation/affectedNeighborhood.js";
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
    symbolIndex: { files },
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
