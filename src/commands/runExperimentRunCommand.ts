import path from "node:path";
import { parseAgentCommandTemplate } from "../agents/index.js";
import { parseAgentId } from "../agents/agentRegistry.js";
import { readBenchmarkProjectProfiles, readEvaluationCases } from "../evaluation/index.js";
import {
  contextStrategyComparisonPlugin,
  createDefaultExperimentPluginRegistry,
  resolveExperimentTarget,
  runExperiment
} from "../experiments/index.js";
import { buildDefaultExperimentOutputRoot } from "../experiments/outputPaths.js";
import { parsePromptComplexityLevel, parsePromptStrategy } from "../prompts/index.js";
import { writePluginExperimentReports } from "../report/index.js";
import { createLabExecutionContext, resolvePackageResource } from "../runtime/index.js";
import type { AgentCommandTemplate } from "../agents/types.js";
import type {
  ExperimentAgentId,
  ExperimentMatrixConfig,
  ExperimentStrategy
} from "../evaluation/controlledExperimentTypes.js";
import type { PromptComplexityLevel } from "../prompts/types.js";
import type { LabExecutionContext } from "../runtime/index.js";

// ---------------------------------------------------------------------------
// v0.4.6 Batch 4 -- reusable experiment-run command owner.
//
// Extracted from scripts/experiments/runExperiment.ts. Reuses the existing
// generic runner (src/experiments/runner.ts) and the registered
// context-strategy-comparison plugin unchanged. Two things move relative to
// the source-checkout script:
//
// 1. Bundled resource lookup (the default cases/project-profiles files) goes
//    through Batch 1's resolvePackageResource() instead of a
//    process.cwd()-relative path, so it no longer depends on the checkout.
// 2. The implicit (no --out) output root, for installed execution only, is
//    rooted under workspaceRoot instead of the tool/package root -- computed
//    with the same buildDefaultExperimentOutputRoot() helper the runner
//    itself uses internally, so the plugin/target/run subdirectory shape is
//    unchanged, only the root differs. Explicit --out is pre-resolved
//    against invocationCwd so its resolution base never changes.
//
// Self-target fallback (no --target) and relative --target resolution are
// untouched -- both still go through the shared toolRoot (packageRoot),
// matching runAuditCommand.ts / runSecurityValidationCommand.ts.
// ---------------------------------------------------------------------------

const DEFAULT_CASES_RESOURCE = "examples/token-savings-cases.json";
const DEFAULT_PROJECT_PROFILES_RESOURCE = "benchmarks/contracts/benchmark-project-profiles.json";

type ParsedRunExperimentArgs = {
  experimentId: string;
  targetPath?: string;
  outDir?: string;
  config: Partial<ExperimentMatrixConfig>;
};

export type RunExperimentRunCommandOptions = {
  // Used for self-target fallback (no --target) and bundled-resource
  // resolution. Defaults to a freshly discovered LabExecutionContext.
  context?: LabExecutionContext;
  // Root used only for the implicit (no --out) output default. Undefined
  // (the npm-script default) preserves the runner's own internal
  // toolRoot-relative default unchanged. The installed CLI router passes
  // context.workspaceRoot here.
  installedDefaultOutputRoot?: string;
};

export async function runExperimentRunCommandFromArgs(
  argv: string[],
  options: RunExperimentRunCommandOptions = {}
): Promise<number> {
  try {
    const args = parseRunExperimentArgs(argv);
    const context = options.context ?? createLabExecutionContext();
    const toolRoot = context.packageRoot;
    const registry = createDefaultExperimentPluginRegistry();
    const inputs = await loadPluginInputs(args, toolRoot, context);
    const runId = generateExperimentRunId(args.experimentId);
    const outputRoot = resolveOutputRoot(args, {
      toolRoot,
      invocationCwd: context.invocationCwd,
      installedDefaultOutputRoot: options.installedDefaultOutputRoot,
      experimentId: args.experimentId,
      runId
    });
    const result = await runExperiment({
      pluginId: args.experimentId,
      registry,
      targetPath: args.targetPath,
      outputRoot,
      config: args.config,
      inputs,
      toolRoot,
      runId
    });
    const reports = await writePluginExperimentReports({
      run: result,
      plugin: registry.describe(result.pluginId),
      outputRoot: String(result.metadata?.outputRoot ?? "")
    });
    console.log(
      [
        `Experiment: ${result.pluginId}`,
        `Run ID: ${result.runId}`,
        `Status: ${result.status}`,
        `Mode: ${result.target.isSelf ? "self" : "external target"}`,
        `Tool root: ${result.target.toolRoot}`,
        `Target root: ${result.target.targetRoot}`,
        `Output: ${String(result.metadata?.outputRoot ?? "")}`,
        `Report JSON: ${reports.outputPaths.jsonPath}`,
        `Report HTML: ${reports.outputPaths.htmlPath}`
      ].join("\n")
    );
    return result.status === "failed" ? 1 : 0;
  } catch (error) {
    if (process.env.DEBUG) {
      console.error(error);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    return 1;
  }
}

export function parseRunExperimentArgs(argv: string[]): ParsedRunExperimentArgs {
  let experimentId = "";
  let targetPath: string | undefined;
  let outDir: string | undefined;
  let casesPath: string | undefined;
  let projectProfilesPath: string | undefined;
  const caseIds: string[] = [];
  const benchmarkProjects: string[] = [];
  let agents: ExperimentAgentId[] | undefined;
  let strategies: ExperimentStrategy[] | undefined;
  let complexityLevels: PromptComplexityLevel[] | undefined;
  let timeoutMs: number | undefined;
  let maxRuns: number | undefined;
  let continueOnFailure: boolean | undefined;
  let requireAgents: boolean | undefined;
  let includeRealAgents: boolean | undefined;
  const commandTemplates: Partial<Record<"codex" | "claude", AgentCommandTemplate>> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--experiment") {
      experimentId = readRequiredValue(argv, ++index, "--experiment");
    } else if (arg === "--target") {
      targetPath = readRequiredValue(argv, ++index, "--target");
    } else if (arg === "--out") {
      outDir = readRequiredValue(argv, ++index, "--out");
    } else if (arg === "--cases") {
      casesPath = readRequiredValue(argv, ++index, "--cases");
    } else if (arg === "--project-profiles") {
      projectProfilesPath = readRequiredValue(argv, ++index, "--project-profiles");
    } else if (arg === "--case") {
      caseIds.push(...splitList(readRequiredValue(argv, ++index, "--case")));
    } else if (arg === "--benchmark-project") {
      benchmarkProjects.push(...splitList(readRequiredValue(argv, ++index, "--benchmark-project")));
    } else if (arg === "--agents") {
      agents = splitList(readRequiredValue(argv, ++index, "--agents")).map((value) => parseAgentId(value) as ExperimentAgentId);
    } else if (arg === "--strategies") {
      strategies = splitList(readRequiredValue(argv, ++index, "--strategies")).map(parsePromptStrategy);
    } else if (arg === "--complexities") {
      complexityLevels = splitList(readRequiredValue(argv, ++index, "--complexities")).map(parsePromptComplexityLevel);
    } else if (arg === "--timeout-ms") {
      timeoutMs = parsePositiveInteger("--timeout-ms", readRequiredValue(argv, ++index, "--timeout-ms"));
    } else if (arg === "--max-runs") {
      maxRuns = parsePositiveInteger("--max-runs", readRequiredValue(argv, ++index, "--max-runs"));
    } else if (arg === "--continue-on-failure") {
      continueOnFailure = true;
    } else if (arg === "--no-continue-on-failure") {
      continueOnFailure = false;
    } else if (arg === "--require-agents") {
      requireAgents = true;
    } else if (arg === "--include-real-agents") {
      includeRealAgents = true;
    } else if (arg === "--command-template-codex") {
      commandTemplates.codex = parseAgentCommandTemplate(readRequiredValue(argv, ++index, "--command-template-codex"));
    } else if (arg === "--command-template-claude") {
      commandTemplates.claude = parseAgentCommandTemplate(readRequiredValue(argv, ++index, "--command-template-claude"));
    } else if (arg === "--no-screenshot") {
      // The plugin-aware report path does not capture screenshots yet; accept this
      // flag so smoke commands can share the legacy demo option set.
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!experimentId) {
    throw new Error("Usage: --experiment <id> [--target <path>] [--out <directory>]");
  }

  return {
    experimentId,
    targetPath,
    outDir,
    config: withoutUndefined({
      casesPath,
      projectProfilesPath,
      caseIds: caseIds.length > 0 ? caseIds : undefined,
      benchmarkProjects: benchmarkProjects.length > 0 ? benchmarkProjects : undefined,
      agents,
      strategies,
      complexityLevels,
      timeoutMs,
      maxRuns,
      continueOnFailure,
      requireAgents,
      includeRealAgents,
      commandTemplates: Object.keys(commandTemplates).length > 0 ? commandTemplates : undefined
    })
  };
}

function resolveOutputRoot(
  args: ParsedRunExperimentArgs,
  params: {
    toolRoot: string;
    invocationCwd: string;
    installedDefaultOutputRoot?: string;
    experimentId: string;
    runId: string;
  }
): string | undefined {
  if (args.outDir) {
    // Pre-resolve to an absolute path against invocationCwd so its
    // resolution base never depends on toolRoot/packageRoot.
    return path.resolve(params.invocationCwd, args.outDir);
  }
  if (!params.installedDefaultOutputRoot) {
    // Preserve the runner's own internal toolRoot-relative default.
    return undefined;
  }
  const target = resolveExperimentTarget(args.targetPath, params.toolRoot);
  return buildDefaultExperimentOutputRoot({
    toolRoot: params.installedDefaultOutputRoot,
    pluginId: params.experimentId,
    target,
    runId: params.runId
  });
}

function generateExperimentRunId(pluginId: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${pluginId}-${timestamp}`;
}

async function loadPluginInputs(
  args: ParsedRunExperimentArgs,
  toolRoot: string,
  context: LabExecutionContext
): Promise<Record<string, unknown> | undefined> {
  if (args.experimentId !== contextStrategyComparisonPlugin.metadata.id) {
    return undefined;
  }
  const validation = contextStrategyComparisonPlugin.validateConfig(args.config);
  if (!validation.valid || !validation.config) {
    throw new Error(`Invalid context strategy comparison config: ${validation.errors.join("; ")}`);
  }
  const projectProfilesPath = args.config.projectProfilesPath
    ? path.resolve(toolRoot, args.config.projectProfilesPath)
    : resolvePackageResource(context, DEFAULT_PROJECT_PROFILES_RESOURCE);
  const casesPath = args.config.casesPath
    ? path.resolve(toolRoot, args.config.casesPath)
    : resolvePackageResource(context, DEFAULT_CASES_RESOURCE);
  const projectProfiles = await readBenchmarkProjectProfiles(projectProfilesPath, toolRoot);
  const cases = await readEvaluationCases(casesPath, toolRoot, {
    projectProfiles,
    requireProjectProfileRef: true
  });
  return { cases, projectProfiles, env: process.env };
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readRequiredValue(argv: string[], index: number, label: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${label} requires a value.`);
  }
  return value;
}

function parsePositiveInteger(label: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as Partial<T>;
}
