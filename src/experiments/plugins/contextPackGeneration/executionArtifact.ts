import type { ContextPackGenerationCaseEvidenceV1 } from "./executionTypes.js";
import { CONTEXT_PACK_GENERATION_TREATMENT_IDS, type ContextPackGenerationTreatmentId } from "./metadata.js";
import { CONTEXT_PACK_SELECTION_POLICY_ID } from "./packSelectionPolicy.js";

export const CONTEXT_PACK_GENERATION_EXECUTION_ARTIFACT_FILE = "context-pack-generation-execution.json";
export const CONTEXT_PACK_GENERATION_EXECUTION_SCHEMA_VERSION = "my-dev-kit-lab-context-pack-generation-execution-v1";

/**
 * Execution evidence only. Scientific analysis has no placeholder here. It holds no source text, raw command output or
 * machine-local path; pack bodies live in the per-case pack artifacts.
 */
export type ContextPackGenerationExecutionArtifactV1 = {
  schemaVersion: typeof CONTEXT_PACK_GENERATION_EXECUTION_SCHEMA_VERSION;
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  treatmentOrder: ContextPackGenerationTreatmentId[];
  selectionPolicyId: string;
  cases: ContextPackGenerationCaseEvidenceV1[];
};

export function buildContextPackGenerationExecutionArtifact(args: {
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  cases: readonly ContextPackGenerationCaseEvidenceV1[];
}): ContextPackGenerationExecutionArtifactV1 {
  return {
    schemaVersion: CONTEXT_PACK_GENERATION_EXECUTION_SCHEMA_VERSION,
    runId: args.runId,
    pluginId: args.pluginId,
    pluginSchemaVersion: args.pluginSchemaVersion,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    treatmentOrder: [...CONTEXT_PACK_GENERATION_TREATMENT_IDS],
    selectionPolicyId: CONTEXT_PACK_SELECTION_POLICY_ID,
    cases: structuredClone(args.cases) as ContextPackGenerationCaseEvidenceV1[]
  };
}
