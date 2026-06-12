import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { readBenchmarkProjectProfiles, readEvaluationCases } from "../evaluation/index.js";
import type { BenchmarkProjectProfile, EvaluationCase, ProjectComplexityMetrics } from "../evaluation/types.js";
import type { ExperimentComparison, ExperimentRun, ExperimentSummary } from "../evaluation/controlledExperimentTypes.js";
import type {
  AggregateAnswerLabel,
  ExperimentReportBenchmarkCaseSection,
  ExperimentReportExecutiveSummary,
  ExperimentReportFileTreeSection,
  ExperimentReportInput,
  ExperimentReportProjectSection,
  ExperimentReportPromptSection
} from "./experimentReportTypes.js";

export type BuildExperimentReportInputOptions = {
  experimentDir: string;
  repoRoot?: string;
  title?: string;
  subtitle?: string;
  maxPromptChars?: number;
  maxFileTreeEntries?: number;
  plotsDir?: string;
  visualizationsDir?: string;
};

const DEFAULT_MAX_PROMPT_CHARS = 1800;
const DEFAULT_MAX_FILE_TREE_ENTRIES = 80;

export async function buildExperimentReportInput(options: BuildExperimentReportInputOptions): Promise<ExperimentReportInput> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const experimentDir = path.resolve(repoRoot, options.experimentDir);
  const warnings: string[] = [];
  const summary = await readRequiredJson<ExperimentSummary>(experimentDir, "experiment-summary.json");
  const runsPayload = await readRequiredJson<{ runs: ExperimentRun[] }>(experimentDir, "experiment-runs.json");
  const comparisonsPayload = await readRequiredJson<{ comparisons: ExperimentComparison[] }>(experimentDir, "experiment-comparisons.json");
  const config = await readRequiredJson<Record<string, unknown>>(experimentDir, "experiment-config.json");
  const runs = runsPayload.runs ?? [];
  const comparisons = comparisonsPayload.comparisons ?? [];

  const profilesPath = typeof summary.projectProfilesPath === "string" ? summary.projectProfilesPath : "benchmarks/contracts/benchmark-project-profiles.json";
  const profiles = await readBenchmarkProjectProfiles(path.resolve(repoRoot, profilesPath), repoRoot);
  const cases = await readEvaluationCases(path.resolve(repoRoot, summary.casesPath), repoRoot, {
    projectProfiles: profiles,
    requireProjectProfileRef: true
  });

  const selectedProjectIds = unique(runs.map((run) => run.benchmarkProject));
  const selectedCaseIds = unique(runs.map((run) => run.caseId));
  const selectedProfiles = selectedProjectIds
    .map((projectId) => profiles.find((profile) => profile.projectId === projectId))
    .filter((profile): profile is BenchmarkProjectProfile => Boolean(profile));
  const selectedCases = selectedCaseIds
    .map((caseId) => cases.find((evaluationCase) => evaluationCase.id === caseId))
    .filter((evaluationCase): evaluationCase is EvaluationCase => Boolean(evaluationCase));

  const promptSections = await buildPromptSections({
    experimentDir,
    runs,
    warnings,
    maxPromptChars: options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS
  });
  const plotSections = await buildPlotSections({ repoRoot, plotsDir: options.plotsDir, warnings });
  const visualizationSections = await buildVisualizationSections({ repoRoot, visualizationsDir: options.visualizationsDir, warnings });
  const aggregate = buildAggregateAnswers({ summary, runs, comparisons });

  return {
    generatedAt: new Date().toISOString(),
    sourceExperimentDir: experimentDir,
    title: options.title ?? "Controlled Experiment Report",
    subtitle: options.subtitle ?? "raw-full-file vs my-dev-kit-guided strategy comparison",
    executiveSummary: aggregate,
    methodology: buildMethodology(summary),
    projectProfiles: selectedProfiles.map(buildProjectSection),
    benchmarkCases: selectedCases.map(buildBenchmarkCaseSection),
    fileTreeSections: selectedProfiles.map((profile) =>
      buildFileTreeSection(profile, options.maxFileTreeEntries ?? DEFAULT_MAX_FILE_TREE_ENTRIES)
    ),
    promptComparisonSections: promptSections,
    agentRunSections: runs,
    correctnessSections: runs,
    tokenSections: comparisons,
    timingSections: comparisons,
    comparisonSections: comparisons,
    plotSections,
    visualizationSections,
    formulaSections: buildFormulaSections(),
    limitations: buildLimitations(runs),
    warnings: unique([...summary.warnings, ...runs.flatMap((run) => run.warnings), ...comparisons.flatMap((comparison) => comparison.warnings), ...warnings]),
    artifactLinks: buildArtifactLinks(experimentDir, runs),
    nextSteps: [
      "Run optional Codex and Claude experiments when local CLI sessions and account limits allow.",
      "Use JSON artifacts as the source of truth for follow-up analysis."
    ],
    rawArtifacts: {
      summary,
      runs,
      comparisons,
      config
    }
  };
}

async function buildPlotSections(args: { repoRoot: string; plotsDir?: string; warnings: string[] }) {
  if (!args.plotsDir) return [];
  const plotsDir = path.resolve(args.repoRoot, args.plotsDir);
  try {
    const data = JSON.parse(await readFile(path.join(plotsDir, "plot-data.json"), "utf8")) as {
      plots?: Array<{ id: string; title: string }>;
    };
    return (data.plots ?? []).map((plot) => ({
      id: plot.id,
      title: plot.title,
      kind: "svg",
      path: path.join(plotsDir, "charts", `${plot.id}.svg`)
    }));
  } catch (error) {
    args.warnings.push(`Plot artifacts unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function buildVisualizationSections(args: { repoRoot: string; visualizationsDir?: string; warnings: string[] }) {
  if (!args.visualizationsDir) return [];
  const visualizationsDir = path.resolve(args.repoRoot, args.visualizationsDir);
  try {
    const runsPayload = JSON.parse(await readFile(path.join(visualizationsDir, "visualization-demo-runs.json"), "utf8")) as {
      runs?: Array<{ id: string; name: string; ok: boolean; durationMs: number; producedArtifactPaths: string[]; warnings: string[] }>;
    };
    return (runsPayload.runs ?? []).map((run) => ({
      id: run.id,
      name: run.name,
      status: run.ok ? "completed" : "warning",
      durationMs: run.durationMs,
      producedArtifactPaths: run.producedArtifactPaths ?? [],
      warnings: run.warnings ?? []
    }));
  } catch (error) {
    args.warnings.push(`Visualization demo artifacts unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export function buildAggregateAnswers(args: {
  summary: ExperimentSummary;
  runs: ExperimentRun[];
  comparisons: ExperimentComparison[];
}): ExperimentReportExecutiveSummary {
  const reliabilityCounts = countBy(args.comparisons.map((comparison) => comparison.reliabilityLabel));
  const tokenAnswer = answerFromComparisonValues(
    args.comparisons.filter((comparison) => comparison.tokenComparisonAvailable).map((comparison) => comparison.tokenSavingsPercent)
  );
  const correctnessAnswer = answerCorrectness(args.comparisons);
  const timingAnswer = answerFromComparisonValues(args.comparisons.map((comparison) => comparison.durationReductionPercent));
  const fakeOnly = args.runs.length > 0 && args.runs.every((run) => run.agentId === "fake-agent");
  const externalIssues = args.summary.limitReachedRuns + args.summary.timeoutRuns + args.summary.unavailableRuns + args.summary.invalidOutputRuns;
  const qualifier = fakeOnly
    ? " Results are deterministic fake-agent smoke evidence, not real Codex or Claude evidence."
    : externalIssues > 0
      ? " Some real-agent outcomes were incomplete and qualify the aggregate answers."
      : "";

  return {
    doesMyDevKitSaveTokens: tokenAnswer,
    doesMyDevKitPreserveCorrectness: correctnessAnswer,
    doesMyDevKitReduceExecutionTime: timingAnswer,
    completedRuns: args.summary.completedRuns,
    failedRuns: args.summary.failedRuns,
    unavailableRuns: args.summary.unavailableRuns,
    limitReachedRuns: args.summary.limitReachedRuns,
    timeoutRuns: args.summary.timeoutRuns,
    invalidOutputRuns: args.summary.invalidOutputRuns,
    comparisonReliabilityCounts: reliabilityCounts,
    summaryText: [
      `Completed ${args.summary.completedRuns} of ${args.summary.totalRuns} runs across ${args.summary.totalComparisons} comparisons.`,
      `Token savings: ${tokenAnswer}. Correctness preserved: ${correctnessAnswer}. Execution time reduced: ${timingAnswer}.`,
      qualifier.trim()
    ]
      .filter(Boolean)
      .join(" ")
  };
}

async function readRequiredJson<T>(experimentDir: string, fileName: string): Promise<T> {
  const filePath = path.join(experimentDir, fileName);
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing or invalid required experiment artifact ${fileName}: ${message}`);
  }
}

async function buildPromptSections(args: {
  experimentDir: string;
  runs: ExperimentRun[];
  warnings: string[];
  maxPromptChars: number;
}): Promise<ExperimentReportPromptSection[]> {
  const sections: ExperimentReportPromptSection[] = [];
  for (const run of args.runs) {
    const promptPath = run.artifactPaths.promptPath ?? path.join(args.experimentDir, "runs", run.runId, "prompt.txt");
    let promptText = run.promptTextForArtifact ?? "";
    try {
      promptText = await readFile(promptPath, "utf8");
    } catch {
      args.warnings.push(`Optional prompt artifact missing for run ${run.runId}.`);
    }
    const truncated = promptText.length > args.maxPromptChars;
    sections.push({
      runId: run.runId,
      caseId: run.caseId,
      agentId: run.agentId,
      strategy: run.promptStrategy,
      complexityLevel: run.promptComplexityLevel,
      promptPath,
      promptExcerpt: truncated ? `${promptText.slice(0, args.maxPromptChars)}\n...` : promptText,
      promptWasTruncated: truncated,
      metrics: run.promptMetrics
    });
  }
  return sections;
}

function buildProjectSection(profile: BenchmarkProjectProfile): ExperimentReportProjectSection {
  return {
    profile,
    complexityMetrics: pickComplexityMetrics(profile.complexityMetrics)
  };
}

function pickComplexityMetrics(metrics: ProjectComplexityMetrics): Record<string, number | undefined> {
  return {
    fileCount: metrics.fileCount,
    sourceFileCount: metrics.sourceFileCount,
    testFileCount: metrics.testFileCount,
    totalLinesOfCode: metrics.totalLinesOfCode,
    sourceLinesOfCode: metrics.sourceLinesOfCode,
    testLinesOfCode: metrics.testLinesOfCode,
    languageCount: metrics.languageCount,
    internalImportCount: metrics.internalImportCount,
    exportedSymbolEstimate: metrics.exportedSymbolEstimate,
    taskCount: metrics.taskCount,
    expectedRelevantFilesAverage: metrics.expectedRelevantFilesAverage,
    expectedRelevantSymbolsAverage: metrics.expectedRelevantSymbolsAverage,
    maxFileLines: metrics.maxFileLines,
    averageFileLines: metrics.averageFileLines
  };
}

function buildFileTreeSection(profile: BenchmarkProjectProfile, maxEntries: number): ExperimentReportFileTreeSection {
  return {
    projectId: profile.projectId,
    entries: profile.fileTree.entries.slice(0, maxEntries),
    totalEntries: profile.fileTree.entries.length,
    truncated: profile.fileTree.entries.length > maxEntries
  };
}

function buildBenchmarkCaseSection(evaluationCase: EvaluationCase): ExperimentReportBenchmarkCaseSection {
  const answerKey = evaluationCase.answerKey;
  return {
    caseId: evaluationCase.id,
    title: evaluationCase.title,
    benchmarkProject: evaluationCase.benchmarkProject,
    query: evaluationCase.query,
    expectedOperation: evaluationCase.expectedOperation,
    expectedFiles: answerKey?.expectedFiles ?? evaluationCase.expectedFiles,
    expectedSymbols: answerKey?.expectedSymbols ?? evaluationCase.expectedSymbols,
    expectedFacts: answerKey?.expectedFacts ?? [],
    minimumCorrectFacts: answerKey?.minimumCorrectFacts ?? 0,
    notes: evaluationCase.notes
  };
}

function buildMethodology(summary: ExperimentSummary): string[] {
  return [
    `Benchmark projects were selected from ${summary.projectProfilesPath ?? "benchmark project profiles"}.`,
    `Prompt strategies tested: ${summary.strategies.join(", ")}.`,
    `Prompt complexity levels tested: ${summary.complexityLevels.join(", ")}.`,
    `Agents tested: ${summary.agents.join(", ")}.`,
    "Run statuses distinguish completed, failed, skipped, unavailable, external limit, timeout, and invalid-output outcomes.",
    "Correctness scoring is deterministic and answer-key based; no semantic LLM judging is used.",
    "Token comparison uses agent session token totals only when both paired runs provide totalTokens.",
    "Timing comparison uses measured run duration from normalized agent run results.",
    "Provider telemetry dashboards and OpenTelemetry collection are not part of this report."
  ];
}

function buildFormulaSections() {
  return [
    {
      id: "correctness",
      title: "Correctness Score",
      formula: "correctnessScore = 0.25 * fileMatchScore + 0.25 * symbolMatchScore + 0.50 * factMatchScore",
      notes: [
        "Pass condition: required facts found unless minimumCorrectFacts applies.",
        "Pass condition: found facts >= minimumCorrectFacts.",
        "Pass condition: correctnessScore >= 0.70."
      ]
    },
    {
      id: "tokens",
      title: "Token Savings",
      formula: "tokenDelta = rawTotalTokens - myDevKitTotalTokens; tokenSavingsPercent = tokenDelta / rawTotalTokens * 100",
      notes: [
        "Computed only when both paired runs expose totalTokens and rawTotalTokens is greater than zero.",
        "Prompt estimated tokens are shown separately and are not substituted for provider session tokens."
      ]
    },
    {
      id: "timing",
      title: "Execution Time Reduction",
      formula: "durationDeltaMs = rawDurationMs - myDevKitDurationMs; durationReductionPercent = durationDeltaMs / rawDurationMs * 100",
      notes: ["Computed only when both paired runs expose durationMs and rawDurationMs is greater than zero."]
    }
  ];
}

function buildLimitations(runs: ExperimentRun[]): string[] {
  const fakeOnly = runs.length > 0 && runs.every((run) => run.agentId === "fake-agent");
  return [
    fakeOnly ? "fake-agent results are deterministic smoke results, not real Codex or Claude evidence." : undefined,
    "Codex and Claude may fail due external account, usage, or session limits.",
    "Token usage depends on agent output availability.",
    "Prompt estimated tokens are not provider session tokens.",
    "Correctness scoring is answer-key based and deterministic, not semantic.",
    "Charts are deterministic static SVG summaries, not provider telemetry dashboards.",
    "Visualization demos are bounded command smoke checks and may report unsupported graph commands as warnings."
  ].filter((item): item is string => Boolean(item));
}

function buildArtifactLinks(experimentDir: string, runs: ExperimentRun[]) {
  return [
    { label: "Experiment summary", path: path.join(experimentDir, "experiment-summary.json"), kind: "json" },
    { label: "Experiment runs", path: path.join(experimentDir, "experiment-runs.json"), kind: "json" },
    { label: "Experiment comparisons", path: path.join(experimentDir, "experiment-comparisons.json"), kind: "json" },
    { label: "Experiment config", path: path.join(experimentDir, "experiment-config.json"), kind: "json" },
    ...runs.flatMap((run) => [
      { label: `${run.runId} prompt`, path: run.artifactPaths.promptPath ?? path.join(experimentDir, "runs", run.runId, "prompt.txt"), kind: "text" },
      {
        label: `${run.runId} correctness`,
        path: run.artifactPaths.correctnessScorePath ?? path.join(experimentDir, "runs", run.runId, "correctness-score.json"),
        kind: "json"
      }
    ])
  ];
}

function answerFromComparisonValues(values: Array<number | undefined>): AggregateAnswerLabel {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (usable.length === 0) {
    return "unavailable";
  }
  const positive = usable.filter((value) => value > 0).length;
  const negative = usable.filter((value) => value < 0).length;
  if (positive > usable.length / 2) return "yes";
  if (negative > usable.length / 2) return "no";
  return "mixed";
}

function answerCorrectness(comparisons: ExperimentComparison[]): AggregateAnswerLabel {
  const completed = comparisons.filter((comparison) => comparison.rawStatus === "completed" && comparison.myDevKitStatus === "completed");
  if (completed.length === 0) {
    return comparisons.length === 0 ? "unavailable" : "inconclusive";
  }
  const preserved = completed.filter((comparison) => comparison.sameCorrectnessPass).length;
  if (preserved === completed.length) return "yes";
  if (preserved === 0) return "no";
  return "mixed";
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export async function assertExperimentReportCanRead(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
