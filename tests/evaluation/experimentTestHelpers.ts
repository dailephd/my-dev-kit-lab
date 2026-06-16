import path from "node:path";
import { readBenchmarkProjectProfiles, readEvaluationCases } from "../../src/evaluation/index.js";
import type { AgentRunResult } from "../../src/agents/types.js";
import type { PromptComplexityLevel, PromptStrategy } from "../../src/prompts/types.js";
import type { ExperimentRun, ExperimentRunStatus, ParsedAgentAnswer } from "../../src/evaluation/controlledExperimentTypes.js";

export async function loadExperimentFixtures() {
  const projectProfiles = await readBenchmarkProjectProfiles(path.resolve(process.cwd(), "benchmarks/contracts/benchmark-project-profiles.json"));
  const cases = await readEvaluationCases(path.resolve(process.cwd(), "examples/token-savings-cases.json"), process.cwd(), {
    projectProfiles,
    requireProjectProfileRef: true
  });
  return { projectProfiles, cases };
}

export function makeAgentRunResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    runId: "run-1",
    agentId: "fake-agent",
    displayName: "Fake Agent",
    surface: "simulated",
    promptVariantId: "variant-1",
    promptStrategy: "raw-full-file",
    promptComplexityLevel: "short",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    status: "completed",
    exitCode: 0,
    command: "fake-agent",
    args: [],
    cwd: process.cwd(),
    finalAnswerText:
      "answer: ok\nrelevantFiles: src/taskService.ts\nrelevantSymbols: createTask\nexpectedFactsFound: create-deterministic-id, create-validates-title",
    finalAnswerParseStatus: "parsed",
    tokenUsage: { totalTokens: 100, source: "agent-reported" },
    tokenUsageSource: "agent-reported",
    tokenUsageReliability: "high",
    warnings: [],
    errors: [],
    ...overrides
  };
}

export function makeParsedAnswer(overrides: Partial<ParsedAgentAnswer> = {}): ParsedAgentAnswer {
  return {
    answerText: "createTask assigns deterministic IDs and validates titles.",
    relevantFiles: ["src/taskService.ts", "src/taskStore.ts"],
    relevantSymbols: ["createTask", "TaskService"],
    expectedFactsFound: ["create-deterministic-id", "create-validates-title"],
    confidence: "high",
    commandsRun: [],
    selectedContext: [],
    fullFileReads: [],
    fullFileReadJustifications: [],
    parseStatus: "parsed",
    warnings: [],
    ...overrides
  };
}

export function makeExperimentRun(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  const strategy = overrides.promptStrategy ?? "raw-full-file";
  const status = overrides.status ?? "completed";
  const complexity = overrides.promptComplexityLevel ?? "short";
  return {
    runId: `${strategy}-run`,
    caseId: "todo-ts-create-task",
    benchmarkProject: "todo-ts",
    agentId: "fake-agent",
    promptStrategy: strategy as PromptStrategy,
    promptComplexityLevel: complexity as PromptComplexityLevel,
    promptVariantId: `variant-${strategy}`,
    projectComplexityLevel: "small",
    projectComplexityScore: 12,
    promptMetrics: {
      promptChars: 100,
      promptEstimatedTokens: 25,
      tokenCountMethod: "estimated_chars_div_4",
      instructionCount: 1,
      constraintCount: 1,
      requestedOutputFieldCount: 4,
      taskStepCount: 0,
      expectedFactCount: 2,
      expectedFileCount: 2,
      expectedSymbolCount: 2,
      includesFileTree: false,
      includesProjectDescription: false,
      includesAnswerKeySummary: false,
      requiresMultipleFiles: true,
      requiresGraphGuidedRetrieval: strategy === "my-dev-kit-guided",
      requiresCommandExecution: strategy === "my-dev-kit-guided",
      requiresTokenReport: true,
      requiresTimingReport: true
    },
    agentRunResult: makeAgentRunResult({ promptStrategy: strategy as PromptStrategy, promptComplexityLevel: complexity as PromptComplexityLevel }),
    parsedAnswer: makeParsedAnswer(),
    correctness: {
      caseId: "todo-ts-create-task",
      fileMatchScore: 1,
      symbolMatchScore: 1,
      factMatchScore: 1,
      correctnessScore: 1,
      requiredFactsFound: 2,
      requiredFactsTotal: 2,
      optionalFactsFound: 0,
      optionalFactsTotal: 0,
      expectedFilesFound: 2,
      expectedFilesTotal: 2,
      expectedSymbolsFound: 2,
      expectedSymbolsTotal: 2,
      passed: true,
      failureReasons: [],
      formula: "test"
    },
    status: status as ExperimentRunStatus,
    statusReason: "test",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    tokenUsage: { totalTokens: 100, source: "agent-reported" },
    tokenUsageSource: "agent-reported",
    tokenUsageReliability: "high",
    warnings: [],
    errors: [],
    artifactPaths: {},
    ...overrides
  };
}
