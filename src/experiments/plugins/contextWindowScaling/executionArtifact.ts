import type { ExperimentRunStatus } from "../../types.js";
import type { RelevantFileEvidence } from "./relevantFiles.js";
import type { BudgetCellEvidence, CorrectnessEvidence } from "./successEvidence.js";
import type { ContextWindowScalingTreatmentId } from "./metadata.js";

export const CONTEXT_WINDOW_SCALING_EXECUTION_ARTIFACT_FILE = "context-window-scaling-execution.json";
export const CONTEXT_WINDOW_SCALING_EXECUTION_SCHEMA_VERSION = "my-dev-kit-lab-context-window-scaling-execution-v1";

/** Measured treatment context. Never carries context text. */
export type TreatmentContextEvidence = {
  status: "available" | "unavailable";
  characterCount: number | null;
  estimatedTokens: number | null;
  tokenCountMethod: string | null;
  /** Repository-relative files the treatment actually included (raw) or read (guided). */
  observedFiles: string[] | null;
  warnings: string[];
  reason: string | null;
};

export type TreatmentEvaluationEvidence = {
  status: "evaluated" | "not-evaluated-no-fitting-budget" | "unavailable";
  agentId: "fake-agent" | null;
  agentStatus: string | null;
  /** Number of deterministic evaluator invocations for this treatment; shared by all fitting budgets. */
  evaluationCount: number;
  correctness: CorrectnessEvidence;
  failureReasons: string[];
  warnings: string[];
  reason: string | null;
};

export type TreatmentExecutionEvidenceV1 = {
  variantId: ContextWindowScalingTreatmentId;
  status: ExperimentRunStatus;
  context: TreatmentContextEvidence;
  evaluation: TreatmentEvaluationEvidence;
  relevantFileEvidence: RelevantFileEvidence;
  budgetCells: BudgetCellEvidence[];
  errors: { code: string; message: string }[];
};

export type CaseExecutionEvidenceV1 = {
  caseId: string;
  caseName: string;
  benchmarkProject: string;
  targetRoot: string;
  taskLocality: string | null;
  treatments: TreatmentExecutionEvidenceV1[];
};

export type ContextWindowScalingExecutionArtifactV1 = {
  schemaVersion: typeof CONTEXT_WINDOW_SCALING_EXECUTION_SCHEMA_VERSION;
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  estimator: { tokenCountMethod: string };
  contextBudgets: number[];
  cases: CaseExecutionEvidenceV1[];
};

export function buildContextWindowScalingExecutionArtifact(args: {
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  tokenCountMethod: string;
  contextBudgets: readonly number[];
  cases: readonly CaseExecutionEvidenceV1[];
}): ContextWindowScalingExecutionArtifactV1 {
  return {
    schemaVersion: CONTEXT_WINDOW_SCALING_EXECUTION_SCHEMA_VERSION,
    runId: args.runId,
    pluginId: args.pluginId,
    pluginSchemaVersion: args.pluginSchemaVersion,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    estimator: { tokenCountMethod: args.tokenCountMethod },
    contextBudgets: [...args.contextBudgets],
    cases: structuredClone([...args.cases]),
  };
}
