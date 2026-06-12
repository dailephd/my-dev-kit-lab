import path from "node:path";
import { runAgentPrompt } from "../agents/index.js";
import type { AgentRunResult } from "../agents/types.js";
import { generatePromptVariants } from "../prompts/index.js";
import type { PromptVariant } from "../prompts/types.js";
import { buildExperimentMatrix } from "./buildExperimentMatrix.js";
import { classifyAgentRunOutcome } from "./classifyAgentRunOutcome.js";
import { compareExperimentRuns } from "./compareExperimentRuns.js";
import { parseAgentAnswer } from "./parseAgentAnswer.js";
import { scoreCorrectness } from "./scoreCorrectness.js";
import { buildExperimentSummary, writeExperimentArtifacts } from "./writeExperimentArtifacts.js";
import type { BenchmarkProjectProfile, EvaluationCase } from "./types.js";
import type { ExperimentArtifacts, ExperimentMatrixConfig, ExperimentRun } from "./controlledExperimentTypes.js";

export async function runControlledExperiment(args: {
  config: ExperimentMatrixConfig;
  cases: EvaluationCase[];
  projectProfiles: BenchmarkProjectProfile[];
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ExperimentArtifacts> {
  const repoRoot = args.repoRoot ?? process.cwd();
  const config = {
    ...args.config,
    agents: args.config.agents ?? ["fake-agent"],
    strategies: args.config.strategies ?? ["raw-full-file", "my-dev-kit-guided"],
    complexityLevels: args.config.complexityLevels ?? ["short"],
    continueOnFailure: args.config.continueOnFailure ?? true,
    includeRealAgents: args.config.includeRealAgents ?? false
  } satisfies ExperimentMatrixConfig;
  const matrix = buildExperimentMatrix({ cases: args.cases, config });
  const runs: ExperimentRun[] = [];

  for (const cell of matrix) {
    const evaluationCase = args.cases.find((candidate) => candidate.id === cell.caseId);
    if (!evaluationCase) {
      throw new Error(`Evaluation case not found while running matrix: ${cell.caseId}`);
    }
    const promptVariant = buildPromptVariant({
      evaluationCase,
      projectProfiles: args.projectProfiles,
      strategy: cell.strategy,
      complexityLevel: cell.complexityLevel
    });
    const runDir = path.join(path.resolve(repoRoot, config.outDir), "runs", cell.runId);
    let run = await executeExperimentCell({
      runId: cell.runId,
      agentId: cell.agentId,
      promptVariant,
      repoRoot,
      runDir,
      timeoutMs: config.timeoutMs,
      requireAgents: config.requireAgents ?? false,
      commandTemplate: cell.agentId === "codex" || cell.agentId === "claude" ? config.commandTemplates?.[cell.agentId] : undefined,
      env: args.env ?? process.env
    });
    runs.push(run);
    if (run.status !== "completed" && config.continueOnFailure === false) {
      break;
    }
  }

  const comparisons = compareExperimentRuns(runs);
  const summary = buildExperimentSummary({ config, runs, comparisons });
  return writeExperimentArtifacts({
    outDir: path.resolve(repoRoot, config.outDir),
    config,
    runs,
    comparisons,
    summary
  });
}

async function executeExperimentCell(args: {
  runId: string;
  agentId: ExperimentRun["agentId"];
  promptVariant: PromptVariant;
  repoRoot: string;
  runDir: string;
  timeoutMs?: number;
  requireAgents: boolean;
  commandTemplate?: Parameters<typeof runAgentPrompt>[0]["commandTemplate"];
  env: NodeJS.ProcessEnv;
}): Promise<ExperimentRun> {
  let agentRunResult: AgentRunResult;
  try {
    agentRunResult = await runAgentPrompt({
      runId: args.runId,
      agentId: args.agentId,
      promptVariant: args.promptVariant,
      promptText: args.promptVariant.promptText,
      cwd: args.repoRoot,
      outDir: args.runDir,
      timeoutMs: args.timeoutMs,
      requireAvailable: args.requireAgents,
      commandTemplate: args.commandTemplate,
      env: args.env
    });
  } catch (error) {
    agentRunResult = buildSyntheticFailureResult(args, error);
  }

  const parsedAnswer = parseAgentAnswer({
    text: agentRunResult.finalAnswerText,
    answerKey: args.promptVariant.expectedAnswerKey,
    tokenUsage: agentRunResult.tokenUsage
  });
  const classification = classifyAgentRunOutcome({ agentRunResult, parsedAnswer });
  const correctness = scoreCorrectness({
    caseId: args.promptVariant.caseId,
    answerKey: args.promptVariant.expectedAnswerKey,
    parsedAnswer,
    status: classification.status
  });

  return {
    runId: args.runId,
    caseId: args.promptVariant.caseId,
    benchmarkProject: args.promptVariant.benchmarkProject,
    agentId: args.agentId,
    promptStrategy: args.promptVariant.strategy,
    promptComplexityLevel: args.promptVariant.complexityLevel,
    promptVariantId: args.promptVariant.id,
    promptTextForArtifact: args.promptVariant.promptText,
    projectComplexityLevel: args.promptVariant.projectProfile.complexityLevel,
    projectComplexityScore: args.promptVariant.projectProfile.complexityScore,
    promptMetrics: args.promptVariant.promptMetrics,
    agentRunResult,
    parsedAnswer,
    correctness,
    status: classification.status,
    statusReason: classification.statusReason,
    startedAt: agentRunResult.startedAt,
    endedAt: agentRunResult.endedAt,
    durationMs: agentRunResult.durationMs,
    tokenUsage: agentRunResult.tokenUsage,
    tokenUsageSource: agentRunResult.tokenUsageSource,
    tokenUsageReliability: agentRunResult.tokenUsageReliability,
    warnings: classification.warnings,
    errors: classification.errors,
    artifactPaths: {}
  };
}

function buildPromptVariant(args: {
  evaluationCase: EvaluationCase;
  projectProfiles: BenchmarkProjectProfile[];
  strategy: PromptVariant["strategy"];
  complexityLevel: PromptVariant["complexityLevel"];
}): PromptVariant {
  const [variant] = generatePromptVariants({
    cases: [args.evaluationCase],
    projectProfiles: args.projectProfiles,
    strategies: [args.strategy],
    complexityLevels: [args.complexityLevel]
  });
  if (!variant) {
    throw new Error(`Failed to generate prompt variant for case: ${args.evaluationCase.id}`);
  }
  return variant;
}

function buildSyntheticFailureResult(
  args: {
    runId: string;
    agentId: ExperimentRun["agentId"];
    promptVariant: PromptVariant;
    repoRoot: string;
  },
  error: unknown
): AgentRunResult {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  return {
    runId: args.runId,
    agentId: args.agentId,
    displayName: args.agentId,
    surface: args.agentId === "fake-agent" ? "simulated" : "cli",
    promptVariantId: args.promptVariant.id,
    promptStrategy: args.promptVariant.strategy,
    promptComplexityLevel: args.promptVariant.complexityLevel,
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    status: "failed",
    exitCode: null,
    command: args.agentId,
    args: [],
    cwd: args.repoRoot,
    finalAnswerText: "",
    finalAnswerParseStatus: "empty",
    tokenUsage: { source: "unavailable" },
    tokenUsageSource: "unavailable",
    tokenUsageReliability: "unavailable",
    warnings: [],
    errors: [message]
  };
}
