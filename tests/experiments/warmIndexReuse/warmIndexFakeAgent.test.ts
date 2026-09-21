import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRunResult } from "../../../src/agents/types.js";
import { parseAgentAnswer } from "../../../src/evaluation/parseAgentAnswer.js";
import { classifyAgentRunOutcome } from "../../../src/evaluation/classifyAgentRunOutcome.js";
import { scoreCorrectness } from "../../../src/evaluation/scoreCorrectness.js";
import type { EvaluationCase } from "../../../src/evaluation/types.js";
import { createDefaultExperimentPluginRegistry, runExperiment } from "../../../src/experiments/index.js";
import type { WarmIndexReuseRun } from "../../../src/experiments/plugins/warmIndexReuse/index.js";
import { generatePromptVariants } from "../../../src/prompts/index.js";
import { fakeKitCommand, loadBundledProjectProfiles, makeCase, writeFakeKitVariant } from "./warmIndexTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function runWarm(cases: EvaluationCase[], env: NodeJS.ProcessEnv = {}, kitCommand = fakeKitCommand) {
  const outputRoot = tempDir("warm-agent-");
  const run = (await runExperiment({
    pluginId: "warm-index-reuse",
    registry: createDefaultExperimentPluginRegistry(),
    outputRoot,
    config: { kitCommand },
    inputs: { cases, projectProfiles: await loadBundledProjectProfiles(), env },
    toolRoot: process.cwd(),
    runId: "warm-agent-run",
  })) as WarmIndexReuseRun;
  return { run, outputRoot };
}

const twoTasks = () => [makeCase({ id: "task-a" }), makeCase({ id: "task-b" })];

describe("warm-index-reuse deterministic fake-agent evaluation", () => {
  it("evaluates both sides of every task once with scoreable fake-agent evidence and token totals", async () => {
    const { run, outputRoot } = await runWarm(twoTasks());
    expect(run.status).toBe("completed");
    const [project] = run.agentEvidence;
    expect(project.tasks.map((task) => task.caseId)).toEqual(["task-a", "task-b"]);
    for (const task of project.tasks) {
      for (const [side, variantId, strategy] of [
        [task.raw!, "raw-full-file", "raw-full-file"],
        [task.warm!, "warm-index-reuse", "my-dev-kit-guided"],
      ] as const) {
        expect(side).toEqual(
          expect.objectContaining({ variantId, agentId: "fake-agent", promptStrategy: strategy, status: "completed" })
        );
        expect(side.correctness.available).toBe(true);
        expect(side.tokenUsage).toEqual(
          expect.objectContaining({ totalTokens: expect.any(Number), source: "agent-reported", reliability: "high" })
        );
        expect(side.artifactPaths.agentRunResultPath).toBe(
          path.join(outputRoot, "agents", "todo-ts", task.caseId, variantId, "agent-run-result.json")
        );
      }
    }
    const [t1, t2] = run.warmIndexMetrics.projects[0].tasks;
    expect(t1.warm.agentCorrectness.availability).toBe("available");
    expect(t2.raw.cumulativeAgentTotalTokens.value).toBe(
      (t1.raw.agentTotalTokens.value as number) + (t2.raw.agentTotalTokens.value as number)
    );
    // Exactly one index for the project; agent evaluation never re-indexes or re-retrieves.
    const indexTelemetry = path.join(outputRoot, "commands", "todo-ts", "index", "index.telemetry.json");
    expect(existsSync(indexTelemetry)).toBe(true);
  });

  it("uses the existing parser, classifier, and scorer for correctness and reports the adapter's token total", async () => {
    const cases = twoTasks();
    const { run } = await runWarm(cases);
    const side = run.agentEvidence[0].tasks[0].warm!;
    const agentRunResult = JSON.parse(readFileSync(side.artifactPaths.agentRunResultPath!, "utf8")) as AgentRunResult;
    const [variant] = generatePromptVariants({
      cases: [cases[0]],
      projectProfiles: await loadBundledProjectProfiles(),
      strategies: ["my-dev-kit-guided"],
      complexityLevels: ["short"],
    });
    const parsedAnswer = parseAgentAnswer({ text: agentRunResult.finalAnswerText, answerKey: variant.expectedAnswerKey, tokenUsage: agentRunResult.tokenUsage });
    const classification = classifyAgentRunOutcome({ agentRunResult, parsedAnswer });
    const expected = scoreCorrectness({ caseId: "task-a", answerKey: variant.expectedAnswerKey, parsedAnswer, status: classification.status });
    expect(side.correctness.score).toBe(expected.correctnessScore);
    expect(side.correctness.passed).toBe(expected.passed);
    expect(run.warmIndexMetrics.projects[0].tasks[0].warm.agentCorrectness.value).toBe(expected.correctnessScore);
    expect(side.tokenUsage.totalTokens).toBe(agentRunResult.tokenUsage.totalTokens);
    expect(run.warmIndexMetrics.projects[0].tasks[0].warm.agentTotalTokens.value).toBe(agentRunResult.tokenUsage.totalTokens);
  });

  it("keeps prompts, answers, and token raw text out of the run record", async () => {
    const { run } = await runWarm(twoTasks());
    const serialized = JSON.stringify(run);
    for (const forbidden of ["finalAnswerText", "promptText", "rawText", "contextText", "Simulated benchmark answer"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("keeps missing fake-agent token usage unavailable without substituting estimated context tokens", async () => {
    const { run } = await runWarm(twoTasks(), { FAKE_AGENT_MODE: "missing-token-usage" });
    for (const task of run.warmIndexMetrics.projects[0].tasks) {
      for (const side of [task.raw, task.warm]) {
        expect(side.agentTotalTokens.availability).toBe("unavailable");
        expect(side.cumulativeAgentTotalTokens.availability).toBe("unavailable");
        expect(side.agentCorrectness.availability).toBe("available");
        expect(side.cumulativeEstimatedContextTokens.availability).toBe("available");
      }
    }
    expect(run.agentEvidence[0].tasks[0].raw?.tokenUsage).toEqual({ totalTokens: null, source: "unavailable", reliability: "unavailable" });
    for (const experimentCase of run.cases) {
      for (const outcome of experimentCase.outcomes) {
        expect(outcome.metrics.map((metric) => metric.id)).not.toContain("agent-total-tokens");
      }
    }
  });

  it("keeps context evidence and continues later tasks when the fake agent fails", async () => {
    const success = await runWarm(twoTasks());
    const failed = await runWarm(twoTasks(), { FAKE_AGENT_MODE: "failure" });
    const successTasks = success.run.warmIndexMetrics.projects[0].tasks;
    const failedTasks = failed.run.warmIndexMetrics.projects[0].tasks;
    expect(failedTasks).toHaveLength(2);
    for (let index = 0; index < failedTasks.length; index += 1) {
      for (const side of ["raw", "warm"] as const) {
        expect(failedTasks[index][side].contextCharacters).toEqual(successTasks[index][side].contextCharacters);
        expect(failedTasks[index][side].contextEstimatedTokens).toEqual(successTasks[index][side].contextEstimatedTokens);
        expect(failedTasks[index][side].agentCorrectness.availability).toBe("unavailable");
        expect(failedTasks[index][side].agentCorrectness.reason).toContain("status failed");
      }
    }
    // Execution status is unchanged; agent failure is reported separately.
    for (const experimentCase of failed.run.cases) {
      expect(experimentCase.outcomes.map((outcome) => outcome.status)).toEqual(["completed", "completed"]);
      expect(experimentCase.outcomes.map((outcome) => outcome.metadata?.agentStatus)).toEqual(["failed", "failed"]);
      expect(experimentCase.outcomes[1].warnings.map((warning) => warning.code)).toContain("fake-agent-evaluation-error");
    }
  });

  it("does not run the warm-side fake agent when no warm retrieval evidence exists", async () => {
    const kitCommand = writeFakeKitVariant(tempDir("warm-kit-"), { failOn: "index" });
    const { run, outputRoot } = await runWarm([makeCase({ id: "task-a" })], {}, kitCommand);
    const [task] = run.agentEvidence[0].tasks;
    expect(task.warm).toBeNull();
    expect(task.raw?.status).toBe("completed");
    expect(existsSync(path.join(outputRoot, "agents", "todo-ts", "task-a", "warm-index-reuse"))).toBe(false);
    expect(run.warmIndexMetrics.projects[0].tasks[0].warm.agentCorrectness.reason).toContain("not run");
    expect(run.cases[0].outcomes[1].metadata?.agentStatus).toBe("not-run");
  });
});
