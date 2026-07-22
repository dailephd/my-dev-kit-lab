import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contextStrategyComparisonPlugin,
  createDefaultExperimentPluginRegistry,
  defaultContextStrategyComparisonConfig,
  resolveExperimentTarget,
} from "../../src/experiments/index.js";
import { loadExperimentFixtures } from "../evaluation/experimentTestHelpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("context-strategy-comparison plugin", () => {
  it("is registered under a stable plugin id", () => {
    const registry = createDefaultExperimentPluginRegistry();
    const plugin = registry.get("context-strategy-comparison");
    expect(plugin).toBe(contextStrategyComparisonPlugin);
    expect(registry.describe("context-strategy-comparison")).toEqual(
      expect.objectContaining({
        id: "context-strategy-comparison",
        name: "Context Strategy Comparison",
        description:
          "Compare raw full-file context against my-dev-kit guided retrieval/context strategies.",
        schemaVersion: "1.0.0",
        supportedTargets: ["self", "external-local"],
        supportedOutputs: ["json", "html", "plot", "screenshot", "artifact"],
      })
    );
  });

  it("normalizes default config to the current fake-agent comparison defaults", () => {
    const result = contextStrategyComparisonPlugin.validateConfig({});
    expect(result.valid).toBe(true);
    expect(result.config).toEqual(
      expect.objectContaining({
        casesPath: "examples/token-savings-cases.json",
        projectProfilesPath: "benchmarks/contracts/benchmark-project-profiles.json",
        agents: ["fake-agent"],
        strategies: ["raw-full-file", "my-dev-kit-guided"],
        complexityLevels: ["short"],
      })
    );
  });

  it("runs the fake-agent workflow through the plugin and preserves legacy artifacts", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-"));
    tempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await contextStrategyComparisonPlugin.run({
      runId: "context-plugin-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        projectProfilesPath: "benchmarks/contracts/benchmark-project-profiles.json",
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        strategies: ["raw-full-file", "my-dev-kit-guided"],
        complexityLevels: ["short"],
        outDir,
      },
      inputs: { cases, projectProfiles },
    });

    expect(result.pluginId).toBe("context-strategy-comparison");
    expect(result.status).toBe("completed");
    expect(result.variants.map((variant) => variant.id).sort()).toEqual([
      "my-dev-kit-guided",
      "raw-full-file",
    ]);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0].outcomes).toHaveLength(2);
    expect(result.metrics.map((metric) => metric.id)).toContain("total-runs");
    expect(result.artifacts.map((artifact) => artifact.id)).toContain("plugin-result");
    expect(result.legacyArtifacts.runs).toHaveLength(2);
    expect(result.legacyArtifacts.comparisons).toHaveLength(1);
    expect(existsSync(path.join(outDir, "experiment-summary.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-runs.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-comparisons.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-plugin-result.json"))).toBe(true);
    const pluginJson = JSON.parse(
      await readFile(path.join(outDir, "experiment-plugin-result.json"), "utf8")
    );
    expect(pluginJson.pluginId).toBe("context-strategy-comparison");
    expect(pluginJson.target.packageName).toBe("@dailephd/my-dev-kit-lab");
    expect(pluginJson.legacyArtifactPaths.summaryPath).toBe(
      path.join(outDir, "experiment-summary.json")
    );
  });

  it("preserves partial outcome information from fake-agent failures", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-failure-"));
    tempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await contextStrategyComparisonPlugin.run({
      runId: "context-plugin-failure-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        strategies: ["raw-full-file", "my-dev-kit-guided"],
        complexityLevels: ["short"],
        outDir,
        continueOnFailure: true,
      },
      inputs: {
        cases,
        projectProfiles,
        env: { ...process.env, FAKE_AGENT_MODE: "failure" },
      },
    });

    expect(result.status).toBe("failed");
    expect(result.legacyArtifacts.summary.failedRuns).toBe(2);
    expect(result.cases[0].outcomes.every((outcome) => outcome.status === "failed")).toBe(true);
  });
});

const CAPSULE_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";
const PACKET_FIXTURE_PATH =
  "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.1/workflow-instruction-packet/complete-v1.0.0.json";
const EXPECTATIONS_FIXTURE_PATH = "tests/fixtures/stage-context-expectations/complete-v1.0.0.json";
const LIBRARY_FIXTURE_PATH = "tests/fixtures/full-workflow-library/complete-v1.0.0.json";

const rawCapsuleForPlugin = JSON.parse(readFileSync(CAPSULE_FIXTURE_PATH, "utf8"));
const rawPacketForPlugin = JSON.parse(readFileSync(PACKET_FIXTURE_PATH, "utf8"));
const rawExpectationsForPlugin = JSON.parse(readFileSync(EXPECTATIONS_FIXTURE_PATH, "utf8"));
const rawLibraryForPlugin = JSON.parse(readFileSync(LIBRARY_FIXTURE_PATH, "utf8"));

function withRoleForPlugin<T extends Record<string, unknown>>(artifact: T, role: string): T {
  const clone = structuredClone(artifact) as Record<string, unknown>;
  clone.request = { ...(clone.request as Record<string, unknown>), role };
  clone.roleContext = { ...(clone.roleContext as Record<string, unknown>), role };
  return clone as T;
}

function capsuleSuccessForPlugin(role: string, sourcePath: string) {
  const artifact = withRoleForPlugin(rawCapsuleForPlugin, role);
  return { ok: true, artifactKind: "my-dev-kit-context-capsule-v1", sourcePath, schemaVersion: "1.0.0", schemaMajor: 1, artifact, rawArtifact: artifact };
}

function packetSuccessForPlugin(sourcePath: string) {
  const artifact = structuredClone(rawPacketForPlugin);
  return { ok: true, artifactKind: "orchestrator-workflow-instruction-packet-v1", sourcePath, schemaVersion: "1.0.0", schemaMajor: 1, artifact, rawArtifact: artifact };
}

function librarySuccessForPlugin(sourcePath: string) {
  const fixture = structuredClone(rawLibraryForPlugin);
  return { ok: true, sourcePath, schemaVersion: "1.0.0", schemaMajor: 1, fixture, rawFixture: fixture };
}

function expectationsSuccessForPlugin(sourcePath: string) {
  const fixture = structuredClone(rawExpectationsForPlugin);
  return { ok: true, sourcePath, schemaVersion: "1.0.0", schemaMajor: 1, fixture, rawFixture: fixture };
}

const V043_EXPECTATIONS_PATH = "mock/expectations.json";
const V043_ARCHITECTURE_CAPSULE_PATH = "mock/architecture-capsule.json";
const V043_IMPLEMENTATION_CAPSULE_PATH = "mock/implementation-capsule.json";
const V043_TEST_IMPLEMENTATION_CAPSULE_PATH = "mock/test-implementation-capsule.json";
const V043_PACKET_PATH = "mock/workflow-packet.json";
const V043_LIBRARY_PATH = "mock/full-workflow-library.json";

interface V043MockPlan {
  expectations: Record<string, unknown>;
  capsules: Record<string, unknown>;
  packets: Record<string, unknown>;
  library: Record<string, unknown>;
}

const V043_MOCK_PLAN: V043MockPlan = {
  expectations: { [V043_EXPECTATIONS_PATH]: expectationsSuccessForPlugin(V043_EXPECTATIONS_PATH) },
  capsules: {
    [V043_ARCHITECTURE_CAPSULE_PATH]: capsuleSuccessForPlugin("architecture", V043_ARCHITECTURE_CAPSULE_PATH),
    [V043_IMPLEMENTATION_CAPSULE_PATH]: capsuleSuccessForPlugin("implementation", V043_IMPLEMENTATION_CAPSULE_PATH),
    [V043_TEST_IMPLEMENTATION_CAPSULE_PATH]: capsuleSuccessForPlugin("test-implementation", V043_TEST_IMPLEMENTATION_CAPSULE_PATH)
  },
  packets: { [V043_PACKET_PATH]: packetSuccessForPlugin(V043_PACKET_PATH) },
  library: { [V043_LIBRARY_PATH]: librarySuccessForPlugin(V043_LIBRARY_PATH) }
};

async function loadMockedPluginModule(plan: V043MockPlan) {
  vi.resetModules();
  vi.doMock("../../src/evaluation/upstreamArtifacts/index.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/evaluation/upstreamArtifacts/index.js")>();
    return {
      ...actual,
      readMyDevKitContextCapsuleV1: vi.fn(
        async (p: string) => plan.capsules?.[p] ?? { ok: false, artifactKind: "my-dev-kit-context-capsule-v1", sourcePath: p, code: "FILE_NOT_FOUND", message: "mock" }
      ),
      readMyDevKitRetrievalAuditRecordV1: actual.readMyDevKitRetrievalAuditRecordV1,
      readOrchestratorWorkflowInstructionPacketV1: vi.fn(
        async (p: string) => plan.packets?.[p] ?? { ok: false, artifactKind: "orchestrator-workflow-instruction-packet-v1", sourcePath: p, code: "FILE_NOT_FOUND", message: "mock" }
      )
    };
  });
  vi.doMock("../../src/evaluation/stageContextExpectations/index.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/evaluation/stageContextExpectations/index.js")>();
    return {
      ...actual,
      readStageContextExpectationFixtureV1: vi.fn(
        async (p: string) => plan.expectations?.[p] ?? { ok: false, sourcePath: p, code: "FILE_NOT_FOUND", message: "mock" }
      )
    };
  });
  vi.doMock("../../src/experiments/plugins/contextStrategyComparison/readV043FullWorkflowLibraryFixture.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/experiments/plugins/contextStrategyComparison/readV043FullWorkflowLibraryFixture.js")>();
    return {
      ...actual,
      readV043FullWorkflowLibraryFixture: vi.fn(
        async (p: string) => plan.library?.[p] ?? { ok: false, sourcePath: p, code: "FILE_NOT_FOUND", message: "mock" }
      )
    };
  });
  return import("../../src/experiments/index.js");
}

async function unloadMockedPluginModule() {
  vi.doUnmock("../../src/evaluation/upstreamArtifacts/index.js");
  vi.doUnmock("../../src/evaluation/stageContextExpectations/index.js");
  vi.doUnmock("../../src/experiments/plugins/contextStrategyComparison/readV043FullWorkflowLibraryFixture.js");
  vi.resetModules();
}

describe("context-strategy-comparison plugin v0.4.3 stage-context integration", () => {
  const v043TempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(v043TempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    await unloadMockedPluginModule();
  });

  it("EXE-099 legacy-only default behavior remains unchanged", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-legacy-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await contextStrategyComparisonPlugin.run({
      runId: "context-plugin-v043-legacy-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        projectProfilesPath: "benchmarks/contracts/benchmark-project-profiles.json",
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        strategies: ["raw-full-file", "my-dev-kit-guided"],
        complexityLevels: ["short"],
        outDir,
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.status).toBe("completed");
    expect(result.variants.map((variant) => variant.id).sort()).toEqual(["my-dev-kit-guided", "raw-full-file"]);
  });

  it("EXE-100 legacy-only result includes v043StageContextExecutions: []", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-empty-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await contextStrategyComparisonPlugin.run({
      runId: "context-plugin-v043-empty-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        projectProfilesPath: "benchmarks/contracts/benchmark-project-profiles.json",
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        strategies: ["raw-full-file", "my-dev-kit-guided"],
        complexityLevels: ["short"],
        outDir,
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextExecutions).toEqual([]);
  });

  it("EXE-101 the six new strategy IDs are accepted when explicitly selected", () => {
    const result = contextStrategyComparisonPlugin.validateConfig({
      casesPath: "examples/token-savings-cases.json",
      outDir: "lab-output/context-strategy-comparison",
      strategies: [
        "raw-full-file",
        "my-dev-kit-guided",
        "architecture-context-only",
        "architecture-plus-implementation-refresh",
        "architecture-plus-implementation-and-test-refresh",
        "full-workflow-library",
        "bounded-workflow-instruction-packet",
        "combined-bounded-stage-context",
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("EXE-102 a selected new strategy requires one matching input", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-missing-input-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    await expect(
      contextStrategyComparisonPlugin.run({
        runId: "context-plugin-v043-missing-input-test",
        startedAt: new Date("2026-06-23T00:00:00.000Z"),
        toolRoot: process.cwd(),
        target: resolveExperimentTarget(undefined, process.cwd()),
        config: {
          casesPath: "examples/token-savings-cases.json",
          outDir,
          strategies: ["architecture-context-only"],
        },
        inputs: { cases, projectProfiles },
      })
    ).rejects.toThrow(/Invalid v0\.4\.3 strategy-input configuration/);
  });

  it("EXE-103 a duplicate input prevents all strategy execution", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-duplicate-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const duplicateInput = {
      strategyId: "architecture-context-only" as const,
      expectationsPath: V043_EXPECTATIONS_PATH,
      architectureContextCapsulePath: V043_ARCHITECTURE_CAPSULE_PATH,
    };
    await expect(
      contextStrategyComparisonPlugin.run({
        runId: "context-plugin-v043-duplicate-test",
        startedAt: new Date("2026-06-23T00:00:00.000Z"),
        toolRoot: process.cwd(),
        target: resolveExperimentTarget(undefined, process.cwd()),
        config: {
          casesPath: "examples/token-savings-cases.json",
          outDir,
          strategies: ["architecture-context-only"],
          v043StrategyInputs: [duplicateInput, duplicateInput],
        },
        inputs: { cases, projectProfiles },
      })
    ).rejects.toThrow(/Invalid v0\.4\.3 strategy-input configuration/);
  });

  it("EXE-104 an extra input for an unselected strategy prevents all strategy execution", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-extra-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    await expect(
      contextStrategyComparisonPlugin.run({
        runId: "context-plugin-v043-extra-test",
        startedAt: new Date("2026-06-23T00:00:00.000Z"),
        toolRoot: process.cwd(),
        target: resolveExperimentTarget(undefined, process.cwd()),
        config: {
          casesPath: "examples/token-savings-cases.json",
          outDir,
          strategies: [],
          v043StrategyInputs: [
            {
              strategyId: "architecture-context-only",
              expectationsPath: V043_EXPECTATIONS_PATH,
              architectureContextCapsulePath: V043_ARCHITECTURE_CAPSULE_PATH,
            },
          ],
        },
        inputs: { cases, projectProfiles },
      })
    ).rejects.toThrow(/Invalid v0\.4\.3 strategy-input configuration/);
  });

  it("EXE-105 configuration error message is deterministic", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-message-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    await expect(
      contextStrategyComparisonPlugin.run({
        runId: "context-plugin-v043-message-test",
        startedAt: new Date("2026-06-23T00:00:00.000Z"),
        toolRoot: process.cwd(),
        target: resolveExperimentTarget(undefined, process.cwd()),
        config: {
          casesPath: "examples/token-savings-cases.json",
          outDir,
          strategies: ["architecture-context-only"],
        },
        inputs: { cases, projectProfiles },
      })
    ).rejects.toThrow(
      "Invalid v0.4.3 strategy-input configuration: MISSING_STRATEGY_INPUT:architecture-context-only"
    );
  });

  it("EXE-106 one selected new strategy executes through the plugin", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-one-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-v043-one-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: mocked.resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        outDir,
        strategies: ["architecture-context-only"],
        v043StrategyInputs: [
          {
            strategyId: "architecture-context-only",
            expectationsPath: V043_EXPECTATIONS_PATH,
            architectureContextCapsulePath: V043_ARCHITECTURE_CAPSULE_PATH,
          },
        ],
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextExecutions).toHaveLength(1);
    expect(result.v043StageContextExecutions[0].status).toBe("completed");
  });

  it("EXE-107 all six selected new strategies execute through the plugin", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-six-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const strategies = [
      "architecture-context-only",
      "architecture-plus-implementation-refresh",
      "architecture-plus-implementation-and-test-refresh",
      "full-workflow-library",
      "bounded-workflow-instruction-packet",
      "combined-bounded-stage-context",
    ] as const;
    const v043StrategyInputs = [
      { strategyId: "architecture-context-only" as const, expectationsPath: V043_EXPECTATIONS_PATH, architectureContextCapsulePath: V043_ARCHITECTURE_CAPSULE_PATH },
      {
        strategyId: "architecture-plus-implementation-refresh" as const,
        expectationsPath: V043_EXPECTATIONS_PATH,
        architectureContextCapsulePath: V043_ARCHITECTURE_CAPSULE_PATH,
        implementationContextCapsulePath: V043_IMPLEMENTATION_CAPSULE_PATH,
      },
      {
        strategyId: "architecture-plus-implementation-and-test-refresh" as const,
        expectationsPath: V043_EXPECTATIONS_PATH,
        architectureContextCapsulePath: V043_ARCHITECTURE_CAPSULE_PATH,
        implementationContextCapsulePath: V043_IMPLEMENTATION_CAPSULE_PATH,
        testImplementationContextCapsulePath: V043_TEST_IMPLEMENTATION_CAPSULE_PATH,
      },
      { strategyId: "full-workflow-library" as const, expectationsPath: V043_EXPECTATIONS_PATH, fullWorkflowLibraryFixturePath: V043_LIBRARY_PATH },
      { strategyId: "bounded-workflow-instruction-packet" as const, expectationsPath: V043_EXPECTATIONS_PATH, workflowInstructionPacketPath: V043_PACKET_PATH },
      {
        strategyId: "combined-bounded-stage-context" as const,
        expectationsPath: V043_EXPECTATIONS_PATH,
        contextArtifacts: [{ role: "architecture" as const, contextCapsulePath: V043_ARCHITECTURE_CAPSULE_PATH }],
        workflowInstructionPacketPath: V043_PACKET_PATH,
      },
    ];
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-v043-six-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: mocked.resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        outDir,
        strategies: [...strategies],
        v043StrategyInputs,
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextExecutions).toHaveLength(6);
    expect(result.v043StageContextExecutions.every((execution) => execution.status === "completed")).toBe(true);
  });

  it("EXE-108 v0.4.3 execution order follows selected strategy order", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-order-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-v043-order-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: mocked.resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        outDir,
        strategies: ["bounded-workflow-instruction-packet", "architecture-context-only"],
        v043StrategyInputs: [
          { strategyId: "architecture-context-only", expectationsPath: V043_EXPECTATIONS_PATH, architectureContextCapsulePath: V043_ARCHITECTURE_CAPSULE_PATH },
          { strategyId: "bounded-workflow-instruction-packet", expectationsPath: V043_EXPECTATIONS_PATH, workflowInstructionPacketPath: V043_PACKET_PATH },
        ],
      },
      inputs: { cases, projectProfiles },
    });
    expect(
      result.v043StageContextExecutions.map((execution) => (execution.status === "completed" ? execution.strategyId : execution.strategyId))
    ).toEqual(["bounded-workflow-instruction-packet", "architecture-context-only"]);
  });

  it("EXE-109 a mixed legacy and v0.4.3 run preserves legacy results", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-mixed-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-v043-mixed-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: mocked.resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        projectProfilesPath: "benchmarks/contracts/benchmark-project-profiles.json",
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        complexityLevels: ["short"],
        outDir,
        strategies: ["raw-full-file", "my-dev-kit-guided", "architecture-context-only"],
        v043StrategyInputs: [
          { strategyId: "architecture-context-only", expectationsPath: V043_EXPECTATIONS_PATH, architectureContextCapsulePath: V043_ARCHITECTURE_CAPSULE_PATH },
        ],
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.legacyArtifacts.runs).toHaveLength(2);
    expect(result.variants.map((variant) => variant.id).sort()).toEqual(["my-dev-kit-guided", "raw-full-file"]);
  });

  it("EXE-110 a mixed run records new executions separately", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-mixed-separate-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-v043-mixed-separate-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: mocked.resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        projectProfilesPath: "benchmarks/contracts/benchmark-project-profiles.json",
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        complexityLevels: ["short"],
        outDir,
        strategies: ["raw-full-file", "my-dev-kit-guided", "architecture-context-only"],
        v043StrategyInputs: [
          { strategyId: "architecture-context-only", expectationsPath: V043_EXPECTATIONS_PATH, architectureContextCapsulePath: V043_ARCHITECTURE_CAPSULE_PATH },
        ],
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextExecutions).toHaveLength(1);
    expect(result.metrics.some((metric) => (metric as unknown as { strategyId?: string }).strategyId === "architecture-context-only")).toBe(false);
  });

  it("EXE-111 an invalid-input v0.4.3 execution does not stop the next selected v0.4.3 strategy", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-invalid-then-ok-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-v043-invalid-then-ok-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: mocked.resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        outDir,
        strategies: ["architecture-context-only", "bounded-workflow-instruction-packet"],
        v043StrategyInputs: [
          { strategyId: "architecture-context-only", expectationsPath: V043_EXPECTATIONS_PATH, architectureContextCapsulePath: "" },
          { strategyId: "bounded-workflow-instruction-packet", expectationsPath: V043_EXPECTATIONS_PATH, workflowInstructionPacketPath: V043_PACKET_PATH },
        ],
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextExecutions.map((execution) => execution.status)).toEqual(["invalid-input", "completed"]);
  });

  it("EXE-112 a failed v0.4.3 execution does not stop the next selected v0.4.3 strategy", async () => {
    const mocked = await loadMockedPluginModule({ ...V043_MOCK_PLAN, capsules: {} });
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-failed-then-ok-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-v043-failed-then-ok-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: mocked.resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        outDir,
        strategies: ["architecture-context-only", "bounded-workflow-instruction-packet"],
        v043StrategyInputs: [
          { strategyId: "architecture-context-only", expectationsPath: V043_EXPECTATIONS_PATH, architectureContextCapsulePath: V043_ARCHITECTURE_CAPSULE_PATH },
          { strategyId: "bounded-workflow-instruction-packet", expectationsPath: V043_EXPECTATIONS_PATH, workflowInstructionPacketPath: V043_PACKET_PATH },
        ],
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextExecutions.map((execution) => execution.status)).toEqual(["failed", "completed"]);
  });

  it("EXE-113 new executions do not receive fabricated legacy metrics", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-no-fake-metrics-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-v043-no-fake-metrics-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: mocked.resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        outDir,
        strategies: ["architecture-context-only"],
        v043StrategyInputs: [
          { strategyId: "architecture-context-only", expectationsPath: V043_EXPECTATIONS_PATH, architectureContextCapsulePath: V043_ARCHITECTURE_CAPSULE_PATH },
        ],
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextExecutions).toHaveLength(1);
    for (const execution of result.v043StageContextExecutions) {
      expect(execution).not.toHaveProperty("metrics");
      expect(execution).not.toHaveProperty("score");
    }
  });

  it("EXE-114 existing raw-full-file behavior is unchanged", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-raw-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await contextStrategyComparisonPlugin.run({
      runId: "context-plugin-v043-raw-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        strategies: ["raw-full-file"],
        complexityLevels: ["short"],
        outDir,
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.variants.map((variant) => variant.id)).toEqual(["raw-full-file"]);
  });

  it("EXE-115 existing my-dev-kit-guided behavior is unchanged", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-v043-guided-"));
    v043TempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await contextStrategyComparisonPlugin.run({
      runId: "context-plugin-v043-guided-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        strategies: ["my-dev-kit-guided"],
        complexityLevels: ["short"],
        outDir,
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.variants.map((variant) => variant.id)).toEqual(["my-dev-kit-guided"]);
  });

  it("EXE-116 default selected strategy IDs remain unchanged", () => {
    expect(defaultContextStrategyComparisonConfig.strategies).toEqual(["raw-full-file", "my-dev-kit-guided"]);
  });

  it("EXE-117 no CLI behavior is added", () => {
    const pluginSource = readFileSync("src/experiments/plugins/contextStrategyComparison/plugin.ts", "utf8");
    expect(pluginSource).not.toContain("process.argv");
    expect(pluginSource).not.toContain("commander");
    expect(pluginSource).not.toContain("yargs");
  });

  it("EXE-118 no artifact path is inferred by the plugin", () => {
    const pluginSource = readFileSync("src/experiments/plugins/contextStrategyComparison/plugin.ts", "utf8");
    expect(pluginSource.toLowerCase()).not.toContain("infer");
    expect(pluginSource.toLowerCase()).not.toContain("guess");
  });

  it("EXE-119 no directory is scanned by the plugin", () => {
    const pluginSource = readFileSync("src/experiments/plugins/contextStrategyComparison/plugin.ts", "utf8");
    expect(pluginSource).not.toContain("readdir");
    expect(pluginSource).not.toContain("glob");
  });

  it("EXE-120 no upstream command is executed by the plugin", () => {
    const pluginSource = readFileSync("src/experiments/plugins/contextStrategyComparison/plugin.ts", "utf8");
    expect(pluginSource).not.toContain("child_process");
    expect(pluginSource).not.toContain("execFile");
    expect(pluginSource).not.toContain("spawn(");
  });
});
