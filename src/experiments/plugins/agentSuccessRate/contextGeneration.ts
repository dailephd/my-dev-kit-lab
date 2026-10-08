import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { countEstimatedTokens, countTextChars } from "../../../core/countTokens.js";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import type { AgentSuccessTaskV1 } from "../../../evaluation/agentSuccess/index.js";
import { compareCodeUnits } from "../../../evaluation/indexSnapshot.js";
import { normalizeRetrievedRepositoryPath } from "../../../evaluation/retrievalQuality/buildRetrievalEvidence.js";
import { buildContextPack } from "../contextPackGeneration/buildContextPack.js";
import type { ContextPackGenerationDependencies } from "../contextPackGeneration/execution.js";
import {
  deriveSymbolSourceRange,
  findIndexedSymbolLine,
  interpretSymbolIndex,
  parseLookup,
  parseSearchHits,
  parseSlice,
  parseSource,
  type ValidatedSymbolIndex
} from "../contextPackGeneration/packEvidence.js";
import {
  CONTEXT_PACK_SELECTION_POLICY_ID,
  GRAPH_DEPTH,
  MAX_SOURCE_LINES_PER_SLICE,
  MAX_SOURCE_SLICES,
  SEARCH_RESULT_LIMIT,
  isTestFilePath,
  selectRelevantSymbols,
  selectSeedNodes,
  type ContextPackCallCandidate,
  type ContextPackFileCandidate,
  type ContextPackSourceSliceCandidate,
  type ContextPackSymbolCandidate
} from "../contextPackGeneration/packSelectionPolicy.js";
import type { ContextPack, ContextPackAvailability, ContextPackEvidenceNoteCode, ContextPackSectionAvailabilityInput } from "../contextPackGeneration/types.js";
import type { AgentSuccessRateTreatmentId } from "./metadata.js";

export const AGENT_SUCCESS_RAW_CONTEXT_POLICY_ID = "raw-source-glob-v1";
export const AGENT_SUCCESS_PACK_CONTEXT_POLICY_ID = CONTEXT_PACK_SELECTION_POLICY_ID;
export const DEFAULT_AGENT_SUCCESS_KIT_COMMAND = "npx @dailephd/my-dev-kit@latest";

const MAX_RAW_FILE_BYTES = 262_144;
const MAX_RAW_TOTAL_BYTES = 1_048_576;
const FORBIDDEN_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "coverage", "lab-output"]);

/** The only task data context generation may read. */
export type AgentSuccessContextTaskInput = {
  caseId: string;
  benchmarkProject: string;
  title: string;
  query: string;
  sourceRoots: readonly string[];
  rawIncludeGlobs: readonly string[];
  /** Project-relative trusted-test paths that must never be selected. This list can only remove candidates. */
  excludedPaths: readonly string[];
};

export type AgentSuccessContextResult = {
  treatmentId: AgentSuccessRateTreatmentId;
  availability: ContextPackAvailability;
  reason: string | null;
  selectionPolicyId: string;
  myDevKitVersion: string | null;
  includedSourceFiles: string[];
  contextChars: number;
  estimatedContextTokens: number;
  /** The exact context body; null when the context is unavailable. Never embedded in execution/analysis JSON. */
  text: string | null;
};

const lf = (text: string): string => text.replace(/\r\n?/g, "\n");

function normalizeRoot(root: string): string | null {
  const normalized = normalizeRetrievedRepositoryPath(root);
  return normalized === null ? null : normalized.replace(/\/+$/, "");
}

/** Pure eligibility policy applied to every candidate before any source is read or retrieved. */
export function isEligibleSourcePath(candidate: unknown, input: Pick<AgentSuccessContextTaskInput, "sourceRoots" | "excludedPaths">): candidate is string {
  const normalized = normalizeRetrievedRepositoryPath(candidate);
  if (normalized === null || normalized !== candidate) return false;
  const roots = input.sourceRoots.map(normalizeRoot).filter((root): root is string => root !== null);
  if (!roots.some((root) => normalized === root || normalized.startsWith(`${root}/`))) return false;
  if (isTestFilePath(normalized)) return false;
  if (normalized.split("/").some((segment) => FORBIDDEN_DIRECTORIES.has(segment))) return false;
  return !input.excludedPaths.includes(normalized);
}

/** `file:<path>` and `symbol:<path>#<name>` node identities; anything else yields null and is dropped. */
export function sourcePathOfNodeId(nodeId: string): string | null {
  const match = /^(?:file|symbol):([^#]+)/.exec(nodeId);
  return match ? normalizeRetrievedRepositoryPath(match[1]) : null;
}

export function buildContextTaskInput(task: AgentSuccessTaskV1): AgentSuccessContextTaskInput {
  const excluded = new Set<string>();
  for (const check of [...task.taskChecks, ...task.regressionChecks]) {
    for (const arg of check.args) {
      const normalized = normalizeRetrievedRepositoryPath(arg);
      if (normalized !== null && !arg.startsWith("-") && /[./]/.test(arg)) excluded.add(normalized);
    }
  }
  return {
    caseId: task.id,
    benchmarkProject: task.benchmarkProject,
    title: task.title,
    query: task.query,
    sourceRoots: [...task.sourceRoots],
    rawIncludeGlobs: [...task.rawIncludeGlobs],
    excludedPaths: [...excluded].sort(compareCodeUnits)
  };
}

function unavailable(treatmentId: AgentSuccessRateTreatmentId, selectionPolicyId: string, reason: string, myDevKitVersion: string | null = null): AgentSuccessContextResult {
  return { treatmentId, availability: "unavailable", reason, selectionPolicyId, myDevKitVersion, includedSourceFiles: [], contextChars: 0, estimatedContextTokens: 0, text: null };
}

// ---------------------------------------------------------------------------------------------------------------
// raw-full-file
// ---------------------------------------------------------------------------------------------------------------

/** Directory names never entered while looking for raw source: trusted tests and generated/vendored trees. */
const SKIPPED_DIRECTORIES = new Set([...FORBIDDEN_DIRECTORIES, "tests", "test", "__tests__"]);

/**
 * Standard glob semantics for the supported subset: `**` matches across directories (`**` followed by `/` matches zero
 * or more directories), `*` and `?` stay within one path segment. Anything else is a literal. Returns null for a glob
 * that is not a plain project-relative pattern.
 */
function globToRegExp(glob: string): RegExp | null {
  const normalized = glob.replace(/\\/g, "/");
  if (normalized.length === 0 || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").some((segment) => segment === "..")) return null;
  let pattern = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]!;
    if (char === "*" && normalized[index + 1] === "*") {
      if (normalized[index + 2] === "/") {
        pattern += "(?:.*/)?";
        index += 2;
      } else {
        pattern += ".*";
        index += 1;
      }
    } else if (char === "*") pattern += "[^/]*";
    else if (char === "?") pattern += "[^/]";
    else pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`);
}

type RawCandidate = { absolutePath: string; relativePath: string };

/** Walks only the allowed source roots, so trusted-test and excluded directories are never even listed. */
async function listRawCandidates(projectRoot: string, input: AgentSuccessContextTaskInput): Promise<RawCandidate[] | null> {
  const patterns = input.rawIncludeGlobs.map(globToRegExp);
  if (patterns.some((pattern) => pattern === null)) return null;
  const found = new Map<string, RawCandidate>();
  const visit = async (relativeDirectory: string): Promise<void> => {
    const entries = await readdir(resolveWithinRoot(projectRoot, relativeDirectory), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await visit(relativePath);
      } else if ((entry.isFile() || entry.isSymbolicLink()) && patterns.some((pattern) => pattern!.test(relativePath))) {
        found.set(relativePath, { absolutePath: resolveWithinRoot(projectRoot, relativePath), relativePath });
      }
    }
  };
  for (const root of input.sourceRoots.map(normalizeRoot)) {
    if (root === null || root === ".") return null;
    await visit(root);
  }
  return [...found.values()];
}

/**
 * Every eligible source file matching the task's public glob selection, in code-unit order, LF-normalized. Reads only
 * regular, non-link, text files below the allowed source roots; anything unreadable makes the context unavailable
 * rather than partially fabricated.
 */
export async function buildRawFullFileContext(input: AgentSuccessContextTaskInput, canonicalProjectRoot: string): Promise<AgentSuccessContextResult> {
  const treatmentId = "raw-full-file" as const;
  const policy = AGENT_SUCCESS_RAW_CONTEXT_POLICY_ID;
  let candidates: RawCandidate[] | null;
  try {
    candidates = await listRawCandidates(canonicalProjectRoot, input);
  } catch {
    candidates = null;
  }
  if (candidates === null) return unavailable(treatmentId, policy, "raw-glob-resolution-failed");
  const eligible = candidates.filter((file) => isEligibleSourcePath(file.relativePath, input)).sort((a, b) => compareCodeUnits(a.relativePath, b.relativePath));
  if (eligible.length === 0) return unavailable(treatmentId, policy, "no-eligible-source-files");
  const sections: string[] = [];
  let totalBytes = 0;
  for (const file of eligible) {
    try {
      const stats = await lstat(resolveWithinRoot(canonicalProjectRoot, file.relativePath));
      if (stats.isSymbolicLink() || !stats.isFile()) return unavailable(treatmentId, policy, "source-file-not-regular");
      if (stats.size > MAX_RAW_FILE_BYTES) return unavailable(treatmentId, policy, "source-file-too-large");
      totalBytes += stats.size;
      if (totalBytes > MAX_RAW_TOTAL_BYTES) return unavailable(treatmentId, policy, "source-context-too-large");
      const data = await readFile(file.absolutePath);
      if (data.includes(0)) return unavailable(treatmentId, policy, "source-file-not-text");
      sections.push(`=== FILE: ${file.relativePath} ===\n${lf(data.toString("utf8"))}\n`);
    } catch {
      return unavailable(treatmentId, policy, "source-file-unreadable");
    }
  }
  const text = sections.join("\n");
  return {
    treatmentId,
    availability: "available",
    reason: null,
    selectionPolicyId: policy,
    myDevKitVersion: null,
    includedSourceFiles: eligible.map((file) => file.relativePath),
    contextChars: countTextChars(text),
    estimatedContextTokens: countEstimatedTokens(text),
    text
  };
}

// ---------------------------------------------------------------------------------------------------------------
// context-pack
// ---------------------------------------------------------------------------------------------------------------

/** Only the my-dev-kit execution seams of the released context-pack plugin are reused. */
export type AgentSuccessContextDependencies = Pick<ContextPackGenerationDependencies, "buildIndex" | "runCommand" | "readSymbolIndex" | "probeVersion">;

type ProjectIndex = { ok: false } | { ok: true; indexDir: string; commandsDir: string; symbolIndex: ValidatedSymbolIndex | null };

const pad = (index: number): string => String(index + 1).padStart(2, "0");

/**
 * Builds the context-pack treatment. The index covers only the task's source roots of the clean canonical project, and
 * every search hit, lookup result, graph neighbor, source candidate, symbol and call endpoint is filtered by the
 * eligibility policy BEFORE it is selected or its source is retrieved. The pure v0.8.2 selection and rendering
 * primitives are reused unchanged; the test-candidate input is always empty.
 */
export class AgentSuccessPackContextBuilder {
  private workRoot: string | null = null;
  private version: string | null | undefined;
  private readonly indexes = new Map<string, Promise<ProjectIndex>>();

  constructor(
    private readonly kitCommand: string,
    private readonly dependencies: AgentSuccessContextDependencies
  ) {}

  /** Removes the private work directory. Returns a bounded reason when it could not be removed. */
  async dispose(): Promise<string | null> {
    const root = this.workRoot;
    this.workRoot = null;
    this.indexes.clear();
    if (root === null) return null;
    try {
      await rm(root, { recursive: true, force: true });
      return null;
    } catch {
      return "context work directory could not be removed.";
    }
  }

  private async ensureWorkRoot(): Promise<string> {
    if (this.workRoot === null) this.workRoot = await mkdtemp(path.join(os.tmpdir(), "my-dev-kit-lab-asr-ctx-"));
    return this.workRoot;
  }

  private indexFor(input: AgentSuccessContextTaskInput, canonicalProjectRoot: string): Promise<ProjectIndex> {
    const key = `${canonicalProjectRoot}\0${[...input.sourceRoots].sort(compareCodeUnits).join("\0")}`;
    let pending = this.indexes.get(key);
    if (!pending) {
      pending = this.buildIndex(input, canonicalProjectRoot, this.indexes.size);
      this.indexes.set(key, pending);
    }
    return pending;
  }

  private async buildIndex(input: AgentSuccessContextTaskInput, canonicalProjectRoot: string, ordinal: number): Promise<ProjectIndex> {
    try {
      const root = await this.ensureWorkRoot();
      const indexDir = path.join(root, `index-${ordinal}`, "base");
      const commandsDir = path.join(root, `index-${ordinal}`, "commands");
      const build = await this.dependencies.buildIndex({
        target: { absoluteTargetRoot: canonicalProjectRoot, sourceRoots: [...input.sourceRoots] },
        kitCommand: this.kitCommand,
        indexDir,
        commandsDir: path.join(commandsDir, "index"),
        requireKit: false,
        callGraph: true
      });
      if (!build.ok) return { ok: false };
      if (this.version === undefined) {
        const tool = await this.dependencies.probeVersion({ kitCommand: this.kitCommand, commandsDir: path.join(root, "version") });
        this.version = tool.version ?? null;
      }
      let symbolIndex: ValidatedSymbolIndex | null = null;
      try {
        symbolIndex = interpretSymbolIndex(await this.dependencies.readSymbolIndex(indexDir));
      } catch {
        symbolIndex = null;
      }
      return { ok: true, indexDir, commandsDir, symbolIndex };
    } catch {
      return { ok: false };
    }
  }

  async build(input: AgentSuccessContextTaskInput, canonicalProjectRoot: string): Promise<AgentSuccessContextResult> {
    const treatmentId = "context-pack" as const;
    const policy = AGENT_SUCCESS_PACK_CONTEXT_POLICY_ID;
    const project = await this.indexFor(input, canonicalProjectRoot);
    if (!project.ok) return unavailable(treatmentId, policy, "project-index-failed", this.version ?? null);
    const version = this.version ?? null;
    const failed = (reason: string) => unavailable(treatmentId, policy, reason, version);
    const { indexDir, symbolIndex } = project;
    const commandsDir = path.join(project.commandsDir, input.caseId.replace(/[^A-Za-z0-9._-]/g, "-"));
    const run = (commandId: string, extraArgs: string[]) =>
      this.dependencies.runCommand({ commandId, commandString: this.kitCommand, cwd: process.cwd(), outDir: commandsDir, extraArgs });
    const eligiblePath = (candidate: string | null): candidate is string => candidate !== null && isEligibleSourcePath(candidate, input);
    const eligibleNode = (nodeId: string): boolean => eligiblePath(sourcePathOfNodeId(nodeId));

    // 1. One search; candidates outside the allowed source are removed before seeds are chosen.
    let hits;
    try {
      const search = await run("search", ["search", "--index", indexDir, "--query", input.query, "--limit", String(SEARCH_RESULT_LIMIT), "--json"]);
      const parsed = search.ok ? parseSearchHits(search.stdout, SEARCH_RESULT_LIMIT) : null;
      if (!parsed || !parsed.ok) return failed("retrieval-failed");
      hits = parsed.value.filter((hit) => eligiblePath(hit.path) && eligibleNode(hit.nodeId));
    } catch {
      return failed("retrieval-failed");
    }

    const fileCandidates: ContextPackFileCandidate[] = [];
    const symbolCandidates: ContextPackSymbolCandidate[] = [];
    const callCandidates: ContextPackCallCandidate[] = [];
    const lineByNodeId = new Map<string, number>();
    const extraNotes: ContextPackEvidenceNoteCode[] = [];
    for (const hit of hits) {
      if (hit.path !== null) fileCandidates.push({ path: hit.path, origin: "search", rank: hit.rank });
      if (hit.kind === "symbol") {
        symbolCandidates.push({ name: hit.label ?? hit.nodeId.slice(hit.nodeId.indexOf("#") + 1), nodeId: hit.nodeId, file: hit.path, line: null, origin: "search", rank: hit.rank });
      }
    }

    // 2. Seeds in upstream order; lookup then depth-1 slice per seed.
    const seeds = selectSeedNodes(hits.map((hit) => ({ nodeId: hit.nodeId, origin: "search" as const, rank: hit.rank })));
    extraNotes.push(...seeds.notes);
    let graphIncomplete = false;
    for (const [index, seed] of seeds.items.entries()) {
      try {
        const lookup = await run(`lookup-${pad(index)}`, ["lookup", "--index", indexDir, "--node", seed.nodeId, "--depth", String(GRAPH_DEPTH), "--json"]);
        const parsed = lookup.ok ? parseLookup(lookup.stdout) : null;
        if (parsed && parsed.ok) {
          const node = parsed.value.node;
          if (eligiblePath(node.path) && eligibleNode(node.id)) {
            fileCandidates.push({ path: node.path, origin: "lookup", rank: seed.rank });
            if (node.kind === "symbol" && node.symbolName !== null) {
              symbolCandidates.push({ name: node.symbolName, nodeId: node.id, file: node.path, line: node.line, origin: "lookup", rank: seed.rank });
              if (node.line !== null) lineByNodeId.set(node.id, node.line);
            }
          }
        } else graphIncomplete = true;
      } catch {
        graphIncomplete = true;
      }
      try {
        const slice = await run(`slice-${pad(index)}`, ["slice", "--index", indexDir, "--node", seed.nodeId, "--depth", String(GRAPH_DEPTH), "--direction", "both", "--json"]);
        const parsed = slice.ok ? parseSlice(slice.stdout) : null;
        if (parsed && parsed.ok) {
          for (const node of parsed.value.nodes) {
            if (!eligiblePath(node.path) || !eligibleNode(node.id)) continue;
            fileCandidates.push({ path: node.path, origin: "graph", rank: seed.rank });
            if (node.kind === "symbol" && node.symbolName !== null) {
              symbolCandidates.push({ name: node.symbolName, nodeId: node.id, file: node.path, line: node.line, origin: "graph", rank: seed.rank });
              if (node.line !== null && !lineByNodeId.has(node.id)) lineByNodeId.set(node.id, node.line);
            }
          }
          for (const edge of parsed.value.edges) {
            if (eligibleNode(edge.source) && eligibleNode(edge.target)) callCandidates.push({ fromNodeId: edge.source, toNodeId: edge.target, kind: edge.kind });
          }
        } else graphIncomplete = true;
      } catch {
        graphIncomplete = true;
      }
    }

    // 3. Bounded source only for already-filtered, selected symbols.
    const selectedSymbols = selectRelevantSymbols(symbolCandidates).items;
    const sliceCandidates: ContextPackSourceSliceCandidate[] = [];
    let sourceIncomplete = false;
    let sourceCount = 0;
    for (const symbol of selectedSymbols) {
      if (sourceCount >= MAX_SOURCE_SLICES) break;
      if (!eligiblePath(symbol.file)) continue;
      const line = (symbol.nodeId !== null ? lineByNodeId.get(symbol.nodeId) : undefined) ?? (symbolIndex ? findIndexedSymbolLine(symbolIndex, symbol.file, symbol.name) : null);
      const range = symbolIndex && line !== null ? deriveSymbolSourceRange(symbolIndex, symbol.file, line) : null;
      if (!range && symbol.nodeId === null) continue;
      sourceCount += 1;
      const nodeId = symbol.nodeId;
      try {
        const args = range
          ? ["source", "--index", indexDir, "--file", symbol.file, "--start", String(range.startLine), "--end", String(range.endLine), "--json"]
          : ["source", "--index", indexDir, "--node", nodeId as string, "--max-lines", String(MAX_SOURCE_LINES_PER_SLICE), "--json"];
        const source = await run(`source-${pad(sourceCount - 1)}`, args);
        const parsed = source.ok ? parseSource(source.stdout) : null;
        if (!parsed || !parsed.ok) {
          sourceIncomplete = true;
          continue;
        }
        const value = parsed.value;
        if (range?.capped) extraNotes.push("source-slice-cap-reached");
        sliceCandidates.push({
          file: symbol.file,
          nodeId,
          symbolName: symbol.name,
          startLine: value.startLine,
          endLine: value.endLine,
          text: value.content,
          boundaryKnown: value.boundaryKnown,
          truncated: range?.capped === true,
          continuationAvailable: range ? range.capped : !value.eof,
          rank: symbol.rank
        });
      } catch {
        sourceIncomplete = true;
      }
    }
    const boundaryUnknown = sliceCandidates.some((candidate) => !candidate.boundaryKnown);

    // 4. Availability is decided here; composition is the pure v0.8.2 builder with an empty test-candidate input.
    const available: ContextPackSectionAvailabilityInput = { availability: "available", reason: null };
    const graphSection: ContextPackSectionAvailabilityInput = graphIncomplete ? { availability: "partial", reason: "graph-step-incomplete" } : available;
    const sourceSection: ContextPackSectionAvailabilityInput = sourceIncomplete
      ? { availability: "partial", reason: "source-step-incomplete" }
      : boundaryUnknown
        ? { availability: "partial", reason: "symbol-end-unknown" }
        : available;
    const packReasonBase = graphIncomplete ? "graph-step-incomplete" : sourceIncomplete ? "source-step-incomplete" : boundaryUnknown ? "symbol-end-unknown" : null;
    const packAvailabilityBase: ContextPackAvailability = packReasonBase === null ? "available" : "partial";
    let pack: ContextPack;
    try {
      pack = buildContextPack({
        caseId: input.caseId,
        benchmarkProject: input.benchmarkProject,
        taskLocality: null,
        task: { title: input.title, summary: input.query },
        myDevKitVersion: version ?? "unavailable",
        fileCandidates,
        symbolCandidates,
        sourceSliceCandidates: sliceCandidates,
        callCandidates,
        testCandidates: [],
        evidenceNotes: extraNotes,
        sectionAvailability: {
          files: graphSection,
          symbols: graphSection,
          sourceSlices: sourceSection,
          callRelationships: graphSection,
          tests: { availability: "unavailable", reason: "not-supplied" },
          evidenceNotes: available
        },
        availability: packAvailabilityBase,
        reason: packReasonBase
      });
    } catch {
      return failed("pack-construction-failed");
    }

    // 5. Defense in depth: nothing outside the allowed source may be present in the finished pack.
    const violations = [
      ...pack.files.map((file) => file.path),
      ...pack.sourceSlices.map((slice) => slice.file),
      ...pack.symbols.map((symbol) => symbol.file).filter((file): file is string => file !== null)
    ].filter((candidate) => !eligiblePath(candidate));
    const endpointViolation = pack.callRelationships.some((call) => !eligibleNode(call.fromNodeId) || !eligibleNode(call.toNodeId));
    if (violations.length > 0 || endpointViolation || pack.tests.length > 0) return failed("context-isolation-violation");
    if (pack.sourceSlices.length === 0) return failed("no-source-slices");

    const includedSourceFiles = [...new Set([...pack.files.map((file) => file.path), ...pack.sourceSlices.map((slice) => slice.file)])];
    const degraded = symbolIndex === null && pack.availability === "available";
    return {
      treatmentId,
      availability: degraded ? "partial" : pack.availability,
      reason: degraded ? "symbol-index-unavailable" : pack.reason,
      selectionPolicyId: pack.selectionPolicy.id,
      myDevKitVersion: version,
      includedSourceFiles,
      contextChars: pack.size.totalChars,
      estimatedContextTokens: pack.size.totalEstimatedTokens,
      text: pack.renderedText
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Leak guard
// ---------------------------------------------------------------------------------------------------------------

export type ForbiddenAgentValue = { label: string; value: string };

/**
 * Distinctive hidden values (reference patch, trusted-test paths, behavior-fact text and hyphenated identifiers) that
 * must never appear in a prompt. Read from the task BEFORE it is sealed; used only to refuse a leaking prompt.
 */
export function collectForbiddenAgentValues(task: AgentSuccessTaskV1): ForbiddenAgentValue[] {
  const values: ForbiddenAgentValue[] = [];
  const add = (label: string, value: string | undefined): void => {
    if (typeof value === "string" && value.trim().length >= 6) values.push({ label, value });
  };
  const fixture = task.deterministicFixture;
  if (fixture) {
    add("deterministicFixture.patch", fixture.patch);
    add("deterministicFixture.id", fixture.id);
    add("deterministicFixture.notes", fixture.notes);
  }
  for (const check of [...task.taskChecks, ...task.regressionChecks]) {
    add("verificationCheck.id", /-/.test(check.id) ? check.id : undefined);
    for (const arg of check.args) if (!arg.startsWith("-") && /[./]/.test(arg)) add("verificationCheck.path", arg);
  }
  for (const fact of task.behaviorFacts) {
    add("behaviorFact.text", fact.text);
    add("behaviorFact.id", /-/.test(fact.id) ? fact.id : undefined);
  }
  for (const file of task.protectedFiles) if (isTestFilePath(file)) add("protectedFile.test", file);
  return values;
}

/** Returns the labels (never the values) of forbidden content found in a finished prompt. */
export function findPromptLeaks(promptText: string, forbidden: readonly ForbiddenAgentValue[]): string[] {
  const found = new Set<string>();
  for (const entry of forbidden) if (promptText.includes(entry.value)) found.add(entry.label);
  return [...found].sort(compareCodeUnits);
}
