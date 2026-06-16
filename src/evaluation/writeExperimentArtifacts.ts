import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExperimentArtifacts, ExperimentComparison, ExperimentMatrixConfig, ExperimentRun, ExperimentSummary } from "./controlledExperimentTypes.js";

export async function writeExperimentArtifacts(args: {
  outDir: string;
  config: ExperimentMatrixConfig;
  runs: ExperimentRun[];
  comparisons: ExperimentComparison[];
  summary: ExperimentSummary;
}): Promise<ExperimentArtifacts> {
  const outDir = path.resolve(args.outDir);
  const runsDir = path.join(outDir, "runs");
  await mkdir(runsDir, { recursive: true });

  for (const run of args.runs) {
    const runDir = path.join(runsDir, run.runId);
    await mkdir(runDir, { recursive: true });
    const promptPath = path.join(runDir, "prompt.txt");
    const agentRunResultPath = path.join(runDir, "agent-run-result.json");
    const parsedAnswerPath = path.join(runDir, "parsed-answer.json");
    const correctnessScorePath = path.join(runDir, "correctness-score.json");
    await writeFile(promptPath, getPromptTextFromRun(run), "utf8");
    await writeFile(agentRunResultPath, `${JSON.stringify(run.agentRunResult, null, 2)}\n`, "utf8");
    await writeFile(parsedAnswerPath, `${JSON.stringify(run.parsedAnswer, null, 2)}\n`, "utf8");
    await writeFile(correctnessScorePath, `${JSON.stringify(run.correctness, null, 2)}\n`, "utf8");
    run.artifactPaths = {
      promptPath,
      agentRunResultPath,
      parsedAnswerPath,
      correctnessScorePath
    };
  }

  const artifactPaths = {
    summaryPath: path.join(outDir, "experiment-summary.json"),
    runsPath: path.join(outDir, "experiment-runs.json"),
    comparisonsPath: path.join(outDir, "experiment-comparisons.json"),
    configPath: path.join(outDir, "experiment-config.json"),
    runsDir
  };

  await writeFile(artifactPaths.summaryPath, `${JSON.stringify(args.summary, null, 2)}\n`, "utf8");
  await writeFile(
    artifactPaths.runsPath,
    `${JSON.stringify({ generatedAt: args.summary.generatedAt, runs: args.runs }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    artifactPaths.comparisonsPath,
    `${JSON.stringify({ generatedAt: args.summary.generatedAt, comparisons: args.comparisons }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(artifactPaths.configPath, `${JSON.stringify(sanitizeConfig(args.config), null, 2)}\n`, "utf8");

  return {
    summary: args.summary,
    runs: args.runs,
    comparisons: args.comparisons,
    artifactPaths,
    warnings: args.summary.warnings
  };
}

export function buildExperimentSummary(args: {
  config: ExperimentMatrixConfig;
  runs: ExperimentRun[];
  comparisons: ExperimentComparison[];
  generatedAt?: string;
}): ExperimentSummary {
  const runs = args.runs;
  const comparisons = args.comparisons;
  const tokenSavings = comparisons
    .map((comparison) => comparison.tokenSavingsPercent)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const durationReductions = comparisons
    .map((comparison) => comparison.durationReductionPercent)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const correctnessDeltas = comparisons
    .map((comparison) => comparison.correctnessDelta)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const completedComparisons = comparisons.filter((comparison) => comparison.rawStatus === "completed" && comparison.myDevKitStatus === "completed");

  return {
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    casesPath: args.config.casesPath,
    projectProfilesPath: args.config.projectProfilesPath,
    agents: [...new Set(runs.map((run) => run.agentId))].sort(),
    strategies: [...new Set(runs.map((run) => run.promptStrategy))].sort(),
    complexityLevels: [...new Set(runs.map((run) => run.promptComplexityLevel))].sort(),
    totalRuns: runs.length,
    completedRuns: countStatus(runs, "completed"),
    failedRuns: countStatus(runs, "failed"),
    skippedRuns: countStatus(runs, "skipped"),
    unavailableRuns: countStatus(runs, "agent-unavailable"),
    limitReachedRuns: countStatus(runs, "agent-limit-reached"),
    timeoutRuns: countStatus(runs, "timeout"),
    invalidOutputRuns: countStatus(runs, "invalid-output"),
    totalComparisons: comparisons.length,
    averageTokenSavingsPercent: averageOrNull(tokenSavings),
    averageDurationReductionPercent: averageOrNull(durationReductions),
    averageCorrectnessDelta: averageOrNull(correctnessDeltas),
    answerDoesMyDevKitSaveTokens: tokenSavings.length === 0 ? null : averageOrNull(tokenSavings)! > 0,
    answerDoesMyDevKitPreserveCorrectness:
      completedComparisons.length === 0 ? null : completedComparisons.every((comparison) => comparison.sameCorrectnessPass),
    answerDoesMyDevKitReduceExecutionTime: durationReductions.length === 0 ? null : averageOrNull(durationReductions)! > 0,
    warnings: [
      ...runs.flatMap((run) => run.warnings),
      ...comparisons.flatMap((comparison) => comparison.warnings)
    ]
  };
}

function getPromptTextFromRun(run: ExperimentRun): string {
  return run.promptTextForArtifact ?? "";
}

function sanitizeConfig(config: ExperimentMatrixConfig): Record<string, unknown> {
  return {
    ...config,
    commandTemplates: config.commandTemplates
      ? Object.fromEntries(Object.entries(config.commandTemplates).map(([key, value]) => [key, value ? { ...value, args: value.args } : value]))
      : undefined
  };
}

function countStatus(runs: ExperimentRun[], status: ExperimentRun["status"]): number {
  return runs.filter((run) => run.status === status).length;
}

function averageOrNull(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
