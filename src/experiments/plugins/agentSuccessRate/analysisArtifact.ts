import { AGENT_SUCCESS_METRIC_IDS, type AgentSuccessRateAnalysisV1 } from "./analysisTypes.js";
import type { AgentSuccessRateExecutionArtifactV1 } from "./executionArtifact.js";
import { AGENT_SUCCESS_RATE_PLUGIN_ID, AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE, AGENT_SUCCESS_RATE_TREATMENT_IDS } from "./metadata.js";
import { validateAgentSuccessMetric } from "./metrics.js";

export const AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE = "agent-success-rate-analysis.json";
export const AGENT_SUCCESS_RATE_ANALYSIS_SCHEMA_VERSION = "my-dev-kit-lab-agent-success-rate-analysis-v1";

/** Frozen methodology identifiers. */
export type AgentSuccessRateMethodologyV1 = {
  taskSuccess: "resolved-and-regression-safe-and-protected-intact";
  factSatisfaction: "all-referenced-post-edit-checks-passed";
  verificationGranularity: "command-check-level";
  aggregation: "matched-case-unweighted-mean";
  treatmentComparison: "pipeline-diagnostic-only" | "descriptive-matched-case";
  relativeChurnDenominator: "baseline-text-line-count";
};

export const AGENT_SUCCESS_RATE_METHODOLOGY: AgentSuccessRateMethodologyV1 = {
  taskSuccess: "resolved-and-regression-safe-and-protected-intact",
  factSatisfaction: "all-referenced-post-edit-checks-passed",
  verificationGranularity: "command-check-level",
  aggregation: "matched-case-unweighted-mean",
  treatmentComparison: "pipeline-diagnostic-only",
  relativeChurnDenominator: "baseline-text-line-count"
};

/** Scientific truth owner. Holds no source text, patch body, command output or machine-local path. */
export type AgentSuccessRateAnalysisArtifactV1 = {
  schemaVersion: typeof AGENT_SUCCESS_RATE_ANALYSIS_SCHEMA_VERSION;
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  methodology: AgentSuccessRateMethodologyV1;
  analysis: AgentSuccessRateAnalysisV1;
};

export function buildAgentSuccessRateAnalysisArtifact(args: {
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  analysis: AgentSuccessRateAnalysisV1;
}): AgentSuccessRateAnalysisArtifactV1 {
  return {
    schemaVersion: AGENT_SUCCESS_RATE_ANALYSIS_SCHEMA_VERSION,
    runId: args.runId,
    pluginId: args.pluginId,
    pluginSchemaVersion: args.pluginSchemaVersion,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    methodology: {
      ...AGENT_SUCCESS_RATE_METHODOLOGY,
      ...(args.analysis.executionMode === AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE ? { treatmentComparison: "descriptive-matched-case" as const } : {})
    },
    analysis: structuredClone(args.analysis)
  };
}

/** Structural validation of an in-memory analysis artifact. Returns problems; empty means valid. */
export function validateAgentSuccessRateAnalysisArtifact(artifact: AgentSuccessRateAnalysisArtifactV1): string[] {
  const problems: string[] = [];
  if (artifact.schemaVersion !== AGENT_SUCCESS_RATE_ANALYSIS_SCHEMA_VERSION) problems.push("analysis artifact schemaVersion is not recognized.");
  if (artifact.pluginId !== AGENT_SUCCESS_RATE_PLUGIN_ID) problems.push("analysis artifact pluginId does not match.");
  const { analysis } = artifact;
  if (analysis.executionMode === AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE) {
    if (!analysis.comparison) problems.push("real-agent analysis is missing the matched-case comparison.");
    else if (analysis.contextEffectEvaluated !== analysis.comparison.matchedCaseIds.length > 0) problems.push("analysis contextEffectEvaluated disagrees with the matched cases.");
    if (artifact.methodology.treatmentComparison !== "descriptive-matched-case") problems.push("real-agent analysis must use the descriptive matched-case methodology.");
  } else {
    if (analysis.contextEffectEvaluated !== false) problems.push("analysis must state contextEffectEvaluated=false.");
    if (analysis.comparison !== undefined) problems.push("deterministic-fixture analysis must not carry a comparison.");
  }
  if (analysis.treatmentOrder.join(",") !== AGENT_SUCCESS_RATE_TREATMENT_IDS.join(",")) problems.push("analysis treatmentOrder is not the fixed order.");
  for (const entry of analysis.cases) {
    if (entry.treatments.map((t) => t.treatmentId).join(",") !== AGENT_SUCCESS_RATE_TREATMENT_IDS.join(",")) problems.push(`analysis case ${entry.caseId} does not hold both treatments in fixed order.`);
    for (const treatment of entry.treatments) {
      for (const id of AGENT_SUCCESS_METRIC_IDS) {
        const metric = treatment.metrics[id];
        if (!metric) problems.push(`analysis case ${entry.caseId}/${treatment.treatmentId} is missing metric ${id}.`);
        else problems.push(...validateAgentSuccessMetric(metric));
      }
    }
  }
  for (const aggregate of analysis.aggregates) {
    problems.push(...validateAgentSuccessMetric(aggregate.taskSuccessRate), ...validateAgentSuccessMetric(aggregate.initialAttemptSuccessRate));
    for (const mean of Object.values(aggregate.means)) problems.push(...validateAgentSuccessMetric(mean.metric));
  }
  return problems;
}

/** Execution and analysis must describe the same run, cases and treatments. */
export function validateAgentSuccessRateArtifactFamily(execution: AgentSuccessRateExecutionArtifactV1, analysis: AgentSuccessRateAnalysisArtifactV1): string[] {
  const problems: string[] = [];
  if (execution.runId !== analysis.runId) problems.push("execution and analysis runId differ.");
  if (execution.pluginSchemaVersion !== analysis.pluginSchemaVersion) problems.push("execution and analysis pluginSchemaVersion differ.");
  if (execution.executionMode !== analysis.analysis.executionMode) problems.push("execution and analysis executionMode differ.");
  if (execution.contextEffectEvaluated !== analysis.analysis.contextEffectEvaluated) problems.push("execution and analysis contextEffectEvaluated differ.");
  if (execution.cases.length !== analysis.analysis.cases.length) problems.push("execution and analysis case counts differ.");
  execution.cases.forEach((entry, index) => {
    const counterpart = analysis.analysis.cases[index];
    if (!counterpart || counterpart.caseId !== entry.caseId) {
      problems.push(`execution and analysis case identity differs at index ${index}.`);
      return;
    }
    if (entry.treatments.map((t) => t.treatmentId).join(",") !== counterpart.treatments.map((t) => t.treatmentId).join(",")) {
      problems.push(`execution and analysis treatment identity differs for case ${entry.caseId}.`);
    }
  });
  return problems;
}
