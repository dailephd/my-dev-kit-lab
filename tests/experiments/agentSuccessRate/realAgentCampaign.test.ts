import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertReadAgentSuccessCorpus } from "../../../src/evaluation/agentSuccess/index.js";
import { snapshotProjectTree } from "../../../src/evaluation/benchmarkSandbox/index.js";
import { createDefaultExperimentPluginRegistry } from "../../../src/experiments/defaultRegistry.js";
import { runExperiment } from "../../../src/experiments/runner.js";
import { makeTempDir, useSandboxTestCleanup } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
import { makeProviderShim, makeSourceBackedKit } from "./realAgentTestHelpers.js";

useSandboxTestCleanup();

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const MODES = ["raw-full-file", "context-pack"] as const;
const PROJECTS = ["agent-success-task-board-node", "agent-success-inventory-node"] as const;

describe("REA simulated real-agent campaign over the six canonical tasks", () => {
  it("REA-058/060: 6 cases, 12 provider attempts, independent sandboxes and trusted evaluation, with the reference patch only on the shim side", async () => {
    const toolRoot = process.cwd();
    const corpus = assertReadAgentSuccessCorpus(toolRoot);
    expect(corpus.tasks).toHaveLength(6);

    const shim = makeProviderShim("codex");
    // The reference answer is injected on the shim side from test-owned fixture data; the plugin never sees it.
    const references = new Map<string, string>();
    for (const task of corpus.tasks) {
      const patch = task.deterministicFixture!.patch;
      references.set(task.id, patch);
      for (const mode of MODES) shim.respond(task.id, mode, `\`\`\`diff\n${patch}${patch.endsWith("\n") ? "" : "\n"}\`\`\`\n`);
    }

    const canonicalBefore = await Promise.all(
      PROJECTS.map(async (project) => snapshotProjectTree(path.join(toolRoot, "benchmarks", "projects", project), { excludedNames: [".git"] }))
    );
    const kit = makeSourceBackedKit();
    const outDir = path.join(makeTempDir("lab-asr-campaign-"), "out");
    const run = await runExperiment({
      pluginId: "agent-success-rate",
      registry: createDefaultExperimentPluginRegistry(),
      toolRoot,
      outputRoot: outDir,
      runId: "campaign-run",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      config: { agentId: "codex", includeRealAgents: true, timeoutMs: 60_000 },
      inputs: { agentSuccessTasks: corpus.tasks, agentSuccessAgentEnv: shim.env, agentSuccessContextDependencies: kit.dependencies }
    });

    expect(run.status, JSON.stringify(run.cases.flatMap((c) => c.outcomes.map((o) => [o.id, o.status, o.failures.map((f) => `${f.code}: ${f.message}`)])))).toBe("completed");
    expect(run.cases).toHaveLength(6);
    expect(run.cases.flatMap((entry) => entry.outcomes)).toHaveLength(12);
    expect(shim.invocationKeys()).toHaveLength(12);

    const execution = JSON.parse(readFileSync(path.join(outDir, "agent-success-rate-execution.json"), "utf8")) as Json;
    const analysis = JSON.parse(readFileSync(path.join(outDir, "agent-success-rate-analysis.json"), "utf8")) as Json;
    expect(execution.cases.map((entry: Json) => entry.caseId)).toEqual(corpus.tasks.map((task) => task.id));
    expect(analysis.analysis.comparison.matchedCaseIds).toEqual(corpus.tasks.map((task) => task.id));
    expect(analysis.analysis.comparison.incompleteCases).toEqual([]);

    const sandboxIds = new Set<string>();
    for (const entry of execution.cases as Json[]) {
      for (const treatment of entry.treatments as Json[]) {
        sandboxIds.add(treatment.sandboxId);
        expect(treatment.baselineAssessment.evaluable, `${entry.caseId}/${treatment.treatmentId}`).toBe(true);
        expect(treatment.realAgent).toMatchObject({ providerId: "codex", providerInvoked: true, providerStatus: "completed", finalAnswerAvailable: true });
        expect(treatment.patch.outcome, `${entry.caseId}/${treatment.treatmentId}`).toBe("success");
        const caseAnalysis = analysis.analysis.cases.find((candidate: Json) => candidate.caseId === entry.caseId);
        const metrics = caseAnalysis.treatments.find((candidate: Json) => candidate.treatmentId === treatment.treatmentId).metrics;
        expect(metrics.taskSuccess, `${entry.caseId}/${treatment.treatmentId}`).toMatchObject({ availability: "available", value: true });
        expect(metrics.agentTotalTokens).toMatchObject({ availability: "available", value: 100 });

        // the prompt actually delivered over stdin carries the treatment context and not the reference patch
        const prompt = shim.prompt(entry.caseId, treatment.treatmentId)!;
        expect(prompt).not.toContain(references.get(entry.caseId)!.trim());
        expect(prompt).not.toContain("tests/");
        expect(prompt).toContain(`Context mode: ${treatment.treatmentId}`);
        expect(treatment.realAgent.context.includedSourceFiles.every((file: string) => file.startsWith("src/"))).toBe(true);
        expect(existsSync(path.join(outDir, treatment.realAgent.context.contextArtifactPath))).toBe(true);
        expect(existsSync(path.join(outDir, treatment.realAgent.agentArtifactDirectory, "agent-run-result.json"))).toBe(true);
      }
    }
    expect(sandboxIds.size).toBe(12);

    // raw context carries every src file of the project; the context pack is a bounded subset
    const raw = (execution.cases[0] as Json).treatments[0];
    const pack = (execution.cases[0] as Json).treatments[1];
    expect(raw.realAgent.context.selectionPolicyId).toBe("raw-source-glob-v1");
    expect(pack.realAgent.context.selectionPolicyId).toBe("bounded-multiseed-v1");

    // the raw-context prompt really contains the canonical source of the first task's project
    const boardValidation = readFileSync(path.join(toolRoot, "benchmarks", "projects", "agent-success-task-board-node", "src", "validation.js"), "utf8");
    expect(shim.prompt(corpus.tasks[0]!.id, "raw-full-file")).toContain(boardValidation.replace(/\r\n/g, "\n"));

    // no reference patch body or source text in the JSON artifacts, and nothing left behind in the canonical projects
    for (const serialized of [JSON.stringify(execution), JSON.stringify(analysis)]) {
      expect(serialized).not.toContain("diff --git");
      expect(serialized).not.toContain("export class ValidationError");
    }
    const canonicalAfter = await Promise.all(
      PROJECTS.map(async (project) => snapshotProjectTree(path.join(toolRoot, "benchmarks", "projects", project), { excludedNames: [".git"] }))
    );
    expect(canonicalAfter).toEqual(canonicalBefore);
    expect(existsSync(path.join(outDir, "sandboxes"))).toBe(false);
    expect(readdirSync(path.join(outDir, "agents"))).toEqual([...PROJECTS].sort());
  }, 900_000);
});
