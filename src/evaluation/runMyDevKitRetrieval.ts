import path from "node:path";
import { realpath } from "node:fs/promises";
import { resolveWithinRoot } from "../core/pathSafety.js";
import { captureIndexSnapshot, readJson, resolveIndexedFilePath } from "./indexSnapshot.js";
import { loadAffectedNeighborhoodGraphEvidence, type AffectedNeighborhoodGraphEvidenceV1 } from "./affectedNeighborhood.js";
import { countEstimatedTokens, countTextChars, tokenCountMethod } from "../core/countTokens.js";
import { runMeasuredCommand, type MeasuredCommandResult } from "../core/runMeasuredCommand.js";
import { interpretToolVersionOutput, type IndexSnapshotToolV1 } from "./indexSnapshot.js";
import { buildRetrievalEvidenceFromCommands, normalizeRetrievedRepositoryPath } from "./retrievalQuality/buildRetrievalEvidence.js";
import type { CoreGraphRetrievalQueryStrategyId } from "./retrievalQueryStrategies.js";
import { buildQueryStrategyEvidenceFromRetrievalEvidence } from "./retrievalQueryStrategyEvidence.js";
import type {
  EvaluationCase,
  MyDevKitAppliedRefreshScope,
  MyDevKitIncrementalRefreshEvidence,
  MyDevKitIndexBuildMode,
  MyDevKitIndexBuildResult,
  MyDevKitIndexTarget,
  MyDevKitRefreshScope,
  MyDevKitRefreshSelectionStatus,
  MyDevKitRetrievalResult
} from "./types.js";

const VERSION_PROBE_TIMEOUT_MS = 30_000;

function parseJsonIfPossible(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readSearchResults(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  for (const key of ["results", "matches", "items", "data"]) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
    }
  }
  return [];
}

function pickCandidateFields(candidate: Record<string, unknown>): { nodeId?: string; file?: string; symbol?: string } {
  const readString = (...keys: string[]) => {
    for (const key of keys) {
      if (typeof candidate[key] === "string" && candidate[key]) {
        return candidate[key] as string;
      }
    }
    return undefined;
  };
  return {
    nodeId: readString("nodeId", "id", "node", "symbolId"),
    file: readString("file", "path", "filePath"),
    symbol: readString("symbol", "name", "label")
  };
}

function skippedRetrieval(
  caseId: string,
  warnings: string[],
  commands: MeasuredCommandResult[],
  durationMs: number
): MyDevKitRetrievalResult {
  return {
    caseId,
    skipped: true,
    warnings,
    totalChars: 0,
    totalEstimatedTokens: 0,
    tokenCountMethod,
    contextText: "",
    filesRead: [],
    commands,
    retrievalEvidence: buildRetrievalEvidenceFromCommands(commands),
    durationMs
  };
}

const APPLIED_SCOPES: readonly MyDevKitAppliedRefreshScope[] = ["none", "changed-files", "affected-neighborhood", "full"];
const SELECTION_STATUSES: readonly MyDevKitRefreshSelectionStatus[] = ["not-needed", "applied", "fallback-full"];
const NEIGHBORHOOD_COUNT_KEYS = ["seedFileCount", "seedSymbolCount", "affectedNodeCount", "affectedEdgeCount"] as const;

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Validates the per-invocation `incrementalRefresh` object from `my-dev-kit index --incremental --json`
 * stdout against the scope Lab requested. Returns validated evidence or an explicit error; never coerces.
 * The fallback reason is intentionally an open string: upstream reason codes may evolve additively.
 */
export function parseIncrementalRefreshEvidence(
  stdout: string,
  requestedScope: MyDevKitRefreshScope
): { ok: true; evidence: MyDevKitIncrementalRefreshEvidence } | { ok: false; error: string } {
  const payload = parseJsonIfPossible(stdout);
  if (payload === undefined) return { ok: false, error: "index stdout is not valid JSON" };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "index JSON result is not an object" };
  }
  const raw = (payload as Record<string, unknown>).incrementalRefresh;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "index JSON result has no incrementalRefresh object" };
  }
  const r = raw as Record<string, unknown>;

  if (r.requestedScope !== requestedScope) {
    return {
      ok: false,
      error: `incrementalRefresh.requestedScope ${JSON.stringify(r.requestedScope)} does not match requested scope ${requestedScope}`
    };
  }
  if (!APPLIED_SCOPES.includes(r.appliedScope as MyDevKitAppliedRefreshScope)) {
    return { ok: false, error: `incrementalRefresh.appliedScope ${JSON.stringify(r.appliedScope)} is not a known value` };
  }
  if (!SELECTION_STATUSES.includes(r.selectionStatus as MyDevKitRefreshSelectionStatus)) {
    return { ok: false, error: `incrementalRefresh.selectionStatus ${JSON.stringify(r.selectionStatus)} is not a known value` };
  }
  if (r.fallbackReason !== null && typeof r.fallbackReason !== "string") {
    return { ok: false, error: "incrementalRefresh.fallbackReason must be a string or null" };
  }
  for (const key of NEIGHBORHOOD_COUNT_KEYS) {
    if (r[key] !== null && !isNonNegativeInteger(r[key])) {
      return { ok: false, error: `incrementalRefresh.${key} must be a non-negative integer or null` };
    }
  }
  for (const key of ["forcedNeighborReanalysisFileCount", "freshExtractionFileCount", "reusedFileCount"] as const) {
    if (!isNonNegativeInteger(r[key])) {
      return { ok: false, error: `incrementalRefresh.${key} must be a non-negative integer` };
    }
  }
  if (!Array.isArray(r.forcedNeighborSample) || r.forcedNeighborSample.some((item) => typeof item !== "string")) {
    return { ok: false, error: "incrementalRefresh.forcedNeighborSample must be an array of strings" };
  }

  const appliedScope = r.appliedScope as MyDevKitAppliedRefreshScope;
  const selectionStatus = r.selectionStatus as MyDevKitRefreshSelectionStatus;
  const fallbackReason = r.fallbackReason as string | null;
  if (selectionStatus === "applied") {
    if (appliedScope !== requestedScope) {
      return { ok: false, error: "incrementalRefresh applied status requires appliedScope equal to requestedScope" };
    }
    if (fallbackReason !== null) return { ok: false, error: "incrementalRefresh applied status requires a null fallbackReason" };
  } else if (selectionStatus === "fallback-full") {
    if (appliedScope !== "full") return { ok: false, error: "incrementalRefresh fallback-full status requires appliedScope full" };
    if (fallbackReason === null || fallbackReason.length === 0) {
      return { ok: false, error: "incrementalRefresh fallback-full status requires a nonempty fallbackReason" };
    }
  } else {
    if (appliedScope !== "none") return { ok: false, error: "incrementalRefresh not-needed status requires appliedScope none" };
    if (fallbackReason !== null) return { ok: false, error: "incrementalRefresh not-needed status requires a null fallbackReason" };
  }
  if (requestedScope === "affected-neighborhood" && selectionStatus === "applied") {
    for (const key of NEIGHBORHOOD_COUNT_KEYS) {
      if (r[key] === null) {
        return { ok: false, error: `incrementalRefresh.${key} must be numeric for an applied affected-neighborhood refresh` };
      }
    }
  }

  return {
    ok: true,
    evidence: {
      requestedScope,
      appliedScope,
      selectionStatus,
      fallbackReason,
      seedFileCount: r.seedFileCount as number | null,
      seedSymbolCount: r.seedSymbolCount as number | null,
      affectedNodeCount: r.affectedNodeCount as number | null,
      affectedEdgeCount: r.affectedEdgeCount as number | null,
      forcedNeighborReanalysisFileCount: r.forcedNeighborReanalysisFileCount as number,
      forcedNeighborSample: [...(r.forcedNeighborSample as string[])],
      freshExtractionFileCount: r.freshExtractionFileCount as number,
      reusedFileCount: r.reusedFileCount as number
    }
  };
}

/**
 * Runs exactly one my-dev-kit `index` command for the target and writes the index only to
 * `indexDir`. Performs no search/lookup/slice/source work. With `requireKit` a failed index
 * throws; otherwise the failure is returned as `ok: false` with a warning.
 *
 * `mode` defaults to a full index. An incremental mode adds `--incremental --refresh-scope <scope>`
 * and requires valid per-invocation `incrementalRefresh` JSON evidence on stdout; a successful
 * process without that evidence is not a usable incremental build. Upstream full-fallback and
 * no-change outcomes are valid evidence and are returned as-is.
 */
export async function buildMyDevKitIndex(options: {
  target: MyDevKitIndexTarget;
  kitCommand: string;
  indexDir: string;
  commandsDir: string;
  requireKit: boolean;
  mode?: MyDevKitIndexBuildMode;
  /**
   * Exact repository-relative file or directory paths passed as repeated `--exclude` arguments. Absent or empty
   * adds no argument. Callers must pass paths, never bare names, because a bare name excludes every directory of
   * that name.
   */
  excludePaths?: readonly string[];
  /**
   * Adds `--call-graph` so the index carries `calls` edges (upstream emits them only for call-graph indexes). Absent or
   * false keeps the exact legacy command; only `true` changes it. Applies to the index command only.
   */
  callGraph?: boolean;
}): Promise<MyDevKitIndexBuildResult> {
  const warnings: string[] = [];
  const mode: MyDevKitIndexBuildMode = options.mode ?? { kind: "full" };
  const command = await runMeasuredCommand({
    commandId: "index",
    commandString: options.kitCommand,
    cwd: process.cwd(),
    outDir: options.commandsDir,
    extraArgs: [
      "index",
      "--root",
      options.target.absoluteTargetRoot,
      ...options.target.sourceRoots.flatMap((sourceRoot) => ["--src", sourceRoot]),
      ...(options.excludePaths ?? []).flatMap((excludePath) => ["--exclude", excludePath]),
      "--out",
      options.indexDir,
      ...(options.callGraph === true ? ["--call-graph"] : []),
      ...(mode.kind === "incremental" ? ["--incremental", "--refresh-scope", mode.refreshScope] : []),
      "--json"
    ]
  });
  const result = { indexDir: options.indexDir, durationMs: command.durationMs, command, mode };

  if (!command.ok) {
    if (options.requireKit) {
      throw new Error(command.error || `my-dev-kit index failed with exit code ${command.exitCode}`);
    }
    warnings.push("my-dev-kit index command was unavailable or failed.");
    return { ...result, ok: false, warnings, incrementalRefresh: null };
  }

  if (mode.kind === "full") {
    return { ...result, ok: true, warnings, incrementalRefresh: null };
  }

  const parsed = parseIncrementalRefreshEvidence(command.stdout, mode.refreshScope);
  if (!parsed.ok) {
    const message = `my-dev-kit incremental index (${mode.refreshScope}) returned no valid incrementalRefresh evidence: ${parsed.error}`;
    if (options.requireKit) throw new Error(message);
    warnings.push(message);
    return { ...result, ok: false, warnings, incrementalRefresh: null };
  }
  return { ...result, ok: true, warnings, incrementalRefresh: parsed.evidence };
}

/**
 * Runs `<kit-command> --version` once through the shared measured-command runner and returns
 * bounded tool evidence. Kept separate from `buildMyDevKitIndex` so it never counts toward index
 * duration. An unsupported, failing, slow, or empty probe is explicit `unavailable` evidence; it
 * never throws and never fails the caller.
 */
export async function probeMyDevKitVersion(options: { kitCommand: string; commandsDir: string }): Promise<IndexSnapshotToolV1> {
  try {
    const command = await runMeasuredCommand({
      commandId: "version",
      commandString: options.kitCommand,
      cwd: process.cwd(),
      outDir: options.commandsDir,
      extraArgs: ["--version"],
      timeoutMs: VERSION_PROBE_TIMEOUT_MS
    });
    return interpretToolVersionOutput({
      ok: command.ok,
      exitCode: command.exitCode,
      stdout: command.stdout,
      error: command.error
    });
  } catch (error) {
    return interpretToolVersionOutput({
      ok: false,
      exitCode: null,
      stdout: "",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function selectRetrievalStrategyContextText(
  strategyId: CoreGraphRetrievalQueryStrategyId,
  outputs: { search: string; lookup: string; slice: string; source: string }
): string {
  const ordered: string[] =
    strategyId === "keyword-search"
      ? [outputs.search]
      : strategyId === "symbol-lookup"
        ? [outputs.lookup, outputs.search]
        : strategyId === "graph-neighborhood"
          ? [outputs.slice, outputs.search]
          : strategyId === "source-slice"
            ? [outputs.source, outputs.search]
            : [outputs.source, outputs.slice, outputs.lookup, outputs.search];
  return ordered.find((text) => text && text.trim().length > 0) ?? "";
}

/**
 * Opt-in bounded multi-source protocol. The default retrieval expands only the first search candidate and
 * its `filesRead` names that selected file. When a caller supplies these options, the SAME search result is
 * additionally expanded, in rank order, into at most `maxSourceFiles` distinct candidate files, each with one
 * bounded `source` command. Candidates come only from the actual search output; no answer key participates.
 */
export type MyDevKitBoundedSourceOptions = {
  /** Fixed budget of distinct candidate files that receive a `source` command. */
  maxSourceFiles: number;
  /** Explicit `--limit` passed to the one `search` command; a result count at this limit means truncation. */
  searchLimit: number;
  /** Private opt-in source-region protocol; historical callers retain their existing lifecycle. */
  enrichment?: {
    headerEligibleFilePrefix: number;
    headerMaxEndLine: number;
    maxDependencyDepth: number;
    maxDependencySourceCalls: number;
    maxSourceLinesPerCall: number;
  };
};

export const BOUNDED_SOURCE_PROTOCOL_ID = "bounded-multi-source-v1";
export const DEFAULT_BOUNDED_SOURCE_OPTIONS: MyDevKitBoundedSourceOptions = { maxSourceFiles: 8, searchLimit: 40 };

export type MyDevKitBoundedSourceCandidate = { file: string; nodeId: string };
export type MyDevKitBoundedSourceAttempt = MyDevKitBoundedSourceCandidate & {
  /** True only when the `source` command for this candidate exited successfully. */
  sourced: boolean;
};

export type MyDevKitBoundedCoverageV1 = {
  protocol: typeof BOUNDED_SOURCE_PROTOCOL_ID;
  maxSourceFiles: number;
  searchLimit: number;
  searchResultCount: number;
  /** True when the search returned as many results as the explicit limit allowed, so more may exist. */
  searchTruncated: boolean;
  /** Distinct safe candidate files found in the search results (before the budget was applied). */
  eligibleCandidateFileCount: number;
  /** True when more distinct candidate files existed than the budget allowed to be sourced. */
  candidateBudgetExhausted: boolean;
  /** File/symbol results dropped because their file identity was unsafe or they carried no node id. */
  rejectedCandidateCount: number;
  /** One entry per planned candidate in rank order; `sourced` reflects the actual command outcome. */
  attempts: MyDevKitBoundedSourceAttempt[];
};

export type MyDevKitBoundedRetrievalResult = MyDevKitRetrievalResult & { boundedCoverage: MyDevKitBoundedCoverageV1 };

export function isBoundedRetrievalResult(result: MyDevKitRetrievalResult): result is MyDevKitBoundedRetrievalResult {
  return (result as { boundedCoverage?: { protocol?: unknown } }).boundedCoverage?.protocol === BOUNDED_SOURCE_PROTOCOL_ID;
}

type SourceInterval = { startLine: number; endLine: number };
type SourceRegion = {
  file: string;
  command: MeasuredCommandResult;
  lines: Map<number, string>;
  rows: Map<number, string>;
  intervals: SourceInterval[];
  valid: boolean;
  complete: boolean;
  eof: number | null;
};
/** Runtime authority supplied by the prepared-index owner, independent of the canonical task. */
type ActiveRetrievalIndexAuthority = { indexDir: string; targetRoot: string; sourceRoots: readonly string[] };
type SourceRequest = {
  status: "EXECUTED" | "REUSED_EXACT_REQUEST" | "SATISFIED_BY_COVERED_SOURCE" | "FAILED" | "INCOMPLETE";
  executed: boolean;
  file: string;
  interval: SourceInterval | null;
  provenance: readonly MeasuredCommandResult[];
};
type SourceCompleteness = {
  regions: SourceRegion[];
  issues: Map<string, string[]>;
  dependencies: Map<string, Set<string>>;
  requirements: Map<string, SourceInterval[]>;
  trusted: Map<string, Map<number, { text: string; provenance: Set<MeasuredCommandResult> }>>;
  conflicts: Set<string>;
  requests: SourceRequest[];
};
// Runtime-only: neither source bodies nor a new completeness schema enter execution artifacts.
const sourceCompleteness = new WeakMap<MyDevKitBoundedCoverageV1, SourceCompleteness>();

function numberedRegion(file: string, command: MeasuredCommandResult): SourceRegion {
  const lines = new Map<number, string>();
  const rows = new Map<number, string>();
  const intervals: SourceInterval[] = [];
  let valid = command.ok && !command.outputLimit && !command.timedOut;
  let previous = 0;
  let markerSeen = false;
  let continued = false;
  let eof: number | null = null;
  for (const row of command.stdout.split(/\r?\n/)) {
    const match = /^[ \t]*([1-9]\d*) \|(?: (.*))?$/.exec(row);
    if (match) {
      const line = Number(match[1]);
      if (!Number.isSafeInteger(line) || line <= previous || markerSeen) valid = false;
      if (lines.has(line) && lines.get(line) !== (match[2] ?? "")) valid = false;
      lines.set(line, match[2] ?? "");
      rows.set(line, row);
      if (line === previous + 1 && intervals.length) intervals.at(-1)!.endLine = line;
      else intervals.push({ startLine: line, endLine: line });
      previous = line;
      continue;
    }
    const continuation = /^\[CONTINUE: (.+) from line ([1-9]\d*) \(reason: [^\r\n]+\)\]$/.exec(row);
    const end = /^\[EOF: (.+) \(([1-9]\d*) lines total\)\]$/.exec(row);
    if (continuation || end) {
      const marker = (continuation ?? end)!;
      const boundary = Number(marker[2]);
      if (markerSeen || marker[1] !== file || !Number.isSafeInteger(boundary) ||
          (continuation ? boundary <= previous : boundary < previous)) valid = false;
      markerSeen = true;
      continued = continuation !== null;
      eof = end ? boundary : null;
      continue;
    }
    // These are metadata, never source lines. Unknown nonempty output is ambiguous.
    if (row === "" || /^(?:Warnings?:|Info:|Source:|File:|Index dir:)/.test(row)) continue;
    valid = false;
  }
  const option = (flag: string) => command.args.includes(flag) ? command.args[command.args.indexOf(flag) + 1] : undefined;
  const start = Number(option("--start"));
  const end = Number(option("--end"));
  const explicitRange = Number.isSafeInteger(start) && start > 0 && Number.isSafeInteger(end) && end >= start;
  if (explicitRange && [...lines.keys()].some((line) => line < start || line > end)) valid = false;
  const complete = valid && lines.size > 0 && (explicitRange
    ? coversSourceInterval(lines, start, eof === null ? end : Math.min(end, eof))
    : intervals.length === 1 && !continued && (eof === null || coversSourceInterval(lines, intervals[0]!.startLine, eof)));
  return { file, command, lines, rows, intervals, valid, complete, eof };
}

function coversSourceInterval(lines: ReadonlyMap<number, unknown>, start: number, end: number): boolean {
  if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end) || end < start || lines.size < end - start + 1) return false;
  for (let line = start; line <= end; line++) if (!lines.has(line)) return false;
  return true;
}

function mergedSource(state: SourceCompleteness, file: string): Map<number, string> {
  return state.conflicts.has(file) ? new Map() : new Map(
    [...(state.trusted.get(file) ?? [])].sort(([left], [right]) => left - right).map(([line, witness]) => [line, witness.text])
  );
}

/** Post-retrieval structural sufficiency gate. No answer text or assertion is used to retrieve source. */
export function boundedSourceContentIssue(result: MyDevKitBoundedRetrievalResult, requiredFiles: readonly string[]): string | null {
  const state = sourceCompleteness.get(result.boundedCoverage);
  if (!state) return null; // Historical results retain their historical interpretation.
  for (const raw of requiredFiles) {
    const file = normalizeRetrievedRepositoryPath(raw);
    if (!file) return "Required source identity is unsafe.";
    const visited = new Set<string>();
    const inspect = (current: string): string | null => {
      if (visited.has(current)) return null;
      visited.add(current);
      const issues = state.issues.get(current);
      if (issues?.length) return `${current}: ${issues.join(" ")}`;
      const lines = mergedSource(state, current);
      if (!lines.size) return `${current}: no verified complete source region.`;
      for (const interval of state.requirements.get(current) ?? []) {
        if (!coversSourceInterval(lines, interval.startLine, interval.endLine)) {
          return `${current}: incomplete source interval [${interval.startLine},${interval.endLine}].`;
        }
      }
      const text = [...lines.entries()].sort(([a], [b]) => a - b).map(([, value]) => value).join("\n");
      // A named parameter default needs its declaration, independently of the function signature.
      for (const match of text.matchAll(/\b\w+\s*=\s*([A-Z][A-Z_0-9]+)\b/g)) {
        const declaration = new RegExp(`(?:^|\\n)(?:export\\s+)?(?:const\\s+)?${match[1]}\\s*(?::[^=\\n]+)?=\\s*[-+]?\\d+(?:\\.\\d+)?\\b`);
        if (!declaration.test(text)) return `${current}: named default ${match[1]} has no retrieved numeric declaration.`;
      }
      // TypeScript import absence requires the uninterrupted leading region, not just a function body.
      if (/\.[cm]?[jt]sx?$/.test(current)) {
        const end = Math.max(...lines.keys());
        for (let line = 1; line <= end; line++) if (!lines.has(line)) return `${current}: incomplete leading import region (line ${line}).`;
      }
      for (const dependency of state.dependencies.get(current) ?? []) {
        const issue = inspect(dependency);
        if (issue) return issue;
      }
      return null;
    };
    const issue = inspect(file);
    if (issue) return issue;
  }
  return null;
}

async function enrichBoundedSources(args: {
  originalQuery: string;
  bounded: MyDevKitBoundedSourceOptions;
  coverage: MyDevKitBoundedCoverageV1;
  commands: MeasuredCommandResult[];
  extraSourceTexts: string[];
  warnings: string[];
  activeIndex: ActiveRetrievalIndexAuthority;
  graph: AffectedNeighborhoodGraphEvidenceV1;
  indexDir: string;
  commandsDir: string;
  kitCommand: string;
}): Promise<void> {
  const config = args.bounded.enrichment!;
  if (Object.values(config).some((value) => !Number.isInteger(value) || value < 0) || config.maxSourceLinesPerCall < 1) {
    throw new Error("Source enrichment budgets must be nonnegative integers with a positive line cap.");
  }
  const state: SourceCompleteness = {
    regions: [], issues: new Map(), dependencies: new Map(), requirements: new Map(),
    trusted: new Map(), conflicts: new Set(), requests: []
  };
  sourceCompleteness.set(args.coverage, state);
  const issue = (file: string, message: string) => {
    if (state.issues.get(file)?.includes(message)) return;
    state.issues.set(file, [...(state.issues.get(file) ?? []), message]);
    args.warnings.push(`${file}: ${message}`);
  };
  const { graph, activeIndex } = args;
  const indexIdentity = await realpath(args.indexDir).catch(() => path.resolve(args.indexDir));
  const targetIdentity = await realpath(activeIndex.targetRoot).catch(() => path.resolve(activeIndex.targetRoot));
  const lineCap = Math.min(160, config.maxSourceLinesPerCall);
  const headerCap = Math.min(24, config.headerMaxEndLine);
  const indexed = new Set(graph.indexedFilePaths);
  const safe = async (file: string): Promise<boolean> => {
    if (!indexed.has(file) || !resolveIndexedFilePath(activeIndex.targetRoot, activeIndex.sourceRoots, file).ok) return false;
    try {
      const root = await realpath(activeIndex.targetRoot);
      const physical = await realpath(resolveWithinRoot(root, file));
      resolveWithinRoot(root, physical);
      return activeIndex.sourceRoots.some((sourceRoot) => {
        try { resolveWithinRoot(resolveWithinRoot(root, sourceRoot), physical); return true; } catch { return false; }
      });
    } catch { return false; }
  };
  const completed = new Map<string, SourceRegion>();
  const identity = (file: string, selector: string, start: number | null, end: number | null, maxLines = 160) =>
    JSON.stringify([indexIdentity, targetIdentity, activeIndex.sourceRoots, file, selector, start, end, maxLines, "numbered"]);

  // The existing validated artifact reader supplies selector bounds, never source observations.
  // Only the actual command output can add a line to trusted coverage.
  const spans = new Map<string, SourceInterval>();
  const ambiguousSpans = new Set<string>();
  const object = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  try {
    if (!graph.symbolIndex) throw new Error("No verified symbol index");
    const symbolPath = await realpath(resolveWithinRoot(indexIdentity, graph.symbolIndex.path));
    resolveWithinRoot(indexIdentity, symbolPath);
    const read = await readJson(symbolPath);
    if (!read.ok) throw new Error("Symbol index unreadable");
    const files = object(read.value)?.files;
    if (!Array.isArray(files)) throw new Error("Symbol file list unavailable");
    for (const entry of files) {
      const fileRecord = object(entry);
      const file = typeof fileRecord?.path === "string" ? normalizeRetrievedRepositoryPath(fileRecord.path) : null;
      if (!file || !indexed.has(file) || !Array.isArray(fileRecord?.symbols)) continue;
      for (const raw of fileRecord.symbols) {
        const symbol = object(raw);
        const location = object(symbol?.location);
        const nodeId: unknown = graph.symbolIndex.schemaVersion === "3" ? symbol?.nodeId
          : typeof symbol?.name === "string" ? `symbol:${file}#${symbol.name}` : null;
        if (typeof nodeId !== "string" || graph.nodes.get(nodeId)?.path !== file ||
            location?.file !== file || !Number.isSafeInteger(location.line) || !Number.isSafeInteger(location.endLine) ||
            (location.line as number) < 1 || (location.endLine as number) < (location.line as number)) continue;
        const span = { startLine: location.line as number, endLine: location.endLine as number };
        const previous = spans.get(nodeId);
        if (previous && (previous.startLine !== span.startLine || previous.endLine !== span.endLine)) ambiguousSpans.add(nodeId);
        else spans.set(nodeId, span);
      }
    }
    for (const nodeId of ambiguousSpans) spans.delete(nodeId);
  } catch {
    for (const attempt of args.coverage.attempts) issue(attempt.file, "Indexed source interval metadata is unavailable or unsafe.");
  }
  const requireInterval = (file: string, startLine: number, endLine: number) => {
    const requirements = state.requirements.get(file) ?? [];
    if (!requirements.some((entry) => entry.startLine === startLine && entry.endLine === endLine)) {
      requirements.push({ startLine, endLine }); state.requirements.set(file, requirements);
    }
  };
  const provenance = (file: string, interval: SourceInterval): MeasuredCommandResult[] => {
    const commands = new Set<MeasuredCommandResult>();
    for (const [line, witness] of state.trusted.get(file) ?? []) {
      if (line >= interval.startLine && line <= interval.endLine) for (const command of witness.provenance) commands.add(command);
    }
    return [...commands].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  };
  const covered = (file: string, interval: SourceInterval) =>
    coversSourceInterval(mergedSource(state, file), interval.startLine, interval.endLine);
  const reused = (status: "REUSED_EXACT_REQUEST" | "SATISFIED_BY_COVERED_SOURCE", file: string,
    interval: SourceInterval | null, original: readonly MeasuredCommandResult[]) => {
    state.requests.push({ status, executed: false, file, interval, provenance: original });
  };
  const register = (file: string, command: MeasuredCommandResult, appendContext: boolean, span?: SourceInterval): SourceRegion => {
    const region = numberedRegion(file, command);
    const indexArgument = command.args[command.args.indexOf("--index") + 1];
    if (!indexArgument || path.relative(path.resolve(args.indexDir), path.resolve(indexArgument)) !== "") region.valid = false;
    if (span) {
      requireInterval(file, span.startLine, span.endLine);
      if ([...region.lines.keys()].some((line) => line < span.startLine || line > span.endLine)) region.valid = false;
      region.complete = region.valid && region.complete && coversSourceInterval(region.lines, span.startLine, span.endLine);
    }
    region.complete = region.complete && region.valid;
    state.regions.push(region);
    if (!region.valid) issue(file, "Source command failed or returned ambiguous/inconsistent numbered source.");
    const freshRows: string[] = [];
    if (region.valid) {
      const lines = state.trusted.get(file) ?? new Map<number, { text: string; provenance: Set<MeasuredCommandResult> }>();
      for (const [line, text] of region.lines) {
        const prior = lines.get(line);
        if (prior && prior.text !== text) {
          state.conflicts.add(file); issue(file, `Conflicting source content at line ${line}.`);
        } else if (prior) prior.provenance.add(command);
        else { lines.set(line, { text, provenance: new Set([command]) }); freshRows.push(region.rows.get(line)!); }
      }
      state.trusted.set(file, lines);
    }
    if (appendContext && freshRows.length && !state.conflicts.has(file)) {
      args.extraSourceTexts.push(`Source evidence ${file} (${command.commandId}):\n${freshRows.join("\n")}`);
    }
    state.requests.push({ status: !command.ok ? "FAILED" : region.complete && region.valid ? "EXECUTED" : "INCOMPLETE",
      executed: true, file, interval: span ?? (region.intervals.length === 1 ? region.intervals[0]! : null), provenance: [command] });
    return region;
  };
  for (const attempt of args.coverage.attempts) {
    const command = args.commands.find((entry) => entry.args.includes("source") && entry.args[entry.args.indexOf("--node") + 1] === attempt.nodeId);
    const node = graph.nodes.get(attempt.nodeId);
    if (!command || node?.path !== attempt.file || !(await safe(attempt.file))) {
      issue(attempt.file, "Source identity is not verified against this index and project roots.");
      continue;
    }
    const region = register(attempt.file, command, false, spans.get(attempt.nodeId));
    completed.set(identity(attempt.file, attempt.nodeId, null, null), region);
    if (!region.complete) issue(attempt.file, "Source command failed, was empty, or returned an incomplete numbered region.");
  }
  let extraCalls = 0;
  let dependencyCalls = 0;
  const request = async (file: string, start: number, end: number, dependency: boolean): Promise<void> => {
    if (end < start) return;
    const required = { startLine: start, endLine: end };
    requireInterval(file, start, end);
    if (covered(file, required)) { reused("SATISFIED_BY_COVERED_SOURCE", file, required, provenance(file, required)); return; }
    if (state.conflicts.has(file)) return;
    const existing = mergedSource(state, file);
    for (let line = start; line <= end; line++) {
      if (existing.has(line)) continue;
      const begin = line;
      while (line < end && !existing.has(line + 1)) line++;
      let selectedEnd = line;
      // The frozen renderer drops a terminal empty row. An already observed nonempty
      // adjacent row is a rendering anchor, never invented content or a larger header cap.
      for (let anchor = selectedEnd + 1; anchor <= headerCap && existing.has(anchor); anchor++) {
        if (existing.get(anchor)!.length) { selectedEnd = anchor; break; }
      }
      const key = identity(file, "file", begin, selectedEnd, lineCap);
      const prior = completed.get(key);
      if (prior) { reused("REUSED_EXACT_REQUEST", file, required, [prior.command]); continue; }
      if (dependency && dependencyCalls >= Math.min(8, config.maxDependencySourceCalls)) {
        state.requests.push({ status: "INCOMPLETE", executed: false, file, interval: required, provenance: [] });
        issue(file, "Dependency source-call cap reached."); return;
      }
      if (!(await safe(file)) || !graph.nodes.has(`file:${file}`)) { issue(file, "Unsafe or unverified dependency target."); return; }
      if (dependency) dependencyCalls++;
      const command = await runMeasuredCommand({
        commandId: `source-${dependency ? "dependency" : "header"}-${++extraCalls}`,
        commandString: args.kitCommand, cwd: process.cwd(), outDir: args.commandsDir,
        extraArgs: ["source", "--index", args.indexDir, "--file", file, "--start", String(begin), "--end", String(selectedEnd),
          "--max-lines", String(lineCap), "--format", "numbered"]
      });
      args.commands.push(command);
      completed.set(key, register(file, command, true));
    }
  };
  for (const attempt of args.coverage.attempts.slice(0, Math.min(8, config.headerEligibleFilePrefix))) {
    const region = state.regions.find((entry) => entry.file === attempt.file && entry.complete);
    if (!region) continue;
    const first = Math.min(...region.lines.keys());
    if (first > 1) {
      const end = Math.min(24, config.headerMaxEndLine, first - 1);
      await request(attempt.file, 1, end, false);
      if (end < first - 1) issue(attempt.file, `Header cap leaves lines ${end + 1}-${first - 1} uncovered.`);
    }
  }
  const nodeSource = async (file: string, nodeId: string): Promise<number | null> => {
    if (ambiguousSpans.has(nodeId)) { issue(file, "Indexed source interval is ambiguous."); return null; }
    const span = spans.get(nodeId);
    if (span) requireInterval(file, span.startLine, span.endLine);
    const key = identity(file, nodeId, null, null, lineCap);
    const prior = completed.get(key);
    if (prior?.complete && !state.conflicts.has(file)) {
      reused("REUSED_EXACT_REQUEST", file, span ?? prior.intervals[0] ?? null, [prior.command]);
      return span?.startLine ?? Math.min(...prior.lines.keys());
    }
    const wholeFile = state.regions.find((region) => region.file === file && region.valid && region.eof !== null &&
      covered(file, { startLine: 1, endLine: region.eof }));
    const satisfied = span && covered(file, span) ? span : wholeFile ? { startLine: 1, endLine: wholeFile.eof! } : null;
    if (satisfied) {
      reused("SATISFIED_BY_COVERED_SOURCE", file, satisfied, provenance(file, satisfied));
      return span?.startLine ?? 1;
    }
    if (prior) { reused("REUSED_EXACT_REQUEST", file, span ?? null, [prior.command]); return null; }
    if (state.conflicts.has(file)) return null;
    if (dependencyCalls >= Math.min(8, config.maxDependencySourceCalls)) {
      state.requests.push({ status: "INCOMPLETE", executed: false, file, interval: span ?? null, provenance: [] });
      issue(file, "Dependency source-call cap reached."); return null;
    }
    dependencyCalls++;
    const command = await runMeasuredCommand({
      commandId: `source-dependency-${++extraCalls}`, commandString: args.kitCommand,
      cwd: process.cwd(), outDir: args.commandsDir,
      extraArgs: ["source", "--index", args.indexDir, "--node", nodeId, "--max-lines", String(lineCap), "--format", "numbered"]
    });
    args.commands.push(command);
    const region = register(file, command, true, span);
    completed.set(key, region);
    if (!region.complete && !span) issue(file, "Dependency source failed or was incomplete.");
    return region.complete ? span?.startLine ?? Math.min(...region.lines.keys()) : null;
  };
  type Import = { line: number; name: string; module: string };
  const imports = (file: string): Import[] => {
    const found: Import[] = [];
    for (const [line, text] of mergedSource(state, file)) {
      const python = /^from\s+([.\w]+)\s+import\s+(.+)$/.exec(text);
      const js = /^\s*import\s+(.+?)\s+from\s+["']([^"']+)["']/.exec(text);
      if (python) {
        for (const name of python[2]!.split(",").map((name) => name.trim())) {
          if (/^\w+(?:\s+as\s+\w+)?$/.test(name)) found.push({ line, name, module: python[1]! });
          else issue(file, "Unresolved multiline or wildcard import.");
        }
      } else if (js) {
        const clause = js[1]!.replace(/^type\s+/, "");
        const names = clause.startsWith("{") && clause.endsWith("}") ? clause.slice(1, -1).split(",") : [clause];
        for (const name of names.map((value) => value.trim()).filter(Boolean)) found.push({ line, name, module: js[2]! });
      }
    }
    return found.sort((a, b) => a.line - b.line || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  };
  const visited = new Set<string>();
  // Only explicit source paths in the original query can establish test intent.
  // Normalize the entire token before matching: never salvage a safe suffix from
  // an absolute, traversing, or otherwise unsafe path, or guess from a symbol.
  const queryPaths = new Set<string>();
  for (const match of args.originalQuery.matchAll(/[^\s"'`<>(){}\[\],;!?]+/g)) {
    const token = match[0].replace(/:\d+(?:-\d+)?$/, "");
    if (!/\.(?:py|[cm]?[jt]sx?)$/.test(token)) continue;
    const file = normalizeRetrievedRepositoryPath(token);
    if (file) queryPaths.add(file);
  }
  const queue: { file: string; depth: number }[] = [];
  for (const entry of args.coverage.attempts) {
    if (!/(?:^|\/)tests?\/|(?:^|\/)test_[^/]+\.py$|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry.file)) continue;
    const observed = state.regions.some((region) => region.file === entry.file && region.valid && region.complete &&
      region.command.args[region.command.args.indexOf("--node") + 1] === entry.nodeId);
    if (!queryPaths.has(entry.file)) {
      // This is uncertainty about test-derived facts only. Incidental tests do
      // not create dependency obligations for independently sourced API facts.
      issue(entry.file, "Test dependency semantics lack an explicit query source-path anchor.");
      continue;
    }
    if (entry.sourced && observed && graph.nodes.get(entry.nodeId)?.path === entry.file && await safe(entry.file)) {
      queue.push({ file: entry.file, depth: 0 });
    }
  }
  for (let next = 0; next < queue.length; next++) {
    const { file, depth } = queue[next]!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const imported of imports(file)) {
      let paths: string[] = [];
      if (file.endsWith(".py")) {
        if (imported.module.startsWith(".")) {
          const match = /^(\.+)([\w.]*)$/.exec(imported.module)!;
          const base = path.posix.join(path.posix.dirname(file), ...Array.from({ length: match[1]!.length - 1 }, () => ".."), match[2]!.replace(/\./g, "/"));
          paths = [`${base}.py`, `${base}/__init__.py`];
        } else {
          const modulePath = imported.module.replace(/\./g, "/");
          const first = imported.module.split(".")[0];
          paths = activeIndex.sourceRoots.flatMap((root) => {
            const base = path.posix.basename(root) === first ? path.posix.dirname(root) : root;
            return [`${base}/${modulePath}.py`, `${base}/${modulePath}/__init__.py`];
          });
        }
      } else if (imported.module.startsWith(".")) {
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), imported.module));
        const stem = base.replace(/\.[cm]?js$/, "");
        paths = [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}/index.ts`, `${stem}/index.js`];
      } else {
        args.warnings.push(`${file}: external or ungrounded alias import ${imported.module}; no dependency expansion.`); continue;
      }
      const matches = [...new Set(paths.filter((candidate) => indexed.has(candidate)))].sort();
      if (matches.length !== 1) {
        // A Python module outside the indexed project is never expanded as a guessed local target.
        const localNamespace = activeIndex.sourceRoots.some((root) => path.posix.basename(root) === imported.module.split(".")[0] || graph.indexedFilePaths.some((entry) => entry.startsWith(`${root}/${imported.module.split(".")[0]}/`)));
        if (matches.length > 1 || imported.module.startsWith(".") || localNamespace) issue(file, `Unresolved or ambiguous import ${imported.module}.`);
        else args.warnings.push(`${file}: external import ${imported.module}; no dependency expansion.`);
        continue;
      }
      const target = matches[0]!;
      if (!(await safe(target))) { issue(file, `Dependency ${target} is outside approved project roots.`); continue; }
      if (depth >= Math.min(2, config.maxDependencyDepth)) {
        if (!visited.has(target)) issue(file, `Dependency depth cap leaves ${target} unresolved.`);
        continue;
      }
      const name = imported.name.replace(/\s+as\s+\w+$/, "").trim();
      const symbolFile = graph.symbolFiles.get(target);
      const identities = symbolFile?.records ?? (graph.symbolIndex?.schemaVersion === "2"
        ? symbolFile?.symbolNames.map((symbol) => ({ name: symbol, nodeId: `symbol:${target}#${symbol}` })) : []);
      const records = identities?.filter((record) => record.name === name && record.nodeId !== null) ?? [];
      if (records.length !== 1 || graph.nodes.get(records[0]!.nodeId!)?.path !== target) {
        issue(file, `Import ${imported.name} has no unique indexed symbol in ${target}.`); continue;
      }
      const links = state.dependencies.get(file) ?? new Set<string>();
      links.add(target); state.dependencies.set(file, links);
      const nodeId = records[0]!.nodeId!;
      const first = await nodeSource(target, nodeId);
      if (first !== null && first > 1) {
        const end = Math.min(headerCap, first - 1);
        await request(target, 1, end, true);
        if (end < first - 1) issue(target, `Dependency header cap leaves lines ${end + 1}-${first - 1} uncovered.`);
      }
      if (!visited.has(target)) queue.push({ file: target, depth: depth + 1 });
    }
  }
  args.warnings.push(`Source request ledger ${JSON.stringify({
    executed: state.requests.filter((entry) => entry.executed).length,
    exactReused: state.requests.filter((entry) => entry.status === "REUSED_EXACT_REQUEST").length,
    covered: state.requests.filter((entry) => entry.status === "SATISFIED_BY_COVERED_SOURCE").length,
    failed: state.requests.filter((entry) => entry.status === "FAILED").length,
    incomplete: state.requests.filter((entry) => entry.status === "INCOMPLETE").length
  })}`);
}

/**
 * Pure, deterministic candidate plan over search results. Only `file`/`symbol` entries (or legacy entries that
 * carry no `kind`) with a node id and a safe repository-relative path are eligible; edges and other kinds are
 * ignored. The first occurrence of each normalized file wins, rank order is preserved, and the plan is cut at
 * `maxSourceFiles`. Never inspects an answer key.
 */
export function planBoundedSourceCandidates(
  results: readonly Record<string, unknown>[],
  maxSourceFiles: number
): { candidates: MyDevKitBoundedSourceCandidate[]; eligibleFileCount: number; rejectedCount: number } {
  const budget = Number.isInteger(maxSourceFiles) && maxSourceFiles > 0 ? maxSourceFiles : 0;
  const seen = new Set<string>();
  const eligible: MyDevKitBoundedSourceCandidate[] = [];
  let rejectedCount = 0;
  for (const entry of results) {
    const kind = entry.kind;
    if (kind !== undefined && kind !== "file" && kind !== "symbol") continue;
    const fields = pickCandidateFields(entry);
    const file = normalizeRetrievedRepositoryPath(fields.file);
    if (file === null || fields.nodeId === undefined) {
      rejectedCount += 1;
      continue;
    }
    if (seen.has(file)) continue;
    seen.add(file);
    eligible.push({ file, nodeId: fields.nodeId });
  }
  return { candidates: eligible.slice(0, budget), eligibleFileCount: eligible.length, rejectedCount };
}

const STRATEGY_DOWNSTREAM_COMMANDS:Record<CoreGraphRetrievalQueryStrategyId, readonly ("lookup" | "slice" | "source")[]> = {
  "keyword-search": [],
  "symbol-lookup": ["lookup"],
  "graph-neighborhood": ["slice"],
  "source-slice": ["source"],
  "combined-graph-guided": ["lookup", "slice", "source"]
};

/**
 * Executes exactly one core retrieval query strategy against an already prepared index. Every
 * strategy starts with `search` and expands at most the first candidate. Never invokes `index`;
 * `durationMs` covers retrieval only.
 */
export async function runMyDevKitRetrievalStrategyFromIndex(options: {
  strategyId: CoreGraphRetrievalQueryStrategyId;
  evaluationCase: EvaluationCase;
  kitCommand: string;
  indexDir: string;
  commandsDir: string;
  requireKit: boolean;
  /** Opt-in only; omitted keeps the historical first-candidate-only behavior unchanged. */
  boundedSource?: MyDevKitBoundedSourceOptions;
  /** Required for enrichment; never inferred from the task or manifest. */
  activeIndex?: ActiveRetrievalIndexAuthority;
}): Promise<MyDevKitRetrievalResult> {
  const started = Date.now();
  const warnings: string[] = [];
  const commands: MeasuredCommandResult[] = [];
  const { commandsDir, indexDir } = options;

  const searchCommand = await runMeasuredCommand({
    commandId: "search",
    commandString: options.kitCommand,
    cwd: process.cwd(),
    outDir: commandsDir,
    extraArgs: [
      "search",
      "--index",
      indexDir,
      "--query",
      options.evaluationCase.query,
      ...(options.boundedSource ? ["--limit", String(options.boundedSource.searchLimit)] : []),
      "--json"
    ]
  });
  commands.push(searchCommand);
  if (!searchCommand.ok) {
    if (options.requireKit) {
      throw new Error(searchCommand.error || `my-dev-kit search failed with exit code ${searchCommand.exitCode}`);
    }
    warnings.push("my-dev-kit search command failed.");
    return skippedRetrieval(options.evaluationCase.id, warnings, commands, Date.now() - started);
  }

  const searchPayload = parseJsonIfPossible(searchCommand.stdout);
  let sourceGraph: AffectedNeighborhoodGraphEvidenceV1 | undefined;
  if (options.boundedSource?.enrichment) {
    const authority = options.activeIndex;
    if (!authority || path.relative(path.resolve(indexDir), path.resolve(authority.indexDir)) !== "") {
      throw new Error("Source enrichment requires the independently selected active index identity.");
    }
    const snapshot = await captureIndexSnapshot({
      indexDir, targetRoot: authority.targetRoot, sourceRoots: authority.sourceRoots, command: searchCommand
    });
    sourceGraph = await loadAffectedNeighborhoodGraphEvidence({ indexDir, sourceRoots: authority.sourceRoots, indexSnapshot: snapshot });
    if (snapshot.status === "unavailable" || sourceGraph.status === "unavailable") {
      throw new Error(`Source enrichment index identity rejected: ${snapshot.unavailable?.code ?? sourceGraph.unavailable?.code}: ${snapshot.unavailable?.message ?? sourceGraph.unavailable?.message}`);
    }
  }
  const candidates = readSearchResults(searchPayload);
  const planned = options.boundedSource ? planBoundedSourceCandidates(candidates, options.boundedSource.maxSourceFiles) : undefined;
  const firstPlanned = planned?.candidates[0];
  const selected = planned
    ? candidates.find((entry) => firstPlanned && pickCandidateFields(entry).nodeId === firstPlanned.nodeId)
    : candidates[0];
  if (!selected) {
    warnings.push("No my-dev-kit search candidate was found.");
    const skipped = skippedRetrieval(options.evaluationCase.id, warnings, commands, Date.now() - started);
    if (planned && options.boundedSource) {
      return Object.assign(skipped, { boundedCoverage: {
        protocol: BOUNDED_SOURCE_PROTOCOL_ID, maxSourceFiles: options.boundedSource.maxSourceFiles,
        searchLimit: options.boundedSource.searchLimit, searchResultCount: candidates.length,
        searchTruncated: candidates.length >= options.boundedSource.searchLimit,
        eligibleCandidateFileCount: planned.eligibleFileCount, candidateBudgetExhausted: planned.eligibleFileCount > 0,
        rejectedCandidateCount: planned.rejectedCount, attempts: []
      } });
    }
    return skipped;
  }

  const candidate = pickCandidateFields(selected);
  const selectedNodeId = candidate.nodeId;
  const selectedFile = candidate.file;
  const selectedSymbol = candidate.symbol;
  const outputs = { search: searchCommand.stdout, lookup: "", slice: "", source: "" };
  const downstream = STRATEGY_DOWNSTREAM_COMMANDS[options.strategyId];

  if (downstream.length > 0) {
    if (selectedNodeId) {
      for (const commandId of downstream) {
        const extraArgs =
          commandId === "source"
            ? ["source", "--index", indexDir, "--node", selectedNodeId, "--max-lines", "160", "--format", "numbered"]
            : [commandId, "--index", indexDir, "--node", selectedNodeId, "--json"];
        const command = await runMeasuredCommand({
          commandId,
          commandString: options.kitCommand,
          cwd: process.cwd(),
          outDir: commandsDir,
          extraArgs
        });
        commands.push(command);
        if (command.ok) {
          outputs[commandId] = command.stdout;
        } else {
          warnings.push(`my-dev-kit ${commandId} command failed.`);
        }
      }
    } else {
      warnings.push("No my-dev-kit node id was available after search.");
    }
  }

  let contextText = selectRetrievalStrategyContextText(options.strategyId, outputs);
  let filesRead = selectedFile ? [selectedFile] : [];
  let boundedCoverage: MyDevKitBoundedCoverageV1 | undefined;
  if (options.boundedSource && downstream.includes("source")) {
    const bounded = await expandBoundedSourceCandidates({
      originalQuery: options.evaluationCase.query,
      bounded: options.boundedSource,
      candidates,
      selectedNodeId,
      selectedSourceOk: commands.some((command) => command.commandId === "source" && command.ok),
      activeIndex: options.activeIndex,
      graph: sourceGraph,
      kitCommand: options.kitCommand,
      indexDir,
      commandsDir,
      commands,
      warnings
    });
    boundedCoverage = bounded.coverage;
    // Bounded mode: filesRead names only files whose own `source` command succeeded, in rank order.
    filesRead = [...new Set([
      ...bounded.coverage.attempts.filter((attempt) => attempt.sourced).map((attempt) => attempt.file),
      ...(sourceCompleteness.get(bounded.coverage)?.regions.filter((region) => region.valid && region.lines.size > 0).map((region) => region.file) ?? [])
    ])];
    if (bounded.extraSourceTexts.length > 0) {
      contextText = [contextText, ...bounded.extraSourceTexts].filter((text) => text.length > 0).join("\n\n");
    }
  }
  const retrievalEvidence = buildRetrievalEvidenceFromCommands(commands, { nodeId: selectedNodeId, file: selectedFile });

  return {
    caseId: options.evaluationCase.id,
    skipped: contextText.length === 0,
    warnings,
    totalChars: countTextChars(contextText),
    totalEstimatedTokens: countEstimatedTokens(contextText),
    tokenCountMethod,
    contextText,
    filesRead,
    commands,
    selectedNodeId,
    selectedFile,
    selectedSymbol,
    retrievalEvidence,
    queryStrategyEvidence: buildQueryStrategyEvidenceFromRetrievalEvidence(options.strategyId, retrievalEvidence),
    ...(boundedCoverage ? { boundedCoverage } : {}),
    durationMs: Date.now() - started
  };
}

async function expandBoundedSourceCandidates(args: {
  originalQuery: string;
  bounded: MyDevKitBoundedSourceOptions;
  candidates: Record<string, unknown>[];
  selectedNodeId: string | undefined;
  selectedSourceOk: boolean;
  kitCommand: string;
  indexDir: string;
  commandsDir: string;
  commands: MeasuredCommandResult[];
  warnings: string[];
  activeIndex?: ActiveRetrievalIndexAuthority;
  graph?: AffectedNeighborhoodGraphEvidenceV1;
}): Promise<{ coverage: MyDevKitBoundedCoverageV1; extraSourceTexts: string[] }> {
  const plan = planBoundedSourceCandidates(args.candidates, args.bounded.maxSourceFiles);
  const attempts: MyDevKitBoundedSourceAttempt[] = [];
  const extraSourceTexts: string[] = [];
  for (const [index, candidate] of plan.candidates.entries()) {
    if (candidate.nodeId === args.selectedNodeId) {
      // The first search candidate already received its `source` command in the historical lifecycle.
      attempts.push({ ...candidate, sourced: args.selectedSourceOk });
      continue;
    }
    const command = await runMeasuredCommand({
      commandId: `source-candidate-${index + 1}`,
      commandString: args.kitCommand,
      cwd: process.cwd(),
      outDir: args.commandsDir,
      extraArgs: ["source", "--index", args.indexDir, "--node", candidate.nodeId, "--max-lines", "160", "--format", "numbered"]
    });
    args.commands.push(command);
    if (!command.ok) {
      args.warnings.push(`my-dev-kit source command failed for bounded candidate ${index + 1}.`);
    } else if (command.stdout.length > 0) {
      extraSourceTexts.push(command.stdout);
    }
    attempts.push({ ...candidate, sourced: command.ok });
  }
  const resultCount = args.candidates.length;
  const coverage: MyDevKitBoundedCoverageV1 = {
    protocol: BOUNDED_SOURCE_PROTOCOL_ID,
    maxSourceFiles: args.bounded.maxSourceFiles,
    searchLimit: args.bounded.searchLimit,
    searchResultCount: resultCount,
    searchTruncated: resultCount >= args.bounded.searchLimit,
    eligibleCandidateFileCount: plan.eligibleFileCount,
    candidateBudgetExhausted: plan.eligibleFileCount > plan.candidates.length,
    rejectedCandidateCount: plan.rejectedCount,
    attempts
  };
  if (args.bounded.enrichment) {
    if (!args.activeIndex || !args.graph) throw new Error("Verified active index authority is required for source enrichment.");
    await enrichBoundedSources({ ...args, activeIndex: args.activeIndex, graph: args.graph, coverage, extraSourceTexts });
  }
  return {
    coverage,
    extraSourceTexts
  };
}

/**
 * Opt-in bounded multi-source retrieval for evaluations that must observe more than one file (for example
 * multi-file required-file evidence). Reuses the shared strategy executor; default top-one retrieval and the
 * meaning of its `filesRead` are unchanged for every other caller. The result always carries
 * `boundedCoverage`, including when the search yielded no usable candidate.
 */
export async function runMyDevKitBoundedRetrievalFromIndex(options: {
  evaluationCase: EvaluationCase;
  kitCommand: string;
  indexDir: string;
  commandsDir: string;
  requireKit: boolean;
  boundedSource?: MyDevKitBoundedSourceOptions;
  activeIndex?: ActiveRetrievalIndexAuthority;
}): Promise<MyDevKitRetrievalResult> {
  const boundedSource = options.boundedSource ?? DEFAULT_BOUNDED_SOURCE_OPTIONS;
  const result = await runMyDevKitRetrievalStrategyFromIndex({ ...options, strategyId: "combined-graph-guided", boundedSource });
  if (isBoundedRetrievalResult(result)) return result;
  // Skipped before expansion (search failed or yielded no candidate): still declare the protocol, nothing sourced.
  const skipped: MyDevKitBoundedRetrievalResult = {
    ...result,
    filesRead: [],
    boundedCoverage: {
      protocol: BOUNDED_SOURCE_PROTOCOL_ID,
      maxSourceFiles: boundedSource.maxSourceFiles,
      searchLimit: boundedSource.searchLimit,
      searchResultCount: 0,
      searchTruncated: false,
      eligibleCandidateFileCount: 0,
      candidateBudgetExhausted: false,
      rejectedCandidateCount: 0,
      attempts: []
    }
  };
  return skipped;
}

/**
 * v0.8.0 compatibility entrypoint: the historical search -> lookup -> slice -> source lifecycle,
 * delegating to the `combined-graph-guided` strategy. Never invokes `index`.
 */
export async function runMyDevKitRetrievalFromIndex(options: {
  evaluationCase: EvaluationCase;
  kitCommand: string;
  indexDir: string;
  commandsDir: string;
  requireKit: boolean;
}): Promise<MyDevKitRetrievalResult> {
  return runMyDevKitRetrievalStrategyFromIndex({ ...options, strategyId: "combined-graph-guided" });
}

/**
 * Legacy per-case lifecycle: builds a case-specific index and retrieves from it. `commands`
 * starts with the index command and `durationMs` covers the whole lifecycle including indexing.
 */
export async function runMyDevKitRetrieval(options: {
  evaluationCase: EvaluationCase;
  kitCommand: string;
  outputDir: string;
  requireKit: boolean;
  /** See `buildMyDevKitIndex`; applied only to the index command. */
  excludePaths?: readonly string[];
}): Promise<MyDevKitRetrievalResult> {
  const started = Date.now();
  const commandsDir = path.join(options.outputDir, "commands", options.evaluationCase.id);
  const indexDir = path.join(options.outputDir, "indexes", options.evaluationCase.id);

  const index = await buildMyDevKitIndex({
    target: options.evaluationCase,
    kitCommand: options.kitCommand,
    indexDir,
    commandsDir,
    requireKit: options.requireKit,
    excludePaths: options.excludePaths
  });
  if (!index.ok) {
    return skippedRetrieval(options.evaluationCase.id, [...index.warnings], [index.command], Date.now() - started);
  }

  const retrieval = await runMyDevKitRetrievalFromIndex({
    evaluationCase: options.evaluationCase,
    kitCommand: options.kitCommand,
    indexDir,
    commandsDir,
    requireKit: options.requireKit
  });

  return {
    ...retrieval,
    warnings: [...index.warnings, ...retrieval.warnings],
    commands: [index.command, ...retrieval.commands],
    durationMs: Date.now() - started
  };
}
