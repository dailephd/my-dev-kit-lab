import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import { buildMyDevKitIndex, runMyDevKitRetrievalFromIndex } from "../../../evaluation/runMyDevKitRetrieval.js";
import { calculateRetrievalQualityMetrics, validateRetrievalPrecisionRecallCase } from "../../../evaluation/retrievalQuality/index.js";
import type { EvaluationCase, MyDevKitRetrievalResult } from "../../../evaluation/types.js";
import type { ExperimentRunStatus } from "../../types.js";
import { groupWarmIndexCases, taskOutputSegment } from "../warmIndexReuse/selection.js";
import type {
  RetrievalPrecisionRecallCaseEvidenceV1,
  RetrievalPrecisionRecallErrorCode,
  RetrievalPrecisionRecallErrorV1,
  RetrievalPrecisionRecallRetrievalSummaryV1
} from "./types.js";

/** Test seam: programmatic callers may substitute the two lifecycle owners; the public command never does. */
export type RetrievalPrecisionRecallDependencies = {
  buildIndex: typeof buildMyDevKitIndex;
  retrieveFromIndex: typeof runMyDevKitRetrievalFromIndex;
};

const MAX_MESSAGE_LENGTH = 300;
const MAX_WARNINGS = 20;

/** Bounds a message and replaces machine-local paths so persisted errors never carry them. */
export function boundedRetrievalSafeMessage(message: string, knownRoots: readonly string[] = []): string {
  let text = message;
  for (const root of knownRoots) {
    if (!root) continue;
    text = text.split(root).join("<path>").split(root.replace(/\\/g, "/")).join("<path>");
  }
  text = text
    .replace(/[A-Za-z]:[\\/][^\s"'`]*/g, "<path>")
    .replace(/(?:^|(?<=[\s"'`(]))\/(?:Users|home|tmp|var|private|opt|mnt)\/[^\s"'`]*/g, "<path>")
    .replace(/[\u0000-\u001f\u007f]/g, " ");
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}...` : text;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function failedCase(
  evaluationCase: EvaluationCase,
  code: RetrievalPrecisionRecallErrorCode,
  message: string
): RetrievalPrecisionRecallCaseEvidenceV1 {
  return {
    caseId: evaluationCase.id,
    caseName: evaluationCase.title,
    benchmarkProject: evaluationCase.benchmarkProject,
    taskLocality: evaluationCase.taskLocality ?? null,
    status: "failed",
    retrieval: null,
    quality: null,
    errors: [{ code, message }]
  };
}

function summarizeRetrieval(result: MyDevKitRetrievalResult): RetrievalPrecisionRecallRetrievalSummaryV1 {
  const evidence = result.retrievalEvidence;
  return {
    skipped: result.skipped,
    durationMs: result.durationMs,
    totalEstimatedTokens: result.totalEstimatedTokens,
    tokenCountMethod: result.tokenCountMethod,
    warnings: result.warnings.slice(0, MAX_WARNINGS).map((warning) => boundedRetrievalSafeMessage(warning)),
    evidenceAvailability: evidence?.availability ?? "missing",
    evidenceAvailabilityReason: evidence?.availabilityReason ?? (evidence === undefined ? "retrieval-evidence-missing" : null),
    retrievedFileCount: evidence?.files.length ?? null,
    retrievedSymbolCount: evidence?.symbols.length ?? null,
    commands: evidence ? evidence.commands.map((command) => ({ ...command })) : []
  };
}

/**
 * One full index per benchmark project, then one retrieval per case from that project's prepared index, using the
 * existing lifecycle owners. A failed project fails only its own cases. No agent runs. Only bounded, context-free
 * evidence is returned: retrieval results (and their contextText) never leave this function.
 */
export async function executeRetrievalPrecisionRecall(options: {
  cases: readonly EvaluationCase[];
  kitCommand: string;
  outputRoot: string;
  dependencies?: Partial<RetrievalPrecisionRecallDependencies>;
}): Promise<RetrievalPrecisionRecallCaseEvidenceV1[]> {
  const buildIndex = options.dependencies?.buildIndex ?? buildMyDevKitIndex;
  const retrieveFromIndex = options.dependencies?.retrieveFromIndex ?? runMyDevKitRetrievalFromIndex;
  const results = new Map<string, RetrievalPrecisionRecallCaseEvidenceV1>();
  const knownRoots = [options.outputRoot, ...options.cases.map((evaluationCase) => evaluationCase.absoluteTargetRoot)];

  const validCases: EvaluationCase[] = [];
  for (const evaluationCase of options.cases) {
    const groundTruthErrors = validateRetrievalPrecisionRecallCase(evaluationCase);
    if (groundTruthErrors.length > 0) {
      results.set(evaluationCase.id, failedCase(evaluationCase, "ground-truth-invalid", boundedRetrievalSafeMessage(groundTruthErrors.join(" "), knownRoots)));
    } else {
      validCases.push(evaluationCase);
    }
  }

  for (const group of groupWarmIndexCases(validCases)) {
    if (group.structuralErrors.length > 0) {
      for (const evaluationCase of group.cases) {
        results.set(
          evaluationCase.id,
          failedCase(evaluationCase, "project-group-inconsistent", "Cases of one benchmark project disagree on target root or source roots.")
        );
      }
      continue;
    }
    const indexDir = resolveWithinRoot(options.outputRoot, path.join("indexes", group.projectSegment));
    const commandsDir = resolveWithinRoot(options.outputRoot, path.join("commands", group.projectSegment));
    let indexFailure: string | undefined;
    try {
      // requireKit: false keeps a failed index as measurable evidence instead of throwing.
      const build = await buildIndex({
        target: { absoluteTargetRoot: group.targetRoot, sourceRoots: [...group.sourceRoots] },
        kitCommand: options.kitCommand,
        indexDir,
        commandsDir: path.join(commandsDir, "index"),
        requireKit: false
      });
      if (!build.ok) indexFailure = build.warnings.join(" ") || "my-dev-kit index setup failed.";
    } catch (error) {
      indexFailure = errorText(error);
    }
    if (indexFailure !== undefined) {
      const message = boundedRetrievalSafeMessage(indexFailure, knownRoots);
      for (const evaluationCase of group.cases) {
        results.set(evaluationCase.id, failedCase(evaluationCase, "project-index-failed", message));
      }
      continue;
    }

    for (const evaluationCase of group.cases) {
      results.set(
        evaluationCase.id,
        await executeCase({
          evaluationCase,
          kitCommand: options.kitCommand,
          indexDir,
          commandsDir: path.join(commandsDir, taskOutputSegment(evaluationCase.id)),
          retrieveFromIndex,
          knownRoots
        })
      );
    }
  }

  // Selection order is the corpus order after filtering, regardless of how projects were grouped.
  return options.cases.map((evaluationCase) => results.get(evaluationCase.id) as RetrievalPrecisionRecallCaseEvidenceV1);
}

async function executeCase(args: {
  evaluationCase: EvaluationCase;
  kitCommand: string;
  indexDir: string;
  commandsDir: string;
  retrieveFromIndex: RetrievalPrecisionRecallDependencies["retrieveFromIndex"];
  knownRoots: readonly string[];
}): Promise<RetrievalPrecisionRecallCaseEvidenceV1> {
  const { evaluationCase } = args;
  let retrieval: MyDevKitRetrievalResult;
  try {
    retrieval = await args.retrieveFromIndex({
      evaluationCase,
      kitCommand: args.kitCommand,
      indexDir: args.indexDir,
      commandsDir: args.commandsDir,
      requireKit: false
    });
  } catch (error) {
    return failedCase(evaluationCase, "retrieval-failed", boundedRetrievalSafeMessage(errorText(error), args.knownRoots));
  }

  const quality = calculateRetrievalQualityMetrics({ evaluationCase, retrieval });
  const status: ExperimentRunStatus = retrieval.retrievalEvidence?.availability === "available" ? "completed" : "partial";
  const errors: RetrievalPrecisionRecallErrorV1[] = [];
  return {
    caseId: evaluationCase.id,
    caseName: evaluationCase.title,
    benchmarkProject: evaluationCase.benchmarkProject,
    taskLocality: evaluationCase.taskLocality ?? null,
    status,
    retrieval: summarizeRetrieval(retrieval),
    quality,
    errors
  };
}
