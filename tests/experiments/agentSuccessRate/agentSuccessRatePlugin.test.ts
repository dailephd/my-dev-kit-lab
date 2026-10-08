import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotProjectTree } from "../../../src/evaluation/benchmarkSandbox/index.js";
import { createDefaultExperimentPluginRegistry } from "../../../src/experiments/defaultRegistry.js";
import {
  AGENT_SUCCESS_RATE_TREATMENT_IDS,
  AgentSuccessRateInputError,
  agentSuccessRateMetadata,
  readAgentSuccessTasksInput,
  resolveControlledBenchmarkProject,
  selectAgentSuccessTasks,
  validateAgentSuccessRateConfig
} from "../../../src/experiments/plugins/agentSuccessRate/index.js";
import { useSandboxTestCleanup } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
import { FIXTURE_FILES, makeTask, makeTempDir, makeToolRoot, runAgentSuccess, taskInput } from "./agentSuccessRateTestHelpers.js";

useSandboxTestCleanup();

const PREVIOUS_PLUGIN_IDS = [
  "context-strategy-comparison",
  "warm-index-reuse",
  "incremental-change-staleness",
  "context-window-scaling",
  "retrieval-precision-recall",
  "retrieval-query-strategy-comparison",
  "context-pack-generation"
];

describe("agent-success-rate registration, metadata and config", () => {
  it("ASR-001 is registered exactly once", () => {
    const ids = createDefaultExperimentPluginRegistry().list().map((metadata) => metadata.id);
    expect(ids.filter((id) => id === "agent-success-rate")).toHaveLength(1);
  });

  it("ASR-002 keeps all seven previous plugin IDs in order and appends the new plugin eighth", () => {
    const ids = createDefaultExperimentPluginRegistry().list().map((metadata) => metadata.id);
    expect(ids).toEqual([...PREVIOUS_PLUGIN_IDS, "agent-success-rate"]);
  });

  it("ASR-003 exposes exactly the two fixed variants in order", () => {
    const plugin = createDefaultExperimentPluginRegistry().get("agent-success-rate");
    expect(plugin.supportedVariants).toEqual(["raw-full-file", "context-pack"]);
    expect([...AGENT_SUCCESS_RATE_TREATMENT_IDS]).toEqual(["raw-full-file", "context-pack"]);
  });

  it("ASR-004 is experimental, self-target only and advertises only implemented outputs", () => {
    expect(agentSuccessRateMetadata).toMatchObject({
      id: "agent-success-rate",
      name: "Agent Success Rate",
      schemaVersion: "1.0.0",
      status: "experimental",
      supportedTargets: ["self"],
      supportedOutputs: ["json", "artifact"]
    });
  });

  it("ASR-005 rejects unknown fields and later-batch real-agent options", () => {
    for (const field of ["agents", "includeRealAgents", "repairAttempts", "campaignPreset", "commandTemplate", "strategies", "complexities", "localSubjectConfig", "casesPath", "projectProfilesPath", "surprise"]) {
      const result = validateAgentSuccessRateConfig({ [field]: 1 });
      expect(result.valid, field).toBe(false);
      expect(result.errors.join(" "), field).toContain(field);
    }
    expect(validateAgentSuccessRateConfig({})).toMatchObject({ valid: true, config: { outDir: "lab-output/agent-success-rate" } });
    expect(validateAgentSuccessRateConfig("nope").valid).toBe(false);
  });

  it("ASR-006 rejects invalid case and project filters", () => {
    for (const bad of [[], [""], [1], ["a", "a"], "a"]) {
      expect(validateAgentSuccessRateConfig({ caseIds: bad }).valid, JSON.stringify(bad)).toBe(false);
      expect(validateAgentSuccessRateConfig({ benchmarkProjects: bad }).valid, JSON.stringify(bad)).toBe(false);
    }
    expect(validateAgentSuccessRateConfig({ outDir: " " }).valid).toBe(false);
    expect(validateAgentSuccessRateConfig({ caseIds: ["a"], benchmarkProjects: ["p"] }).valid).toBe(true);
  });

  it("ASR-007 refuses external-local execution before any sandbox mutation", async () => {
    const toolRoot = makeToolRoot();
    const external = makeTempDir("lab-asr-external-");
    const { run, outDir } = await runAgentSuccess({ toolRoot, tasks: [taskInput()], targetPath: external });
    expect(run.status).toBe("failed");
    expect(run.failures[0]!.message).toContain("supports only the self target");
    expect(run.cases).toEqual([]);
    expect(existsSync(path.join(outDir, "sandboxes"))).toBe(false);
    expect(existsSync(path.join(outDir, "agent-success-rate-execution.json"))).toBe(false);
  });
});

describe("agent-success-rate inputs", () => {
  it("ASR-008 rejects missing, non-array and empty task input without creating a sandbox", async () => {
    expect(() => readAgentSuccessTasksInput(undefined)).toThrow(AgentSuccessRateInputError);
    expect(() => readAgentSuccessTasksInput({})).toThrow(/requires an agentSuccessTasks input/);
    expect(() => readAgentSuccessTasksInput({ agentSuccessTasks: "x" })).toThrow(/must be an array/);
    expect(() => readAgentSuccessTasksInput({ agentSuccessTasks: [] })).toThrow(/must not be empty/);
    const toolRoot = makeToolRoot();
    const { run, outDir } = await runAgentSuccess({ toolRoot });
    expect(run.status).toBe("failed");
    expect(run.failures[0]!.message).toContain("agentSuccessTasks");
    expect(existsSync(path.join(outDir, "sandboxes"))).toBe(false);
  });

  it("ASR-009 rejects an invalid task using the Batch 1 validator", () => {
    expect(() => readAgentSuccessTasksInput({ agentSuccessTasks: [taskInput({ schemaVersion: "v0" })] })).toThrow(/INVALID_SCHEMA_VERSION/);
    expect(() => readAgentSuccessTasksInput({ agentSuccessTasks: [taskInput({ surprise: 1 })] })).toThrow(/UNKNOWN_FIELD/);
    // An old retrieval-style case is not silently accepted.
    expect(() => readAgentSuccessTasksInput({ agentSuccessTasks: [{ id: "x", query: "q", benchmarkProject: "fixture" }] })).toThrow(AgentSuccessRateInputError);
  });

  it("ASR-010 rejects duplicate task IDs", () => {
    expect(() => readAgentSuccessTasksInput({ agentSuccessTasks: [taskInput(), taskInput()] })).toThrow(/Duplicate agent-success task id: fixture-add-fix/);
  });

  it("ASR-011 rejects a task without a deterministicFixture", () => {
    const { deterministicFixture: _omitted, ...withoutFixture } = taskInput();
    expect(() => readAgentSuccessTasksInput({ agentSuccessTasks: [withoutFixture] })).toThrow(/no deterministicFixture/);
  });

  it("ASR-012 filters preserve canonical input order", () => {
    const tasks = readAgentSuccessTasksInput({
      agentSuccessTasks: [taskInput({ id: "c-3", benchmarkProject: "p2" }), taskInput({ id: "a-1", benchmarkProject: "p1" }), taskInput({ id: "b-2", benchmarkProject: "p2" })]
    });
    expect(selectAgentSuccessTasks(tasks, { caseIds: ["b-2", "c-3"] }).map((t) => t.id)).toEqual(["c-3", "b-2"]);
    expect(selectAgentSuccessTasks(tasks, { benchmarkProjects: ["p2"] }).map((t) => t.id)).toEqual(["c-3", "b-2"]);
    expect(selectAgentSuccessTasks(tasks, {}).map((t) => t.id)).toEqual(["c-3", "a-1", "b-2"]);
    expect(() => selectAgentSuccessTasks(tasks, { caseIds: ["zzz"] })).toThrow(/not found/);
    expect(() => selectAgentSuccessTasks(tasks, { benchmarkProjects: ["zzz"] })).toThrow(/not found/);
    expect(() => selectAgentSuccessTasks(tasks, { caseIds: ["a-1"], benchmarkProjects: ["p2"] })).toThrow(/No agent-success tasks matched/);
  });

  it("ASR-013 benchmark-project resolution cannot escape the controlled benchmark root", async () => {
    const toolRoot = makeToolRoot({ fixture: FIXTURE_FILES });
    const resolved = await resolveControlledBenchmarkProject(toolRoot, "fixture");
    expect(resolved.endsWith("fixture")).toBe(true);
    await expect(resolveControlledBenchmarkProject(toolRoot, "../../..")).rejects.toThrow(AgentSuccessRateInputError);
    await expect(resolveControlledBenchmarkProject(toolRoot, "..")).rejects.toThrow(AgentSuccessRateInputError);
    await expect(resolveControlledBenchmarkProject(toolRoot, "a/b")).rejects.toThrow(AgentSuccessRateInputError);
    await expect(resolveControlledBenchmarkProject(toolRoot, path.resolve(toolRoot))).rejects.toThrow(AgentSuccessRateInputError);
    await expect(resolveControlledBenchmarkProject(toolRoot, "missing")).rejects.toThrow(/not found/);

    // A link inside the controlled directory that points outside it is refused.
    const outside = makeTempDir("lab-asr-outside-");
    mkdirSync(path.join(outside, "x"), { recursive: true });
    symlinkSync(outside, path.join(toolRoot, "benchmarks", "projects", "linked"), "junction");
    await expect(resolveControlledBenchmarkProject(toolRoot, "linked")).rejects.toThrow(AgentSuccessRateInputError);

    // Through the plugin: no sandbox is created and the escape target is untouched.
    const before = await snapshotProjectTree(outside, { excludedNames: [] });
    const { run, outDir } = await runAgentSuccess({ toolRoot, tasks: [taskInput({ benchmarkProject: "linked" })] });
    expect(run.status).toBe("failed");
    expect(existsSync(path.join(outDir, "sandboxes"))).toBe(false);
    expect(await snapshotProjectTree(outside, { excludedNames: [] })).toEqual(before);
  });

  it("keeps task validation independent of the project directory", () => {
    expect(makeTask().deterministicFixture?.id).toBe("fx-fix");
  });
});
