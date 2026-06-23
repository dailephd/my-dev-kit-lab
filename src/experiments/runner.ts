import path from "node:path";
import { createDefaultExperimentPluginRegistry } from "./defaultRegistry.js";
import { buildDefaultExperimentOutputRoot, isPathInside } from "./outputPaths.js";
import { resolveExperimentTarget } from "./target.js";
import type { ExperimentPluginRegistry } from "./registry.js";
import type {
  ExperimentArtifact,
  ExperimentConfigValidationResult,
  ExperimentExecutionContext,
  ExperimentFailure,
  ExperimentRun,
  ExperimentSummary,
  ExperimentTarget,
  ExperimentWarning,
} from "./types.js";

export type RunExperimentOptions = {
  pluginId: string;
  targetPath?: string;
  outputRoot?: string;
  config?: unknown;
  reportPrefix?: string;
  toolRoot?: string;
  runId?: string;
  startedAt?: Date;
  inputs?: Record<string, unknown>;
  registry?: ExperimentPluginRegistry;
  logger?: ExperimentExecutionContext["logger"];
};

export async function runExperiment(options: RunExperimentOptions): Promise<ExperimentRun> {
  const toolRoot = path.resolve(options.toolRoot ?? process.cwd());
  const registry = options.registry ?? createDefaultExperimentPluginRegistry();
  const plugin = registry.get(options.pluginId);
  const runId = options.runId ?? defaultRunId(options.pluginId);
  const startedAt = options.startedAt ?? new Date();
  const target = resolveExperimentTarget(options.targetPath, toolRoot);
  const validation = plugin.validateConfig(options.config ?? {});
  if (!validation.valid || validation.config === undefined) {
    throw new Error(
      `Invalid experiment config for ${plugin.metadata.id}: ${validation.errors.join("; ")}`
    );
  }

  const outputRoot = resolveExperimentOutputRoot({
    toolRoot,
    pluginId: plugin.metadata.id,
    runId,
    target,
    optionsOutputRoot: options.outputRoot,
    inputConfig: options.config,
  });
  assertOutputRootAllowed({ outputRoot, target });

  const context = buildExperimentContext({
    runId,
    startedAt,
    pluginId: plugin.metadata.id,
    pluginSchemaVersion: plugin.metadata.schemaVersion,
    toolRoot,
    target,
    outputRoot,
    config: withOutputRoot(validation.config, outputRoot),
    inputs: options.inputs,
    logger: options.logger,
  });

  try {
    await plugin.prepare?.(context);
    const result = await plugin.run(context);
    const summary = result.summary ?? plugin.summarize?.(result, context);
    return normalizeResult({
      result,
      summary,
      validation,
      outputRoot,
      pluginSchemaVersion: plugin.metadata.schemaVersion,
    });
  } catch (error) {
    return buildFailedRun({
      error,
      runId,
      startedAt,
      pluginId: plugin.metadata.id,
      pluginSchemaVersion: plugin.metadata.schemaVersion,
      target,
      outputRoot,
      validationWarnings: validation.warnings,
    });
  } finally {
    await plugin.cleanup?.(context);
  }
}

function buildExperimentContext<TConfig>(args: {
  runId: string;
  startedAt: Date;
  pluginId: string;
  pluginSchemaVersion: string;
  toolRoot: string;
  target: ExperimentTarget;
  outputRoot: string;
  config: TConfig;
  inputs?: Record<string, unknown>;
  logger?: ExperimentExecutionContext["logger"];
}): ExperimentExecutionContext<TConfig> {
  return {
    runId: args.runId,
    startedAt: args.startedAt,
    pluginId: args.pluginId,
    pluginSchemaVersion: args.pluginSchemaVersion,
    toolRoot: args.toolRoot,
    targetRoot: args.target.targetRoot,
    isSelfTarget: args.target.isSelf,
    target: args.target,
    config: args.config,
    outputRoot: args.outputRoot,
    environment: {
      platform: process.platform,
      nodeVersion: process.version,
    },
    inputs: args.inputs,
    logger: args.logger,
  };
}

function resolveExperimentOutputRoot(args: {
  toolRoot: string;
  pluginId: string;
  runId: string;
  target: ExperimentTarget;
  optionsOutputRoot?: string;
  inputConfig?: unknown;
}): string {
  const explicitOutDir = readStringField(args.inputConfig, "outDir");
  const outputRoot =
    args.optionsOutputRoot ??
    explicitOutDir ??
    buildDefaultExperimentOutputRoot({
      toolRoot: args.toolRoot,
      pluginId: args.pluginId,
      runId: args.runId,
      target: args.target,
    });
  return path.isAbsolute(outputRoot) ? path.resolve(outputRoot) : path.resolve(args.toolRoot, outputRoot);
}

function assertOutputRootAllowed(args: { outputRoot: string; target: ExperimentTarget }): void {
  if (!args.target.isSelf && isPathInside(args.target.targetRoot, args.outputRoot)) {
    throw new Error(
      `Experiment output root must not be inside the external target project: ${args.outputRoot}`
    );
  }
}

function withOutputRoot<TConfig>(config: TConfig, outputRoot: string): TConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return config;
  }
  return {
    ...(config as Record<string, unknown>),
    outDir: outputRoot,
  } as TConfig;
}

function normalizeResult(args: {
  result: ExperimentRun;
  summary?: ExperimentSummary;
  validation: ExperimentConfigValidationResult<unknown>;
  outputRoot: string;
  pluginSchemaVersion: string;
}): ExperimentRun {
  const validationWarnings = args.validation.warnings.map((message) => ({
    code: "config-validation-warning",
    message,
  }));
  const warnings = [...args.result.warnings, ...validationWarnings];
  return {
    ...args.result,
    summary: args.summary ?? args.result.summary,
    warnings,
    metadata: {
      ...args.result.metadata,
      outputRoot: args.outputRoot,
      pluginSchemaVersion: args.pluginSchemaVersion,
    },
  };
}

function buildFailedRun(args: {
  error: unknown;
  runId: string;
  startedAt: Date;
  pluginId: string;
  pluginSchemaVersion: string;
  target: ExperimentTarget;
  outputRoot: string;
  validationWarnings: string[];
}): ExperimentRun {
  const completedAt = new Date().toISOString();
  const failure: ExperimentFailure = {
    code: "experiment-run-failed",
    message: args.error instanceof Error ? args.error.message : String(args.error),
    recoverable: false,
  };
  const warnings: ExperimentWarning[] = args.validationWarnings.map((message) => ({
    code: "config-validation-warning",
    message,
  }));
  const artifacts: ExperimentArtifact[] = [];
  const summary: ExperimentSummary = {
    status: "failed",
    totalCases: 0,
    completedCases: 0,
    partialCases: 0,
    failedCases: 0,
    skippedCases: 0,
    metrics: [],
    warnings,
    failures: [failure],
  };
  return {
    runId: args.runId,
    pluginId: args.pluginId,
    startedAt: args.startedAt.toISOString(),
    completedAt,
    status: "failed",
    target: args.target,
    variants: [],
    cases: [],
    metrics: [],
    artifacts,
    warnings,
    failures: [failure],
    summary,
    metadata: {
      outputRoot: args.outputRoot,
      pluginSchemaVersion: args.pluginSchemaVersion,
    },
  };
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}

function defaultRunId(pluginId: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${pluginId}-${timestamp}`;
}
