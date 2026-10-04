import path from "node:path";
import type { MeasuredCommandResult } from "../../../src/core/runMeasuredCommand.js";
import { calculateRetrievalQualityMetrics, type RetrievalEvidenceV1 } from "../../../src/evaluation/retrievalQuality/index.js";
import type { EvaluationCase, MyDevKitIndexBuildResult, MyDevKitRetrievalResult } from "../../../src/evaluation/types.js";
import type { RetrievalPrecisionRecallCaseEvidenceV1 } from "../../../src/experiments/plugins/retrievalPrecisionRecall/index.js";

/** Sentinels that must never appear in any durable artifact or report. */
export const SOURCE_SENTINEL = "SENTINEL_SOURCE_BODY_do_not_persist";
export const STDOUT_SENTINEL = "SENTINEL_RAW_STDOUT_do_not_persist";
export const STDERR_SENTINEL = "SENTINEL_RAW_STDERR_do_not_persist";
export const COMMAND_PATH_SENTINEL = "C:\\Users\\sentinel-user\\private\\my-dev-kit.cmd";

export function makeEvaluationCase(args: {
  id: string;
  project?: string;
  files?: string[];
  symbols?: string[];
  targetRoot?: string;
  sourceRoots?: string[];
  locality?: EvaluationCase["taskLocality"];
  withFactMapping?: boolean;
}): EvaluationCase {
  const files = args.files ?? ["src/a.ts", "src/b.ts"];
  const symbols = args.symbols ?? ["A", "B"];
  const project = args.project ?? "project-one";
  const targetRoot = args.targetRoot ?? path.resolve("benchmarks/projects", project);
  return {
    id: args.id,
    title: `Title of ${args.id}`,
    benchmarkProject: project,
    targetRoot: path.relative(process.cwd(), targetRoot),
    absoluteTargetRoot: targetRoot,
    sourceRoots: args.sourceRoots ?? ["src"],
    query: `query for ${args.id}`,
    expectedFiles: files,
    expectedSymbols: symbols,
    rawIncludeGlobs: ["src/**/*"],
    taskLocality: args.locality ?? "localized",
    answerKey: {
      expectedFiles: files,
      expectedSymbols: symbols,
      expectedFacts: [
        { id: `${args.id}-fact-1`, text: "first fact", weight: 1, required: true },
        { id: `${args.id}-fact-2`, text: "second fact", weight: 1, required: true }
      ],
      expectedContextTargets:
        args.withFactMapping === false
          ? undefined
          : [
              { file: files[0], symbols: [symbols[0]], required: true, factIds: [`${args.id}-fact-1`] },
              { file: files[1] ?? files[0], symbols: [symbols[1] ?? symbols[0]], required: true, factIds: [`${args.id}-fact-2`] }
            ],
      minimumCorrectFacts: 1
    }
  };
}

export function evidenceOf(
  files: string[],
  symbols: Array<{ name: string; file?: string }> = [],
  availability: RetrievalEvidenceV1["availability"] = "available"
): RetrievalEvidenceV1 {
  return {
    schemaVersion: "retrieval-evidence-v1",
    availability,
    ...(availability === "available" ? {} : { availabilityReason: "some-executed-commands-were-not-fully-interpreted" }),
    files: files.map((file) => ({ path: file, surfacedBy: ["search" as const] })),
    symbols: symbols.map((symbol) => ({ ...symbol, surfacedBy: ["search" as const] })),
    commands: [
      { family: "search", succeeded: true, parseState: "parsed", fileEvidenceCount: files.length, symbolEvidenceCount: symbols.length, rejectedIdentityCount: 0 }
    ]
  };
}

function measuredCommand(commandId: string): MeasuredCommandResult {
  return {
    commandId,
    commandString: COMMAND_PATH_SENTINEL,
    executable: COMMAND_PATH_SENTINEL,
    args: [COMMAND_PATH_SENTINEL, commandId],
    cwd: "C:\\Users\\sentinel-user\\private",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1,
    exitCode: 0,
    stdout: STDOUT_SENTINEL,
    stderr: STDERR_SENTINEL,
    stdoutPath: "C:\\Users\\sentinel-user\\private\\stdout.txt",
    stderrPath: "C:\\Users\\sentinel-user\\private\\stderr.txt",
    telemetryPath: "C:\\Users\\sentinel-user\\private\\telemetry.json",
    ok: true
  };
}

/** A retrieval result as the real lifecycle returns it: with contextText and raw command output attached. */
export function retrievalResultOf(
  evaluationCase: EvaluationCase,
  retrievalEvidence: RetrievalEvidenceV1 | undefined,
  options: { tokens?: number; skipped?: boolean; warnings?: string[] } = {}
): MyDevKitRetrievalResult {
  return {
    caseId: evaluationCase.id,
    skipped: options.skipped ?? false,
    warnings: options.warnings ?? [],
    totalChars: 400,
    totalEstimatedTokens: options.tokens ?? 100,
    tokenCountMethod: "estimated_chars_div_4",
    contextText: SOURCE_SENTINEL,
    filesRead: ["src/a.ts"],
    commands: ["search", "lookup", "slice", "source"].map(measuredCommand),
    selectedNodeId: "n1",
    selectedFile: "src/a.ts",
    selectedSymbol: "A",
    retrievalEvidence,
    durationMs: 5
  };
}

export function indexResultOf(indexDir: string, ok = true): MyDevKitIndexBuildResult {
  const command = measuredCommand("index");
  return { indexDir, durationMs: 1, command, mode: { kind: "full" }, ok, warnings: ok ? [] : ["my-dev-kit index command was unavailable or failed."], incrementalRefresh: null };
}

/** Per-case evidence whose quality comes from the real Batch 2 calculator, as a completed/partial case would carry. */
export function caseEvidenceFor(
  evaluationCase: EvaluationCase,
  retrievalEvidence: RetrievalEvidenceV1 | undefined,
  tokens = 100
): RetrievalPrecisionRecallCaseEvidenceV1 {
  const result = retrievalResultOf(evaluationCase, retrievalEvidence, { tokens });
  return {
    caseId: evaluationCase.id,
    caseName: evaluationCase.title,
    benchmarkProject: evaluationCase.benchmarkProject,
    taskLocality: evaluationCase.taskLocality ?? null,
    status: retrievalEvidence?.availability === "available" ? "completed" : "partial",
    retrieval: {
      skipped: false,
      durationMs: 5,
      totalEstimatedTokens: tokens,
      tokenCountMethod: "estimated_chars_div_4",
      warnings: [],
      evidenceAvailability: retrievalEvidence?.availability ?? "missing",
      evidenceAvailabilityReason: retrievalEvidence?.availabilityReason ?? null,
      retrievedFileCount: retrievalEvidence?.files.length ?? null,
      retrievedSymbolCount: retrievalEvidence?.symbols.length ?? null,
      commands: []
    },
    quality: calculateRetrievalQualityMetrics({ evaluationCase, retrieval: result }),
    errors: []
  };
}

export function failedCaseEvidence(evaluationCase: EvaluationCase): RetrievalPrecisionRecallCaseEvidenceV1 {
  return {
    caseId: evaluationCase.id,
    caseName: evaluationCase.title,
    benchmarkProject: evaluationCase.benchmarkProject,
    taskLocality: evaluationCase.taskLocality ?? null,
    status: "failed",
    retrieval: null,
    quality: null,
    errors: [{ code: "project-index-failed", message: "my-dev-kit index command was unavailable or failed." }]
  };
}
