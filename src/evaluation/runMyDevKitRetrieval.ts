import path from "node:path";
import { countEstimatedTokens, countTextChars, tokenCountMethod } from "../core/countTokens.js";
import { runMeasuredCommand, type MeasuredCommandResult } from "../core/runMeasuredCommand.js";
import { interpretToolVersionOutput, type IndexSnapshotToolV1 } from "./indexSnapshot.js";
import { buildRetrievalEvidenceFromCommands } from "./retrievalQuality/buildRetrievalEvidence.js";
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

const STRATEGY_DOWNSTREAM_COMMANDS: Record<CoreGraphRetrievalQueryStrategyId, readonly ("lookup" | "slice" | "source")[]> = {
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
    extraArgs: ["search", "--index", indexDir, "--query", options.evaluationCase.query, "--json"]
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
  const candidates = readSearchResults(searchPayload);
  const selected = candidates[0];
  if (!selected) {
    warnings.push("No my-dev-kit search candidate was found.");
    return skippedRetrieval(options.evaluationCase.id, warnings, commands, Date.now() - started);
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

  const contextText = selectRetrievalStrategyContextText(options.strategyId, outputs);
  const filesRead = selectedFile ? [selectedFile] : [];
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
    durationMs: Date.now() - started
  };
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
