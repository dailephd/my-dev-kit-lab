import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import { runMeasuredCommand } from "../../../core/runMeasuredCommand.js";
import { validateRetrievalPrecisionRecallCase } from "../../../evaluation/retrievalQuality/index.js";
import { buildMyDevKitIndex, probeMyDevKitVersion } from "../../../evaluation/runMyDevKitRetrieval.js";
import { runRawFullFileBaseline } from "../../../evaluation/runRawFullFileBaseline.js";
import type { EvaluationCase } from "../../../evaluation/types.js";
import { groupWarmIndexCases, taskOutputSegment } from "../warmIndexReuse/selection.js";
import { buildContextPack } from "./buildContextPack.js";
import type { ExperimentRunStatus } from "../../types.js";
import {
  CONTEXT_PACK_GENERATION_ERROR_TEXT,
  type ContextPackExecutionStepV1,
  type ContextPackGenerationCaseEvidenceV1,
  type ContextPackGenerationCaseResult,
  type ContextPackGenerationErrorCode,
  type ContextPackGenerationTreatmentEvidenceV1
} from "./executionTypes.js";
import { buildContextPackIdentityEvidence, buildRawFullFileIdentityEvidence } from "./identityEvidence.js";
import { CONTEXT_PACK_GENERATION_TREATMENT_IDS } from "./metadata.js";
import { contextPackArtifactRelativePath } from "./packArtifact.js";
import {
  deriveSymbolSourceRange,
  findIndexedSymbolLine,
  interpretSymbolIndex,
  parseLookup,
  parseSearchHits,
  parseSlice,
  parseSource,
  type ValidatedSymbolIndex
} from "./packEvidence.js";
import {
  GRAPH_DEPTH,
  MAX_SOURCE_LINES_PER_SLICE,
  MAX_SOURCE_SLICES,
  SEARCH_RESULT_LIMIT,
  selectRelevantSymbols,
  selectSeedNodes,
  type ContextPackCallCandidate,
  type ContextPackFileCandidate,
  type ContextPackSourceSliceCandidate,
  type ContextPackSymbolCandidate,
  type ContextPackTestCandidate
} from "./packSelectionPolicy.js";
import type { ContextPack, ContextPackAvailability, ContextPackEvidenceNoteCode, ContextPackSectionAvailabilityInput } from "./types.js";

/** Test seams: only the execution owners may be substituted. */
export type ContextPackGenerationDependencies = {
  buildIndex: typeof buildMyDevKitIndex;
  runCommand: typeof runMeasuredCommand;
  runRawBaseline: typeof runRawFullFileBaseline;
  /** Returns the parsed `symbol-index.json` of an index directory. */
  readSymbolIndex: (indexDir: string) => Promise<unknown>;
  probeVersion: typeof probeMyDevKitVersion;
};

const defaultDependencies: ContextPackGenerationDependencies = {
  buildIndex: buildMyDevKitIndex,
  runCommand: runMeasuredCommand,
  runRawBaseline: runRawFullFileBaseline,
  readSymbolIndex: async (indexDir) => JSON.parse(await readFile(path.join(indexDir, "symbol-index.json"), "utf8")) as unknown,
  probeVersion: probeMyDevKitVersion
};

const pad = (index: number): string => String(index + 1).padStart(2, "0");

function failedTreatment(
  treatmentId: ContextPackGenerationTreatmentEvidenceV1["treatmentId"],
  code: ContextPackGenerationErrorCode,
  steps: ContextPackExecutionStepV1[] = []
): ContextPackGenerationTreatmentEvidenceV1 {
  return {
    treatmentId,
    status: "failed",
    availability: null,
    availabilityReason: null,
    size: null,
    identityEvidence: null,
    includedFiles: [],
    steps,
    sections: null,
    evidenceNotes: [],
    packArtifactPath: null,
    errors: [{ code, message: CONTEXT_PACK_GENERATION_ERROR_TEXT[code] }]
  };
}

function failedCase(evaluationCase: EvaluationCase, code: ContextPackGenerationErrorCode): ContextPackGenerationCaseResult {
  return {
    evidence: {
      caseId: evaluationCase.id,
      caseName: evaluationCase.title,
      benchmarkProject: evaluationCase.benchmarkProject,
      taskLocality: evaluationCase.taskLocality ?? null,
      treatments: CONTEXT_PACK_GENERATION_TREATMENT_IDS.map((treatmentId) => failedTreatment(treatmentId, code))
    },
    pack: null
  };
}

const statusOf = (availability: ContextPackAvailability): ExperimentRunStatus => (availability === "available" ? "completed" : availability === "partial" ? "partial" : "failed");

type CaseContext = {
  evaluationCase: EvaluationCase;
  kitCommand: string;
  indexDir: string;
  commandsDir: string;
  symbolIndex: ValidatedSymbolIndex | null;
  myDevKitVersion: string;
  dependencies: ContextPackGenerationDependencies;
};

async function executeRawTreatment(context: CaseContext): Promise<ContextPackGenerationTreatmentEvidenceV1> {
  try {
    const baseline = await context.dependencies.runRawBaseline(context.evaluationCase);
    const symbolIndex = context.symbolIndex;
    const availability: ContextPackAvailability = symbolIndex ? "available" : "partial";
    const reason = symbolIndex ? null : "symbol-index-unavailable";
    return {
      treatmentId: "raw-full-file",
      status: statusOf(availability),
      availability,
      availabilityReason: reason,
      size: { totalChars: baseline.totalChars, totalEstimatedTokens: baseline.totalEstimatedTokens, tokenCountMethod: baseline.tokenCountMethod },
      identityEvidence: buildRawFullFileIdentityEvidence({
        includedFiles: baseline.filesIncluded,
        indexedFiles: symbolIndex?.files ?? [],
        availability,
        reason
      }),
      includedFiles: [...baseline.filesIncluded],
      steps: [],
      sections: null,
      evidenceNotes: [],
      packArtifactPath: null,
      errors: []
    };
  } catch {
    return failedTreatment("raw-full-file", "raw-baseline-failed");
  }
}

async function executePackTreatment(context: CaseContext): Promise<{ treatment: ContextPackGenerationTreatmentEvidenceV1; pack: ContextPack | null }> {
  const { evaluationCase, indexDir, symbolIndex } = context;
  const steps: ContextPackExecutionStepV1[] = [];
  const run = (commandId: string, extraArgs: string[]) =>
    context.dependencies.runCommand({ commandId, commandString: context.kitCommand, cwd: process.cwd(), outDir: context.commandsDir, extraArgs });
  const fail = (code: ContextPackGenerationErrorCode) => ({ treatment: failedTreatment("context-pack", code, steps), pack: null });

  // 1. One search, capped, upstream rank preserved.
  let hits;
  try {
    const search = await run("search", ["search", "--index", indexDir, "--query", evaluationCase.query, "--limit", String(SEARCH_RESULT_LIMIT), "--json"]);
    const parsed = search.ok ? parseSearchHits(search.stdout, SEARCH_RESULT_LIMIT) : null;
    if (!search.ok || !parsed || !parsed.ok) {
      steps.push({ kind: "search", nodeId: null, sourceMode: null, succeeded: false, reason: search.ok ? "malformed-output" : "command-failed" });
      return fail("retrieval-failed");
    }
    steps.push({ kind: "search", nodeId: null, sourceMode: null, succeeded: true, reason: null });
    hits = parsed.value;
  } catch {
    steps.push({ kind: "search", nodeId: null, sourceMode: null, succeeded: false, reason: "command-failed" });
    return fail("retrieval-failed");
  }

  const fileCandidates: ContextPackFileCandidate[] = [];
  const symbolCandidates: ContextPackSymbolCandidate[] = [];
  const testCandidates: ContextPackTestCandidate[] = [];
  const callCandidates: ContextPackCallCandidate[] = [];
  const lineByNodeId = new Map<string, number>();
  const extraNotes: ContextPackEvidenceNoteCode[] = [];

  for (const hit of hits) {
    if (hit.path !== null) {
      fileCandidates.push({ path: hit.path, origin: "search", rank: hit.rank });
      testCandidates.push({ path: hit.path, origin: "search-candidate", rank: hit.rank });
    }
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
        steps.push({ kind: "lookup", nodeId: seed.nodeId, sourceMode: null, succeeded: true, reason: null });
        const node = parsed.value.node;
        if (node.path !== null) fileCandidates.push({ path: node.path, origin: "lookup", rank: seed.rank });
        if (node.kind === "symbol" && node.symbolName !== null) {
          symbolCandidates.push({ name: node.symbolName, nodeId: node.id, file: node.path, line: node.line, origin: "lookup", rank: seed.rank });
          if (node.line !== null) lineByNodeId.set(node.id, node.line);
        }
      } else {
        graphIncomplete = true;
        steps.push({ kind: "lookup", nodeId: seed.nodeId, sourceMode: null, succeeded: false, reason: lookup.ok ? "malformed-output" : "command-failed" });
      }
    } catch {
      graphIncomplete = true;
      steps.push({ kind: "lookup", nodeId: seed.nodeId, sourceMode: null, succeeded: false, reason: "command-failed" });
    }
    try {
      const slice = await run(`slice-${pad(index)}`, ["slice", "--index", indexDir, "--node", seed.nodeId, "--depth", String(GRAPH_DEPTH), "--direction", "both", "--json"]);
      const parsed = slice.ok ? parseSlice(slice.stdout) : null;
      if (parsed && parsed.ok) {
        steps.push({ kind: "slice", nodeId: seed.nodeId, sourceMode: null, succeeded: true, reason: null });
        for (const node of parsed.value.nodes) {
          if (node.path !== null) {
            fileCandidates.push({ path: node.path, origin: "graph", rank: seed.rank });
            testCandidates.push({ path: node.path, origin: "graph-neighbor", rank: seed.rank });
          }
          if (node.kind === "symbol" && node.symbolName !== null) {
            symbolCandidates.push({ name: node.symbolName, nodeId: node.id, file: node.path, line: node.line, origin: "graph", rank: seed.rank });
            if (node.line !== null && !lineByNodeId.has(node.id)) lineByNodeId.set(node.id, node.line);
          }
        }
        for (const edge of parsed.value.edges) callCandidates.push({ fromNodeId: edge.source, toNodeId: edge.target, kind: edge.kind });
      } else {
        graphIncomplete = true;
        steps.push({ kind: "slice", nodeId: seed.nodeId, sourceMode: null, succeeded: false, reason: slice.ok ? "malformed-output" : "command-failed" });
      }
    } catch {
      graphIncomplete = true;
      steps.push({ kind: "slice", nodeId: seed.nodeId, sourceMode: null, succeeded: false, reason: "command-failed" });
    }
  }

  // 3. Bounded source for the selected symbols, in selection order, at most MAX_SOURCE_SLICES commands.
  const selectedSymbols = selectRelevantSymbols(symbolCandidates).items;
  const sliceCandidates: ContextPackSourceSliceCandidate[] = [];
  let sourceIncomplete = false;
  let sourceCount = 0;
  for (const symbol of selectedSymbols) {
    if (sourceCount >= MAX_SOURCE_SLICES) break;
    if (symbol.file === null) continue;
    const line = (symbol.nodeId !== null ? lineByNodeId.get(symbol.nodeId) : undefined) ?? (symbolIndex ? findIndexedSymbolLine(symbolIndex, symbol.file, symbol.name) : null);
    const range = symbolIndex && line !== null ? deriveSymbolSourceRange(symbolIndex, symbol.file, line) : null;
    if (!range && symbol.nodeId === null) continue;
    sourceCount += 1;
    const sourceMode = range ? ("index-range" as const) : ("node" as const);
    const nodeId = symbol.nodeId;
    try {
      const args = range
        ? ["source", "--index", indexDir, "--file", symbol.file, "--start", String(range.startLine), "--end", String(range.endLine), "--json"]
        : ["source", "--index", indexDir, "--node", nodeId as string, "--max-lines", String(MAX_SOURCE_LINES_PER_SLICE), "--json"];
      const source = await run(`source-${pad(sourceCount - 1)}`, args);
      const parsed = source.ok ? parseSource(source.stdout) : null;
      if (!parsed || !parsed.ok) {
        sourceIncomplete = true;
        steps.push({ kind: "source", nodeId, sourceMode, succeeded: false, reason: source.ok ? "malformed-output" : "command-failed" });
        continue;
      }
      const value = parsed.value;
      steps.push({ kind: "source", nodeId, sourceMode, succeeded: true, reason: value.boundaryKnown ? null : "symbol-end-unknown" });
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
      steps.push({ kind: "source", nodeId, sourceMode, succeeded: false, reason: "command-failed" });
    }
  }
  const boundaryUnknown = sliceCandidates.some((candidate) => !candidate.boundaryKnown);

  // 4. Deterministic section availability decided here (execution), then pure composition.
  const available: ContextPackSectionAvailabilityInput = { availability: "available", reason: null };
  const graphSection: ContextPackSectionAvailabilityInput = graphIncomplete ? { availability: "partial", reason: "graph-step-incomplete" } : available;
  const sourceSection: ContextPackSectionAvailabilityInput = sourceIncomplete
    ? { availability: "partial", reason: "source-step-incomplete" }
    : boundaryUnknown
      ? { availability: "partial", reason: "symbol-end-unknown" }
      : available;
  const sectionAvailability = { files: graphSection, symbols: graphSection, sourceSlices: sourceSection, callRelationships: graphSection, tests: graphSection, evidenceNotes: available };
  const packAvailability: ContextPackAvailability = graphIncomplete || sourceIncomplete || boundaryUnknown ? "partial" : "available";
  const packReason = graphIncomplete ? "graph-step-incomplete" : sourceIncomplete ? "source-step-incomplete" : boundaryUnknown ? "symbol-end-unknown" : null;

  let pack: ContextPack;
  try {
    pack = buildContextPack({
      caseId: evaluationCase.id,
      benchmarkProject: evaluationCase.benchmarkProject,
      taskLocality: evaluationCase.taskLocality ?? null,
      task: { title: evaluationCase.title, summary: evaluationCase.query },
      myDevKitVersion: context.myDevKitVersion,
      fileCandidates,
      symbolCandidates,
      sourceSliceCandidates: sliceCandidates,
      callCandidates,
      testCandidates,
      evidenceNotes: extraNotes,
      sectionAvailability,
      availability: packAvailability,
      reason: packReason
    });
  } catch {
    return fail("pack-construction-failed");
  }

  // Slice-contained symbols need the symbol index; without it the identity evidence is explicitly partial, never guessed.
  const identitySource = symbolIndex || pack.availability !== "available" ? pack : { ...pack, availability: "partial" as const, reason: "symbol-index-unavailable" };
  return {
    pack,
    treatment: {
      treatmentId: "context-pack",
      status: statusOf(identitySource.availability),
      availability: identitySource.availability,
      availabilityReason: identitySource.reason,
      size: pack.size,
      identityEvidence: buildContextPackIdentityEvidence(identitySource, symbolIndex?.files ?? []),
      includedFiles: pack.files.map((file) => file.path),
      steps,
      sections: pack.sections.map((section) => ({ ...section })),
      evidenceNotes: [...pack.evidenceNotes],
      packArtifactPath: contextPackArtifactRelativePath(evaluationCase.id),
      errors: []
    }
  };
}

/**
 * Matched two-treatment execution (raw-full-file, context-pack). One base index per benchmark project, shared by both
 * treatments of every case in it; cases run strictly sequentially in corpus order. Builds no scientific analysis and
 * writes nothing durable: it returns bounded evidence plus the in-memory packs.
 */
export async function executeContextPackGeneration(options: {
  cases: readonly EvaluationCase[];
  kitCommand: string;
  outputRoot: string;
  dependencies?: Partial<ContextPackGenerationDependencies>;
}): Promise<ContextPackGenerationCaseResult[]> {
  const dependencies: ContextPackGenerationDependencies = { ...defaultDependencies, ...options.dependencies };
  const results = new Map<string, ContextPackGenerationCaseResult>();

  const validCases: EvaluationCase[] = [];
  for (const evaluationCase of options.cases) {
    if (validateRetrievalPrecisionRecallCase(evaluationCase).length > 0) results.set(evaluationCase.id, failedCase(evaluationCase, "ground-truth-invalid"));
    else validCases.push(evaluationCase);
  }

  let myDevKitVersion: string | null = null;
  for (const group of groupWarmIndexCases(validCases)) {
    if (group.structuralErrors.length > 0) {
      for (const evaluationCase of group.cases) results.set(evaluationCase.id, failedCase(evaluationCase, "project-group-inconsistent"));
      continue;
    }
    const baseIndexDir = resolveWithinRoot(options.outputRoot, path.join("indexes", group.projectSegment, "base"));
    const projectCommandsDir = resolveWithinRoot(options.outputRoot, path.join("commands", group.projectSegment));
    let indexReady = false;
    try {
      const build = await dependencies.buildIndex({
        target: { absoluteTargetRoot: group.targetRoot, sourceRoots: [...group.sourceRoots] },
        kitCommand: options.kitCommand,
        indexDir: baseIndexDir,
        commandsDir: path.join(projectCommandsDir, "index"),
        requireKit: false,
        // Context packs carry call relationships, which upstream emits only for call-graph indexes.
        callGraph: true
      });
      indexReady = build.ok;
    } catch {
      indexReady = false;
    }
    if (!indexReady) {
      for (const evaluationCase of group.cases) results.set(evaluationCase.id, failedCase(evaluationCase, "project-index-failed"));
      continue;
    }
    if (myDevKitVersion === null) {
      const tool = await dependencies.probeVersion({ kitCommand: options.kitCommand, commandsDir: resolveWithinRoot(options.outputRoot, path.join("commands", "version")) });
      myDevKitVersion = tool.version ?? "unavailable";
    }
    let symbolIndex: ValidatedSymbolIndex | null = null;
    try {
      symbolIndex = interpretSymbolIndex(await dependencies.readSymbolIndex(baseIndexDir));
    } catch {
      symbolIndex = null;
    }
    for (const evaluationCase of group.cases) {
      const context: CaseContext = {
        evaluationCase,
        kitCommand: options.kitCommand,
        indexDir: baseIndexDir,
        commandsDir: resolveWithinRoot(projectCommandsDir, taskOutputSegment(evaluationCase.id)),
        symbolIndex,
        myDevKitVersion,
        dependencies
      };
      // Strictly sequential, fixed treatment order.
      const raw = await executeRawTreatment(context);
      const pack = await executePackTreatment(context);
      const evidence: ContextPackGenerationCaseEvidenceV1 = {
        caseId: evaluationCase.id,
        caseName: evaluationCase.title,
        benchmarkProject: evaluationCase.benchmarkProject,
        taskLocality: evaluationCase.taskLocality ?? null,
        treatments: [raw, pack.treatment]
      };
      results.set(evaluationCase.id, { evidence, pack: pack.pack });
    }
  }

  // Selection order is the corpus order after filtering, regardless of how projects were grouped.
  return options.cases.map((evaluationCase) => results.get(evaluationCase.id) as ContextPackGenerationCaseResult);
}
