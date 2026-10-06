import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import { validateRetrievalPrecisionRecallCase } from "../../../evaluation/retrievalQuality/index.js";
import {
  RETRIEVAL_QUERY_STRATEGY_IDS,
  isCoreGraphRetrievalQueryStrategyId,
  type RetrievalQueryStrategyId
} from "../../../evaluation/retrievalQueryStrategies.js";
import type { RetrievalQueryStrategyEvidenceV1 } from "../../../evaluation/retrievalQueryStrategyEvidence.js";
import { buildMyDevKitIndex, runMyDevKitRetrievalStrategyFromIndex } from "../../../evaluation/runMyDevKitRetrieval.js";
import { runSemanticRetrievalStrategyFromIndex } from "../../../evaluation/runSemanticRetrievalStrategy.js";
import type { EvaluationCase } from "../../../evaluation/types.js";
import { groupWarmIndexCases, taskOutputSegment } from "../warmIndexReuse/selection.js";
import { boundedRetrievalSafeMessage } from "../retrievalPrecisionRecall/execution.js";
import type {
  RetrievalQueryStrategyComparisonCaseEvidenceV1,
  RetrievalQueryStrategyComparisonErrorCode,
  RetrievalQueryStrategyTreatmentEvidenceV1
} from "./types.js";

/** Test seam: only the three execution owners may be substituted. Filesystem copy/removal stays Lab-owned. */
export type RetrievalQueryStrategyComparisonDependencies = {
  buildIndex: typeof buildMyDevKitIndex;
  runCoreStrategy: typeof runMyDevKitRetrievalStrategyFromIndex;
  runSemanticStrategy: typeof runSemanticRetrievalStrategyFromIndex;
};

const MAX_WARNINGS = 20;
export const SEMANTIC_INDEX_CLEANUP_FAILED_WARNING = "semantic-index-cleanup-failed";

function failedTreatment(
  strategyId: RetrievalQueryStrategyId,
  code: RetrievalQueryStrategyComparisonErrorCode,
  message: string
): RetrievalQueryStrategyTreatmentEvidenceV1 {
  return { strategyId, status: "failed", retrieval: null, evidence: null, errors: [{ code, message }] };
}

/**
 * The single normalization point from an executed strategy result into bounded comparison evidence. It takes no
 * contextText and inspects no raw command output. An available observation (including an available empty one)
 * is COMPLETED; partial or unavailable evidence from a measured result is PARTIAL.
 */
export function buildQueryStrategyTreatmentEvidence(
  strategyId: RetrievalQueryStrategyId,
  result: {
    skipped: boolean;
    warnings: readonly string[];
    totalEstimatedTokens: number;
    tokenCountMethod: string;
    durationMs: number;
    queryStrategyEvidence: RetrievalQueryStrategyEvidenceV1;
  }
): RetrievalQueryStrategyTreatmentEvidenceV1 {
  const evidence = result.queryStrategyEvidence;
  return {
    strategyId,
    status: evidence.availability === "available" ? "completed" : "partial",
    retrieval: {
      skipped: result.skipped,
      durationMs: result.durationMs,
      totalEstimatedTokens: result.totalEstimatedTokens,
      tokenCountMethod: result.tokenCountMethod,
      warnings: result.warnings.slice(0, MAX_WARNINGS).map((warning) => boundedRetrievalSafeMessage(warning)),
      evidenceAvailability: evidence.availability,
      evidenceAvailabilityReason: evidence.availabilityReason,
      retrievedFileCount: evidence.files.length,
      retrievedSymbolCount: evidence.symbols.length,
      steps: evidence.steps.map((step) => ({ ...step }))
    },
    evidence: structuredClone(evidence),
    errors: []
  };
}

function failedCase(
  evaluationCase: EvaluationCase,
  code: RetrievalQueryStrategyComparisonErrorCode,
  message: string
): RetrievalQueryStrategyComparisonCaseEvidenceV1 {
  return {
    caseId: evaluationCase.id,
    caseName: evaluationCase.title,
    benchmarkProject: evaluationCase.benchmarkProject,
    taskLocality: evaluationCase.taskLocality ?? null,
    treatments: RETRIEVAL_QUERY_STRATEGY_IDS.map((strategyId) => failedTreatment(strategyId, code, message))
  };
}

/**
 * Matched seven-treatment execution. One base index per benchmark project; the five core strategies share it;
 * each semantic case/treatment gets a private copy of it because upstream `data-model` writes derived artifacts
 * into the index directory. No agent runs and no quality metric is calculated. Only bounded, context-free
 * evidence is returned.
 */
export async function executeRetrievalQueryStrategyComparison(options: {
  cases: readonly EvaluationCase[];
  kitCommand: string;
  outputRoot: string;
  dependencies?: Partial<RetrievalQueryStrategyComparisonDependencies>;
}): Promise<RetrievalQueryStrategyComparisonCaseEvidenceV1[]> {
  const dependencies: RetrievalQueryStrategyComparisonDependencies = {
    buildIndex: options.dependencies?.buildIndex ?? buildMyDevKitIndex,
    runCoreStrategy: options.dependencies?.runCoreStrategy ?? runMyDevKitRetrievalStrategyFromIndex,
    runSemanticStrategy: options.dependencies?.runSemanticStrategy ?? runSemanticRetrievalStrategyFromIndex
  };
  const results = new Map<string, RetrievalQueryStrategyComparisonCaseEvidenceV1>();

  const validCases: EvaluationCase[] = [];
  for (const evaluationCase of options.cases) {
    if (validateRetrievalPrecisionRecallCase(evaluationCase).length > 0) {
      results.set(
        evaluationCase.id,
        failedCase(evaluationCase, "ground-truth-invalid", "Retrieval comparison ground truth is invalid for this case.")
      );
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
    const baseIndexDir = resolveWithinRoot(options.outputRoot, path.join("indexes", group.projectSegment, "base"));
    const projectCommandsDir = resolveWithinRoot(options.outputRoot, path.join("commands", group.projectSegment));
    let indexReady = false;
    try {
      // requireKit: false keeps a failed index as measurable evidence instead of throwing. Full, ordinary index only.
      const build = await dependencies.buildIndex({
        target: { absoluteTargetRoot: group.targetRoot, sourceRoots: [...group.sourceRoots] },
        kitCommand: options.kitCommand,
        indexDir: baseIndexDir,
        commandsDir: path.join(projectCommandsDir, "index"),
        requireKit: false
      });
      indexReady = build.ok;
    } catch {
      indexReady = false;
    }
    if (!indexReady) {
      for (const evaluationCase of group.cases) {
        results.set(
          evaluationCase.id,
          failedCase(evaluationCase, "project-index-failed", "The benchmark-project index could not be prepared.")
        );
      }
      continue;
    }

    for (const evaluationCase of group.cases) {
      const caseSegment = taskOutputSegment(evaluationCase.id);
      results.set(
        evaluationCase.id,
        await executeRetrievalQueryStrategyCaseFromPreparedIndex({
          evaluationCase,
          kitCommand: options.kitCommand,
          baseIndexDir,
          commandsDir: resolveWithinRoot(projectCommandsDir, caseSegment),
          semanticIndexesRoot: resolveWithinRoot(options.outputRoot, path.join("strategy-indexes", group.projectSegment, caseSegment)),
          dependencies
        })
      );
    }
  }

  // Selection order is the corpus order after filtering, regardless of how projects were grouped.
  return options.cases.map((evaluationCase) => results.get(evaluationCase.id) as RetrievalQueryStrategyComparisonCaseEvidenceV1);
}

/**
 * Executes exactly seven treatments for one already-validated case against one already-prepared base index. Core
 * treatments share `baseIndexDir`; each semantic treatment gets its own fresh recursive copy under
 * `semanticIndexesRoot`. It builds no index, validates no ground truth, and calculates no scientific analysis.
 */
export async function executeRetrievalQueryStrategyCaseFromPreparedIndex(options: {
  evaluationCase: EvaluationCase;
  kitCommand: string;
  baseIndexDir: string;
  commandsDir: string;
  semanticIndexesRoot: string;
  dependencies?: Partial<Pick<RetrievalQueryStrategyComparisonDependencies, "runCoreStrategy" | "runSemanticStrategy">>;
}): Promise<RetrievalQueryStrategyComparisonCaseEvidenceV1> {
  const { evaluationCase } = options;
  const dependencies = {
    runCoreStrategy: options.dependencies?.runCoreStrategy ?? runMyDevKitRetrievalStrategyFromIndex,
    runSemanticStrategy: options.dependencies?.runSemanticStrategy ?? runSemanticRetrievalStrategyFromIndex
  };
  const treatments: RetrievalQueryStrategyTreatmentEvidenceV1[] = [];
  // Strictly sequential, in the frozen strategy order: deterministic chronology and failure ordering.
  for (const strategyId of RETRIEVAL_QUERY_STRATEGY_IDS) {
    const commandsDir = resolveWithinRoot(options.commandsDir, strategyId);
    treatments.push(
      isCoreGraphRetrievalQueryStrategyId(strategyId)
        ? await executeCoreTreatment({
            strategyId,
            evaluationCase,
            kitCommand: options.kitCommand,
            baseIndexDir: options.baseIndexDir,
            commandsDir,
            dependencies
          })
        : await executeSemanticTreatment({
            strategyId,
            evaluationCase,
            kitCommand: options.kitCommand,
            baseIndexDir: options.baseIndexDir,
            treatmentIndexDir: resolveWithinRoot(options.semanticIndexesRoot, strategyId),
            commandsDir,
            dependencies
          })
    );
  }
  return {
    caseId: evaluationCase.id,
    caseName: evaluationCase.title,
    benchmarkProject: evaluationCase.benchmarkProject,
    taskLocality: evaluationCase.taskLocality ?? null,
    treatments
  };
}

const SEMANTIC_INDEX_CLEANUP_FAILED_MESSAGE = "The isolated semantic-strategy index could not be removed.";
const RETRIEVAL_THREW_MESSAGE = "The retrieval strategy threw before producing a measurement.";

async function executeCoreTreatment(args: {
  strategyId: Parameters<RetrievalQueryStrategyComparisonDependencies["runCoreStrategy"]>[0]["strategyId"];
  evaluationCase: EvaluationCase;
  kitCommand: string;
  baseIndexDir: string;
  commandsDir: string;
  dependencies: Pick<RetrievalQueryStrategyComparisonDependencies, "runCoreStrategy" | "runSemanticStrategy">;
}): Promise<RetrievalQueryStrategyTreatmentEvidenceV1> {
  try {
    const result = await args.dependencies.runCoreStrategy({
      strategyId: args.strategyId,
      evaluationCase: args.evaluationCase,
      kitCommand: args.kitCommand,
      indexDir: args.baseIndexDir,
      commandsDir: args.commandsDir,
      requireKit: false
    });
    const evidence = result.queryStrategyEvidence;
    if (!evidence) return failedTreatment(args.strategyId, "retrieval-failed", RETRIEVAL_THREW_MESSAGE);
    return buildQueryStrategyTreatmentEvidence(args.strategyId, { ...result, queryStrategyEvidence: evidence });
  } catch {
    return failedTreatment(args.strategyId, "retrieval-failed", RETRIEVAL_THREW_MESSAGE);
  }
}

async function executeSemanticTreatment(args: {
  strategyId: Parameters<RetrievalQueryStrategyComparisonDependencies["runSemanticStrategy"]>[0]["strategyId"];
  evaluationCase: EvaluationCase;
  kitCommand: string;
  baseIndexDir: string;
  treatmentIndexDir: string;
  commandsDir: string;
  dependencies: Pick<RetrievalQueryStrategyComparisonDependencies, "runCoreStrategy" | "runSemanticStrategy">;
}): Promise<RetrievalQueryStrategyTreatmentEvidenceV1> {
  try {
    // Fresh copy of the untouched base index; the destination must not pre-exist.
    await rm(args.treatmentIndexDir, { recursive: true, force: true });
    await cp(args.baseIndexDir, args.treatmentIndexDir, { recursive: true });
  } catch {
    await rm(args.treatmentIndexDir, { recursive: true, force: true }).catch(() => undefined);
    return failedTreatment(args.strategyId, "strategy-index-copy-failed", "The isolated semantic-strategy index could not be prepared.");
  }

  let treatment: RetrievalQueryStrategyTreatmentEvidenceV1;
  let cleanupFailed = false;
  try {
    const result = await args.dependencies.runSemanticStrategy({
      strategyId: args.strategyId,
      evaluationCase: args.evaluationCase,
      kitCommand: args.kitCommand,
      indexDir: args.treatmentIndexDir,
      commandsDir: args.commandsDir,
      requireKit: false
    });
    treatment = buildQueryStrategyTreatmentEvidence(args.strategyId, result);
  } catch {
    treatment = failedTreatment(args.strategyId, "retrieval-failed", RETRIEVAL_THREW_MESSAGE);
  } finally {
    try {
      await rm(args.treatmentIndexDir, { recursive: true, force: true });
    } catch {
      // A cleanup failure never invalidates a measurement; it is recorded as a fixed, path-free warning.
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) {
    if (treatment.retrieval) {
      treatment.retrieval.warnings = [...treatment.retrieval.warnings, SEMANTIC_INDEX_CLEANUP_FAILED_WARNING];
    } else {
      // No measurement exists: keep the primary failure and make the leftover copied index auditable (path-free).
      treatment.errors = [...treatment.errors, { code: "strategy-index-cleanup-failed", message: SEMANTIC_INDEX_CLEANUP_FAILED_MESSAGE }];
    }
  }
  return treatment;
}
