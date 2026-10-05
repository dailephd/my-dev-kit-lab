import type { RetrievalPrecisionRecallAggregateV1, RetrievalPrecisionRecallCaseEvidenceV1 } from "./types.js";

export const RETRIEVAL_PRECISION_RECALL_EXECUTION_ARTIFACT_FILE = "retrieval-precision-recall-execution.json";
export const RETRIEVAL_PRECISION_RECALL_EXECUTION_SCHEMA_VERSION = "my-dev-kit-lab-retrieval-precision-recall-execution-v1";

/**
 * The single plugin execution artifact. It carries the complete deterministic per-case scientific evidence and the
 * aggregate, calculated before persistence. It holds no contextText, raw stdout/stderr, command lines, or paths.
 */
export type RetrievalPrecisionRecallExecutionArtifactV1 = {
  schemaVersion: typeof RETRIEVAL_PRECISION_RECALL_EXECUTION_SCHEMA_VERSION;
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  /** Token estimator used for retrieved token counts; null when no case produced a count. */
  tokenCountMethod: string | null;
  cases: RetrievalPrecisionRecallCaseEvidenceV1[];
  aggregate: RetrievalPrecisionRecallAggregateV1;
};

export function buildRetrievalPrecisionRecallExecutionArtifact(args: {
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  cases: readonly RetrievalPrecisionRecallCaseEvidenceV1[];
  aggregate: RetrievalPrecisionRecallAggregateV1;
}): RetrievalPrecisionRecallExecutionArtifactV1 {
  return {
    schemaVersion: RETRIEVAL_PRECISION_RECALL_EXECUTION_SCHEMA_VERSION,
    runId: args.runId,
    pluginId: args.pluginId,
    pluginSchemaVersion: args.pluginSchemaVersion,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    tokenCountMethod: args.cases.find((entry) => entry.retrieval !== null)?.retrieval?.tokenCountMethod ?? null,
    cases: args.cases.map((entry) => structuredClone(entry)),
    aggregate: structuredClone(args.aggregate)
  };
}
