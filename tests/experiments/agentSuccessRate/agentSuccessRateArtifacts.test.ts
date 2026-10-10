import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_SUCCESS_RATE_ANALYSIS_SCHEMA_VERSION,
  AGENT_SUCCESS_RATE_EXECUTION_SCHEMA_VERSION,
  analyzeAgentSuccessRate,
  buildAgentSuccessRateAnalysisArtifact,
  buildAgentSuccessRateExecutionArtifact,
  validateAgentSuccessRateAnalysisArtifact,
  validateAgentSuccessRateArtifactFamily,
  validateAgentSuccessRateExecutionArtifact,
  type AgentSuccessRateAnalysisArtifactV1,
  type AgentSuccessRateExecutionArtifactV1
} from "../../../src/experiments/plugins/agentSuccessRate/index.js";
import { useSandboxTestCleanup } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
import { makeCaseEvidence, makeTask, makeTempDir, makeToolRoot, runAgentSuccess, taskInput } from "./agentSuccessRateTestHelpers.js";

useSandboxTestCleanup();

const common = { runId: "run-1", pluginId: "agent-success-rate", pluginSchemaVersion: "1.0.0", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z" };

function buildFamily() {
  const task = makeTask();
  const evidence = [makeCaseEvidence(task)];
  const execution = buildAgentSuccessRateExecutionArtifact({ ...common, cases: evidence });
  const analysis = buildAgentSuccessRateAnalysisArtifact({ ...common, analysis: analyzeAgentSuccessRate([task], evidence) });
  return { execution, analysis };
}

const walk = (root: string): string[] =>
  !existsSync(root)
    ? []
    : readdirSync(root, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(root, entry.name)).map((child) => `${entry.name}/${child}`) : [entry.name])).sort();

describe("agent-success-rate artifacts", () => {
  it("ASR-047 the execution artifact schema and identity validate", () => {
    const { execution } = buildFamily();
    expect(execution.schemaVersion).toBe("my-dev-kit-lab-agent-success-rate-execution-v1");
    expect(execution.schemaVersion).toBe(AGENT_SUCCESS_RATE_EXECUTION_SCHEMA_VERSION);
    expect(execution).toMatchObject({ pluginId: "agent-success-rate", pluginSchemaVersion: "1.0.0", executionMode: "deterministic-fixture", contextEffectEvaluated: false, treatmentOrder: ["raw-full-file", "context-pack"] });
    expect(validateAgentSuccessRateExecutionArtifact(execution)).toEqual([]);
    expect(validateAgentSuccessRateExecutionArtifact({ ...execution, treatmentOrder: ["context-pack", "raw-full-file"] })).not.toEqual([]);
    expect(validateAgentSuccessRateExecutionArtifact({ ...execution, contextEffectEvaluated: true as unknown as false })).not.toEqual([]);
    const sharedSandbox = structuredClone(execution);
    sharedSandbox.cases[0]!.treatments[1]!.sandboxId = sharedSandbox.cases[0]!.treatments[0]!.sandboxId;
    expect(validateAgentSuccessRateExecutionArtifact(sharedSandbox)).not.toEqual([]);
  });

  it("ASR-048 the analysis artifact schema and identity validate", () => {
    const { analysis } = buildFamily();
    expect(analysis.schemaVersion).toBe("my-dev-kit-lab-agent-success-rate-analysis-v1");
    expect(analysis.schemaVersion).toBe(AGENT_SUCCESS_RATE_ANALYSIS_SCHEMA_VERSION);
    expect(analysis).toMatchObject({ pluginId: "agent-success-rate", pluginSchemaVersion: "1.0.0" });
    expect(validateAgentSuccessRateAnalysisArtifact(analysis)).toEqual([]);
    const broken = structuredClone(analysis);
    broken.analysis.cases[0]!.treatments[0]!.metrics.taskSuccess = { id: "taskSuccess", availability: "available", value: null, unit: "boolean", reason: null };
    expect(validateAgentSuccessRateAnalysisArtifact(broken)).not.toEqual([]);
  });

  it("ASR-049 execution and analysis share run, case and treatment identities", () => {
    const { execution, analysis } = buildFamily();
    expect(validateAgentSuccessRateArtifactFamily(execution, analysis)).toEqual([]);
    expect(validateAgentSuccessRateArtifactFamily({ ...execution, runId: "other" }, analysis)).not.toEqual([]);
    const renamed = structuredClone(analysis);
    renamed.analysis.cases[0]!.caseId = "other-case";
    expect(validateAgentSuccessRateArtifactFamily(execution, renamed)).not.toEqual([]);
  });

  it("ASR-049/050 persisted artifacts agree and proposed and applied patch artifacts are distinct files", async () => {
    const toolRoot = makeToolRoot();
    const { run, outDir } = await runAgentSuccess({ toolRoot, tasks: [taskInput()] });
    const execution = JSON.parse(readFileSync(path.join(outDir, "agent-success-rate-execution.json"), "utf8")) as AgentSuccessRateExecutionArtifactV1;
    const analysis = JSON.parse(readFileSync(path.join(outDir, "agent-success-rate-analysis.json"), "utf8")) as AgentSuccessRateAnalysisArtifactV1;
    expect(validateAgentSuccessRateExecutionArtifact(execution)).toEqual([]);
    expect(validateAgentSuccessRateAnalysisArtifact(analysis)).toEqual([]);
    expect(validateAgentSuccessRateArtifactFamily(execution, analysis)).toEqual([]);
    expect(execution.runId).toBe("run-1");
    expect(run.runId).toBe(execution.runId);
    expect(walk(outDir)).toEqual([
      "agent-success-rate-analysis.json",
      "agent-success-rate-execution.json",
      "diffs/fixture/fixture-add-fix/context-pack/attempt-1-applied.patch",
      "diffs/fixture/fixture-add-fix/context-pack/attempt-1-proposed.patch",
      "diffs/fixture/fixture-add-fix/raw-full-file/attempt-1-applied.patch",
      "diffs/fixture/fixture-add-fix/raw-full-file/attempt-1-proposed.patch"
    ]);
    const proposed = readFileSync(path.join(outDir, "diffs/fixture/fixture-add-fix/raw-full-file/attempt-1-proposed.patch"), "utf8");
    const applied = readFileSync(path.join(outDir, "diffs/fixture/fixture-add-fix/raw-full-file/attempt-1-applied.patch"), "utf8");
    expect(proposed).not.toBe(applied);
    // The analysis in the run object is the artifact's analysis, so reporting never recomputes it.
    expect(run.analysis).toEqual(analysis.analysis);
    expect(run.metrics.length).toBeGreaterThan(0);
    expect(run.summary).toMatchObject({ totalCases: 1, completedCases: 1 });
  }, 60_000);

  it("ASR-052 an artifact write failure removes only this attempt's files and fails the run", async () => {
    const toolRoot = makeToolRoot();
    const outDir = path.join(makeTempDir("lab-asr-out-"), "out");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "unrelated.txt"), "keep me");
    const written: string[] = [];
    const { run } = await runAgentSuccess({
      toolRoot,
      tasks: [taskInput()],
      outputRoot: outDir,
      extraInputs: {
        agentSuccessArtifactIo: {
          writeFile: async (filePath: string, content: string) => {
            if (filePath.endsWith("agent-success-rate-analysis.json")) throw new Error("disk full at C:\\private\\path");
            writeFileSync(filePath, content);
            written.push(filePath);
          }
        }
      }
    });
    expect(written.length).toBeGreaterThan(0);
    expect(run.status).toBe("failed");
    expect(run.failures[0]!.message).toBe("Agent success rate artifact persistence failed.");
    expect(run.failures[0]!.message).not.toContain("private");
    // No falsely complete family: every file this attempt created is gone, the sandboxes were still cleaned.
    expect(walk(outDir)).toEqual(["unrelated.txt"]);
    expect(readFileSync(path.join(outDir, "unrelated.txt"), "utf8")).toBe("keep me");
    expect(existsSync(path.join(outDir, "sandboxes"))).toBe(false);
  }, 60_000);

  it("ASR-053 unrelated pre-existing output is never removed or overwritten", async () => {
    const toolRoot = makeToolRoot();
    const outDir = path.join(makeTempDir("lab-asr-out-"), "out");
    mkdirSync(path.join(outDir, "diffs"), { recursive: true });
    writeFileSync(path.join(outDir, "notes.md"), "notes");
    writeFileSync(path.join(outDir, "diffs", "other.patch"), "other");
    const ok = await runAgentSuccess({ toolRoot, tasks: [taskInput()], outputRoot: outDir });
    expect(ok.run.status).toBe("completed");
    expect(readFileSync(path.join(outDir, "notes.md"), "utf8")).toBe("notes");
    expect(readFileSync(path.join(outDir, "diffs", "other.patch"), "utf8")).toBe("other");

    // A second run into the same directory would overwrite this run's artifacts: it must refuse instead.
    const before = readFileSync(path.join(outDir, "agent-success-rate-execution.json"), "utf8");
    const again = await runAgentSuccess({ toolRoot, tasks: [taskInput()], outputRoot: outDir, runId: "run-2" });
    expect(again.run.status).toBe("failed");
    expect(readFileSync(path.join(outDir, "agent-success-rate-execution.json"), "utf8")).toBe(before);
    expect(readFileSync(path.join(outDir, "notes.md"), "utf8")).toBe("notes");
  }, 90_000);

  it("ASR-057 repeated runs of identical fixtures give identical scientific values and ordering", async () => {
    const toolRoot = makeToolRoot();
    const stripTiming = (artifact: AgentSuccessRateAnalysisArtifactV1) => {
      const copy = structuredClone(artifact);
      copy.startedAt = copy.completedAt = "t";
      for (const entry of copy.analysis.cases) {
        for (const treatment of entry.treatments) {
          for (const id of ["baselineVerificationDurationMs", "patchPipelineDurationMs", "postEditVerificationDurationMs", "evaluationDurationMs"] as const) treatment.metrics[id].value = 0;
        }
      }
      for (const aggregate of copy.analysis.aggregates) aggregate.means.meanEvaluationDurationMs.metric.value = 0;
      return copy;
    };
    const read = async () => {
      const { outDir } = await runAgentSuccess({ toolRoot, tasks: [taskInput(), taskInput({ id: "second-case" })] });
      return {
        analysis: stripTiming(JSON.parse(readFileSync(path.join(outDir, "agent-success-rate-analysis.json"), "utf8")) as AgentSuccessRateAnalysisArtifactV1),
        files: walk(outDir)
      };
    };
    const first = await read();
    const second = await read();
    expect(second).toEqual(first);
    expect(first.analysis.analysis.cases.map((c) => c.caseId)).toEqual(["fixture-add-fix", "second-case"]);
  }, 120_000);
});
