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
  captureSnapshotQueue?: unknown[];
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
      readMyDevKitContextCapsuleV1: vi.fn(async (p: string) => {
        const entry = plan.capsules?.[p];
        if (typeof entry === "function") return (entry as () => unknown)();
        return entry ?? { ok: false, artifactKind: "my-dev-kit-context-capsule-v1", sourcePath: p, code: "FILE_NOT_FOUND", message: "mock" };
      }),
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
  if (plan.captureSnapshotQueue) {
    const queue = [...plan.captureSnapshotQueue];
    vi.doMock("../../src/evaluation/targetImmutability/index.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src/evaluation/targetImmutability/index.js")>();
      return {
        ...actual,
        captureTargetSnapshot: vi.fn(async () => queue.shift())
      };
    });
  }
  return import("../../src/experiments/index.js");
}

async function unloadMockedPluginModule() {
  vi.doUnmock("../../src/evaluation/upstreamArtifacts/index.js");
  vi.doUnmock("../../src/evaluation/stageContextExpectations/index.js");
  vi.doUnmock("../../src/experiments/plugins/contextStrategyComparison/readV043FullWorkflowLibraryFixture.js");
  vi.doUnmock("../../src/evaluation/targetImmutability/index.js");
  vi.resetModules();
}

function defaultGitSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    availability: "not-repository",
    branch: null,
    head: null,
    statusEntries: [],
    worktreeDiffSha256: null,
    stagedDiffSha256: null,
    untrackedFiles: [],
    ...overrides
  };
}

function targetSnapshotSuccess(gitOverrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    snapshot: {
      targetRootPath: "Z:/fixture/target",
      resolvedTargetRootPath: "Z:/fixture/target",
      configuredFiles: [],
      git: defaultGitSnapshot(gitOverrides)
    }
  };
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

describe("context-strategy-comparison plugin v0.4.3 evidence-metric integration", () => {
  const metricTempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(metricTempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    await unloadMockedPluginModule();
  });

  it("MET-189 legacy-only results include v043StageContextEvaluations: []", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-legacy-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-legacy-test",
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
    expect(result.v043StageContextEvaluations).toEqual([]);
  });

  it("MET-190 one completed v0.4.3 execution produces one completed evaluation", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-one-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-one-test",
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
    expect(result.v043StageContextEvaluations).toHaveLength(1);
    expect(result.v043StageContextEvaluations[0].status).toBe("completed");
  });

  it("MET-191 all six completed executions produce six evaluations", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-six-"));
    metricTempDirs.push(outDir);
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
      runId: "context-plugin-met-six-test",
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
    expect(result.v043StageContextEvaluations).toHaveLength(6);
    expect(result.v043StageContextEvaluations.every((evaluation) => evaluation.status === "completed")).toBe(true);
  });

  it("MET-192 execution and evaluation arrays have equal lengths", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-equal-length-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-equal-length-test",
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
    expect(result.v043StageContextExecutions).toHaveLength(result.v043StageContextEvaluations.length);
    for (let index = 0; index < result.v043StageContextExecutions.length; index += 1) {
      const executionStrategyId = result.v043StageContextExecutions[index].strategyId;
      const evaluationStrategyId = result.v043StageContextEvaluations[index].strategyId;
      if (executionStrategyId !== null && evaluationStrategyId !== null) {
        expect(executionStrategyId).toBe(evaluationStrategyId);
      }
    }
  });

  it("MET-193 evaluation order follows selected v0.4.3 strategy order", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-order-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-order-test",
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
    expect(result.v043StageContextEvaluations.map((evaluation) => evaluation.strategyId)).toEqual([
      "bounded-workflow-instruction-packet",
      "architecture-context-only",
    ]);
  });

  it("MET-194 a failed execution produces a not-applicable evaluation", async () => {
    const mocked = await loadMockedPluginModule({ ...V043_MOCK_PLAN, capsules: {} });
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-failed-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-failed-test",
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
    expect(result.v043StageContextExecutions[0].status).toBe("failed");
    expect(result.v043StageContextEvaluations[0].status).toBe("not-applicable");
  });

  it("MET-195 an invalid-input execution produces a not-applicable evaluation", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-invalid-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-invalid-test",
      startedAt: new Date("2026-06-23T00:00:00.000Z"),
      toolRoot: process.cwd(),
      target: mocked.resolveExperimentTarget(undefined, process.cwd()),
      config: {
        casesPath: "examples/token-savings-cases.json",
        outDir,
        strategies: ["architecture-context-only"],
        v043StrategyInputs: [
          { strategyId: "architecture-context-only", expectationsPath: V043_EXPECTATIONS_PATH, architectureContextCapsulePath: "" },
        ],
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextExecutions[0].status).toBe("invalid-input");
    expect(result.v043StageContextEvaluations[0].status).toBe("not-applicable");
  });

  it("MET-196 a failed evaluation does not stop later selected strategies", async () => {
    const mocked = await loadMockedPluginModule({ ...V043_MOCK_PLAN, capsules: {} });
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-continue-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-continue-test",
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
    expect(result.v043StageContextEvaluations.map((evaluation) => evaluation.status)).toEqual(["not-applicable", "completed"]);
  });

  it("MET-197 legacy strategy results remain unchanged", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-legacy-unchanged-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-legacy-unchanged-test",
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

  it("MET-198 legacy strategies are not evaluated by the new metric layer", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-no-legacy-eval-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-no-legacy-eval-test",
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
    expect(result.v043StageContextEvaluations).toHaveLength(1);
    expect(result.v043StageContextEvaluations[0].strategyId).toBe("architecture-context-only");
  });

  it("MET-199 v043StageContextExecutions remains unchanged", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-executions-unchanged-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-executions-unchanged-test",
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
    expect(result.v043StageContextExecutions[0].status).toBe("completed");
  });

  it("MET-200 v043StageContextEvaluations remains separate from legacy results", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-separate-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-separate-test",
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
    expect(result.legacyArtifacts).not.toHaveProperty("v043StageContextEvaluations");
    expect(result.metrics.some((metric) => (metric as unknown as Record<string, unknown>).evaluationStatus !== undefined)).toBe(false);
  });

  it("MET-201 no fabricated legacy metric is added", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-no-fabricated-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-no-fabricated-test",
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
    expect(result.metrics.every((metric) => typeof metric.value === "number" || metric.value === null)).toBe(true);
  });

  it("MET-202 no composite score is added", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-no-score-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-no-score-test",
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
    expect(result).not.toHaveProperty("compositeScore");
    expect(result).not.toHaveProperty("score");
  });

  it("MET-203 no winning strategy is selected", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-no-winner-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-no-winner-test",
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
    expect(result).not.toHaveProperty("winner");
    expect(result).not.toHaveProperty("bestStrategy");
  });

  it("MET-204 default selected strategies remain unchanged", () => {
    expect(defaultContextStrategyComparisonConfig.strategies).toEqual(["raw-full-file", "my-dev-kit-guided"]);
  });

  it("MET-205 no CLI behavior is introduced", () => {
    const pluginSource = readFileSync("src/experiments/plugins/contextStrategyComparison/plugin.ts", "utf8");
    expect(pluginSource).not.toContain("process.argv");
  });

  it("MET-206 no report file is generated", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-met-no-report-"));
    metricTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-met-no-report-test",
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
    expect(existsSync(path.join(outDir, "report.html"))).toBe(false);
    expect(existsSync(path.join(outDir, "report.txt"))).toBe(false);
  });
});

describe("context-strategy-comparison plugin v0.4.3 run-assurance integration", () => {
  const runAssuranceTempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(runAssuranceTempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    await unloadMockedPluginModule();
  });

  it("RUN-076 legacy-only result includes v043StageContextRunAssurance: []", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-legacy-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-legacy-test",
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
    expect(result.v043StageContextRunAssurance).toEqual([]);
  });

  it("RUN-077 default v0.4.3 run uses repeatCount 1", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-default-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-default-test",
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
    expect(result.v043StageContextRunAssurance[0].repeatCount).toBe(1);
  });

  it("RUN-078 default v0.4.3 run assurance is not-applicable without target config", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-not-applicable-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-not-applicable-test",
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
    expect(result.v043StageContextRunAssurance[0].status).toBe("not-applicable");
  });

  it("RUN-079 one selected strategy produces one assurance result", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-one-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-one-test",
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
    expect(result.v043StageContextRunAssurance).toHaveLength(1);
  });

  it("RUN-080 all six selected strategies produce six assurance results", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-six-"));
    runAssuranceTempDirs.push(outDir);
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
      runId: "context-plugin-run-six-test",
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
    expect(result.v043StageContextRunAssurance).toHaveLength(6);
  });

  it("RUN-081 execution, evaluation, and assurance arrays have equal lengths", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-equal-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-equal-test",
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
    expect(result.v043StageContextExecutions).toHaveLength(2);
    expect(result.v043StageContextEvaluations).toHaveLength(2);
    expect(result.v043StageContextRunAssurance).toHaveLength(2);
  });

  it("RUN-082 all three arrays use selected-strategy order", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-order-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-order-test",
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
    const expectedOrder = ["bounded-workflow-instruction-packet", "architecture-context-only"];
    expect(result.v043StageContextExecutions.map((e) => e.strategyId)).toEqual(expectedOrder);
    expect(result.v043StageContextEvaluations.map((e) => e.strategyId)).toEqual(expectedOrder);
    expect(result.v043StageContextRunAssurance.map((e) => e.strategyId)).toEqual(expectedOrder);
  });

  it("RUN-083 primary execution is the exact execution array entry", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-primary-exec-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-primary-exec-test",
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
    expect(result.v043StageContextRunAssurance[0].primaryExecution).toBe(result.v043StageContextExecutions[0]);
  });

  it("RUN-084 primary evaluation is the exact evaluation array entry", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-primary-eval-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-primary-eval-test",
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
    expect(result.v043StageContextRunAssurance[0].primaryEvaluation).toBe(result.v043StageContextEvaluations[0]);
  });

  it("RUN-085 repeatCount 2 executes each selected v0.4.3 strategy twice", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-repeat-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-repeat-test",
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
        v043RunAssurance: { repeatCount: 2 },
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextRunAssurance[0].runRecords).toHaveLength(2);
  });

  it("RUN-086 only the first execution is placed in v043StageContextExecutions", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-only-first-exec-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-only-first-exec-test",
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
        v043RunAssurance: { repeatCount: 2 },
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextExecutions).toHaveLength(1);
  });

  it("RUN-087 only the first evaluation is placed in v043StageContextEvaluations", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-only-first-eval-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-only-first-eval-test",
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
        v043RunAssurance: { repeatCount: 2 },
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextEvaluations).toHaveLength(1);
  });

  it("RUN-088 repeated-run digests remain in the assurance result", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-digests-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-digests-test",
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
        v043RunAssurance: { repeatCount: 2 },
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextRunAssurance[0].determinism.runDigests).toHaveLength(2);
  });

  it("RUN-089 an unchanged target produces passed assurance", async () => {
    const snapshot = targetSnapshotSuccess();
    const mocked = await loadMockedPluginModule({
      ...V043_MOCK_PLAN,
      captureSnapshotQueue: [snapshot, structuredClone(snapshot)]
    });
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-unchanged-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-unchanged-test",
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
        v043RunAssurance: { targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] } },
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextRunAssurance[0].status).toBe("passed");
  });

  it("RUN-090 a mutated target produces failed assurance", async () => {
    const before = targetSnapshotSuccess({ head: "abc" });
    const after = targetSnapshotSuccess({ head: "def" });
    const mocked = await loadMockedPluginModule({ ...V043_MOCK_PLAN, captureSnapshotQueue: [before, after] });
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-mutated-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-mutated-test",
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
        v043RunAssurance: { targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] } },
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextRunAssurance[0].status).toBe("failed");
  });

  it("RUN-091 a failed assurance result does not stop the next strategy", async () => {
    const before = targetSnapshotSuccess({ head: "abc" });
    const after = targetSnapshotSuccess({ head: "def" });
    const unchanged = targetSnapshotSuccess();
    const mocked = await loadMockedPluginModule({
      ...V043_MOCK_PLAN,
      captureSnapshotQueue: [before, after, unchanged, structuredClone(unchanged)]
    });
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-continue-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-continue-test",
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
        v043RunAssurance: { targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] } },
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextRunAssurance.map((a) => a.status)).toEqual(["failed", "passed"]);
  });

  it("RUN-092 a nondeterministic strategy produces failed assurance", async () => {
    let callCount = 0;
    const mocked = await loadMockedPluginModule({
      ...V043_MOCK_PLAN,
      capsules: {
        [V043_ARCHITECTURE_CAPSULE_PATH]: () => {
          callCount += 1;
          const artifact = withRoleForPlugin(rawCapsuleForPlugin, "architecture");
          if (callCount > 1) artifact.warnings = [...artifact.warnings, `nondeterministic-run-${callCount}`];
          return {
            ok: true,
            artifactKind: "my-dev-kit-context-capsule-v1",
            sourcePath: V043_ARCHITECTURE_CAPSULE_PATH,
            schemaVersion: "1.0.0",
            schemaMajor: 1,
            artifact,
            rawArtifact: artifact
          };
        }
      }
    });
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-nondeterministic-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-nondeterministic-test",
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
        v043RunAssurance: { repeatCount: 2 },
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.v043StageContextRunAssurance[0].status).toBe("failed");
    expect(result.v043StageContextRunAssurance[0].determinism.deterministic).toBe(false);
  });

  it("RUN-093 an invalid assurance config prevents every strategy execution", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-invalid-assurance-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    await expect(
      contextStrategyComparisonPlugin.run({
        runId: "context-plugin-run-invalid-assurance-test",
        startedAt: new Date("2026-06-23T00:00:00.000Z"),
        toolRoot: process.cwd(),
        target: resolveExperimentTarget(undefined, process.cwd()),
        config: {
          casesPath: "examples/token-savings-cases.json",
          outDir,
          strategies: ["raw-full-file"],
          v043RunAssurance: { repeatCount: 0 },
        },
        inputs: { cases, projectProfiles },
      })
    ).rejects.toThrow(/Invalid v0\.4\.3 run-assurance configuration/);
  });

  it("RUN-094 assurance config error message is deterministic", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-assurance-message-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    await expect(
      contextStrategyComparisonPlugin.run({
        runId: "context-plugin-run-assurance-message-test",
        startedAt: new Date("2026-06-23T00:00:00.000Z"),
        toolRoot: process.cwd(),
        target: resolveExperimentTarget(undefined, process.cwd()),
        config: {
          casesPath: "examples/token-savings-cases.json",
          outDir,
          strategies: ["raw-full-file"],
          v043RunAssurance: { repeatCount: 0 },
        },
        inputs: { cases, projectProfiles },
      })
    ).rejects.toThrow("Invalid v0.4.3 run-assurance configuration: INVALID_REPEAT_COUNT:repeatCount");
  });

  it("RUN-095 an invalid target config prevents every strategy execution", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-invalid-target-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    await expect(
      contextStrategyComparisonPlugin.run({
        runId: "context-plugin-run-invalid-target-test",
        startedAt: new Date("2026-06-23T00:00:00.000Z"),
        toolRoot: process.cwd(),
        target: resolveExperimentTarget(undefined, process.cwd()),
        config: {
          casesPath: "examples/token-savings-cases.json",
          outDir,
          strategies: ["raw-full-file"],
          v043RunAssurance: { targetImmutability: { targetRootPath: "", relativeFilePaths: [] } },
        },
        inputs: { cases, projectProfiles },
      })
    ).rejects.toThrow(/Invalid v0\.4\.3 run-assurance configuration/);
  });

  it("RUN-096 legacy strategy behavior remains unchanged", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-legacy-behavior-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-legacy-behavior-test",
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
    expect(result.legacyArtifacts.runs).toHaveLength(2);
  });

  it("RUN-097 legacy strategies are not repeated", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-legacy-not-repeated-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-legacy-not-repeated-test",
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
        v043RunAssurance: { repeatCount: 5 },
      },
      inputs: { cases, projectProfiles },
    });
    expect(result.legacyArtifacts.runs).toHaveLength(2);
  });

  it("RUN-098 legacy strategies receive no target snapshot", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-legacy-no-snapshot-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const result = await contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-legacy-no-snapshot-test",
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
    expect(result.v043StageContextRunAssurance).toEqual([]);
  });

  it("RUN-099 no CLI option is introduced", () => {
    const pluginSource = readFileSync("src/experiments/plugins/contextStrategyComparison/plugin.ts", "utf8");
    expect(pluginSource).not.toContain("process.argv");
  });

  it("RUN-100 no report file is generated", async () => {
    const mocked = await loadMockedPluginModule(V043_MOCK_PLAN);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "context-plugin-run-no-report-"));
    runAssuranceTempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    await mocked.contextStrategyComparisonPlugin.run({
      runId: "context-plugin-run-no-report-test",
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
        v043RunAssurance: { repeatCount: 2 },
      },
      inputs: { cases, projectProfiles },
    });
    expect(existsSync(path.join(outDir, "assurance-report.json"))).toBe(false);
  });

  it("RUN-101 no target repair action occurs", () => {
    const pluginSource = readFileSync("src/experiments/plugins/contextStrategyComparison/plugin.ts", "utf8");
    for (const verb of ["git reset", "git restore", "git clean", "git stash", "git checkout"]) {
      expect(pluginSource).not.toContain(verb);
    }
  });
});
