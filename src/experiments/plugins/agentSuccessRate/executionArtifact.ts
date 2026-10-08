import type { AgentSuccessCaseEvidenceV1, AgentSuccessRealAgentProviderId } from "./executionTypes.js";
import {
  AGENT_SUCCESS_RATE_EXECUTION_MODE,
  AGENT_SUCCESS_RATE_PLUGIN_ID,
  AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE,
  AGENT_SUCCESS_RATE_TREATMENT_IDS,
  type AgentSuccessExecutionMode,
  type AgentSuccessRateTreatmentId
} from "./metadata.js";

export const AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE = "agent-success-rate-execution.json";
export const AGENT_SUCCESS_RATE_EXECUTION_SCHEMA_VERSION = "my-dev-kit-lab-agent-success-rate-execution-v1";

/** Run-level real-agent settings. Present only in real-agent mode. */
export type AgentSuccessRateRealAgentRunV1 = {
  providerId: AgentSuccessRealAgentProviderId;
  timeoutMs: number;
  attemptsPerTreatment: 1;
  promptTransport: "stdin";
};

/**
 * Execution evidence only. It holds no source text, patch body, raw command output or machine-local path; patch
 * bodies live in the separate diff artifacts, context bodies in the context artifacts, and scientific values live in
 * the analysis artifact.
 */
export type AgentSuccessRateExecutionArtifactV1 = {
  schemaVersion: typeof AGENT_SUCCESS_RATE_EXECUTION_SCHEMA_VERSION;
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  executionMode: AgentSuccessExecutionMode;
  contextEffectEvaluated: boolean;
  treatmentOrder: AgentSuccessRateTreatmentId[];
  cases: AgentSuccessCaseEvidenceV1[];
  /** Real-agent mode only; deterministic-fixture artifacts never carry this key. */
  realAgent?: AgentSuccessRateRealAgentRunV1;
};

export function buildAgentSuccessRateExecutionArtifact(args: {
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  cases: readonly AgentSuccessCaseEvidenceV1[];
  /** Real-agent mode only. */
  realAgent?: AgentSuccessRateRealAgentRunV1 & { contextEffectEvaluated: boolean };
}): AgentSuccessRateExecutionArtifactV1 {
  return {
    schemaVersion: AGENT_SUCCESS_RATE_EXECUTION_SCHEMA_VERSION,
    runId: args.runId,
    pluginId: args.pluginId,
    pluginSchemaVersion: args.pluginSchemaVersion,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    executionMode: args.realAgent ? AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE : AGENT_SUCCESS_RATE_EXECUTION_MODE,
    contextEffectEvaluated: args.realAgent ? args.realAgent.contextEffectEvaluated : false,
    treatmentOrder: [...AGENT_SUCCESS_RATE_TREATMENT_IDS],
    cases: structuredClone(args.cases) as AgentSuccessCaseEvidenceV1[],
    ...(args.realAgent
      ? { realAgent: { providerId: args.realAgent.providerId, timeoutMs: args.realAgent.timeoutMs, attemptsPerTreatment: 1 as const, promptTransport: "stdin" as const } }
      : {})
  };
}

/** Structural validation of an in-memory execution artifact. Returns problems; empty means valid. */
export function validateAgentSuccessRateExecutionArtifact(artifact: AgentSuccessRateExecutionArtifactV1): string[] {
  const problems: string[] = [];
  if (artifact.schemaVersion !== AGENT_SUCCESS_RATE_EXECUTION_SCHEMA_VERSION) problems.push("execution artifact schemaVersion is not recognized.");
  if (artifact.pluginId !== AGENT_SUCCESS_RATE_PLUGIN_ID) problems.push("execution artifact pluginId does not match.");
  const real = artifact.executionMode === AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE;
  if (artifact.executionMode !== AGENT_SUCCESS_RATE_EXECUTION_MODE && !real) problems.push("execution artifact executionMode is not recognized.");
  if (real) {
    if (!artifact.realAgent) problems.push("real-agent execution artifact is missing the realAgent run settings.");
    if (typeof artifact.contextEffectEvaluated !== "boolean") problems.push("execution artifact contextEffectEvaluated must be a boolean.");
  } else {
    if (artifact.contextEffectEvaluated !== false) problems.push("execution artifact must state contextEffectEvaluated=false.");
    if (artifact.realAgent !== undefined) problems.push("deterministic-fixture execution artifact must not carry realAgent settings.");
  }
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
      if (!real) {
        if (treatment.timing.agentDurationMs !== null || treatment.agentTokenUsage !== null || treatment.realAgent !== undefined) {
          problems.push(`case ${entry.caseId} claims agent evidence in deterministic mode.`);
        }
        continue;
      }
      const evidence = treatment.realAgent;
      if (!evidence) {
        problems.push(`case ${entry.caseId}/${treatment.treatmentId} is missing real-agent evidence.`);
        continue;
      }
      if (artifact.realAgent && evidence.providerId !== artifact.realAgent.providerId) problems.push(`case ${entry.caseId}/${treatment.treatmentId} provider does not match the run provider.`);
      if (evidence.context.contextMode !== treatment.treatmentId) problems.push(`case ${entry.caseId}/${treatment.treatmentId} context mode does not match the treatment.`);
      if (evidence.providerInvoked !== (evidence.agentArtifactDirectory !== null)) problems.push(`case ${entry.caseId}/${treatment.treatmentId} agent artifact directory disagrees with provider invocation.`);
      if (!evidence.providerInvoked && (treatment.timing.agentDurationMs !== null && evidence.providerStatus === "not-invoked")) problems.push(`case ${entry.caseId}/${treatment.treatmentId} has an agent duration without a provider attempt.`);
      if (evidence.finalAnswerAvailable !== treatment.patch.attempted) problems.push(`case ${entry.caseId}/${treatment.treatmentId} patch attempt disagrees with the provider final answer.`);
      if (evidence.context.availability !== "unavailable" && evidence.providerInvoked && evidence.context.contextArtifactPath === null) problems.push(`case ${entry.caseId}/${treatment.treatmentId} is missing its context artifact reference.`);
    }
  }
  return problems;
}
