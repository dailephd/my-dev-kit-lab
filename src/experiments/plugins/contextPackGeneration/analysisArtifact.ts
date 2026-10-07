import type { ContextPackGenerationAnalysisV1 } from "./analysisTypes.js";

export const CONTEXT_PACK_GENERATION_ANALYSIS_ARTIFACT_FILE = "context-pack-generation-analysis.json";
export const CONTEXT_PACK_GENERATION_ANALYSIS_SCHEMA_VERSION = "my-dev-kit-lab-context-pack-generation-analysis-v1";

export type ContextPackGenerationMethodologyV1 = {
  fileF1: "balanced-f1";
  symbolF1: "balanced-f1";
  aggregation: "matched-complete-case-macro-mean";
  treatmentComparison: "paired-descriptive-delta";
  sizeMeasure: "estimated-tokens-of-rendered-text";
};

/** Single owner of the frozen methodology. No ranking, winner, composite score or Pareto front exists for this experiment. */
export const CONTEXT_PACK_GENERATION_METHODOLOGY: ContextPackGenerationMethodologyV1 = {
  fileF1: "balanced-f1",
  symbolF1: "balanced-f1",
  aggregation: "matched-complete-case-macro-mean",
  treatmentComparison: "paired-descriptive-delta",
  sizeMeasure: "estimated-tokens-of-rendered-text"
};

/** Scientific truth owner. Holds no source text, command output, command data or machine-local paths. */
export type ContextPackGenerationAnalysisArtifactV1 = {
  schemaVersion: typeof CONTEXT_PACK_GENERATION_ANALYSIS_SCHEMA_VERSION;
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  methodology: ContextPackGenerationMethodologyV1;
  analysis: ContextPackGenerationAnalysisV1;
};

export function buildContextPackGenerationAnalysisArtifact(args: {
  runId: string;
  pluginId: string;
  pluginSchemaVersion: string;
  startedAt: string;
  completedAt: string;
  analysis: ContextPackGenerationAnalysisV1;
}): ContextPackGenerationAnalysisArtifactV1 {
  return {
    schemaVersion: CONTEXT_PACK_GENERATION_ANALYSIS_SCHEMA_VERSION,
    runId: args.runId,
    pluginId: args.pluginId,
    pluginSchemaVersion: args.pluginSchemaVersion,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    methodology: { ...CONTEXT_PACK_GENERATION_METHODOLOGY },
    analysis: structuredClone(args.analysis)
  };
}
