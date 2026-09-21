import path from "node:path";
import { runAgentPrompt } from "../../../agents/index.js";
import type { AgentRunResult, TokenUsageReliability, TokenUsageSource } from "../../../agents/types.js";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import { classifyAgentRunOutcome } from "../../../evaluation/classifyAgentRunOutcome.js";
import { parseAgentAnswer } from "../../../evaluation/parseAgentAnswer.js";
import { scoreCorrectness } from "../../../evaluation/scoreCorrectness.js";
import type { BenchmarkProjectProfile, EvaluationCase } from "../../../evaluation/types.js";
import { generatePromptVariants } from "../../../prompts/index.js";
import type { PromptStrategy } from "../../../prompts/types.js";
import type { WarmIndexProjectExecutionV1 } from "./execution.js";
import { taskOutputSegment } from "./selection.js";

// ---------------------------------------------------------------------------
// Deterministic fake-agent evaluation for warm-index-reuse. Only fake-agent is
// used in v0.5.0; real-agent warm-index campaigns are out of scope. The agent
// runs after execution evidence exists and never repeats raw context
// construction or my-dev-kit retrieval. Prompts come from the shared prompt
// generator (case + profile metadata), so no target source is embedded.
// ---------------------------------------------------------------------------

export type WarmIndexAgentVariantId = "raw-full-file" | "warm-index-reuse";

/** Bounded fake-agent evidence: no prompt text, answer text, stdout/stderr bodies, or token rawText. */
export type WarmIndexAgentSideEvidenceV1 = {
  variantId: WarmIndexAgentVariantId;
  agentId: "fake-agent";
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

/** A null side means the fake agent was not run because that side produced no context evidence. */
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
        evaluateSide({
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

async function evaluateSide(args: {
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
    const parsedAnswer = parseAgentAnswer({
      text: agentRunResult.finalAnswerText,
      answerKey: promptVariant.expectedAnswerKey,
      tokenUsage: agentRunResult.tokenUsage,
    });
    const classification = classifyAgentRunOutcome({ agentRunResult, parsedAnswer });
    const correctness = scoreCorrectness({
      caseId: args.caseId,
      answerKey: promptVariant.expectedAnswerKey,
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
        promptPath: path.join(args.outDir, "prompt.txt"),
        agentRunResultPath: path.join(args.outDir, "agent-run-result.json"),
        stdoutPath: agentRunResult.stdoutPath,
        stderrPath: agentRunResult.stderrPath,
        telemetryPath: agentRunResult.telemetryPath,
      },
    };
  } catch (error) {
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
}
