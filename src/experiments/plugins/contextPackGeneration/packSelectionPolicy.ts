import { compareCodeUnits } from "../../../evaluation/indexSnapshot.js";
import { normalizeRetrievedRepositoryPath } from "../../../evaluation/retrievalQuality/buildRetrievalEvidence.js";
import type {
  ContextPackCallRelationship,
  ContextPackEvidenceNoteCode,
  ContextPackFile,
  ContextPackProvenance,
  ContextPackProvenanceCommand,
  ContextPackSelectionPolicy,
  ContextPackSourceSlice,
  ContextPackSymbol,
  ContextPackTest,
  ContextPackTestOrigin
} from "./types.js";

/** Frozen v0.8.2 selection policy. These are experimental constants, never user configuration; do not tune them. */
export const CONTEXT_PACK_SELECTION_POLICY_ID = "bounded-multiseed-v1";
export const SEARCH_RESULT_LIMIT = 12;
export const MAX_SEED_NODES = 8;
export const GRAPH_DEPTH = 1;
export const MAX_FILES = 12;
export const MAX_SYMBOLS = 16;
export const MAX_SOURCE_SLICES = 8;
export const MAX_SOURCE_LINES_PER_SLICE = 160;
export const MAX_TOTAL_SOURCE_LINES = 1280;
export const MAX_TEST_FILES = 8;
export const MAX_CALL_RELATIONSHIPS = 32;

export function buildContextPackSelectionPolicy(myDevKitVersion: string): ContextPackSelectionPolicy {
  return {
    id: CONTEXT_PACK_SELECTION_POLICY_ID,
    searchResultLimit: SEARCH_RESULT_LIMIT,
    maxSeedNodes: MAX_SEED_NODES,
    graphDepth: GRAPH_DEPTH,
    maxFiles: MAX_FILES,
    maxSymbols: MAX_SYMBOLS,
    maxSourceSlices: MAX_SOURCE_SLICES,
    maxSourceLinesPerSlice: MAX_SOURCE_LINES_PER_SLICE,
    maxTotalSourceLines: MAX_TOTAL_SOURCE_LINES,
    maxTestFiles: MAX_TEST_FILES,
    maxCallRelationships: MAX_CALL_RELATIONSHIPS,
    myDevKitVersion
  };
}

/** Evidence origin in stable candidate priority order: direct search, then lookup, then depth-1 graph evidence. */
export type ContextPackEvidenceOrigin = "search" | "lookup" | "graph";

const ORIGIN_PRIORITY: Record<ContextPackEvidenceOrigin, number> = { search: 0, lookup: 1, graph: 2 };
const ORIGIN_COMMAND: Record<ContextPackEvidenceOrigin, ContextPackProvenanceCommand> = {
  search: "search",
  lookup: "lookup",
  graph: "slice"
};
const FILE_REASON: Record<ContextPackEvidenceOrigin, ContextPackFile["reason"]> = {
  search: "search-candidate",
  lookup: "lookup-evidence",
  graph: "graph-neighbor"
};

export type ContextPackFileCandidate = { path: string; origin: ContextPackEvidenceOrigin; rank: number };

export type ContextPackSymbolCandidate = {
  name: string;
  nodeId: string | null;
  file: string | null;
  line?: number | null;
  origin: ContextPackEvidenceOrigin;
  rank: number;
};

export type ContextPackSeedCandidate = { nodeId: string; origin: ContextPackEvidenceOrigin; rank: number };

export type ContextPackCallCandidate = { fromNodeId: string; toNodeId: string; kind: string };

export type ContextPackTestCandidate = { path: string; origin: ContextPackTestOrigin; rank?: number | null };

/** Already-captured source evidence. `rank` is the upstream rank of the seed the slice came from. */
export type ContextPackSourceSliceCandidate = {
  file: string;
  nodeId?: string | null;
  symbolName?: string | null;
  startLine: number;
  endLine: number;
  text: string;
  boundaryKnown: boolean;
  truncated?: boolean;
  continuationAvailable?: boolean;
  rank: number;
};

export type Selection<T> = { items: T[]; notes: ContextPackEvidenceNoteCode[] };

const compareNullableRank = (left: number | null, right: number | null): number =>
  left === right ? 0 : left === null ? 1 : right === null ? -1 : left - right;

const compareNullableText = (left: string | null, right: string | null): number => compareCodeUnits(left ?? "", right ?? "");

const provenanceOf = (origin: ContextPackEvidenceOrigin, nodeId: string | null, rank: number | null): ContextPackProvenance => ({
  command: ORIGIN_COMMAND[origin],
  nodeId,
  rank
});

function mergeProvenance(entries: readonly ContextPackProvenance[]): ContextPackProvenance[] {
  const unique = new Map<string, ContextPackProvenance>();
  for (const entry of entries) unique.set(`${entry.command}\0${entry.nodeId ?? ""}\0${entry.rank ?? ""}`, entry);
  return [...unique.values()].sort(
    (a, b) => compareCodeUnits(a.command, b.command) || compareNullableText(a.nodeId, b.nodeId) || compareNullableRank(a.rank, b.rank)
  );
}

function uniqueSortedNotes(notes: Iterable<ContextPackEvidenceNoteCode>): ContextPackEvidenceNoteCode[] {
  return [...new Set(notes)].sort(compareCodeUnits);
}

/** Pure repository test-file classification: tests/, test/, __tests__/ directories and *.test.* / *.spec.* files. */
export function isTestFilePath(path: string): boolean {
  const segments = path.split("/");
  const directories = segments.slice(0, -1);
  if (directories.some((segment) => segment === "tests" || segment === "test" || segment === "__tests__")) return true;
  return /\.(test|spec)\.[^/.]+$/.test(segments[segments.length - 1] ?? "");
}

/** Direct search evidence, then lookup, then depth-1 graph; lower rank first; code-unit ties. Deduplicated before the cap. */
export function selectSeedNodes(candidates: readonly ContextPackSeedCandidate[]): Selection<ContextPackSeedCandidate> {
  const best = new Map<string, ContextPackSeedCandidate>();
  for (const candidate of candidates) {
    const current = best.get(candidate.nodeId);
    if (!current || compareSeeds(candidate, current) < 0) best.set(candidate.nodeId, { ...candidate });
  }
  const ordered = [...best.values()].sort(compareSeeds);
  const items = ordered.slice(0, MAX_SEED_NODES);
  return { items, notes: ordered.length > MAX_SEED_NODES ? ["seed-cap-reached"] : [] };
}

function compareSeeds(a: ContextPackSeedCandidate, b: ContextPackSeedCandidate): number {
  return ORIGIN_PRIORITY[a.origin] - ORIGIN_PRIORITY[b.origin] || a.rank - b.rank || compareCodeUnits(a.nodeId, b.nodeId);
}

export function selectRelevantFiles(candidates: readonly ContextPackFileCandidate[]): Selection<ContextPackFile> {
  const notes: ContextPackEvidenceNoteCode[] = [];
  const byPath = new Map<string, { best: ContextPackFileCandidate; provenance: ContextPackProvenance[] }>();
  for (const candidate of candidates) {
    const path = normalizeRetrievedRepositoryPath(candidate.path);
    if (path === null) {
      notes.push("invalid-repository-path-ignored");
      continue;
    }
    const entry = byPath.get(path);
    const provenance = provenanceOf(candidate.origin, null, candidate.rank);
    const normalized = { ...candidate, path };
    if (!entry) byPath.set(path, { best: normalized, provenance: [provenance] });
    else {
      entry.provenance.push(provenance);
      if (compareEvidence(normalized, entry.best) < 0) entry.best = normalized;
    }
  }
  const ordered = [...byPath.values()].sort((a, b) => compareEvidence(a.best, b.best) || compareCodeUnits(a.best.path, b.best.path));
  if (ordered.length > MAX_FILES) notes.push("file-cap-reached");
  return {
    items: ordered.slice(0, MAX_FILES).map(({ best, provenance }) => ({
      path: best.path,
      rank: best.rank,
      reason: isTestFilePath(best.path) ? "test-candidate" : FILE_REASON[best.origin],
      provenance: mergeProvenance(provenance)
    })),
    notes: uniqueSortedNotes(notes)
  };
}

function compareEvidence(a: { origin: ContextPackEvidenceOrigin; rank: number }, b: { origin: ContextPackEvidenceOrigin; rank: number }): number {
  return ORIGIN_PRIORITY[a.origin] - ORIGIN_PRIORITY[b.origin] || a.rank - b.rank;
}

export function selectRelevantSymbols(candidates: readonly ContextPackSymbolCandidate[]): Selection<ContextPackSymbol> {
  const notes: ContextPackEvidenceNoteCode[] = [];
  const byKey = new Map<string, { best: ContextPackSymbolCandidate & { file: string | null }; provenance: ContextPackProvenance[] }>();
  for (const candidate of candidates) {
    let file: string | null = null;
    if (candidate.file !== null) {
      file = normalizeRetrievedRepositoryPath(candidate.file);
      if (file === null) {
        notes.push("invalid-repository-path-ignored");
        continue;
      }
    }
    const key = candidate.nodeId !== null ? `n\0${candidate.nodeId}` : `f\0${file ?? ""}\0${candidate.name}`;
    const normalized = { ...candidate, file };
    const provenance = provenanceOf(candidate.origin, candidate.nodeId, candidate.rank);
    const entry = byKey.get(key);
    if (!entry) byKey.set(key, { best: normalized, provenance: [provenance] });
    else {
      entry.provenance.push(provenance);
      if (compareEvidence(normalized, entry.best) < 0) entry.best = normalized;
    }
  }
  const ordered = [...byKey.values()].sort(
    (a, b) =>
      compareEvidence(a.best, b.best) ||
      compareNullableText(a.best.file, b.best.file) ||
      compareCodeUnits(a.best.name, b.best.name) ||
      compareNullableText(a.best.nodeId, b.best.nodeId)
  );
  if (ordered.length > MAX_SYMBOLS) notes.push("symbol-cap-reached");
  return {
    items: ordered.slice(0, MAX_SYMBOLS).map(({ best, provenance }) => ({
      name: best.name,
      nodeId: best.nodeId,
      file: best.file,
      rank: best.rank,
      line: best.line ?? null,
      provenance: mergeProvenance(provenance)
    })),
    notes: uniqueSortedNotes(notes)
  };
}

/** Only `calls` edges qualify; `defines`, `exports` and every other kind are ignored. Canonical order: from, then to. */
export function selectCallRelationships(candidates: readonly ContextPackCallCandidate[]): Selection<ContextPackCallRelationship> {
  const unique = new Map<string, ContextPackCallRelationship>();
  for (const candidate of candidates) {
    if (candidate.kind !== "calls") continue;
    unique.set(`${candidate.fromNodeId}\0${candidate.toNodeId}`, {
      fromNodeId: candidate.fromNodeId,
      toNodeId: candidate.toNodeId,
      kind: "calls",
      provenance: [{ command: "slice", nodeId: candidate.fromNodeId, rank: null }]
    });
  }
  const ordered = [...unique.values()].sort((a, b) => compareCodeUnits(a.fromNodeId, b.fromNodeId) || compareCodeUnits(a.toNodeId, b.toNodeId));
  return {
    items: ordered.slice(0, MAX_CALL_RELATIONSHIPS),
    notes: ordered.length > MAX_CALL_RELATIONSHIPS ? ["call-relationship-cap-reached"] : []
  };
}

const TEST_ORIGIN_PRIORITY: Record<ContextPackTestOrigin, number> = { "search-candidate": 0, "graph-neighbor": 1 };

/** Descriptive test evidence only; non-test paths are ignored. No coverage score exists. */
export function selectTestFiles(candidates: readonly ContextPackTestCandidate[]): Selection<ContextPackTest> {
  const notes: ContextPackEvidenceNoteCode[] = [];
  const byPath = new Map<string, { best: { path: string; origin: ContextPackTestOrigin; rank: number | null }; provenance: ContextPackProvenance[] }>();
  const compare = (a: { origin: ContextPackTestOrigin; rank: number | null }, b: { origin: ContextPackTestOrigin; rank: number | null }) =>
    TEST_ORIGIN_PRIORITY[a.origin] - TEST_ORIGIN_PRIORITY[b.origin] || compareNullableRank(a.rank, b.rank);
  for (const candidate of candidates) {
    const path = normalizeRetrievedRepositoryPath(candidate.path);
    if (path === null) {
      notes.push("invalid-repository-path-ignored");
      continue;
    }
    if (!isTestFilePath(path)) continue;
    const rank = candidate.rank ?? null;
    const provenance: ContextPackProvenance = { command: candidate.origin === "search-candidate" ? "search" : "slice", nodeId: null, rank };
    const normalized = { path, origin: candidate.origin, rank };
    const entry = byPath.get(path);
    if (!entry) byPath.set(path, { best: normalized, provenance: [provenance] });
    else {
      entry.provenance.push(provenance);
      if (compare(normalized, entry.best) < 0) entry.best = normalized;
    }
  }
  const ordered = [...byPath.values()].sort((a, b) => compare(a.best, b.best) || compareCodeUnits(a.best.path, b.best.path));
  if (ordered.length > MAX_TEST_FILES) notes.push("test-file-cap-reached");
  return {
    items: ordered.slice(0, MAX_TEST_FILES).map(({ best, provenance }) => ({
      path: best.path,
      rank: best.rank,
      how: best.origin,
      provenance: mergeProvenance(provenance)
    })),
    notes: uniqueSortedNotes(notes)
  };
}

const normalizeLineEndings = (text: string): string => text.replace(/\r\n?/g, "\n");

function splitLines(text: string): string[] {
  const normalized = normalizeLineEndings(text);
  if (normalized.length === 0) return [];
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export type SourceSliceLimits = { maxSourceSlices: number; maxSourceLinesPerSlice: number; maxTotalSourceLines: number };

const FROZEN_SOURCE_SLICE_LIMITS: SourceSliceLimits = {
  maxSourceSlices: MAX_SOURCE_SLICES,
  maxSourceLinesPerSlice: MAX_SOURCE_LINES_PER_SLICE,
  maxTotalSourceLines: MAX_TOTAL_SOURCE_LINES
};

/**
 * Applies the source caps to already-captured slices; performs no source command and no continuation.
 * Slices are consumed in (rank, file, startLine, endLine, nodeId) order. A slice longer than the per-slice cap keeps its
 * first lines. The total cap truncates the slice that crosses it and drops every later slice; earlier slices are never
 * reordered. The returned slices are in canonical render order: file, startLine, endLine, nodeId.
 */
export function selectSourceSlices(
  candidates: readonly ContextPackSourceSliceCandidate[],
  /** Test seam only: with the frozen constants the slice-count cap (8 x 160 = 1280) is reached before the total cap can be crossed. */
  limits: SourceSliceLimits = FROZEN_SOURCE_SLICE_LIMITS
): Selection<ContextPackSourceSlice> {
  const notes: ContextPackEvidenceNoteCode[] = [];
  type Prepared = ContextPackSourceSliceCandidate & { file: string; nodeId: string | null; lines: string[] };
  const prepared: Prepared[] = [];
  for (const candidate of candidates) {
    const file = normalizeRetrievedRepositoryPath(candidate.file);
    if (file === null) {
      notes.push("invalid-repository-path-ignored");
      continue;
    }
    const lines = splitLines(candidate.text);
    if (!Number.isInteger(candidate.startLine) || candidate.startLine < 1 || lines.length === 0) {
      notes.push("invalid-source-slice-ignored");
      continue;
    }
    prepared.push({ ...candidate, file, nodeId: candidate.nodeId ?? null, lines });
  }
  const byRange = (a: Prepared, b: Prepared): number =>
    compareCodeUnits(a.file, b.file) || a.startLine - b.startLine || a.lines.length - b.lines.length || compareNullableText(a.nodeId, b.nodeId);
  prepared.sort((a, b) => a.rank - b.rank || byRange(a, b));

  const selected: ContextPackSourceSlice[] = [];
  const seen = new Set<string>();
  let usedLines = 0;
  for (const candidate of prepared) {
    const key = `${candidate.file}\0${candidate.startLine}\0${candidate.lines.length}\0${candidate.nodeId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (selected.length >= limits.maxSourceSlices) {
      notes.push("source-slice-count-cap-reached");
      break;
    }
    if (usedLines >= limits.maxTotalSourceLines) {
      notes.push("total-source-line-cap-reached");
      break;
    }
    let keep = candidate.lines.length;
    let truncated = candidate.truncated === true;
    if (keep > limits.maxSourceLinesPerSlice) {
      keep = limits.maxSourceLinesPerSlice;
      truncated = true;
      notes.push("source-slice-cap-reached");
    }
    if (usedLines + keep > limits.maxTotalSourceLines) {
      keep = limits.maxTotalSourceLines - usedLines;
      truncated = true;
      notes.push("total-source-line-cap-reached");
    }
    usedLines += keep;
    if (!candidate.boundaryKnown) notes.push("symbol-end-unknown");
    selected.push({
      file: candidate.file,
      nodeId: candidate.nodeId,
      symbolName: candidate.symbolName ?? null,
      startLine: candidate.startLine,
      endLine: candidate.startLine + keep - 1,
      lineCount: keep,
      text: candidate.lines.slice(0, keep).join("\n"),
      boundaryKnown: candidate.boundaryKnown,
      truncated,
      continuationAvailable: candidate.continuationAvailable === true,
      provenance: [{ command: "source", nodeId: candidate.nodeId, rank: candidate.rank }]
    });
  }
  selected.sort(
    (a, b) => compareCodeUnits(a.file, b.file) || a.startLine - b.startLine || a.endLine - b.endLine || compareNullableText(a.nodeId, b.nodeId)
  );
  return { items: selected, notes: uniqueSortedNotes(notes) };
}
