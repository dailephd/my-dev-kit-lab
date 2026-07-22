import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runControlledExperiment } from "../../../evaluation/runControlledExperiment.js";
import type { BenchmarkProjectProfile, EvaluationCase } from "../../../evaluation/types.js";
import type { ExperimentPlugin, ExperimentPluginMetadata } from "../../types.js";
import {
  defaultContextStrategyComparisonConfig,
  type ContextStrategyComparisonConfig,
  validateContextStrategyComparisonConfig,
} from "./config.js";
import {
  mapLegacyArtifactsToExperimentRun,
  type ContextStrategyComparisonRun,
} from "./resultMapping.js";
import { executeV043StageContextStrategy } from "./executeV043StageContextStrategy.js";
import { resolveV043StrategyInputs } from "./resolveV043StrategyInputs.js";
import { V043_STAGE_CONTEXT_STRATEGY_IDS, type V043StageContextStrategyId } from "./v043StrategyIds.js";
import type { V043StageContextStrategyExecutionResult } from "./v043StrategyExecutionTypes.js";
import { evaluateV043StageContextExecution } from "../../../evaluation/stageContextMetrics/evaluateV043StageContextExecution.js";
import type { V043StageContextEvaluationResultV1 } from "../../../evaluation/stageContextMetrics/types.js";

export const contextStrategyComparisonMetadata: ExperimentPluginMetadata = {
  id: "context-strategy-comparison",
  name: "Context Strategy Comparison",
  description: "Compare raw full-file context against my-dev-kit guided retrieval/context strategies.",
  schemaVersion: "1.0.0",
  status: "experimental",
  supportedTargets: ["self", "external-local"],
  supportedOutputs: ["json", "html", "plot", "screenshot", "artifact"],
};

function isV043StrategyId(value: string): value is V043StageContextStrategyId {
  return (V043_STAGE_CONTEXT_STRATEGY_IDS as readonly string[]).includes(value);
}

export const contextStrategyComparisonPlugin: ExperimentPlugin<
  ContextStrategyComparisonConfig,
  ContextStrategyComparisonRun
> = {
  metadata: contextStrategyComparisonMetadata,
  defaultConfig: defaultContextStrategyComparisonConfig,
  configDefinition: {
    fields: [
      { name: "casesPath", type: "string", required: true },
      { name: "projectProfilesPath", type: "string" },
      { name: "agents", type: "array" },
      { name: "strategies", type: "array" },
      { name: "complexityLevels", type: "array" },
      { name: "outDir", type: "string", required: true },
    ],
  },
  validateConfig: validateContextStrategyComparisonConfig,
  async run(context) {
    const cases = readInputArray<EvaluationCase>(context.inputs, "cases");
    const projectProfiles = readInputArray<BenchmarkProjectProfile>(
      context.inputs,
      "projectProfiles"
    );
    const env = readEnv(context.inputs);
    const startedAt = context.startedAt.toISOString();

    const selectedStrategyIds = context.config.strategies ?? defaultContextStrategyComparisonConfig.strategies ?? [];
    const providedV043Inputs = context.config.v043StrategyInputs ?? [];

    const resolution = resolveV043StrategyInputs(selectedStrategyIds, providedV043Inputs);
    if (!resolution.ok) {
      const issuesText = resolution.issues.map((issue) => `${issue.code}:${issue.strategyId}`).join(", ");
      throw new Error(`Invalid v0.4.3 strategy-input configuration: ${issuesText}`);
    }

    const legacyStrategyIds = selectedStrategyIds.filter((strategyId) => !isV043StrategyId(strategyId));
    const legacyConfig = { ...context.config, strategies: legacyStrategyIds };
    const legacyArtifacts = await runControlledExperiment({
      config: legacyConfig,
      cases,
      projectProfiles,
      repoRoot: context.target.targetRoot,
      env,
    });

    const v043SelectedStrategyIds = selectedStrategyIds.filter(isV043StrategyId);
    const v043StageContextExecutions: V043StageContextStrategyExecutionResult[] = [];
    const v043StageContextEvaluations: V043StageContextEvaluationResultV1[] = [];
    for (const strategyId of v043SelectedStrategyIds) {
      const input = resolution.inputByStrategyId[strategyId];
      if (!input) continue;
      const executionResult = await executeV043StageContextStrategy(input);
      v043StageContextExecutions.push(executionResult);
      const evaluationResult = evaluateV043StageContextExecution(executionResult);
      v043StageContextEvaluations.push(evaluationResult);
    }

    const completedAt = new Date().toISOString();
    const outDir = context.outputRoot ?? path.resolve(context.toolRoot, context.config.outDir);
    await mkdir(outDir, { recursive: true });
    const pluginResultPath = path.join(outDir, "experiment-plugin-result.json");
    const result = mapLegacyArtifactsToExperimentRun({
      runId: context.runId,
      startedAt,
      completedAt,
      target: context.target,
      legacyArtifacts,
      v043StageContextExecutions,
      v043StageContextEvaluations,
      pluginResultPath,
    });
    await writeFile(pluginResultPath, `${JSON.stringify(redactLegacyArtifacts(result), null, 2)}\n`, "utf8");
    return result;
  },
  summarize(result) {
    if (!result.summary) {
      throw new Error("Context strategy comparison result is missing a summary.");
    }
    return result.summary;
  },
};

function readInputArray<T>(inputs: Record<string, unknown> | undefined, key: string): T[] {
  const value = inputs?.[key];
  if (!Array.isArray(value)) {
    throw new Error(`Context strategy comparison requires ${key} input.`);
  }
  return value as T[];
}

function readEnv(inputs: Record<string, unknown> | undefined): NodeJS.ProcessEnv | undefined {
  const env = inputs?.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return undefined;
  }
  return env as NodeJS.ProcessEnv;
}

function redactLegacyArtifacts(result: ContextStrategyComparisonRun): Omit<ContextStrategyComparisonRun, "legacyArtifacts"> & {
  legacyArtifactPaths: ContextStrategyComparisonRun["legacyArtifacts"]["artifactPaths"];
} {
  const { legacyArtifacts, ...rest } = result;
  return {
    ...rest,
    legacyArtifactPaths: legacyArtifacts.artifactPaths,
  };
}
