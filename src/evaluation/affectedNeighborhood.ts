import path from "node:path";
import { resolveWithinRoot } from "../core/pathSafety.js";
import type { IndexFreshnessAssessmentV1, IndexFreshnessChangeType } from "./indexFreshness.js";
import { compareCodeUnits, interpretIndexManifest, readJson, type IndexSnapshotV1 } from "./indexSnapshot.js";

export const AFFECTED_NEIGHBORHOOD_GRAPH_EVIDENCE_SCHEMA_VERSION = "my-dev-kit-lab-affected-neighborhood-graph-evidence-v1";
export const AFFECTED_NEIGHBORHOOD_SEED_MAPPING_SCHEMA_VERSION = "my-dev-kit-lab-affected-neighborhood-seed-mapping-v1";

const MANIFEST_FILE = "manifest.json";
const SUPPORTED_SYMBOL_INDEX_SCHEMA_VERSION = "2";
const SUPPORTED_CODE_GRAPH_ARTIFACT_KIND = "code-graph";
const SUPPORTED_CODE_GRAPH_VERSION_PATTERN = /^1\./;
// Same bounds as the v0.6.0 freshness/snapshot evidence lists.
const MAX_WARNINGS = 50;
const MAX_UNRESOLVED = 50;
const MAX_REPORTED_TEXT_LENGTH = 260;

export type AffectedNeighborhoodEvidenceStatus = "complete" | "partial" | "unavailable";

export type AffectedNeighborhoodGraphUnavailableCode =
  | "index-snapshot-unavailable"
  | "manifest-missing"
  | "manifest-unreadable"
  | "manifest-unsupported"
  | "symbol-index-missing"
  | "symbol-index-unreadable"
  | "symbol-index-unsupported"
  | "artifact-path-escapes-index"
  | "graph-evidence-load-failed";

export type AffectedNeighborhoodGraphWarningCode =
  | "code-graph-not-referenced"
  | "code-graph-missing"
  | "code-graph-unreadable"
  | "code-graph-unsupported"
  | "code-graph-path-escapes-index"
  | "invalid-node-entry"
  | "duplicate-node-id"
  | "invalid-edge-entry"
  | "conflicting-duplicate-edge-id"
  | "dangling-edge"
  | "invalid-symbol-file-entry"
  | "invalid-symbol-entry";

export type AffectedNeighborhoodGraphWarningV1 = {
  code: AffectedNeighborhoodGraphWarningCode;
  /** Path, node ID, or edge ID the warning concerns; null for artifact-level warnings. */
  subject: string | null;
  message: string;
};

/** A graph node exactly as the code-graph artifact names it; IDs are never rewritten. */
export type AffectedNeighborhoodGraphNodeV1 = {
  id: string;
  kind: string;
  path: string | null;
  label: string | null;
};

/** A graph edge preserved generically; `kind` is never filtered against a fixed vocabulary. */
export type AffectedNeighborhoodGraphEdgeV1 = {
  id: string;
  source: string;
  target: string;
  kind: string;
};

/** Baseline symbol records of one indexed file, collapsed to unique names. */
export type AffectedNeighborhoodSymbolFileV1 = {
  /** Unique baseline symbol names, code-unit sorted. */
  symbolNames: readonly string[];
  /** Names the symbol index lists more than once in this file (each is still one identity). */
  duplicateSymbolNames: readonly string[];
};

/**
 * Baseline graph evidence of one prepared index, read once from the manifest-referenced symbol
 * index and code graph. `partial` means some artifact content was dropped or the code graph could
 * not be loaded (`codeGraph` is then null and no node mapping is possible); `unavailable` means no
 * indexed-file or symbol claim can be made. Runtime evidence only; it is not persisted.
 */
export type AffectedNeighborhoodGraphEvidenceV1 = {
  schemaVersion: typeof AFFECTED_NEIGHBORHOOD_GRAPH_EVIDENCE_SCHEMA_VERSION;
  status: AffectedNeighborhoodEvidenceStatus;
  unavailable: { code: AffectedNeighborhoodGraphUnavailableCode; message: string } | null;
  indexRoot: string;
  manifest: { path: string; artifactKind: string; schemaVersion: string } | null;
  symbolIndex: { path: string; schemaVersion: string } | null;
  codeGraph: { path: string; artifactKind: string; schemaVersion: string } | null;
  /** Exact indexed-file paths the symbol index lists, code-unit sorted; never derived from a directory walk. */
  indexedFilePaths: readonly string[];
  /** Baseline symbol records keyed by indexed file path, in sorted key order. */
  symbolFiles: ReadonlyMap<string, AffectedNeighborhoodSymbolFileV1>;
  /** Graph nodes keyed by actual stable node ID, in sorted key order. */
  nodes: ReadonlyMap<string, AffectedNeighborhoodGraphNodeV1>;
  /** Distinct graph edges sorted by ID. Not traversed in Batch 1. */
  edges: readonly AffectedNeighborhoodGraphEdgeV1[];
  /** Identical repeated edge records collapsed to one edge; diagnostic only. */
  duplicateEdgeRecordCount: number;
  warningCount: number;
  warnings: AffectedNeighborhoodGraphWarningV1[];
  warningsTruncated: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: string): string {
  return value.length > MAX_REPORTED_TEXT_LENGTH ? `${value.slice(0, MAX_REPORTED_TEXT_LENGTH)}...` : value;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

/** The upstream stable file-node identity. */
export function fileNodeId(filePath: string): string {
  return `file:${filePath}`;
}

/** The upstream stable symbol-node identity: file path + symbol name. */
export function symbolNodeId(filePath: string, symbolName: string): string {
  return `symbol:${filePath}#${symbolName}`;
}

function emptyEvidence(indexRoot: string): AffectedNeighborhoodGraphEvidenceV1 {
  return {
    schemaVersion: AFFECTED_NEIGHBORHOOD_GRAPH_EVIDENCE_SCHEMA_VERSION,
    status: "unavailable",
    unavailable: null,
    indexRoot,
    manifest: null,
    symbolIndex: null,
    codeGraph: null,
    indexedFilePaths: [],
    symbolFiles: new Map(),
    nodes: new Map(),
    edges: [],
    duplicateEdgeRecordCount: 0,
    warningCount: 0,
    warnings: [],
    warningsTruncated: false,
  };
}

function unavailableEvidence(
  indexRoot: string,
  code: AffectedNeighborhoodGraphUnavailableCode,
  message: string,
  manifest: AffectedNeighborhoodGraphEvidenceV1["manifest"] = null
): AffectedNeighborhoodGraphEvidenceV1 {
  return { ...emptyEvidence(indexRoot), unavailable: { code, message: boundedText(message) }, manifest };
}

function sortWarnings(warnings: AffectedNeighborhoodGraphWarningV1[]): AffectedNeighborhoodGraphWarningV1[] {
  return [...warnings].sort(
    (left, right) =>
      compareCodeUnits(left.code, right.code) || compareCodeUnits(left.subject ?? "", right.subject ?? "") || compareCodeUnits(left.message, right.message)
  );
}

type SymbolIndexInterpretation = {
  indexedFilePaths: string[];
  symbolFiles: Map<string, AffectedNeighborhoodSymbolFileV1>;
  warnings: AffectedNeighborhoodGraphWarningV1[];
};

/**
 * Policy: reads indexed-file membership and baseline symbols from a symbol-index artifact. Only
 * schema version 2 is understood. A file entry whose symbol list is malformed keeps its
 * membership but yields no symbol record; a malformed symbol entry is dropped with a warning.
 * Pure.
 */
export function interpretSymbolIndexForNeighborhood(
  symbolIndex: unknown
): { ok: true; value: SymbolIndexInterpretation } | { ok: false; message: string } {
  if (!isRecord(symbolIndex)) {
    return { ok: false, message: "Symbol index is not a JSON object." };
  }
  if (symbolIndex.schemaVersion !== SUPPORTED_SYMBOL_INDEX_SCHEMA_VERSION) {
    return { ok: false, message: `Symbol index schemaVersion is not the supported ${SUPPORTED_SYMBOL_INDEX_SCHEMA_VERSION}.` };
  }
  if (!Array.isArray(symbolIndex.files)) {
    return { ok: false, message: "Symbol index does not list indexed files." };
  }
  const warnings: AffectedNeighborhoodGraphWarningV1[] = [];
  const records = new Map<string, AffectedNeighborhoodSymbolFileV1>();
  const paths = new Set<string>();
  for (const entry of symbolIndex.files) {
    if (!isRecord(entry) || !nonEmptyString(entry.path)) {
      return { ok: false, message: "Symbol index contains a file entry without a path." };
    }
    const filePath = normalizePath(entry.path);
    if (paths.has(filePath)) {
      return { ok: false, message: "Symbol index lists the same file path more than once." };
    }
    paths.add(filePath);
    if (!Array.isArray(entry.symbols)) {
      warnings.push({
        code: "invalid-symbol-file-entry",
        subject: boundedText(filePath),
        message: "Symbol index file entry has no symbol list; no baseline symbols are recorded for it.",
      });
      continue;
    }
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const symbol of entry.symbols) {
      if (!isRecord(symbol) || !nonEmptyString(symbol.name)) {
        warnings.push({ code: "invalid-symbol-entry", subject: boundedText(filePath), message: "Symbol index entry lacks a symbol name and was ignored." });
        continue;
      }
      if (seen.has(symbol.name)) {
        duplicates.add(symbol.name);
      }
      seen.add(symbol.name);
    }
    records.set(filePath, {
      symbolNames: [...seen].sort(compareCodeUnits),
      duplicateSymbolNames: [...duplicates].sort(compareCodeUnits),
    });
  }
  const indexedFilePaths = [...paths].sort(compareCodeUnits);
  const symbolFiles = new Map<string, AffectedNeighborhoodSymbolFileV1>();
  for (const key of [...records.keys()].sort(compareCodeUnits)) {
    symbolFiles.set(key, records.get(key) as AffectedNeighborhoodSymbolFileV1);
  }
  return { ok: true, value: { indexedFilePaths, symbolFiles, warnings } };
}

type CodeGraphInterpretation = {
  artifactKind: string;
  schemaVersion: string;
  nodes: Map<string, AffectedNeighborhoodGraphNodeV1>;
  edges: AffectedNeighborhoodGraphEdgeV1[];
  duplicateEdgeRecordCount: number;
  warnings: AffectedNeighborhoodGraphWarningV1[];
};

/**
 * Policy: validates the structure of a code-graph artifact and preserves its nodes and edges by
 * their actual IDs and kinds. Edge kinds are not filtered. Structurally invalid entries are dropped
 * with a warning; identical repeated edge records collapse silently into a count. Pure.
 */
export function interpretCodeGraphForNeighborhood(
  codeGraph: unknown
): { ok: true; value: CodeGraphInterpretation } | { ok: false; message: string } {
  if (!isRecord(codeGraph)) {
    return { ok: false, message: "Code graph is not a JSON object." };
  }
  if (codeGraph.artifactKind !== SUPPORTED_CODE_GRAPH_ARTIFACT_KIND) {
    return { ok: false, message: `Code graph artifactKind is not ${SUPPORTED_CODE_GRAPH_ARTIFACT_KIND}.` };
  }
  if (typeof codeGraph.schemaVersion !== "string" || !SUPPORTED_CODE_GRAPH_VERSION_PATTERN.test(codeGraph.schemaVersion)) {
    return { ok: false, message: "Code graph schemaVersion is missing or not a supported 1.x version." };
  }
  if (!Array.isArray(codeGraph.nodes) || !Array.isArray(codeGraph.edges)) {
    return { ok: false, message: "Code graph does not list nodes and edges." };
  }
  const warnings: AffectedNeighborhoodGraphWarningV1[] = [];
  const unsorted = new Map<string, AffectedNeighborhoodGraphNodeV1>();
  for (const entry of codeGraph.nodes) {
    if (!isRecord(entry) || !nonEmptyString(entry.id) || !nonEmptyString(entry.kind)) {
      warnings.push({ code: "invalid-node-entry", subject: null, message: "Code graph node lacks an id or kind and was ignored." });
      continue;
    }
    const node: AffectedNeighborhoodGraphNodeV1 = {
      id: entry.id,
      kind: entry.kind,
      path: typeof entry.path === "string" ? entry.path : null,
      label: typeof entry.label === "string" ? entry.label : null,
    };
    const existing = unsorted.get(node.id);
    if (existing) {
      if (existing.kind !== node.kind || existing.path !== node.path) {
        warnings.push({ code: "duplicate-node-id", subject: boundedText(node.id), message: "Code graph repeats a node ID with different content; the first record was kept." });
      }
      continue;
    }
    unsorted.set(node.id, node);
  }
  const nodes = new Map<string, AffectedNeighborhoodGraphNodeV1>();
  for (const key of [...unsorted.keys()].sort(compareCodeUnits)) {
    nodes.set(key, unsorted.get(key) as AffectedNeighborhoodGraphNodeV1);
  }

  const edgesById = new Map<string, AffectedNeighborhoodGraphEdgeV1>();
  let duplicateEdgeRecordCount = 0;
  for (const entry of codeGraph.edges) {
    if (!isRecord(entry) || !nonEmptyString(entry.id) || !nonEmptyString(entry.source) || !nonEmptyString(entry.target) || !nonEmptyString(entry.kind)) {
      warnings.push({ code: "invalid-edge-entry", subject: null, message: "Code graph edge lacks an id, source, target, or kind and was ignored." });
      continue;
    }
    const edge: AffectedNeighborhoodGraphEdgeV1 = { id: entry.id, source: entry.source, target: entry.target, kind: entry.kind };
    const existing = edgesById.get(edge.id);
    if (existing) {
      if (existing.source === edge.source && existing.target === edge.target && existing.kind === edge.kind) {
        duplicateEdgeRecordCount += 1;
      } else {
        warnings.push({ code: "conflicting-duplicate-edge-id", subject: boundedText(edge.id), message: "Code graph repeats an edge ID with different content; the first record was kept." });
      }
      continue;
    }
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      warnings.push({ code: "dangling-edge", subject: boundedText(edge.id), message: "Code graph edge references a node that is not in the graph and was ignored." });
      continue;
    }
    edgesById.set(edge.id, edge);
  }
  const edges = [...edgesById.values()].sort((left, right) => compareCodeUnits(left.id, right.id));
  return {
    ok: true,
    value: { artifactKind: codeGraph.artifactKind, schemaVersion: codeGraph.schemaVersion, nodes, edges, duplicateEdgeRecordCount, warnings },
  };
}

/**
 * Loads the baseline graph evidence of one prepared index once. Reads only manifest-referenced
 * artifacts inside `indexDir`; never enumerates the index, reads `cache-metadata.json`, walks
 * source roots, runs my-dev-kit, or throws. `indexSnapshot` is the session's already captured v0.6.0
 * snapshot, which proves the manifest was accepted for this target; an unavailable snapshot yields
 * unavailable evidence rather than a re-derived one.
 */
export async function loadAffectedNeighborhoodGraphEvidence(options: {
  indexDir: string;
  sourceRoots: readonly string[];
  indexSnapshot: IndexSnapshotV1;
}): Promise<AffectedNeighborhoodGraphEvidenceV1> {
  const { indexDir, sourceRoots, indexSnapshot } = options;
  const indexRoot = path.resolve(indexDir);
  try {
    if (indexSnapshot.status === "unavailable" || !indexSnapshot.manifest) {
      return unavailableEvidence(
        indexRoot,
        "index-snapshot-unavailable",
        indexSnapshot.unavailable?.message ?? "The index snapshot is unavailable, so the index contract was not accepted."
      );
    }
    const manifestRead = await readJson(path.join(indexDir, MANIFEST_FILE));
    if (!manifestRead.ok) {
      return unavailableEvidence(indexRoot, manifestRead.missing ? "manifest-missing" : "manifest-unreadable", `Index manifest ${manifestRead.message}.`);
    }
    const manifest = interpretIndexManifest(manifestRead.value, { sourceRoots });
    if (!manifest.ok) {
      return unavailableEvidence(indexRoot, "manifest-unsupported", manifest.message);
    }
    const manifestSummary = {
      path: MANIFEST_FILE,
      artifactKind: manifest.contract.manifestArtifactKind,
      schemaVersion: manifest.contract.manifestVersion,
    };

    let symbolIndexFile: string;
    try {
      symbolIndexFile = resolveWithinRoot(indexDir, manifest.contract.symbolIndexRelativePath);
    } catch {
      return unavailableEvidence(indexRoot, "artifact-path-escapes-index", "Index manifest symbolIndex path escapes the index directory.", manifestSummary);
    }
    const symbolIndexRead = await readJson(symbolIndexFile);
    if (!symbolIndexRead.ok) {
      return unavailableEvidence(
        indexRoot,
        symbolIndexRead.missing ? "symbol-index-missing" : "symbol-index-unreadable",
        `Symbol index ${symbolIndexRead.message}.`,
        manifestSummary
      );
    }
    const symbols = interpretSymbolIndexForNeighborhood(symbolIndexRead.value);
    if (!symbols.ok) {
      return unavailableEvidence(indexRoot, "symbol-index-unsupported", symbols.message, manifestSummary);
    }
    const symbolIndexSummary = {
      path: normalizePath(path.relative(path.resolve(indexDir), symbolIndexFile)),
      schemaVersion: SUPPORTED_SYMBOL_INDEX_SCHEMA_VERSION,
    };

    const warnings = [...symbols.value.warnings];
    let codeGraphSummary: AffectedNeighborhoodGraphEvidenceV1["codeGraph"] = null;
    let graph: CodeGraphInterpretation | null = null;
    const rawCodeGraph = isRecord(manifestRead.value) && isRecord(manifestRead.value.artifacts) ? manifestRead.value.artifacts.codeGraph : undefined;
    if (!nonEmptyString(rawCodeGraph)) {
      warnings.push({ code: "code-graph-not-referenced", subject: null, message: "Index manifest does not name a codeGraph artifact." });
    } else {
      let codeGraphFile: string | null = null;
      try {
        codeGraphFile = resolveWithinRoot(indexDir, rawCodeGraph);
      } catch {
        warnings.push({ code: "code-graph-path-escapes-index", subject: null, message: "Index manifest codeGraph path escapes the index directory." });
      }
      if (codeGraphFile !== null) {
        const codeGraphRead = await readJson(codeGraphFile);
        if (!codeGraphRead.ok) {
          warnings.push({
            code: codeGraphRead.missing ? "code-graph-missing" : "code-graph-unreadable",
            subject: null,
            message: boundedText(`Code graph ${codeGraphRead.message}.`),
          });
        } else {
          const interpreted = interpretCodeGraphForNeighborhood(codeGraphRead.value);
          if (!interpreted.ok) {
            warnings.push({ code: "code-graph-unsupported", subject: null, message: boundedText(interpreted.message) });
          } else {
            graph = interpreted.value;
            warnings.push(...graph.warnings);
            codeGraphSummary = {
              path: normalizePath(path.relative(path.resolve(indexDir), codeGraphFile)),
              artifactKind: graph.artifactKind,
              schemaVersion: graph.schemaVersion,
            };
          }
        }
      }
    }

    const sorted = sortWarnings(warnings);
    return {
      schemaVersion: AFFECTED_NEIGHBORHOOD_GRAPH_EVIDENCE_SCHEMA_VERSION,
      status: sorted.length === 0 ? "complete" : "partial",
      unavailable: null,
      indexRoot,
      manifest: manifestSummary,
      symbolIndex: symbolIndexSummary,
      codeGraph: codeGraphSummary,
      indexedFilePaths: symbols.value.indexedFilePaths,
      symbolFiles: symbols.value.symbolFiles,
      nodes: graph?.nodes ?? new Map(),
      edges: graph?.edges ?? [],
      duplicateEdgeRecordCount: graph?.duplicateEdgeRecordCount ?? 0,
      warningCount: sorted.length,
      warnings: sorted.slice(0, MAX_WARNINGS),
      warningsTruncated: sorted.length > MAX_WARNINGS,
    };
  } catch (error) {
    return unavailableEvidence(
      indexRoot,
      "graph-evidence-load-failed",
      `Affected-neighborhood graph evidence load failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export type AffectedNeighborhoodNodeLookupV1 =
  | { ok: true; nodeId: string }
  | { ok: false; expectedNodeId: string; reason: "graph-node-missing" | "graph-node-kind-mismatch" };

function lookupNode(evidence: AffectedNeighborhoodGraphEvidenceV1, expectedNodeId: string, kind: string): AffectedNeighborhoodNodeLookupV1 {
  const node = evidence.nodes.get(expectedNodeId);
  if (!node) return { ok: false, expectedNodeId, reason: "graph-node-missing" };
  return node.kind === kind ? { ok: true, nodeId: node.id } : { ok: false, expectedNodeId, reason: "graph-node-kind-mismatch" };
}

/** Exact file-path lookup of the baseline file node. Never falls back to another path. */
export function lookupFileNode(evidence: AffectedNeighborhoodGraphEvidenceV1, filePath: string): AffectedNeighborhoodNodeLookupV1 {
  return lookupNode(evidence, fileNodeId(filePath), "file");
}

/** Same-file symbol lookup. Never searches for a same-named symbol in another file. */
export function lookupSymbolNode(evidence: AffectedNeighborhoodGraphEvidenceV1, filePath: string, symbolName: string): AffectedNeighborhoodNodeLookupV1 {
  return lookupNode(evidence, symbolNodeId(filePath, symbolName), "symbol");
}

export type AffectedNeighborhoodUnresolvedReason =
  | "not-in-index-snapshot"
  | "graph-unavailable"
  | "graph-node-missing"
  | "graph-node-kind-mismatch"
  | "symbol-index-record-missing";

export type AffectedNeighborhoodMappingStatus = "mapped" | "unresolved";

export type AffectedNeighborhoodChangedFileEntryV1 = {
  path: string;
  changeType: IndexFreshnessChangeType;
  expectedNodeId: string;
  resolvedNodeId: string | null;
  status: AffectedNeighborhoodMappingStatus;
  unresolvedReason: AffectedNeighborhoodUnresolvedReason | null;
};

export type AffectedNeighborhoodChangedSymbolEntryV1 = {
  path: string;
  name: string;
  expectedNodeId: string;
  resolvedNodeId: string | null;
  status: AffectedNeighborhoodMappingStatus;
  unresolvedReason: AffectedNeighborhoodUnresolvedReason | null;
};

export type AffectedNeighborhoodUnresolvedEntryV1 = {
  subject: "changed-file" | "changed-symbol" | "symbol-index-record";
  path: string;
  name: string | null;
  reason: AffectedNeighborhoodUnresolvedReason;
};

export type AffectedNeighborhoodSeedMappingWarningCode =
  | "freshness-unknown"
  | "freshness-partially-stale"
  | "freshness-changes-truncated"
  | "graph-evidence-incomplete"
  | "graph-evidence-unavailable"
  | "code-graph-not-loaded"
  | "symbol-index-unavailable"
  | "mapping-unresolved"
  | "duplicate-symbol-records";

export type AffectedNeighborhoodSeedMappingWarningV1 = {
  code: AffectedNeighborhoodSeedMappingWarningCode;
  path: string | null;
  message: string;
};

/**
 * Changed-node seeds derived from confirmed v0.6.0 freshness evidence and the baseline graph.
 * A changed symbol means "present in a confirmed changed indexed file", not "its own source text
 * changed". Counts are never truncated by the bounded `unresolved` and `warnings` lists; a count
 * is null when it cannot be established (never silently zero).
 */
export type AffectedNeighborhoodSeedMappingV1 = {
  schemaVersion: typeof AFFECTED_NEIGHBORHOOD_SEED_MAPPING_SCHEMA_VERSION;
  status: AffectedNeighborhoodEvidenceStatus;
  freshnessStatus: IndexFreshnessAssessmentV1["status"];
  graphEvidenceStatus: AffectedNeighborhoodEvidenceStatus;
  /** Unique confirmed modified/missing snapshot-represented files; null when freshness gives no basis. */
  changedFileCount: number | null;
  /** Unique baseline path+name identities of changed files; null when no symbol index evidence exists. */
  changedSymbolCount: number | null;
  mappedChangedFileNodeCount: number;
  mappedChangedSymbolNodeCount: number;
  seedNodeCount: number;
  /** True when freshness listed fewer confirmed changes than it counted, so entries are incomplete. */
  changesTruncated: boolean;
  changedFiles: AffectedNeighborhoodChangedFileEntryV1[];
  changedSymbols: AffectedNeighborhoodChangedSymbolEntryV1[];
  /** Unique, code-unit sorted graph node IDs of every resolved changed file and symbol. */
  seedNodeIds: string[];
  unresolvedCount: number;
  unresolved: AffectedNeighborhoodUnresolvedEntryV1[];
  unresolvedTruncated: boolean;
  warningCount: number;
  warnings: AffectedNeighborhoodSeedMappingWarningV1[];
  warningsTruncated: boolean;
};

/**
 * Maps confirmed changed indexed files, and the baseline symbols belonging to them, onto baseline
 * graph nodes. Pure and deterministic: consumes only the v0.6.0 snapshot and freshness assessment
 * plus the prepared index's graph evidence; never touches the filesystem, current source, or
 * my-dev-kit, and never falls back to fuzzy or cross-file matching.
 */
export function mapAffectedNeighborhoodSeeds(input: {
  indexSnapshot: IndexSnapshotV1;
  freshness: IndexFreshnessAssessmentV1;
  graph: AffectedNeighborhoodGraphEvidenceV1;
}): AffectedNeighborhoodSeedMappingV1 {
  const { indexSnapshot, freshness, graph } = input;
  const warnings: AffectedNeighborhoodSeedMappingWarningV1[] = [];
  const unresolved: AffectedNeighborhoodUnresolvedEntryV1[] = [];
  const warn = (code: AffectedNeighborhoodSeedMappingWarningCode, message: string, warnPath: string | null = null): void => {
    warnings.push({ code, path: warnPath === null ? null : boundedText(warnPath), message });
  };

  const snapshotPaths = new Set(indexSnapshot.files.map((file) => normalizePath(file.path)));
  const changesByPath = new Map<string, IndexFreshnessChangeType>();
  for (const change of freshness.changes) {
    const changePath = normalizePath(change.path);
    if (!snapshotPaths.has(changePath)) {
      unresolved.push({ subject: "changed-file", path: boundedText(changePath), name: null, reason: "not-in-index-snapshot" });
      continue;
    }
    // Duplicate change records collapse deterministically: a missing file outranks a modified one.
    const existing = changesByPath.get(changePath);
    if (existing === undefined || (existing === "modified" && change.changeType === "missing")) {
      changesByPath.set(changePath, change.changeType);
    }
  }
  const changedPaths = [...changesByPath.keys()].sort(compareCodeUnits);
  const totalConfirmed = freshness.changedFileCount + freshness.missingFileCount;
  const changesTruncated = freshness.changesTruncated;

  const freshnessGivesBasis = freshness.status !== "unknown" || changedPaths.length > 0;
  const changedFileCount = !freshnessGivesBasis ? null : changesTruncated ? Math.max(totalConfirmed, changedPaths.length) : changedPaths.length;
  const codeGraphLoaded = graph.codeGraph !== null && graph.status !== "unavailable";
  const symbolIndexAvailable = graph.status !== "unavailable";

  if (freshness.status === "unknown") warn("freshness-unknown", "Freshness is unknown; no changed-file basis exists.");
  if (freshness.status === "partially-stale") warn("freshness-partially-stale", "Freshness comparison is incomplete; confirmed changes are preserved but the mapping stays partial.");
  if (changesTruncated) warn("freshness-changes-truncated", `Freshness listed ${changedPaths.length} of ${totalConfirmed} confirmed changes; the remainder is not mapped.`);
  if (graph.status === "unavailable") warn("graph-evidence-unavailable", graph.unavailable?.message ?? "Graph evidence is unavailable.");
  else if (graph.status === "partial") warn("graph-evidence-incomplete", `Graph evidence is partial (${graph.warningCount} warning(s)).`);
  if (symbolIndexAvailable && !codeGraphLoaded) warn("code-graph-not-loaded", "The code graph could not be loaded, so no node mapping is possible.");

  const changedFiles: AffectedNeighborhoodChangedFileEntryV1[] = [];
  const changedSymbols: AffectedNeighborhoodChangedSymbolEntryV1[] = [];
  const seeds = new Set<string>();
  let mappedFileCount = 0;
  let mappedSymbolCount = 0;
  let symbolIdentityCount = 0;

  for (const filePath of changedPaths) {
    const changeType = changesByPath.get(filePath) as IndexFreshnessChangeType;
    const expectedNodeId = fileNodeId(filePath);
    let resolvedNodeId: string | null = null;
    let reason: AffectedNeighborhoodUnresolvedReason | null = null;
    if (!codeGraphLoaded) {
      reason = "graph-unavailable";
    } else {
      const lookup = lookupFileNode(graph, filePath);
      if (lookup.ok) resolvedNodeId = lookup.nodeId;
      else reason = lookup.reason;
    }
    if (resolvedNodeId !== null) {
      mappedFileCount += 1;
      seeds.add(resolvedNodeId);
    } else {
      unresolved.push({ subject: "changed-file", path: boundedText(filePath), name: null, reason: reason as AffectedNeighborhoodUnresolvedReason });
    }
    changedFiles.push({
      path: filePath,
      changeType,
      expectedNodeId,
      resolvedNodeId,
      status: resolvedNodeId === null ? "unresolved" : "mapped",
      unresolvedReason: reason,
    });

    if (!symbolIndexAvailable) continue;
    const record = graph.symbolFiles.get(filePath);
    if (!record) {
      unresolved.push({ subject: "symbol-index-record", path: boundedText(filePath), name: null, reason: "symbol-index-record-missing" });
      continue;
    }
    if (record.duplicateSymbolNames.length > 0) {
      warn(
        "duplicate-symbol-records",
        `Baseline symbol index lists ${record.duplicateSymbolNames.length} symbol name(s) more than once; each counts as one identity.`,
        filePath
      );
    }
    for (const name of record.symbolNames) {
      symbolIdentityCount += 1;
      const symbolExpectedId = symbolNodeId(filePath, name);
      let symbolResolvedId: string | null = null;
      let symbolReason: AffectedNeighborhoodUnresolvedReason | null = null;
      if (!codeGraphLoaded) {
        symbolReason = "graph-unavailable";
      } else {
        const lookup = lookupSymbolNode(graph, filePath, name);
        if (lookup.ok) symbolResolvedId = lookup.nodeId;
        else symbolReason = lookup.reason;
      }
      if (symbolResolvedId !== null) {
        mappedSymbolCount += 1;
        seeds.add(symbolResolvedId);
      } else {
        unresolved.push({ subject: "changed-symbol", path: boundedText(filePath), name: boundedText(name), reason: symbolReason as AffectedNeighborhoodUnresolvedReason });
      }
      changedSymbols.push({
        path: filePath,
        name,
        expectedNodeId: symbolExpectedId,
        resolvedNodeId: symbolResolvedId,
        status: symbolResolvedId === null ? "unresolved" : "mapped",
        unresolvedReason: symbolReason,
      });
    }
  }

  const symbolCountEstablished = symbolIndexAvailable && freshnessGivesBasis;
  const changedSymbolCount = symbolCountEstablished ? symbolIdentityCount : null;
  if (unresolved.length > 0) warn("mapping-unresolved", `${unresolved.length} changed-file or changed-symbol mapping(s) could not be resolved.`);

  unresolved.sort(
    (left, right) =>
      compareCodeUnits(left.path, right.path) ||
      compareCodeUnits(left.name ?? "", right.name ?? "") ||
      compareCodeUnits(left.subject, right.subject) ||
      compareCodeUnits(left.reason, right.reason)
  );
  warnings.sort((left, right) => compareCodeUnits(left.code, right.code) || compareCodeUnits(left.path ?? "", right.path ?? "") || compareCodeUnits(left.message, right.message));

  let status: AffectedNeighborhoodEvidenceStatus;
  if (!freshnessGivesBasis || !codeGraphLoaded) {
    status = "unavailable";
  } else if (
    (freshness.status === "fresh" || freshness.status === "stale") &&
    graph.status === "complete" &&
    !changesTruncated &&
    unresolved.length === 0
  ) {
    status = "complete";
  } else {
    status = "partial";
  }

  const seedNodeIds = [...seeds].sort(compareCodeUnits);
  return {
    schemaVersion: AFFECTED_NEIGHBORHOOD_SEED_MAPPING_SCHEMA_VERSION,
    status,
    freshnessStatus: freshness.status,
    graphEvidenceStatus: graph.status,
    changedFileCount,
    changedSymbolCount,
    mappedChangedFileNodeCount: mappedFileCount,
    mappedChangedSymbolNodeCount: mappedSymbolCount,
    seedNodeCount: seedNodeIds.length,
    changesTruncated,
    changedFiles,
    changedSymbols,
    seedNodeIds,
    unresolvedCount: unresolved.length,
    unresolved: unresolved.slice(0, MAX_UNRESOLVED),
    unresolvedTruncated: unresolved.length > MAX_UNRESOLVED,
    warningCount: warnings.length,
    warnings: warnings.slice(0, MAX_WARNINGS),
    warningsTruncated: warnings.length > MAX_WARNINGS,
  };
}
