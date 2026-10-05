/**
 * Semantic retrieval strategies (`data-model-graph`, `model-view-lineage`) executed against an
 * already prepared my-dev-kit index through `data-model` queries.
 *
 * The target is chosen from the task query and the upstream data-model graph only; the answer key is
 * never read. Output is normalized into `retrieval-query-strategy-evidence-v1`, never into
 * `retrieval-evidence-v1`, because these commands are not search/lookup/slice/source.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { countEstimatedTokens, countTextChars, tokenCountMethod } from "../core/countTokens.js";
import { runMeasuredCommand, type MeasuredCommandResult } from "../core/runMeasuredCommand.js";
import { compareCodeUnits } from "./indexSnapshot.js";
import { normalizeRetrievedRepositoryPath } from "./retrievalQuality/buildRetrievalEvidence.js";
import {
  canonicalizeQueryStrategyIdentities,
  type RetrievalQueryStrategyEvidenceStepV1,
  type RetrievalQueryStrategyEvidenceV1,
  type RetrievalQueryStrategySymbolEvidenceV1
} from "./retrievalQueryStrategyEvidence.js";
import type { EvaluationCase } from "./types.js";

export type SemanticRetrievalStrategyId = "data-model-graph" | "model-view-lineage";

export type SemanticRetrievalStrategyResult = {
  caseId: string;
  strategyId: SemanticRetrievalStrategyId;
  skipped: boolean;
  warnings: string[];
  totalChars: number;
  totalEstimatedTokens: number;
  tokenCountMethod: typeof tokenCountMethod;
  contextText: string;
  commands: MeasuredCommandResult[];
  queryStrategyEvidence: RetrievalQueryStrategyEvidenceV1;
  durationMs: number;
};

/** Minimal Lab-owned view of an upstream `my-dev-kit-v1-data-model-graph` node. */
type DataModelGraphNodeLike = {
  id: string;
  kind: "entity" | "field";
  label: string;
};

type Options = {
  strategyId: SemanticRetrievalStrategyId;
  evaluationCase: EvaluationCase;
  kitCommand: string;
  indexDir: string;
  commandsDir: string;
  requireKit: boolean;
};

const REJECTED_REASON = "some-semantic-identities-were-rejected";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonIfPossible(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Lowercases, splits on every run of non ASCII alphanumerics, drops tokens shorter than two
 * characters, deduplicates, and sorts in code-unit order. No stemming, synonyms, or stop words.
 */
export function tokenizeSemanticRetrievalQuery(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length >= 2);
  return [...new Set(tokens)].sort(compareCodeUnits);
}

/** Count of unique query tokens that occur exactly as label tokens. */
export function scoreSemanticLabel(queryTokens: readonly string[], label: string): number {
  const labelTokens = new Set(tokenizeSemanticRetrievalQuery(label));
  let score = 0;
  for (const token of new Set(queryTokens)) {
    if (labelTokens.has(token)) score += 1;
  }
  return score;
}

function step(
  kind: RetrievalQueryStrategyEvidenceStepV1["kind"],
  succeeded: boolean,
  evidenceAvailable: boolean,
  reason: string | null
): RetrievalQueryStrategyEvidenceStepV1 {
  return { kind, succeeded, evidenceAvailable, reason };
}

function buildEvidence(
  strategyId: SemanticRetrievalStrategyId,
  availability: RetrievalQueryStrategyEvidenceV1["availability"],
  availabilityReason: string | null,
  identities: { files: string[]; symbols: RetrievalQueryStrategySymbolEvidenceV1[] },
  steps: RetrievalQueryStrategyEvidenceStepV1[]
): RetrievalQueryStrategyEvidenceV1 {
  const canonical = canonicalizeQueryStrategyIdentities(
    identities.files.map((file) => ({ path: file })),
    identities.symbols
  );
  return {
    schemaVersion: "retrieval-query-strategy-evidence-v1",
    strategyId,
    availability,
    availabilityReason,
    files: canonical.files,
    symbols: canonical.symbols,
    steps
  };
}

function unavailableEvidence(
  strategyId: SemanticRetrievalStrategyId,
  reason: string,
  steps: RetrievalQueryStrategyEvidenceStepV1[]
): RetrievalQueryStrategyEvidenceV1 {
  return buildEvidence(strategyId, "unavailable", reason, { files: [], symbols: [] }, steps);
}

type GraphReadResult = { ok: true; nodes: DataModelGraphNodeLike[] } | { ok: false; reason: string };

async function readDataModelGraph(indexDir: string): Promise<GraphReadResult> {
  let text: string;
  try {
    text = await readFile(path.join(indexDir, "data-model-graph.json"), "utf8");
  } catch {
    return { ok: false, reason: "data-model-graph-artifact-missing" };
  }
  const payload = parseJsonIfPossible(text);
  if (!isRecord(payload)) return { ok: false, reason: "data-model-graph-artifact-malformed" };
  if (
    payload.artifactKind !== "my-dev-kit-v1-data-model-graph" ||
    typeof payload.schemaVersion !== "string" ||
    !payload.schemaVersion.startsWith("1.")
  ) {
    return { ok: false, reason: "data-model-graph-schema-unsupported" };
  }
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
    return { ok: false, reason: "data-model-graph-artifact-malformed" };
  }
  const nodes: DataModelGraphNodeLike[] = [];
  for (const node of payload.nodes) {
    if (
      isRecord(node) &&
      typeof node.id === "string" &&
      typeof node.label === "string" &&
      (node.kind === "entity" || node.kind === "field")
    ) {
      nodes.push({ id: node.id, kind: node.kind, label: node.label });
    }
  }
  return { ok: true, nodes };
}

/** Highest score wins; ties break on node id in code-unit order. No candidate means no match. */
function selectSemanticCandidate(
  queryTokens: readonly string[],
  nodes: readonly DataModelGraphNodeLike[]
): DataModelGraphNodeLike | undefined {
  let best: { node: DataModelGraphNodeLike; score: number } | undefined;
  for (const node of nodes) {
    const score = scoreSemanticLabel(queryTokens, node.label);
    if (score <= 0) continue;
    if (!best || score > best.score || (score === best.score && compareCodeUnits(node.id, best.node.id) < 0)) {
      best = { node, score };
    }
  }
  return best?.node;
}

/** Normalizes `filePath` of every ref; unsafe values are counted, never kept. */
function collectSafeFiles(refs: readonly unknown[]): { files: string[]; rejected: number } {
  const files: string[] = [];
  let rejected = 0;
  for (const ref of refs) {
    const normalized = isRecord(ref) ? normalizeRetrievedRepositoryPath(ref.filePath) : null;
    if (normalized === null) {
      rejected += 1;
    } else {
      files.push(normalized);
    }
  }
  return { files, rejected };
}

function uniqueFileOrNull(files: readonly string[]): string | null {
  const unique = [...new Set(files)];
  return unique.length === 1 ? unique[0] : null;
}

function readEntityOutput(payload: unknown, expectedMode: string): "malformed" | "mismatched" | Record<string, unknown> {
  if (!isRecord(payload) || payload.status !== "ok" || typeof payload.mode !== "string") return "malformed";
  if (payload.mode !== expectedMode) return "mismatched";
  return payload;
}

function readIdentity(value: unknown): { id: string; name: string } | undefined {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string"
    ? { id: value.id, name: value.name }
    : undefined;
}

function buildDataModelGraphStrategyEvidence(
  selectedNode: DataModelGraphNodeLike,
  lookupPayload: unknown,
  generationCommand: MeasuredCommandResult,
  lookupCommand: MeasuredCommandResult
): RetrievalQueryStrategyEvidenceV1 {
  const strategyId = "data-model-graph";
  const generationStep = step("data-model", generationCommand.ok, generationCommand.ok, null);
  const failed = (reason: string) =>
    unavailableEvidence(strategyId, reason, [generationStep, step("data-model", lookupCommand.ok, false, reason)]);

  if (!lookupCommand.ok) return failed("data-model-lookup-command-failed");
  const expectedMode = selectedNode.kind === "entity" ? "entity" : "field";
  const output = readEntityOutput(lookupPayload, expectedMode);
  if (output === "malformed") return failed("data-model-lookup-output-malformed");
  if (output === "mismatched") return failed("data-model-lookup-output-mismatched");

  const selected = readIdentity(expectedMode === "entity" ? output.entity : output.field);
  if (!selected || !Array.isArray(output.sourceRefs)) return failed("data-model-lookup-output-malformed");

  const { files, rejected } = collectSafeFiles(output.sourceRefs);
  const symbol: RetrievalQueryStrategySymbolEvidenceV1 = {
    name: selected.name,
    nodeId: selected.id,
    file: uniqueFileOrNull(files)
  };
  const partial = rejected > 0;
  return buildEvidence(
    strategyId,
    partial ? "partial" : "available",
    partial ? REJECTED_REASON : null,
    { files, symbols: [symbol] },
    [generationStep, step("data-model", true, !partial, partial ? REJECTED_REASON : null)]
  );
}

function buildModelViewLineageStrategyEvidence(
  tracePayload: unknown,
  generationCommand: MeasuredCommandResult,
  traceCommand: MeasuredCommandResult,
  expectedMode: "trace-entity" | "trace-field"
): RetrievalQueryStrategyEvidenceV1 {
  const strategyId = "model-view-lineage";
  const generationStep = step("data-model", generationCommand.ok, generationCommand.ok, null);
  const failed = (reason: string) =>
    unavailableEvidence(strategyId, reason, [generationStep, step("model-view-lineage", traceCommand.ok, false, reason)]);

  if (!traceCommand.ok) return failed("model-view-lineage-command-failed");
  const output = readEntityOutput(tracePayload, expectedMode);
  if (output === "malformed") return failed("model-view-lineage-output-malformed");
  if (output === "mismatched") return failed("model-view-lineage-output-mismatched");
  const lineage = output.lineage;
  if (!readIdentity(output.entity) || !isRecord(lineage) || !Array.isArray(lineage.nodes) || !Array.isArray(lineage.edges)) {
    return failed("model-view-lineage-output-malformed");
  }

  const files: string[] = [];
  const symbols: RetrievalQueryStrategySymbolEvidenceV1[] = [];
  let rejected = 0;
  for (const node of lineage.nodes) {
    if (!isRecord(node) || typeof node.id !== "string" || typeof node.label !== "string") {
      rejected += 1;
      continue;
    }
    let nodeFiles: string[] = [];
    if (Array.isArray(node.evidenceRefs)) {
      const collected = collectSafeFiles(node.evidenceRefs);
      nodeFiles = collected.files;
      rejected += collected.rejected;
    } else if (node.evidenceRefs !== undefined) {
      rejected += 1;
    }
    files.push(...nodeFiles);
    symbols.push({ name: node.label, nodeId: node.id, file: uniqueFileOrNull(nodeFiles) });
  }
  const partial = rejected > 0;
  return buildEvidence(
    strategyId,
    partial ? "partial" : "available",
    partial ? REJECTED_REASON : null,
    { files, symbols },
    [generationStep, step("model-view-lineage", true, !partial, partial ? REJECTED_REASON : null)]
  );
}

async function runDataModelCommand(
  options: Options,
  commandId: string,
  args: string[],
  commands: MeasuredCommandResult[]
): Promise<MeasuredCommandResult> {
  const command = await runMeasuredCommand({
    commandId,
    commandString: options.kitCommand,
    cwd: process.cwd(),
    outDir: options.commandsDir,
    extraArgs: ["data-model", "--index", options.indexDir, ...args, "--json"]
  });
  commands.push(command);
  if (!command.ok && options.requireKit) {
    throw new Error(command.error || `my-dev-kit data-model failed with exit code ${command.exitCode}`);
  }
  return command;
}

function buildResult(
  options: Options,
  started: number,
  commands: MeasuredCommandResult[],
  evidence: RetrievalQueryStrategyEvidenceV1,
  contextText: string
): SemanticRetrievalStrategyResult {
  const warnings: string[] = [];
  if (evidence.availability === "unavailable") {
    warnings.push(`my-dev-kit semantic retrieval was unavailable: ${evidence.availabilityReason}.`);
  } else if (evidence.availability === "partial") {
    warnings.push(`my-dev-kit semantic retrieval was partially interpreted: ${evidence.availabilityReason}.`);
  }
  const text = evidence.availability === "unavailable" ? "" : contextText;
  return {
    caseId: options.evaluationCase.id,
    strategyId: options.strategyId,
    skipped: text.length === 0,
    warnings,
    totalChars: countTextChars(text),
    totalEstimatedTokens: countEstimatedTokens(text),
    tokenCountMethod,
    contextText: text,
    commands,
    queryStrategyEvidence: evidence,
    durationMs: Date.now() - started
  };
}

type Resolved =
  | { kind: "node"; node: DataModelGraphNodeLike; generation: MeasuredCommandResult }
  | { kind: "done"; evidence: RetrievalQueryStrategyEvidenceV1 };

/** Shared by both strategies: generate artifacts, validate the graph, select one semantic node. */
async function resolveSemanticTarget(options: Options, commands: MeasuredCommandResult[]): Promise<Resolved> {
  const generation = await runDataModelCommand(options, "data-model", [], commands);
  if (!generation.ok) {
    return {
      kind: "done",
      evidence: unavailableEvidence(options.strategyId, "data-model-command-failed", [
        step("data-model", false, false, "data-model-command-failed")
      ])
    };
  }
  const generationStep = step("data-model", true, true, null);
  const graph = await readDataModelGraph(options.indexDir);
  if (!graph.ok) {
    return {
      kind: "done",
      evidence: unavailableEvidence(options.strategyId, graph.reason, [step("data-model", true, false, graph.reason)])
    };
  }
  const node = selectSemanticCandidate(tokenizeSemanticRetrievalQuery(options.evaluationCase.query), graph.nodes);
  if (!node) {
    return {
      kind: "done",
      evidence: buildEvidence(options.strategyId, "available", null, { files: [], symbols: [] }, [generationStep])
    };
  }
  return { kind: "node", node, generation };
}

async function executeDataModelGraphStrategy(options: Options, started: number): Promise<SemanticRetrievalStrategyResult> {
  const commands: MeasuredCommandResult[] = [];
  const resolved = await resolveSemanticTarget(options, commands);
  if (resolved.kind === "done") return buildResult(options, started, commands, resolved.evidence, "");

  const selector = resolved.node.kind === "entity" ? ["--entity", resolved.node.label] : ["--field", resolved.node.label];
  const lookup = await runDataModelCommand(options, "data-model-selected", selector, commands);
  const evidence = buildDataModelGraphStrategyEvidence(
    resolved.node,
    lookup.ok ? parseJsonIfPossible(lookup.stdout) : undefined,
    resolved.generation,
    lookup
  );
  return buildResult(options, started, commands, evidence, lookup.stdout);
}

async function executeModelViewLineageStrategy(options: Options, started: number): Promise<SemanticRetrievalStrategyResult> {
  const commands: MeasuredCommandResult[] = [];
  const resolved = await resolveSemanticTarget(options, commands);
  if (resolved.kind === "done") return buildResult(options, started, commands, resolved.evidence, "");

  const isEntity = resolved.node.kind === "entity";
  const selector = isEntity ? ["--trace-view", resolved.node.label] : ["--field", resolved.node.label, "--trace-view"];
  const trace = await runDataModelCommand(options, "model-view-lineage", selector, commands);
  const evidence = buildModelViewLineageStrategyEvidence(
    trace.ok ? parseJsonIfPossible(trace.stdout) : undefined,
    resolved.generation,
    trace,
    isEntity ? "trace-entity" : "trace-field"
  );
  return buildResult(options, started, commands, evidence, trace.stdout);
}

/**
 * Executes one semantic retrieval strategy against an already prepared index. Never invokes `index`,
 * never reads the answer key, never runs agents.
 */
export async function runSemanticRetrievalStrategyFromIndex(options: Options): Promise<SemanticRetrievalStrategyResult> {
  const started = Date.now();
  switch (options.strategyId) {
    case "data-model-graph":
      return executeDataModelGraphStrategy(options, started);
    case "model-view-lineage":
      return executeModelViewLineageStrategy(options, started);
    default:
      throw new Error(`Unsupported semantic retrieval strategy: ${String(options.strategyId)}`);
  }
}
