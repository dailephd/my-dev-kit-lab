import path from "node:path";
import { tokenCountMethod } from "../../../core/countTokens.js";
import { runMyDevKitRetrieval } from "../../../evaluation/runMyDevKitRetrieval.js";
import { runRawFullFileBaseline } from "../../../evaluation/runRawFullFileBaseline.js";
import type {
  BenchmarkProjectProfile,
  EvaluationCase,
  MyDevKitRetrievalResult,
  RawFullFileBaselineResult,
} from "../../../evaluation/types.js";
import type { ExperimentRunStatus } from "../../types.js";
import { taskOutputSegment } from "../warmIndexReuse/selection.js";
import { evaluateTreatmentWithFakeAgent, type TreatmentEvaluator } from "./evaluation.js";
import type {
  CaseExecutionEvidenceV1,
  TreatmentContextEvidence,
  TreatmentEvaluationEvidence,
  TreatmentExecutionEvidenceV1,
} from "./executionArtifact.js";
import { CONTEXT_WINDOW_SCALING_TREATMENT_IDS, type ContextWindowScalingTreatmentId } from "./metadata.js";
import { computeRelevantFileEvidence } from "./relevantFiles.js";
import { buildBudgetCell, UNAVAILABLE_CORRECTNESS } from "./successEvidence.js";
import type { ContextBudgetTokens } from "./types.js";

/** Test seams; defaults are the production owners. Budget never reaches any of them. */
export type ContextWindowScalingDependencies = {
  constructRawContext: (evaluationCase: EvaluationCase) => Promise<RawFullFileBaselineResult>;
  constructGuidedContext: (args: {
    evaluationCase: EvaluationCase;
    kitCommand: string;
    outputDir: string;
  }) => Promise<MyDevKitRetrievalResult>;
  evaluateTreatment: TreatmentEvaluator;
};

export const defaultContextWindowScalingDependencies: ContextWindowScalingDependencies = {
  constructRawContext: (evaluationCase) => runRawFullFileBaseline(evaluationCase),
  constructGuidedContext: ({ evaluationCase, kitCommand, outputDir }) =>
    runMyDevKitRetrieval({ evaluationCase, kitCommand, outputDir, requireKit: false }),
  evaluateTreatment: evaluateTreatmentWithFakeAgent,
};

type ConstructedContext = {
  context: TreatmentContextEvidence;
  /** Set when context construction legitimately produced no usable evidence (existing skipped semantics). */
  skipped: boolean;
  /** Set when construction threw: the treatment evidence is invalid. */
  error: { code: string; message: string } | null;
};

/**
 * Per case: construct each treatment context once, then evaluate that one context against every
 * budget. A deterministic evaluation runs at most once per treatment and is shared by the budgets
 * the context fits. Nothing is truncated, retried, or rebuilt per budget.
 */
export async function executeContextWindowScalingCases(args: {
  cases: readonly EvaluationCase[];
  contextBudgets: readonly ContextBudgetTokens[];
  kitCommand: string;
  outputRoot: string;
  projectProfiles: readonly BenchmarkProjectProfile[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  dependencies?: Partial<ContextWindowScalingDependencies>;
}): Promise<CaseExecutionEvidenceV1[]> {
  const deps = { ...defaultContextWindowScalingDependencies, ...args.dependencies };
  const results: CaseExecutionEvidenceV1[] = [];
  for (const evaluationCase of args.cases) {
    const treatments: TreatmentExecutionEvidenceV1[] = [];
    for (const variantId of CONTEXT_WINDOW_SCALING_TREATMENT_IDS) {
      treatments.push(await executeTreatment({ ...args, evaluationCase, variantId, deps }));
    }
    results.push({
      caseId: evaluationCase.id,
      caseName: evaluationCase.title,
      benchmarkProject: evaluationCase.benchmarkProject,
      targetRoot: evaluationCase.targetRoot,
      taskLocality: evaluationCase.taskLocality ?? null,
      treatments,
    });
  }
  return results;
}

async function executeTreatment(args: {
  evaluationCase: EvaluationCase;
  variantId: ContextWindowScalingTreatmentId;
  contextBudgets: readonly ContextBudgetTokens[];
  kitCommand: string;
  outputRoot: string;
  projectProfiles: readonly BenchmarkProjectProfile[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  deps: ContextWindowScalingDependencies;
}): Promise<TreatmentExecutionEvidenceV1> {
  const { evaluationCase, variantId, deps } = args;
  const constructed = await constructContext(args);
  const tokens = constructed.context.estimatedTokens;
  const expectedFiles = evaluationCase.answerKey?.expectedFiles ?? evaluationCase.expectedFiles;
  const relevantFileEvidence = computeRelevantFileEvidence({
    expectedFiles,
    observedFiles: constructed.context.observedFiles,
  });

  let evaluation: TreatmentEvaluationEvidence;
  const anyFits = tokens !== null && args.contextBudgets.some((budget) => tokens <= budget);
  if (tokens === null) {
    evaluation = emptyEvaluation("unavailable", "Treatment context is unavailable.");
  } else if (!anyFits) {
    evaluation = emptyEvaluation("not-evaluated-no-fitting-budget", "The context is too large for every selected budget.");
  } else {
    evaluation = await evaluateOnce(args, deps);
  }

  const budgetCells = args.contextBudgets.map((contextBudgetTokens) =>
    buildBudgetCell({
      contextBudgetTokens,
      contextEstimatedTokens: tokens,
      shared: evaluation.status === "evaluated" || evaluation.status === "unavailable" ? evaluation.correctness : null,
    })
  );

  return {
    variantId,
    status: treatmentStatus(constructed, budgetCells.map((cell) => cell.contextFitStatus === "fits" && cell.evaluationStatus === "unavailable")),
    context: constructed.context,
    evaluation,
    relevantFileEvidence,
    budgetCells,
    errors: constructed.error ? [constructed.error] : [],
  };
}

async function evaluateOnce(
  args: Parameters<typeof executeTreatment>[0],
  deps: ContextWindowScalingDependencies
): Promise<TreatmentEvaluationEvidence> {
  try {
    const result = await deps.evaluateTreatment({
      evaluationCase: args.evaluationCase,
      treatment: args.variantId,
      projectProfiles: args.projectProfiles,
      outputRoot: args.outputRoot,
      cwd: args.cwd,
      env: args.env,
    });
    const available = result.correctness.availability === "available";
    return {
      status: available ? "evaluated" : "unavailable",
      agentId: result.agentId,
      agentStatus: result.agentStatus,
      evaluationCount: 1,
      correctness: result.correctness,
      failureReasons: result.failureReasons,
      warnings: [...result.warnings, ...result.errors],
      reason: available ? null : `Deterministic evaluation was not scoreable (agent status ${result.agentStatus}).`,
    };
  } catch (error) {
    return {
      ...emptyEvaluation("unavailable", error instanceof Error ? error.message : String(error)),
      evaluationCount: 1,
    };
  }
}

function emptyEvaluation(status: TreatmentEvaluationEvidence["status"], reason: string): TreatmentEvaluationEvidence {
  return {
    status,
    agentId: null,
    agentStatus: null,
    evaluationCount: 0,
    correctness: { ...UNAVAILABLE_CORRECTNESS },
    failureReasons: [],
    warnings: [],
    reason,
  };
}

function treatmentStatus(constructed: ConstructedContext, fittingCellUnavailable: boolean[]): ExperimentRunStatus {
  if (constructed.error) return "failed";
  if (constructed.skipped) return "skipped";
  return fittingCellUnavailable.some(Boolean) ? "partial" : "completed";
}

async function constructContext(args: {
  evaluationCase: EvaluationCase;
  variantId: ContextWindowScalingTreatmentId;
  kitCommand: string;
  outputRoot: string;
  deps: ContextWindowScalingDependencies;
}): Promise<ConstructedContext> {
  const { evaluationCase, variantId, deps } = args;
  try {
    if (variantId === "raw-full-file") {
      const raw = await deps.constructRawContext(evaluationCase);
      return {
        skipped: false,
        error: null,
        context: {
          status: "available",
          characterCount: raw.totalChars,
          estimatedTokens: raw.totalEstimatedTokens,
          tokenCountMethod: raw.tokenCountMethod,
          observedFiles: [...raw.filesIncluded],
          warnings: [],
          reason: null,
        },
      };
    }
    const guided = await deps.constructGuidedContext({
      evaluationCase,
      kitCommand: args.kitCommand,
      outputDir: path.join(args.outputRoot, "guided", taskOutputSegment(evaluationCase.id)),
    });
    if (guided.skipped) {
      return {
        skipped: true,
        error: null,
        context: unavailableContext(guided.warnings, "my-dev-kit-guided retrieval was skipped and produced no context."),
      };
    }
    return {
      skipped: false,
      error: null,
      context: {
        status: "available",
        characterCount: guided.totalChars,
        estimatedTokens: guided.totalEstimatedTokens,
        tokenCountMethod: guided.tokenCountMethod,
        observedFiles: [...guided.filesRead],
        warnings: [...guided.warnings],
        reason: null,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      skipped: false,
      error: { code: "context-construction-failed", message },
      context: unavailableContext([], message),
    };
  }
}

function unavailableContext(warnings: readonly string[], reason: string): TreatmentContextEvidence {
  return {
    status: "unavailable",
    characterCount: null,
    estimatedTokens: null,
    tokenCountMethod: null,
    observedFiles: null,
    warnings: [...warnings],
    reason,
  };
}

export { tokenCountMethod as CONTEXT_WINDOW_SCALING_TOKEN_COUNT_METHOD };
