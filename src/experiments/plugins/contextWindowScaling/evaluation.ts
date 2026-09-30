import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import type { BenchmarkProjectProfile, EvaluationCase } from "../../../evaluation/types.js";
import { evaluateFakeSide } from "../warmIndexReuse/agentEvaluation.js";
import { taskOutputSegment } from "../warmIndexReuse/selection.js";
import type { ContextWindowScalingTreatmentId } from "./metadata.js";
import { toCorrectnessEvidence, type CorrectnessEvidence } from "./successEvidence.js";

/** One deterministic evaluation of a treatment for a case; shared by every budget the context fits. */
export type TreatmentEvaluationResult = {
  agentId: "fake-agent";
  agentStatus: string;
  correctness: CorrectnessEvidence;
  failureReasons: string[];
  warnings: string[];
  errors: string[];
};

export type TreatmentEvaluator = (args: {
  evaluationCase: EvaluationCase;
  treatment: ContextWindowScalingTreatmentId;
  projectProfiles: readonly BenchmarkProjectProfile[];
  outputRoot: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
}) => Promise<TreatmentEvaluationResult>;

/**
 * Reuses the single existing fake-agent pipeline (prompt owner, fake agent, parseAgentAnswer,
 * classifyAgentRunOutcome, scoreCorrectness) owned by warm-index agent evaluation. The pipeline
 * derives its prompt from the case and never receives a budget, so the result is identical for
 * every budget the treatment context fits.
 */
export const evaluateTreatmentWithFakeAgent: TreatmentEvaluator = async (args) => {
  const side = await evaluateFakeSide({
    evaluationCase: args.evaluationCase,
    caseId: args.evaluationCase.id,
    // The shared pipeline's side ids map to prompt strategies; the guided treatment uses the
    // my-dev-kit-guided strategy. The side id is internal and is not persisted as a variant.
    variantId: args.treatment === "raw-full-file" ? "raw-full-file" : "warm-index-reuse",
    projectProfiles: args.projectProfiles,
    outDir: resolveWithinRoot(
      args.outputRoot,
      path.join("agents", taskOutputSegment(args.evaluationCase.id), args.treatment)
    ),
    cwd: args.cwd,
    env: args.env,
  });
  return {
    agentId: "fake-agent",
    agentStatus: side.status,
    correctness: toCorrectnessEvidence({
      available: side.correctness.available,
      score: side.correctness.score,
      passed: side.correctness.passed,
    }),
    failureReasons: [...side.correctness.failureReasons],
    warnings: [...side.warnings],
    errors: [...side.errors],
  };
};
