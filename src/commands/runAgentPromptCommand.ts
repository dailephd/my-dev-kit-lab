import path from "node:path";
import { parseAgentCommandTemplate, runAgentPrompt } from "../agents/index.js";
import { parseAgentId } from "../agents/agentRegistry.js";
import type { AgentId, AgentCommandTemplate } from "../agents/types.js";
import { readBenchmarkProjectProfiles, readEvaluationCases } from "../evaluation/index.js";
import {
  generatePromptVariants,
  parsePromptComplexityLevel,
  parsePromptStrategy
} from "../prompts/index.js";
import type { PromptComplexityLevel, PromptStrategy } from "../prompts/types.js";

export type ParsedRunAgentPromptArgs = {
  agentId: AgentId;
  casesPath: string;
  caseId: string;
  strategy: PromptStrategy;
  complexity: PromptComplexityLevel;
  outDir: string;
  projectProfilesPath: string;
  commandTemplate?: AgentCommandTemplate;
  requireAvailable: boolean;
  timeoutMs?: number;
};

export function parseRunAgentPromptArgs(argv: string[]): ParsedRunAgentPromptArgs {
  let agentId: AgentId | undefined;
  let casesPath = "";
  let caseId = "";
  let strategy: PromptStrategy | undefined;
  let complexity: PromptComplexityLevel | undefined;
  let outDir = "";
  let projectProfilesPath = "benchmarks/contracts/benchmark-project-profiles.json";
  let commandTemplate: AgentCommandTemplate | undefined;
  let requireAvailable = false;
  let timeoutMs: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--agent") {
      agentId = parseAgentId(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--cases") {
      casesPath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--case") {
      caseId = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--strategy") {
      strategy = parsePromptStrategy(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--complexity") {
      complexity = parsePromptComplexityLevel(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--out") {
      outDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--project-profiles") {
      projectProfilesPath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--command-template") {
      commandTemplate = parseAgentCommandTemplate(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--require-agent") {
      requireAvailable = true;
    } else if (arg === "--timeout-ms") {
      timeoutMs = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error("--timeout-ms must be a positive number.");
      }
      index += 1;
    }
  }

  if (!agentId || !casesPath || !caseId || !strategy || !complexity || !outDir || !projectProfilesPath) {
    throw new Error(
      [
        "Usage: --agent <fake-agent|codex|claude> --cases <path> --case <id>",
        "--strategy <raw-full-file|my-dev-kit-guided> --complexity <short|medium|long|multi-step>",
        "--out <directory> [--project-profiles <path>] [--command-template <command>] [--require-agent] [--timeout-ms <ms>]"
      ].join(" ")
    );
  }

  return {
    agentId,
    casesPath,
    caseId,
    strategy,
    complexity,
    outDir,
    projectProfilesPath,
    commandTemplate,
    requireAvailable,
    timeoutMs
  };
}

export async function runAgentPromptFromArgs(args: ParsedRunAgentPromptArgs, repoRoot = process.cwd()) {
  const projectProfiles = await readBenchmarkProjectProfiles(path.resolve(repoRoot, args.projectProfilesPath), repoRoot);
  const cases = await readEvaluationCases(path.resolve(repoRoot, args.casesPath), repoRoot, {
    projectProfiles,
    requireProjectProfileRef: true
  });
  const evaluationCase = cases.find((candidate) => candidate.id === args.caseId);
  if (!evaluationCase) {
    throw new Error(`Evaluation case not found: ${args.caseId}`);
  }
  const [promptVariant] = generatePromptVariants({
    cases: [evaluationCase],
    projectProfiles,
    strategies: [args.strategy],
    complexityLevels: [args.complexity]
  });
  if (!promptVariant) {
    throw new Error(`Failed to generate prompt variant for case: ${args.caseId}`);
  }

  const outDir = path.resolve(repoRoot, args.outDir);
  const result = await runAgentPrompt({
    runId: `${args.caseId}.${args.agentId}.${args.strategy}.${args.complexity}`,
    agentId: args.agentId,
    promptVariant,
    promptText: promptVariant.promptText,
    cwd: repoRoot,
    outDir,
    commandTemplate: args.commandTemplate,
    timeoutMs: args.timeoutMs,
    requireAvailable: args.requireAvailable,
    env: process.env
  });

  return { projectProfiles, cases, promptVariant, result, outDir };
}

export async function runAgentPromptCommand(argv: string[]): Promise<number> {
  try {
    const args = parseRunAgentPromptArgs(argv);
    const { result, outDir } = await runAgentPromptFromArgs(args);
    console.log(
      [
        `Agent: ${result.agentId}`,
        `Status: ${result.status}`,
        `Prompt: ${path.join(outDir, "prompt.txt")}`,
        `Result: ${path.join(outDir, "agent-run-result.json")}`
      ].join("\n")
    );
    return result.status === "failed" ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
