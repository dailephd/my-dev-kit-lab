import type { AgentSuccessCaseEvidenceV1 } from "./executionTypes.js";
import { AGENT_SUCCESS_RATE_EXECUTION_MODE, AGENT_SUCCESS_RATE_PLUGIN_ID, AGENT_SUCCESS_RATE_TREATMENT_IDS, type AgentSuccessRateTreatmentId } from "./metadata.js";

export const AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE = "agent-success-rate-execution.json";
export const AGENT_SUCCESS_RATE_EXECUTION_SCHEMA_VERSION = "my-dev-kit-lab-agent-success-rate-execution-v1";

/**
 * Execution evidence only. It holds no source text, patch body, raw command output or machine-local path; patch
 * bodies live in the separate diff artifacts and scientific values live in the analysis artifact.
 */
export type AgentSuccessRateExecutionArtifactV1 = {
  schemaVersion: typeof AGENT_SUCCESS_RATE_EXECUTION_SCHEMA_VERSION;
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  executionMode: typeof AGENT_SUCCESS_RATE_EXECUTION_MODE;
  contextEffectEvaluated: false;
  treatmentOrder: AgentSuccessRateTreatmentId[];
  cases: AgentSuccessCaseEvidenceV1[];
};

export function buildAgentSuccessRateExecutionArtifact(args: {
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  cases: readonly AgentSuccessCaseEvidenceV1[];
}): AgentSuccessRateExecutionArtifactV1 {
  return {
    schemaVersion: AGENT_SUCCESS_RATE_EXECUTION_SCHEMA_VERSION,
    runId: args.runId,
    pluginId: args.pluginId,
    pluginSchemaVersion: args.pluginSchemaVersion,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    executionMode: AGENT_SUCCESS_RATE_EXECUTION_MODE,
    contextEffectEvaluated: false,
    treatmentOrder: [...AGENT_SUCCESS_RATE_TREATMENT_IDS],
    cases: structuredClone(args.cases) as AgentSuccessCaseEvidenceV1[]
  };
}

/** Structural validation of an in-memory execution artifact. Returns problems; empty means valid. */
export function validateAgentSuccessRateExecutionArtifact(artifact: AgentSuccessRateExecutionArtifactV1): string[] {
  const problems: string[] = [];
  if (artifact.schemaVersion !== AGENT_SUCCESS_RATE_EXECUTION_SCHEMA_VERSION) problems.push("execution artifact schemaVersion is not recognized.");
  if (artifact.pluginId !== AGENT_SUCCESS_RATE_PLUGIN_ID) problems.push("execution artifact pluginId does not match.");
  if (artifact.executionMode !== AGENT_SUCCESS_RATE_EXECUTION_MODE) problems.push("execution artifact executionMode is not deterministic-fixture.");
  if (artifact.contextEffectEvaluated !== false) problems.push("execution artifact must state contextEffectEvaluated=false.");
  if (artifact.treatmentOrder.join(",") !== AGENT_SUCCESS_RATE_TREATMENT_IDS.join(",")) problems.push("execution artifact treatmentOrder is not the fixed order.");
  const seen = new Set<string>();
  for (const entry of artifact.cases) {
    if (seen.has(entry.caseId)) problems.push(`duplicate execution case ${entry.caseId}.`);
    seen.add(entry.caseId);
    if (entry.treatments.map((t) => t.treatmentId).join(",") !== AGENT_SUCCESS_RATE_TREATMENT_IDS.join(",")) {
      problems.push(`case ${entry.caseId} does not hold both treatments in fixed order.`);
    }
    const sandboxIds = entry.treatments.map((t) => t.sandboxId);
    if (new Set(sandboxIds).size !== sandboxIds.length) problems.push(`case ${entry.caseId} treatments share a sandbox id.`);
    for (const treatment of entry.treatments) {
      if (treatment.timing.agentDurationMs !== null || treatment.agentTokenUsage !== null) problems.push(`case ${entry.caseId} claims agent evidence in deterministic mode.`);
    }
  }
  return problems;
}
