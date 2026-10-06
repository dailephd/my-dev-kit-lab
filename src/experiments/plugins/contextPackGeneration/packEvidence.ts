/**
 * Pure interpretation of already-captured my-dev-kit JSON output (search, lookup, slice, source) and of the validated
 * symbol index. No I/O, no process execution. Anything not matching the expected shape is reported as malformed rather
 * than guessed.
 */
import { interpretSymbolIndexFiles } from "../../../evaluation/indexSnapshot.js";
import type { IndexedSourceFileSymbols } from "./identityEvidence.js";
import { MAX_SOURCE_LINES_PER_SLICE } from "./packSelectionPolicy.js";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const asString = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const asLine = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null);

function parseJson(stdout: string): unknown | undefined {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

export type ParsedNode = { id: string; kind: string; path: string | null; symbolName: string | null; line: number | null };
export type ParsedEdge = { source: string; target: string; kind: string };

export type SearchHit = { rank: number; kind: string; nodeId: string; path: string | null; label: string | null };

export type Parsed<T> = { ok: true; value: T } | { ok: false };

function parseNode(value: unknown): ParsedNode | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const kind = asString(value.kind);
  if (id === null || kind === null) return null;
  return { id, kind, path: asString(value.path), symbolName: asString(value.symbolName) ?? asString(value.label), line: asLine(value.line) };
}

function parseEdges(value: unknown): ParsedEdge[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const edges: ParsedEdge[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const source = asString(entry.source);
    const target = asString(entry.target);
    const kind = asString(entry.kind);
    if (source === null || target === null || kind === null) return null;
    edges.push({ source, target, kind });
  }
  return edges;
}

/** Preserves upstream order: rank is the 1-based position in `results`. Only file and symbol hits carry a seed node. */
export function parseSearchHits(stdout: string, limit: number): Parsed<SearchHit[]> {
  const payload = parseJson(stdout);
  if (!isRecord(payload) || !Array.isArray(payload.results)) return { ok: false };
  const hits: SearchHit[] = [];
  for (const [index, entry] of payload.results.slice(0, limit).entries()) {
    if (!isRecord(entry)) return { ok: false };
    const kind = asString(entry.kind);
    const nodeId = asString(entry.nodeId) ?? asString(entry.id);
    if (kind === null) return { ok: false };
    if ((kind !== "file" && kind !== "symbol") || nodeId === null) continue;
    hits.push({ rank: index + 1, kind, nodeId, path: asString(entry.path), label: asString(entry.label) });
  }
  return { ok: true, value: hits };
}

export function parseLookup(stdout: string): Parsed<{ node: ParsedNode }> {
  const payload = parseJson(stdout);
  if (!isRecord(payload)) return { ok: false };
  const node = parseNode(payload.node);
  return node === null ? { ok: false } : { ok: true, value: { node } };
}

export function parseSlice(stdout: string): Parsed<{ nodes: ParsedNode[]; edges: ParsedEdge[] }> {
  const payload = parseJson(stdout);
  if (!isRecord(payload) || !Array.isArray(payload.nodes)) return { ok: false };
  const nodes: ParsedNode[] = [];
  for (const entry of payload.nodes) {
    const node = parseNode(entry);
    if (node === null) return { ok: false };
    nodes.push(node);
  }
  const edges = parseEdges(payload.edges);
  return edges === null ? { ok: false } : { ok: true, value: { nodes, edges } };
}

export type ParsedSource = {
  startLine: number;
  endLine: number;
  content: string;
  eof: boolean;
  /** False only when upstream reports the symbol end as unknown. */
  boundaryKnown: boolean;
};

export function parseSource(stdout: string): Parsed<ParsedSource> {
  const payload = parseJson(stdout);
  if (!isRecord(payload) || payload.status !== "ok" || typeof payload.content !== "string") return { ok: false };
  const startLine = asLine(payload.startLine);
  const endLine = asLine(payload.endLine);
  if (startLine === null || endLine === null || endLine < startLine) return { ok: false };
  const cursor = isRecord(payload.continuationCursor) ? payload.continuationCursor : null;
  return {
    ok: true,
    value: {
      startLine,
      endLine,
      content: payload.content,
      eof: cursor?.eof === true,
      boundaryKnown: !(cursor !== null && (cursor.symbolBoundaryKnown === false || cursor.reason === "symbol-end-unknown"))
    }
  };
}

/** Validated view of the my-dev-kit symbol index needed for raw/pack symbol evidence and source ranges. */
export type ValidatedSymbolIndex = {
  files: IndexedSourceFileSymbols[];
  lineCountByFile: Map<string, number>;
};

/** Returns null when the symbol-index contract cannot be interpreted; symbol evidence is then unavailable. */
export function interpretSymbolIndex(symbolIndex: unknown): ValidatedSymbolIndex | null {
  if (!interpretSymbolIndexFiles(symbolIndex, null).ok) return null;
  const files: IndexedSourceFileSymbols[] = [];
  const lineCountByFile = new Map<string, number>();
  for (const entry of (symbolIndex as { files: unknown[] }).files) {
    if (!isRecord(entry) || typeof entry.path !== "string" || !Array.isArray(entry.symbols)) return null;
    const symbols: { name: string; location: { line: number } }[] = [];
    for (const symbol of entry.symbols) {
      if (!isRecord(symbol) || typeof symbol.name !== "string" || !isRecord(symbol.location)) return null;
      const line = asLine(symbol.location.line);
      if (line === null) return null;
      symbols.push({ name: symbol.name, location: { line } });
    }
    files.push({ path: entry.path, symbols });
    if (typeof entry.lineCount === "number" && Number.isInteger(entry.lineCount) && entry.lineCount >= 1) lineCountByFile.set(entry.path, entry.lineCount);
  }
  return { files, lineCountByFile };
}

export type SymbolSourceRange = { startLine: number; endLine: number; naturalEndLine: number; capped: boolean };

/**
 * Index-derived bounded range for a symbol: it starts at the definition line and ends one line before the next indexed
 * symbol of the same file (or at the file end), then is capped at MAX_SOURCE_LINES_PER_SLICE lines. Returns null when the
 * index cannot establish a reliable boundary, in which case the caller falls back to bounded source by node.
 */
export function deriveSymbolSourceRange(index: ValidatedSymbolIndex, file: string, startLine: number): SymbolSourceRange | null {
  const entry = index.files.find((candidate) => candidate.path === file);
  if (!entry || !entry.symbols.some((symbol) => symbol.location.line === startLine)) return null;
  const next = entry.symbols.map((symbol) => symbol.location.line).filter((line) => line > startLine).sort((a, b) => a - b)[0];
  const fileEnd = index.lineCountByFile.get(file);
  const naturalEndLine = next !== undefined ? next - 1 : fileEnd;
  if (naturalEndLine === undefined || naturalEndLine < startLine) return null;
  const endLine = Math.min(naturalEndLine, startLine + MAX_SOURCE_LINES_PER_SLICE - 1);
  return { startLine, endLine, naturalEndLine, capped: naturalEndLine > endLine };
}

/** Finds a symbol definition line in the index by file and exact name (first definition in line order). */
export function findIndexedSymbolLine(index: ValidatedSymbolIndex, file: string, name: string): number | null {
  const entry = index.files.find((candidate) => candidate.path === file);
  const lines = entry?.symbols.filter((symbol) => symbol.name === name).map((symbol) => symbol.location.line).sort((a, b) => a - b);
  return lines && lines.length > 0 ? lines[0] : null;
}
