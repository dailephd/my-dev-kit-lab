import path from "node:path";
import { parseAgentCommandTemplate } from "../../src/agents/index.js";
import { parseAgentId } from "../../src/agents/agentRegistry.js";
import { readBenchmarkProjectProfiles, readEvaluationCases } from "../../src/evaluation/index.js";
import { createDefaultExperimentPluginRegistry, runExperiment } from "../../src/experiments/index.js";
import { contextStrategyComparisonPlugin } from "../../src/experiments/plugins/contextStrategyComparison/index.js";
import { parsePromptComplexityLevel, parsePromptStrategy } from "../../src/prompts/index.js";
import { writePluginExperimentReports } from "../../src/report/index.js";
import type { AgentCommandTemplate } from "../../src/agents/types.js";
import type {
  ExperimentAgentId,
  ExperimentMatrixConfig,
  ExperimentStrategy,
} from "../../src/evaluation/controlledExperimentTypes.js";
import type { PromptComplexityLevel } from "../../src/prompts/types.js";

type ParsedRunExperimentArgs = {
  experimentId: string;
  targetPath?: string;
  outDir?: string;
  config: Partial<ExperimentMatrixConfig>;
};

async function main(argv: string[]): Promise<number> {
  try {
    const args = parseRunExperimentArgs(argv);
    const toolRoot = process.cwd();
    const registry = createDefaultExperimentPluginRegistry();
    const inputs = await loadPluginInputs(args, toolRoot);
    const result = await runExperiment({
      pluginId: args.experimentId,
      registry,
      targetPath: args.targetPath,
      outputRoot: args.outDir,
      config: args.config,
      inputs,
      toolRoot,
    });
    const reports = await writePluginExperimentReports({
      run: result,
      plugin: registry.describe(result.pluginId),
      outputRoot: String(result.metadata?.outputRoot ?? ""),
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
        `Report HTML: ${reports.outputPaths.htmlPath}`,
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
      commandTemplates: Object.keys(commandTemplates).length > 0 ? commandTemplates : undefined,
    }),
  };
}

async function loadPluginInputs(args: ParsedRunExperimentArgs, toolRoot: string): Promise<Record<string, unknown> | undefined> {
  if (args.experimentId !== contextStrategyComparisonPlugin.metadata.id) {
    return undefined;
  }
  const validation = contextStrategyComparisonPlugin.validateConfig(args.config);
  if (!validation.valid || !validation.config) {
    throw new Error(`Invalid context strategy comparison config: ${validation.errors.join("; ")}`);
  }
  const projectProfilesPath = path.resolve(toolRoot, validation.config.projectProfilesPath ?? "benchmarks/contracts/benchmark-project-profiles.json");
  const casesPath = path.resolve(toolRoot, validation.config.casesPath);
  const projectProfiles = await readBenchmarkProjectProfiles(projectProfilesPath, toolRoot);
  const cases = await readEvaluationCases(casesPath, toolRoot, {
    projectProfiles,
    requireProjectProfileRef: true,
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

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))) {
  process.exitCode = await main(process.argv.slice(2));
}
