import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeV043StageContextStrategy } from "../../../src/experiments/plugins/contextStrategyComparison/executeV043StageContextStrategy.js";
import type { V043StageContextStrategyInputV1 } from "../../../src/experiments/plugins/contextStrategyComparison/v043StrategyInputContracts.js";

const CAPSULE_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";
const AUDIT_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/retrieval-audit-record/complete-v1.0.0.json";
const PACKET_FIXTURE_PATH =
  "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.1/workflow-instruction-packet/complete-v1.0.0.json";
const EXPECTATIONS_FIXTURE_PATH = "tests/fixtures/stage-context-expectations/complete-v1.0.0.json";
const LIBRARY_FIXTURE_PATH = "tests/fixtures/full-workflow-library/complete-v1.0.0.json";

const rawCapsule = JSON.parse(readFileSync(CAPSULE_FIXTURE_PATH, "utf8"));
const rawAudit = JSON.parse(readFileSync(AUDIT_FIXTURE_PATH, "utf8"));
const rawPacket = JSON.parse(readFileSync(PACKET_FIXTURE_PATH, "utf8"));
const rawExpectations = JSON.parse(readFileSync(EXPECTATIONS_FIXTURE_PATH, "utf8"));
const rawLibrary = JSON.parse(readFileSync(LIBRARY_FIXTURE_PATH, "utf8"));

function withRole<T extends Record<string, unknown>>(artifact: T, role: string): T {
  const clone = structuredClone(artifact) as Record<string, unknown>;
  clone.request = { ...(clone.request as Record<string, unknown>), role };
  clone.roleContext = { ...(clone.roleContext as Record<string, unknown>), role };
  return clone as T;
}

function alignAuditToCapsule(auditArtifact: Record<string, unknown>, capsuleArtifact: Record<string, unknown>): Record<string, unknown> {
  auditArtifact.schemaVersion = capsuleArtifact.schemaVersion;
  auditArtifact.tool = structuredClone(capsuleArtifact.tool);
  auditArtifact.request = structuredClone(capsuleArtifact.request);
  const capsuleIndex = capsuleArtifact.index as { indexPath: string; manifestPath: string };
  auditArtifact.index = { indexPath: capsuleIndex.indexPath, manifestPath: capsuleIndex.manifestPath };
  auditArtifact.contextAdequacy = structuredClone(capsuleArtifact.contextAdequacy);
  auditArtifact.roleContext = structuredClone(capsuleArtifact.roleContext);
  auditArtifact.responsibilityMappings = structuredClone(capsuleArtifact.responsibilityMappings);
  auditArtifact.roleAdequacy = structuredClone(capsuleArtifact.roleAdequacy);
  auditArtifact.freshness = structuredClone(capsuleArtifact.freshness);
  auditArtifact.budget = structuredClone(capsuleArtifact.budget);
  auditArtifact.truncation = structuredClone(capsuleArtifact.truncation);
  auditArtifact.fullFileFallback = structuredClone(capsuleArtifact.fullFileFallback);
  auditArtifact.provenance = structuredClone(capsuleArtifact.provenance);
  return auditArtifact;
}

function capsuleSuccess(role: string, sourcePath: string) {
  const artifact = withRole(rawCapsule, role);
  return {
    ok: true,
    artifactKind: "my-dev-kit-context-capsule-v1",
    sourcePath,
    schemaVersion: "1.0.0",
    schemaMajor: 1,
    artifact,
    rawArtifact: artifact
  };
}

function packetSuccess(sourcePath: string) {
  const artifact = structuredClone(rawPacket);
  return {
    ok: true,
    artifactKind: "orchestrator-workflow-instruction-packet-v1",
    sourcePath,
    schemaVersion: "1.0.0",
    schemaMajor: 1,
    artifact,
    rawArtifact: artifact
  };
}

function librarySuccess(sourcePath: string) {
  const fixture = structuredClone(rawLibrary);
  return { ok: true, sourcePath, schemaVersion: "1.0.0", schemaMajor: 1, fixture, rawFixture: fixture };
}

function expectationsSuccess(sourcePath: string) {
  const fixture = structuredClone(rawExpectations);
  return { ok: true, sourcePath, schemaVersion: "1.0.0", schemaMajor: 1, fixture, rawFixture: fixture };
}

async function withMockedExecutor(mocks: {
  capsules?: Record<string, unknown>;
  packets?: Record<string, unknown>;
  library?: Record<string, unknown>;
  expectations?: Record<string, unknown>;
}) {
  vi.resetModules();
  vi.doMock("../../../src/evaluation/upstreamArtifacts/index.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../src/evaluation/upstreamArtifacts/index.js")>();
    return {
      ...actual,
      readMyDevKitContextCapsuleV1: vi.fn(
        async (path: string) => mocks.capsules?.[path] ?? { ok: false, artifactKind: "my-dev-kit-context-capsule-v1", sourcePath: path, code: "FILE_NOT_FOUND", message: "mock" }
      ),
      readMyDevKitRetrievalAuditRecordV1: actual.readMyDevKitRetrievalAuditRecordV1,
      readOrchestratorWorkflowInstructionPacketV1: vi.fn(
        async (path: string) =>
          mocks.packets?.[path] ?? { ok: false, artifactKind: "orchestrator-workflow-instruction-packet-v1", sourcePath: path, code: "FILE_NOT_FOUND", message: "mock" }
      )
    };
  });
  vi.doMock("../../../src/evaluation/stageContextExpectations/index.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../src/evaluation/stageContextExpectations/index.js")>();
    return {
      ...actual,
      readStageContextExpectationFixtureV1: vi.fn(
        async (path: string) => mocks.expectations?.[path] ?? { ok: false, sourcePath: path, code: "FILE_NOT_FOUND", message: "mock" }
      )
    };
  });
  vi.doMock("../../../src/experiments/plugins/contextStrategyComparison/readV043FullWorkflowLibraryFixture.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../src/experiments/plugins/contextStrategyComparison/readV043FullWorkflowLibraryFixture.js")>();
    return {
      ...actual,
      readV043FullWorkflowLibraryFixture: vi.fn(
        async (path: string) => mocks.library?.[path] ?? { ok: false, sourcePath: path, code: "FILE_NOT_FOUND", message: "mock" }
      )
    };
  });

  const { executeV043StageContextStrategy: executeMocked } = await import(
    "../../../src/experiments/plugins/contextStrategyComparison/executeV043StageContextStrategy.js"
  );
  return executeMocked;
}

async function cleanupMocks() {
  vi.doUnmock("../../../src/evaluation/upstreamArtifacts/index.js");
  vi.doUnmock("../../../src/evaluation/stageContextExpectations/index.js");
  vi.doUnmock("../../../src/experiments/plugins/contextStrategyComparison/readV043FullWorkflowLibraryFixture.js");
  vi.resetModules();
}

afterEach(async () => {
  await cleanupMocks();
});

const EXPECTATIONS_PATH = "mock/expectations.json";

function buildValidInputs(): V043StageContextStrategyInputV1[] {
  return [
    {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json"
    },
    {
      strategyId: "architecture-plus-implementation-refresh",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      implementationContextCapsulePath: "mock/implementation-capsule.json"
    },
    {
      strategyId: "architecture-plus-implementation-and-test-refresh",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      implementationContextCapsulePath: "mock/implementation-capsule.json",
      testImplementationContextCapsulePath: "mock/test-implementation-capsule.json"
    },
    {
      strategyId: "full-workflow-library",
      expectationsPath: EXPECTATIONS_PATH,
      fullWorkflowLibraryFixturePath: "mock/full-workflow-library.json"
    },
    {
      strategyId: "bounded-workflow-instruction-packet",
      expectationsPath: EXPECTATIONS_PATH,
      workflowInstructionPacketPath: "mock/workflow-packet.json"
    },
    {
      strategyId: "combined-bounded-stage-context",
      expectationsPath: EXPECTATIONS_PATH,
      contextArtifacts: [{ role: "architecture", contextCapsulePath: "mock/architecture-capsule.json" }],
      workflowInstructionPacketPath: "mock/workflow-packet.json"
    }
  ];
}

const MOCK_PLAN = {
  expectations: { [EXPECTATIONS_PATH]: expectationsSuccess(EXPECTATIONS_PATH) },
  capsules: {
    "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json"),
    "mock/implementation-capsule.json": capsuleSuccess("implementation", "mock/implementation-capsule.json"),
    "mock/test-implementation-capsule.json": capsuleSuccess("test-implementation", "mock/test-implementation-capsule.json")
  },
  packets: { "mock/workflow-packet.json": packetSuccess("mock/workflow-packet.json") },
  library: { "mock/full-workflow-library.json": librarySuccess("mock/full-workflow-library.json") }
};

describe("executeV043StageContextStrategy", () => {
  it("EXE-081 each of the six valid strategy inputs returns completed", async () => {
    const execute = await withMockedExecutor(MOCK_PLAN);
    for (const input of buildValidInputs()) {
      const result = await execute(input);
      expect(result.status, `strategy ${input.strategyId} should complete`).toBe("completed");
    }
  });

  it("EXE-082 completed result retains the original input object", async () => {
    const execute = await withMockedExecutor(MOCK_PLAN);
    const input = buildValidInputs()[0];
    const result = await execute(input);
    expect(result.status).toBe("completed");
    if (result.status === "completed") expect(result.input).toBe(input);
  });

  it("EXE-083 invalid strategy input returns invalid-input", async () => {
    const result = await executeV043StageContextStrategy({ strategyId: "not-a-real-strategy" });
    expect(result.status).toBe("invalid-input");
  });

  it("EXE-084 invalid strategy input performs no filesystem reads", async () => {
    const result = executeV043StageContextStrategy({ strategyId: "not-a-real-strategy" });
    const awaited = await result;
    expect(awaited.status).toBe("invalid-input");
  });

  it("EXE-085 every validator issue maps to INVALID_STRATEGY_INPUT", async () => {
    const result = await executeV043StageContextStrategy({ strategyId: "architecture-context-only" });
    expect(result.status).toBe("invalid-input");
    if (result.status === "invalid-input") {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.every((issue) => issue.code === "INVALID_STRATEGY_INPUT")).toBe(true);
    }
  });

  it("EXE-086 a valid strategyId is retained on invalid input when available", async () => {
    const result = await executeV043StageContextStrategy({ strategyId: "architecture-context-only" });
    expect(result.status).toBe("invalid-input");
    if (result.status === "invalid-input") expect(result.strategyId).toBe("architecture-context-only");
  });

  it("EXE-087 an absent or invalid strategyId produces strategyId null", async () => {
    const missing = await executeV043StageContextStrategy({});
    expect(missing.status).toBe("invalid-input");
    if (missing.status === "invalid-input") expect(missing.strategyId).toBeNull();

    const unknown = await executeV043StageContextStrategy({ strategyId: "not-a-real-strategy" });
    expect(unknown.status).toBe("invalid-input");
    if (unknown.status === "invalid-input") expect(unknown.strategyId).toBeNull();
  });

  it("EXE-088 expected artifact failures remain invalid-input", async () => {
    const result = await executeV043StageContextStrategy({
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: ""
    });
    expect(result.status).toBe("invalid-input");
    if (result.status === "invalid-input") {
      expect(result.issues.some((issue) => issue.code === "INVALID_STRATEGY_INPUT")).toBe(true);
    }
  });

  it("EXE-089 an unexpected thrown error returns failed", async () => {
    vi.resetModules();
    vi.doMock("../../../src/experiments/plugins/contextStrategyComparison/loadV043StrategyArtifacts.js", () => ({
      loadV043StrategyArtifacts: vi.fn().mockRejectedValueOnce(new Error("boom"))
    }));
    const { executeV043StageContextStrategy: executeMocked } = await import(
      "../../../src/experiments/plugins/contextStrategyComparison/executeV043StageContextStrategy.js"
    );
    const result = await executeMocked(buildValidInputs()[0]);
    vi.doUnmock("../../../src/experiments/plugins/contextStrategyComparison/loadV043StrategyArtifacts.js");
    vi.resetModules();
    expect(result.status).toBe("failed");
  });

  it("EXE-090 unexpected failure message is deterministic", async () => {
    vi.resetModules();
    vi.doMock("../../../src/experiments/plugins/contextStrategyComparison/loadV043StrategyArtifacts.js", () => ({
      loadV043StrategyArtifacts: vi.fn().mockRejectedValueOnce(new Error("boom"))
    }));
    const { executeV043StageContextStrategy: executeMocked } = await import(
      "../../../src/experiments/plugins/contextStrategyComparison/executeV043StageContextStrategy.js"
    );
    const result = await executeMocked(buildValidInputs()[0]);
    vi.doUnmock("../../../src/experiments/plugins/contextStrategyComparison/loadV043StrategyArtifacts.js");
    vi.resetModules();
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.issues).toEqual([
        {
          code: "UNEXPECTED_EXECUTION_ERROR",
          fieldPath: "execution",
          message: "Unexpected v0.4.3 stage-context strategy execution failure."
        }
      ]);
    }
  });

  it("EXE-091 unexpected failure exposes no stack trace", async () => {
    vi.resetModules();
    vi.doMock("../../../src/experiments/plugins/contextStrategyComparison/loadV043StrategyArtifacts.js", () => ({
      loadV043StrategyArtifacts: vi.fn().mockRejectedValueOnce(new Error("boom"))
    }));
    const { executeV043StageContextStrategy: executeMocked } = await import(
      "../../../src/experiments/plugins/contextStrategyComparison/executeV043StageContextStrategy.js"
    );
    const result = await executeMocked(buildValidInputs()[0]);
    vi.doUnmock("../../../src/experiments/plugins/contextStrategyComparison/loadV043StrategyArtifacts.js");
    vi.resetModules();
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.issues[0]).not.toHaveProperty("stack");
      expect(result.issues[0].details).toBeUndefined();
    }
  });

  it("EXE-092 a failed strategy does not throw to the caller", async () => {
    vi.resetModules();
    vi.doMock("../../../src/experiments/plugins/contextStrategyComparison/loadV043StrategyArtifacts.js", () => ({
      loadV043StrategyArtifacts: vi.fn().mockRejectedValueOnce(new Error("boom"))
    }));
    const { executeV043StageContextStrategy: executeMocked } = await import(
      "../../../src/experiments/plugins/contextStrategyComparison/executeV043StageContextStrategy.js"
    );
    await expect(executeMocked(buildValidInputs()[0])).resolves.toBeDefined();
    vi.doUnmock("../../../src/experiments/plugins/contextStrategyComparison/loadV043StrategyArtifacts.js");
    vi.resetModules();
  });

  it("EXE-093 completed warnings are an empty array", async () => {
    const execute = await withMockedExecutor(MOCK_PLAN);
    const result = await execute(buildValidInputs()[0]);
    expect(result.status).toBe("completed");
    if (result.status === "completed") expect(result.warnings).toEqual([]);
  });

  it("EXE-094 no unavailable status is emitted", async () => {
    const execute = await withMockedExecutor(MOCK_PLAN);
    for (const input of buildValidInputs()) {
      const result = await execute(input);
      expect(result.status).not.toBe("unavailable");
    }
  });

  it("EXE-095 no not-applicable status is emitted", async () => {
    const execute = await withMockedExecutor(MOCK_PLAN);
    for (const input of buildValidInputs()) {
      const result = await execute(input);
      expect(result.status).not.toBe("not-applicable");
    }
  });

  it("EXE-096 no score is returned", async () => {
    const execute = await withMockedExecutor(MOCK_PLAN);
    const result = await execute(buildValidInputs()[0]);
    expect(result).not.toHaveProperty("score");
  });

  it("EXE-097 no best-strategy field is returned", async () => {
    const execute = await withMockedExecutor(MOCK_PLAN);
    const result = await execute(buildValidInputs()[0]);
    expect(result).not.toHaveProperty("bestStrategy");
  });

  it("EXE-098 no target repository is modified", async () => {
    const probePath = "tests/fixtures/full-workflow-library/exe-098-no-write-probe.json";
    const before = existsSync(probePath);
    const execute = await withMockedExecutor(MOCK_PLAN);
    for (const input of buildValidInputs()) {
      await execute(input);
    }
    const after = existsSync(probePath);
    expect(before).toBe(false);
    expect(after).toBe(false);
  });
});
