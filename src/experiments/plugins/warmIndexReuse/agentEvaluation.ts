import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAgentPrompt } from "../../../agents/index.js";
import type { AgentId, AgentRunResult, TokenUsageReliability, TokenUsageSource } from "../../../agents/types.js";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import { classifyAgentRunOutcome } from "../../../evaluation/classifyAgentRunOutcome.js";
import { parseAgentAnswer } from "../../../evaluation/parseAgentAnswer.js";
import { scoreCorrectness } from "../../../evaluation/scoreCorrectness.js";
import type { BenchmarkProjectProfile, BenchmarkTaskAnswerKey, EvaluationCase } from "../../../evaluation/types.js";
import { generatePromptVariants } from "../../../prompts/index.js";
import type { PromptStrategy } from "../../../prompts/types.js";
import type { WarmIndexCampaignAgentId } from "./campaignPresets.js";
import type { WarmIndexProjectExecutionV1 } from "./execution.js";
import { buildWarmIndexRealAgentPrompt } from "./realAgentPrompt.js";
import { taskOutputSegment } from "./selection.js";

// ---------------------------------------------------------------------------
// Single shared owner for warm-index agent evidence types and evaluation. The
// deterministic fake-agent path (v0.5.0) and the real-agent campaign path
// (v0.5.2 Batch 3) share the same bounded evidence shape, prompt-strategy
// mapping, and scoring/classification pipeline (parseAgentAnswer,
// classifyAgentRunOutcome, scoreCorrectness) -- there is exactly one
// implementation of each, not one per path. Both paths run after execution
// evidence already exists and never repeat raw context construction or
// my-dev-kit retrieval.
// ---------------------------------------------------------------------------

export type WarmIndexAgentVariantId = "raw-full-file" | "warm-index-reuse";

/** Bounded agent evidence: no prompt text, answer text, context text, or stdout/stderr bodies. */
export type WarmIndexAgentSideEvidenceV1 = {
  variantId: WarmIndexAgentVariantId;
  agentId: AgentId;
  /** Internal agent-harness prompt strategy; the experiment outcome keeps its own variant ID. */
  promptStrategy: PromptStrategy;
  /** Classified agent outcome status (for example completed, failed, invalid-output). */
  status: string;
  correctness: {
    available: boolean;
    score: number | null;
    passed: boolean | null;
    failureReasons: string[];
  };
  tokenUsage: {
    totalTokens: number | null;
    source: TokenUsageSource;
    reliability: TokenUsageReliability;
  };
  durationMs: number | null;
  warnings: string[];
  errors: string[];
  artifactPaths: {
    promptPath?: string;
    agentRunResultPath?: string;
    stdoutPath?: string;
    stderrPath?: string;
    telemetryPath?: string;
  };
};

/** A null side means the agent was not run because that side produced no context evidence. */
export type WarmIndexTaskAgentEvidenceV1 = {
  caseId: string;
  raw: WarmIndexAgentSideEvidenceV1 | null;
  warm: WarmIndexAgentSideEvidenceV1 | null;
};

export type WarmIndexProjectAgentEvidenceV1 = {
  benchmarkProject: string;
  tasks: WarmIndexTaskAgentEvidenceV1[];
};

// Classified statuses for which the scorer evaluated an actual agent answer.
const SCOREABLE_STATUSES = new Set(["completed", "invalid-output"]);

const SIDE_STRATEGIES: Record<WarmIndexAgentVariantId, PromptStrategy> = {
  "raw-full-file": "raw-full-file",
  "warm-index-reuse": "my-dev-kit-guided",
};

export async function evaluateWarmIndexFakeAgents(options: {
  projects: readonly WarmIndexProjectExecutionV1[];
  cases: readonly EvaluationCase[];
  projectProfiles: readonly BenchmarkProjectProfile[];
  outputRoot: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): Promise<WarmIndexProjectAgentEvidenceV1[]> {
  const casesById = new Map(options.cases.map((evaluationCase) => [evaluationCase.id, evaluationCase]));
  const result: WarmIndexProjectAgentEvidenceV1[] = [];
  for (const project of options.projects) {
    const tasks: WarmIndexTaskAgentEvidenceV1[] = [];
    for (const task of project.tasks) {
      const evaluationCase = casesById.get(task.caseId);
      const run = (variantId: WarmIndexAgentVariantId) =>
        evaluateFakeSide({
          evaluationCase,
          caseId: task.caseId,
          variantId,
          projectProfiles: options.projectProfiles,
          outDir: resolveWithinRoot(
            options.outputRoot,
            path.join("agents", project.projectSegment, taskOutputSegment(task.caseId), variantId)
          ),
          cwd: options.cwd,
          env: options.env,
        });
      tasks.push({
        caseId: task.caseId,
        raw: task.rawBaseline ? await run("raw-full-file") : null,
        warm: task.warmRetrieval ? await run("warm-index-reuse") : null,
      });
    }
    result.push({ benchmarkProject: project.benchmarkProject, tasks });
  }
  return result;
}

async function evaluateFakeSide(args: {
  evaluationCase: EvaluationCase | undefined;
  caseId: string;
  variantId: WarmIndexAgentVariantId;
  projectProfiles: readonly BenchmarkProjectProfile[];
  outDir: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): Promise<WarmIndexAgentSideEvidenceV1> {
  const promptStrategy = SIDE_STRATEGIES[args.variantId];
  const base = { variantId: args.variantId, agentId: "fake-agent" as const, promptStrategy };
  try {
    if (!args.evaluationCase) {
      throw new Error(`Evaluation case ${args.caseId} is not available for fake-agent evaluation.`);
    }
    const [promptVariant] = generatePromptVariants({
      cases: [args.evaluationCase],
      projectProfiles: [...args.projectProfiles],
      strategies: [promptStrategy],
      complexityLevels: ["short"],
    });
    if (!promptVariant) {
      throw new Error(`Failed to generate a fake-agent prompt for case ${args.caseId}.`);
    }
    const agentRunResult: AgentRunResult = await runAgentPrompt({
      runId: `${args.caseId}.fake-agent.${args.variantId}`,
      agentId: "fake-agent",
      promptVariant,
      promptText: promptVariant.promptText,
      cwd: args.cwd,
      outDir: args.outDir,
      env: args.env,
    });
    return buildSideEvidenceFromRun({ base, caseId: args.caseId, outDir: args.outDir, agentRunResult, expectedAnswerKey: promptVariant.expectedAnswerKey });
  } catch (error) {
    return buildFailedSideEvidence(base, error);
  }
}

/**
 * Real-agent campaign evaluator (v0.5.2 Batch 3): consumes the exact context text the warm-index
 * execution stage already produced for one side. Never calls my-dev-kit, never independently
 * inspects the repository, and never runs a side with no usable context.
 */
export async function evaluateWarmIndexRealAgentCampaign(options: {
  projects: readonly WarmIndexProjectExecutionV1[];
  cases: readonly EvaluationCase[];
  projectProfiles: readonly BenchmarkProjectProfile[];
  outputRoot: string;
  agentId: WarmIndexCampaignAgentId;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}): Promise<WarmIndexProjectAgentEvidenceV1[]> {
  const casesById = new Map(options.cases.map((evaluationCase) => [evaluationCase.id, evaluationCase]));
  const result: WarmIndexProjectAgentEvidenceV1[] = [];
  for (const project of options.projects) {
    const tasks: WarmIndexTaskAgentEvidenceV1[] = [];
    for (const task of project.tasks) {
      const evaluationCase = casesById.get(task.caseId);
      const rawContext = task.rawBaseline?.contextText;
      const rawEligible = typeof rawContext === "string" && rawContext.trim().length > 0;
      const warmContext = task.warmRetrieval?.contextText;
      const warmEligible =
        task.warmRetrieval !== undefined &&
        task.warmRetrieval.skipped === false &&
        typeof warmContext === "string" &&
        warmContext.trim().length > 0;

      const runSide = (variantId: WarmIndexAgentVariantId, contextText: string) =>
        evaluateRealSide({
          evaluationCase,
          caseId: task.caseId,
          variantId,
          contextText,
          projectProfiles: options.projectProfiles,
          outDir: resolveWithinRoot(
            options.outputRoot,
            path.join("agents", project.projectSegment, taskOutputSegment(task.caseId), variantId)
          ),
          agentId: options.agentId,
          timeoutMs: options.timeoutMs,
          env: options.env,
        });

      tasks.push({
        caseId: task.caseId,
        raw: rawEligible ? await runSide("raw-full-file", rawContext as string) : null,
        warm: warmEligible ? await runSide("warm-index-reuse", warmContext as string) : null,
      });
    }
    result.push({ benchmarkProject: project.benchmarkProject, tasks });
  }
  return result;
}

async function evaluateRealSide(args: {
  evaluationCase: EvaluationCase | undefined;
  caseId: string;
  variantId: WarmIndexAgentVariantId;
  contextText: string;
  projectProfiles: readonly BenchmarkProjectProfile[];
  outDir: string;
  agentId: WarmIndexCampaignAgentId;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}): Promise<WarmIndexAgentSideEvidenceV1> {
  const promptStrategy = SIDE_STRATEGIES[args.variantId];
  const base = { variantId: args.variantId, agentId: args.agentId, promptStrategy };
  let neutralCwd: string | undefined;
  try {
    if (!args.evaluationCase) {
      throw new Error(`Evaluation case ${args.caseId} is not available for real-agent evaluation.`);
    }
    // Generated only for internal scoring/metadata (expectedAnswerKey, promptComplexityLevel); its
    // promptText is never sent to the provider.
    const [promptVariant] = generatePromptVariants({
      cases: [args.evaluationCase],
      projectProfiles: [...args.projectProfiles],
      strategies: [promptStrategy],
      complexityLevels: ["short"],
    });
    if (!promptVariant) {
      throw new Error(`Failed to generate an internal scoring prompt variant for case ${args.caseId}.`);
    }
    const realPromptText = buildWarmIndexRealAgentPrompt({
      evaluationCase: args.evaluationCase,
      variantId: args.variantId,
      contextText: args.contextText,
    });

    // Neutral working directory: the provider must not run from the repository, the benchmark
    // target, the installed package, or the agent artifact directory.
    neutralCwd = await mkdtemp(path.join(os.tmpdir(), "my-dev-kit-lab-warm-agent-"));
    const agentRunResult: AgentRunResult = await runAgentPrompt({
      runId: `${args.caseId}.${args.agentId}.${args.variantId}`,
      agentId: args.agentId,
      promptVariant,
      promptText: realPromptText,
      promptTransport: "stdin",
      timeoutMs: args.timeoutMs,
      requireAvailable: false,
      env: args.env,
      cwd: neutralCwd,
      outDir: args.outDir,
    });

    return buildSideEvidenceFromRun({
      base,
      caseId: args.caseId,
      outDir: args.outDir,
      agentRunResult,
      expectedAnswerKey: promptVariant.expectedAnswerKey,
    });
  } catch (error) {
    return buildFailedSideEvidence(base, error);
  } finally {
    if (neutralCwd) {
      await rm(neutralCwd, { recursive: true, force: true });
    }
  }
}

// Shared scoring/classification/evidence assembly for both the fake-agent and real-agent paths.
function buildSideEvidenceFromRun(args: {
  base: { variantId: WarmIndexAgentVariantId; agentId: AgentId; promptStrategy: PromptStrategy };
  caseId: string;
  outDir: string;
  agentRunResult: AgentRunResult;
  expectedAnswerKey: BenchmarkTaskAnswerKey;
}): WarmIndexAgentSideEvidenceV1 {
  const { base, caseId, outDir, agentRunResult, expectedAnswerKey } = args;
  const parsedAnswer = parseAgentAnswer({
    text: agentRunResult.finalAnswerText,
    answerKey: expectedAnswerKey,
    tokenUsage: agentRunResult.tokenUsage,
  });
  const classification = classifyAgentRunOutcome({ agentRunResult, parsedAnswer });
  const correctness = scoreCorrectness({
    caseId,
    answerKey: expectedAnswerKey,
    parsedAnswer,
    status: classification.status,
  });
  const scoreable = SCOREABLE_STATUSES.has(classification.status) && Number.isFinite(correctness.correctnessScore);
  const totalTokens = agentRunResult.tokenUsage.totalTokens;
  return {
    ...base,
    status: classification.status,
    correctness: {
      available: scoreable,
      score: scoreable ? correctness.correctnessScore : null,
      passed: scoreable ? correctness.passed : null,
      failureReasons: [...correctness.failureReasons],
    },
    tokenUsage: {
      totalTokens: typeof totalTokens === "number" && Number.isFinite(totalTokens) ? totalTokens : null,
      source: agentRunResult.tokenUsageSource,
      reliability: agentRunResult.tokenUsageReliability,
    },
    durationMs: agentRunResult.durationMs,
    warnings: [...classification.warnings],
    errors: [...classification.errors],
    artifactPaths: {
      promptPath: path.join(outDir, "prompt.txt"),
      agentRunResultPath: path.join(outDir, "agent-run-result.json"),
      stdoutPath: agentRunResult.stdoutPath,
      stderrPath: agentRunResult.stderrPath,
      telemetryPath: agentRunResult.telemetryPath,
    },
  };
}

function buildFailedSideEvidence(
  base: { variantId: WarmIndexAgentVariantId; agentId: AgentId; promptStrategy: PromptStrategy },
  error: unknown
): WarmIndexAgentSideEvidenceV1 {
  return {
    ...base,
    status: "failed",
    correctness: { available: false, score: null, passed: null, failureReasons: [] },
    tokenUsage: { totalTokens: null, source: "unavailable", reliability: "unavailable" },
    durationMs: null,
    warnings: [],
    errors: [error instanceof Error ? error.message : String(error)],
    artifactPaths: {},
  };
}
