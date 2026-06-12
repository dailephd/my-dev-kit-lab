import path from "node:path";
import { parseAgentCommandTemplate } from "../agents/index.js";
import { parseAgentId } from "../agents/agentRegistry.js";
import { readBenchmarkProjectProfiles, readEvaluationCases, runControlledExperiment } from "../evaluation/index.js";
import { parsePromptComplexityLevel, parsePromptStrategy } from "../prompts/index.js";
import type { AgentCommandTemplate } from "../agents/types.js";
import type { PromptComplexityLevel } from "../prompts/types.js";
import type { ExperimentAgentId, ExperimentMatrixConfig, ExperimentStrategy } from "../evaluation/controlledExperimentTypes.js";

export type ParsedRunControlledExperimentArgs = ExperimentMatrixConfig;

export function parseRunControlledExperimentArgs(argv: string[]): ParsedRunControlledExperimentArgs {
  let casesPath = "";
  let projectProfilesPath = "benchmarks/contracts/benchmark-project-profiles.json";
  let outDir = "";
  const caseIds: string[] = [];
  const benchmarkProjects: string[] = [];
  let agents: ExperimentAgentId[] | undefined;
  let strategies: ExperimentStrategy[] | undefined;
  let complexityLevels: PromptComplexityLevel[] | undefined;
  let timeoutMs: number | undefined;
  let maxRuns: number | undefined;
  let continueOnFailure = true;
  let requireAgents = false;
  let includeRealAgents = false;
  const commandTemplates: Partial<Record<"codex" | "claude", AgentCommandTemplate>> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cases") {
      casesPath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--project-profiles") {
      projectProfilesPath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--case") {
      caseIds.push(...splitList(argv[index + 1] ?? ""));
      index += 1;
    } else if (arg === "--benchmark-project") {
      benchmarkProjects.push(...splitList(argv[index + 1] ?? ""));
      index += 1;
    } else if (arg === "--agents") {
      agents = splitList(argv[index + 1] ?? "").map((value) => parseAgentId(value) as ExperimentAgentId);
      index += 1;
    } else if (arg === "--strategies") {
      strategies = splitList(argv[index + 1] ?? "").map(parsePromptStrategy);
      index += 1;
    } else if (arg === "--complexities") {
      complexityLevels = splitList(argv[index + 1] ?? "").map(parsePromptComplexityLevel);
      index += 1;
    } else if (arg === "--out") {
      outDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--timeout-ms") {
      timeoutMs = parsePositiveInteger("--timeout-ms", argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--max-runs") {
      maxRuns = parsePositiveInteger("--max-runs", argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--continue-on-failure") {
      continueOnFailure = true;
    } else if (arg === "--no-continue-on-failure") {
      continueOnFailure = false;
    } else if (arg === "--require-agents") {
      requireAgents = true;
    } else if (arg === "--include-real-agents") {
      includeRealAgents = true;
    } else if (arg === "--command-template-codex") {
      commandTemplates.codex = parseAgentCommandTemplate(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--command-template-claude") {
      commandTemplates.claude = parseAgentCommandTemplate(argv[index + 1] ?? "");
      index += 1;
    }
  }

  if (!casesPath || !outDir) {
    throw new Error(
      [
        "Usage: --cases <path> --out <directory>",
        "[--project-profiles <path>] [--case <id>] [--benchmark-project <id>]",
        "[--agents <fake-agent,codex,claude>] [--strategies <raw-full-file,my-dev-kit-guided>]",
        "[--complexities <short,medium,long,multi-step>] [--timeout-ms <ms>] [--max-runs <n>]",
        "[--continue-on-failure] [--require-agents] [--include-real-agents]",
        "[--command-template-codex <command>] [--command-template-claude <command>]"
      ].join(" ")
    );
  }

  return {
    casesPath,
    projectProfilesPath,
    caseIds: caseIds.length > 0 ? caseIds : undefined,
    benchmarkProjects: benchmarkProjects.length > 0 ? benchmarkProjects : undefined,
    agents,
    strategies,
    complexityLevels,
    outDir,
    timeoutMs,
    requireAgents,
    continueOnFailure,
    maxRuns,
    commandTemplates: Object.keys(commandTemplates).length > 0 ? commandTemplates : undefined,
    includeRealAgents
  };
}

export async function runControlledExperimentFromArgs(args: ParsedRunControlledExperimentArgs, repoRoot = process.cwd()) {
  const projectProfilesPath = path.resolve(repoRoot, args.projectProfilesPath ?? "benchmarks/contracts/benchmark-project-profiles.json");
  const casesPath = path.resolve(repoRoot, args.casesPath);
  const projectProfiles = await readBenchmarkProjectProfiles(projectProfilesPath, repoRoot);
  const cases = await readEvaluationCases(casesPath, repoRoot, {
    projectProfiles,
    requireProjectProfileRef: true
  });
  const artifacts = await runControlledExperiment({
    config: {
      ...args,
      casesPath: args.casesPath,
      projectProfilesPath: args.projectProfilesPath
    },
    cases,
    projectProfiles,
    repoRoot
  });
  return { projectProfiles, cases, artifacts };
}

export async function runControlledExperimentCommand(argv: string[]): Promise<number> {
  try {
    const args = parseRunControlledExperimentArgs(argv);
    const { artifacts } = await runControlledExperimentFromArgs(args);
    console.log(
      [
        `Runs: ${artifacts.summary.totalRuns}`,
        `Completed: ${artifacts.summary.completedRuns}`,
        `Comparisons: ${artifacts.summary.totalComparisons}`,
        `Output: ${path.resolve(args.outDir)}`
      ].join("\n")
    );
    return artifacts.summary.failedRuns > 0 && args.continueOnFailure === false ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(label: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}
