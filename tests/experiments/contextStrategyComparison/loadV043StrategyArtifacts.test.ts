import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ArchitectureContextOnlyExecutionPayloadV1,
  ArchitecturePlusImplementationRefreshExecutionPayloadV1,
  ArchitecturePlusImplementationAndTestRefreshExecutionPayloadV1,
  BoundedWorkflowInstructionPacketExecutionPayloadV1,
  CombinedBoundedStageContextExecutionPayloadV1,
  FullWorkflowLibraryExecutionPayloadV1
} from "../../../src/experiments/plugins/contextStrategyComparison/v043StrategyExecutionTypes.js";
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

function withRole<T extends Record<string, unknown>>(artifact: T, role: string | null): T {
  const clone = structuredClone(artifact) as Record<string, unknown>;
  clone.request = { ...(clone.request as Record<string, unknown>), role };
  clone.roleContext = { ...(clone.roleContext as Record<string, unknown>), role };
  return clone as T;
}

function capsuleSuccess(role: string | null, sourcePath: string) {
  const artifact = withRole(rawCapsule, role);
  return { ok: true, artifactKind: "my-dev-kit-context-capsule-v1", sourcePath, schemaVersion: "1.0.0", schemaMajor: 1, artifact, rawArtifact: artifact };
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

function auditSuccess(role: string | null, sourcePath: string) {
  const capsuleArtifact = withRole(rawCapsule, role);
  const artifact = alignAuditToCapsule(withRole(rawAudit, role), capsuleArtifact);
  return { ok: true, artifactKind: "my-dev-kit-retrieval-audit-record-v1", sourcePath, schemaVersion: "1.0.0", schemaMajor: 1, artifact, rawArtifact: artifact };
}

function packetSuccess(sourcePath: string) {
  const artifact = structuredClone(rawPacket);
  return { ok: true, artifactKind: "orchestrator-workflow-instruction-packet-v1", sourcePath, schemaVersion: "1.0.0", schemaMajor: 1, artifact, rawArtifact: artifact };
}

function librarySuccess(sourcePath: string) {
  const fixture = structuredClone(rawLibrary);
  return { ok: true, sourcePath, schemaVersion: "1.0.0", schemaMajor: 1, fixture, rawFixture: fixture };
}

function expectationsSuccess(sourcePath: string) {
  const fixture = structuredClone(rawExpectations);
  return { ok: true, sourcePath, schemaVersion: "1.0.0", schemaMajor: 1, fixture, rawFixture: fixture };
}

function readFailure(artifactKind: string, sourcePath: string, code = "FILE_NOT_FOUND") {
  return { ok: false, artifactKind, sourcePath, code, message: `mock failure at ${sourcePath}` };
}

interface MockPlan {
  capsules?: Record<string, unknown>;
  audits?: Record<string, unknown>;
  packets?: Record<string, unknown>;
  library?: Record<string, unknown>;
  expectations?: Record<string, unknown>;
}

async function loadWithMocks(input: V043StageContextStrategyInputV1, plan: MockPlan) {
  vi.resetModules();
  vi.doMock("../../../src/evaluation/upstreamArtifacts/index.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../src/evaluation/upstreamArtifacts/index.js")>();
    return {
      ...actual,
      readMyDevKitContextCapsuleV1: vi.fn(async (path: string) => plan.capsules?.[path] ?? readFailure("my-dev-kit-context-capsule-v1", path)),
      readMyDevKitRetrievalAuditRecordV1: vi.fn(
        async (path: string) => plan.audits?.[path] ?? readFailure("my-dev-kit-retrieval-audit-record-v1", path)
      ),
      readOrchestratorWorkflowInstructionPacketV1: vi.fn(
        async (path: string) => plan.packets?.[path] ?? readFailure("orchestrator-workflow-instruction-packet-v1", path)
      )
    };
  });
  vi.doMock("../../../src/evaluation/stageContextExpectations/index.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../src/evaluation/stageContextExpectations/index.js")>();
    return {
      ...actual,
      readStageContextExpectationFixtureV1: vi.fn(
        async (path: string) => plan.expectations?.[path] ?? { ok: false, sourcePath: path, code: "FILE_NOT_FOUND", message: `mock failure at ${path}` }
      )
    };
  });
  vi.doMock("../../../src/experiments/plugins/contextStrategyComparison/readV043FullWorkflowLibraryFixture.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../src/experiments/plugins/contextStrategyComparison/readV043FullWorkflowLibraryFixture.js")>();
    return {
      ...actual,
      readV043FullWorkflowLibraryFixture: vi.fn(
        async (path: string) => plan.library?.[path] ?? { ok: false, sourcePath: path, code: "FILE_NOT_FOUND", message: `mock failure at ${path}` }
      )
    };
  });

  const { loadV043StrategyArtifacts } = await import(
    "../../../src/experiments/plugins/contextStrategyComparison/loadV043StrategyArtifacts.js"
  );
  const result = await loadV043StrategyArtifacts(input);

  vi.doUnmock("../../../src/evaluation/upstreamArtifacts/index.js");
  vi.doUnmock("../../../src/evaluation/stageContextExpectations/index.js");
  vi.doUnmock("../../../src/experiments/plugins/contextStrategyComparison/readV043FullWorkflowLibraryFixture.js");
  vi.resetModules();
  return result;
}

const EXPECTATIONS_PATH = "mock/expectations.json";
const DEFAULT_PLAN_EXPECTATIONS = { [EXPECTATIONS_PATH]: expectationsSuccess(EXPECTATIONS_PATH) };

afterEach(() => {
  vi.doUnmock("../../../src/evaluation/upstreamArtifacts/index.js");
  vi.doUnmock("../../../src/evaluation/stageContextExpectations/index.js");
  vi.doUnmock("../../../src/experiments/plugins/contextStrategyComparison/readV043FullWorkflowLibraryFixture.js");
  vi.resetModules();
});

describe("loadV043StrategyArtifacts", () => {
  it("EXE-045 architecture-only loads expectations and architecture capsule", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: { "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json") }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = result.payload as ArchitectureContextOnlyExecutionPayloadV1;
      expect(payload.architecture.contextCapsule.request.role).toBe("architecture");
      expect(result.expectationsSourcePath).toBe(EXPECTATIONS_PATH);
    }
  });

  it("EXE-046 architecture-only loads an optional audit", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      architectureRetrievalAuditRecordPath: "mock/architecture-audit.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: { "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json") },
      audits: { "mock/architecture-audit.json": auditSuccess("architecture", "mock/architecture-audit.json") }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = result.payload as ArchitectureContextOnlyExecutionPayloadV1;
      expect(payload.architecture.retrievalAuditRecord).toBeDefined();
      expect(payload.architecture.consistency?.consistent).toBe(true);
    }
  });

  it("EXE-047 architecture-only succeeds without an audit", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: { "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json") }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = result.payload as ArchitectureContextOnlyExecutionPayloadV1;
      expect(payload.architecture.retrievalAuditRecord).toBeUndefined();
    }
  });

  it("EXE-048 architecture-plus-implementation loads two capsule roles", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-plus-implementation-refresh",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      implementationContextCapsulePath: "mock/implementation-capsule.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: {
        "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json"),
        "mock/implementation-capsule.json": capsuleSuccess("implementation", "mock/implementation-capsule.json")
      }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = result.payload as ArchitecturePlusImplementationRefreshExecutionPayloadV1;
      expect(payload.architecture.contextCapsule.request.role).toBe("architecture");
      expect(payload.implementation.contextCapsule.request.role).toBe("implementation");
    }
  });

  it("EXE-049 architecture-plus-implementation-and-test loads all three capsule roles", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-plus-implementation-and-test-refresh",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      implementationContextCapsulePath: "mock/implementation-capsule.json",
      testImplementationContextCapsulePath: "mock/test-implementation-capsule.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: {
        "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json"),
        "mock/implementation-capsule.json": capsuleSuccess("implementation", "mock/implementation-capsule.json"),
        "mock/test-implementation-capsule.json": capsuleSuccess("test-implementation", "mock/test-implementation-capsule.json")
      }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = result.payload as ArchitecturePlusImplementationAndTestRefreshExecutionPayloadV1;
      expect(payload.architecture.contextCapsule.request.role).toBe("architecture");
      expect(payload.implementation.contextCapsule.request.role).toBe("implementation");
      expect(payload.testImplementation.contextCapsule.request.role).toBe("test-implementation");
    }
  });

  it("EXE-050 full-workflow-library loads the exact full library fixture", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "full-workflow-library",
      expectationsPath: EXPECTATIONS_PATH,
      fullWorkflowLibraryFixturePath: "mock/full-workflow-library.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      library: { "mock/full-workflow-library.json": librarySuccess("mock/full-workflow-library.json") }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = result.payload as FullWorkflowLibraryExecutionPayloadV1;
      expect(payload.fullWorkflowLibrary.fixtureId).toBe("FULL-WORKFLOW-LIBRARY-V043-001");
    }
  });

  it("EXE-051 bounded packet loads the exact WorkflowInstructionPacket", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "bounded-workflow-instruction-packet",
      expectationsPath: EXPECTATIONS_PATH,
      workflowInstructionPacketPath: "mock/workflow-packet.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      packets: { "mock/workflow-packet.json": packetSuccess("mock/workflow-packet.json") }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = result.payload as BoundedWorkflowInstructionPacketExecutionPayloadV1;
      expect(payload.workflowInstructionPacket.workflowId).toBe("workflow.feature");
    }
  });

  it("EXE-052 combined strategy preserves contextArtifacts caller order", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "combined-bounded-stage-context",
      expectationsPath: EXPECTATIONS_PATH,
      contextArtifacts: [
        { role: "test-implementation", contextCapsulePath: "mock/test-implementation-capsule.json" },
        { role: "architecture", contextCapsulePath: "mock/architecture-capsule.json" },
        { role: "implementation", contextCapsulePath: "mock/implementation-capsule.json" }
      ],
      workflowInstructionPacketPath: "mock/workflow-packet.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: {
        "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json"),
        "mock/implementation-capsule.json": capsuleSuccess("implementation", "mock/implementation-capsule.json"),
        "mock/test-implementation-capsule.json": capsuleSuccess("test-implementation", "mock/test-implementation-capsule.json")
      },
      packets: { "mock/workflow-packet.json": packetSuccess("mock/workflow-packet.json") }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = result.payload as CombinedBoundedStageContextExecutionPayloadV1;
      expect(payload.contextArtifacts.map((pair) => pair.role)).toEqual(["test-implementation", "architecture", "implementation"]);
    }
  });

  it("EXE-053 combined strategy loads the packet after all context entries", async () => {
    const callOrder: string[] = [];
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "combined-bounded-stage-context",
      expectationsPath: EXPECTATIONS_PATH,
      contextArtifacts: [{ role: "architecture", contextCapsulePath: "mock/architecture-capsule.json" }],
      workflowInstructionPacketPath: "mock/workflow-packet.json"
    };
    vi.resetModules();
    vi.doMock("../../../src/evaluation/upstreamArtifacts/index.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../../src/evaluation/upstreamArtifacts/index.js")>();
      return {
        ...actual,
        readMyDevKitContextCapsuleV1: vi.fn(async (path: string) => {
          callOrder.push(`capsule:${path}`);
          return capsuleSuccess("architecture", path);
        }),
        readMyDevKitRetrievalAuditRecordV1: actual.readMyDevKitRetrievalAuditRecordV1,
        readOrchestratorWorkflowInstructionPacketV1: vi.fn(async (path: string) => {
          callOrder.push(`packet:${path}`);
          return packetSuccess(path);
        })
      };
    });
    vi.doMock("../../../src/evaluation/stageContextExpectations/index.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../../src/evaluation/stageContextExpectations/index.js")>();
      return { ...actual, readStageContextExpectationFixtureV1: vi.fn(async (path: string) => expectationsSuccess(path)) };
    });
    const { loadV043StrategyArtifacts } = await import(
      "../../../src/experiments/plugins/contextStrategyComparison/loadV043StrategyArtifacts.js"
    );
    const result = await loadV043StrategyArtifacts(input);
    vi.doUnmock("../../../src/evaluation/upstreamArtifacts/index.js");
    vi.doUnmock("../../../src/evaluation/stageContextExpectations/index.js");
    vi.resetModules();

    expect(result.status).toBe("completed");
    expect(callOrder).toEqual(["capsule:mock/architecture-capsule.json", "packet:mock/workflow-packet.json"]);
  });

  it("EXE-054 expectation failure is mapped to EXPECTATION_READ_FAILED", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: "mock/missing-expectations.json",
      architectureContextCapsulePath: "mock/architecture-capsule.json"
    };
    const result = await loadWithMocks(input, {
      expectations: {},
      capsules: { "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json") }
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.issues.some((issue) => issue.code === "EXPECTATION_READ_FAILED")).toBe(true);
    }
  });

  it("EXE-055 capsule failure is mapped to CONTEXT_CAPSULE_READ_FAILED", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/missing-capsule.json"
    };
    const result = await loadWithMocks(input, { expectations: DEFAULT_PLAN_EXPECTATIONS, capsules: {} });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.issues.some((issue) => issue.code === "CONTEXT_CAPSULE_READ_FAILED")).toBe(true);
    }
  });

  it("EXE-056 audit failure is mapped to RETRIEVAL_AUDIT_READ_FAILED", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      architectureRetrievalAuditRecordPath: "mock/missing-audit.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: { "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json") },
      audits: {}
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.issues.some((issue) => issue.code === "RETRIEVAL_AUDIT_READ_FAILED")).toBe(true);
    }
  });

  it("EXE-057 packet failure is mapped to WORKFLOW_PACKET_READ_FAILED", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "bounded-workflow-instruction-packet",
      expectationsPath: EXPECTATIONS_PATH,
      workflowInstructionPacketPath: "mock/missing-packet.json"
    };
    const result = await loadWithMocks(input, { expectations: DEFAULT_PLAN_EXPECTATIONS, packets: {} });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.issues.some((issue) => issue.code === "WORKFLOW_PACKET_READ_FAILED")).toBe(true);
    }
  });

  it("EXE-058 full-library failure is mapped to FULL_WORKFLOW_LIBRARY_READ_FAILED", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "full-workflow-library",
      expectationsPath: EXPECTATIONS_PATH,
      fullWorkflowLibraryFixturePath: "mock/missing-library.json"
    };
    const result = await loadWithMocks(input, { expectations: DEFAULT_PLAN_EXPECTATIONS, library: {} });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.issues.some((issue) => issue.code === "FULL_WORKFLOW_LIBRARY_READ_FAILED")).toBe(true);
    }
  });

  it("EXE-059 all configured read failures are collected", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-plus-implementation-refresh",
      expectationsPath: "mock/missing-expectations.json",
      architectureContextCapsulePath: "mock/missing-architecture.json",
      implementationContextCapsulePath: "mock/missing-implementation.json"
    };
    const result = await loadWithMocks(input, { expectations: {}, capsules: {} });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      const codes = result.issues.map((issue) => issue.code);
      expect(codes).toContain("EXPECTATION_READ_FAILED");
      expect(codes.filter((code) => code === "CONTEXT_CAPSULE_READ_FAILED")).toHaveLength(2);
    }
  });

  it("EXE-060 architecture capsule request.role mismatch is reported", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json"
    };
    const artifact = withRole(rawCapsule, "implementation");
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: {
        "mock/architecture-capsule.json": {
          ok: true,
          artifactKind: "my-dev-kit-context-capsule-v1",
          sourcePath: "mock/architecture-capsule.json",
          schemaVersion: "1.0.0",
          schemaMajor: 1,
          artifact,
          rawArtifact: artifact
        }
      }
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(
        result.issues.some(
          (issue) => issue.code === "CONTEXT_ROLE_MISMATCH" && issue.fieldPath === "architecture.contextCapsule.request.role"
        )
      ).toBe(true);
    }
  });

  it("EXE-061 architecture capsule roleContext.role mismatch is reported", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json"
    };
    const artifact = structuredClone(rawCapsule);
    artifact.request = { ...artifact.request, role: "architecture" };
    artifact.roleContext = { ...artifact.roleContext, role: "implementation" };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: {
        "mock/architecture-capsule.json": {
          ok: true,
          artifactKind: "my-dev-kit-context-capsule-v1",
          sourcePath: "mock/architecture-capsule.json",
          schemaVersion: "1.0.0",
          schemaMajor: 1,
          artifact,
          rawArtifact: artifact
        }
      }
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(
        result.issues.some(
          (issue) => issue.code === "CONTEXT_ROLE_MISMATCH" && issue.fieldPath === "architecture.contextCapsule.roleContext.role"
        )
      ).toBe(true);
    }
  });

  it("EXE-062 architecture audit request.role mismatch is reported", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      architectureRetrievalAuditRecordPath: "mock/architecture-audit.json"
    };
    const auditArtifact = structuredClone(rawAudit);
    auditArtifact.request = { ...auditArtifact.request, role: "implementation" };
    auditArtifact.roleContext = { ...auditArtifact.roleContext, role: "architecture" };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: { "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json") },
      audits: {
        "mock/architecture-audit.json": {
          ok: true,
          artifactKind: "my-dev-kit-retrieval-audit-record-v1",
          sourcePath: "mock/architecture-audit.json",
          schemaVersion: "1.0.0",
          schemaMajor: 1,
          artifact: auditArtifact,
          rawArtifact: auditArtifact
        }
      }
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(
        result.issues.some(
          (issue) => issue.code === "CONTEXT_ROLE_MISMATCH" && issue.fieldPath === "architecture.retrievalAuditRecord.request.role"
        )
      ).toBe(true);
    }
  });

  it("EXE-063 architecture audit roleContext.role mismatch is reported", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      architectureRetrievalAuditRecordPath: "mock/architecture-audit.json"
    };
    const auditArtifact = structuredClone(rawAudit);
    auditArtifact.request = { ...auditArtifact.request, role: "architecture" };
    auditArtifact.roleContext = { ...auditArtifact.roleContext, role: "implementation" };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: { "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json") },
      audits: {
        "mock/architecture-audit.json": {
          ok: true,
          artifactKind: "my-dev-kit-retrieval-audit-record-v1",
          sourcePath: "mock/architecture-audit.json",
          schemaVersion: "1.0.0",
          schemaMajor: 1,
          artifact: auditArtifact,
          rawArtifact: auditArtifact
        }
      }
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(
        result.issues.some(
          (issue) => issue.code === "CONTEXT_ROLE_MISMATCH" && issue.fieldPath === "architecture.retrievalAuditRecord.roleContext.role"
        )
      ).toBe(true);
    }
  });

  it("EXE-064 implementation role mismatch is reported", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-plus-implementation-refresh",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      implementationContextCapsulePath: "mock/implementation-capsule.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: {
        "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json"),
        "mock/implementation-capsule.json": capsuleSuccess("architecture", "mock/implementation-capsule.json")
      }
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(
        result.issues.some(
          (issue) => issue.code === "CONTEXT_ROLE_MISMATCH" && issue.fieldPath === "implementation.contextCapsule.request.role"
        )
      ).toBe(true);
    }
  });

  it("EXE-065 test-implementation role mismatch is reported", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-plus-implementation-and-test-refresh",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      implementationContextCapsulePath: "mock/implementation-capsule.json",
      testImplementationContextCapsulePath: "mock/test-implementation-capsule.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: {
        "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json"),
        "mock/implementation-capsule.json": capsuleSuccess("implementation", "mock/implementation-capsule.json"),
        "mock/test-implementation-capsule.json": capsuleSuccess("implementation", "mock/test-implementation-capsule.json")
      }
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(
        result.issues.some(
          (issue) =>
            issue.code === "CONTEXT_ROLE_MISMATCH" && issue.fieldPath === "testImplementation.contextCapsule.request.role"
        )
      ).toBe(true);
    }
  });

  it("EXE-066 combined explicit role is authoritative", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "combined-bounded-stage-context",
      expectationsPath: EXPECTATIONS_PATH,
      contextArtifacts: [{ role: "test-implementation", contextCapsulePath: "mock/architecture-capsule.json" }],
      workflowInstructionPacketPath: "mock/workflow-packet.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: { "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json") },
      packets: { "mock/workflow-packet.json": packetSuccess("mock/workflow-packet.json") }
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(
        result.issues.some(
          (issue) =>
            issue.code === "CONTEXT_ROLE_MISMATCH" && issue.fieldPath === "contextArtifacts[0].contextCapsule.request.role"
        )
      ).toBe(true);
    }
  });

  it("EXE-067 null role is reported as a mismatch", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: { "mock/architecture-capsule.json": capsuleSuccess(null, "mock/architecture-capsule.json") }
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.issues.some((issue) => issue.code === "CONTEXT_ROLE_MISMATCH")).toBe(true);
    }
  });

  it("EXE-068 consistent capsule/audit pair succeeds", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      architectureRetrievalAuditRecordPath: "mock/architecture-audit.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: { "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json") },
      audits: { "mock/architecture-audit.json": auditSuccess("architecture", "mock/architecture-audit.json") }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = result.payload as ArchitectureContextOnlyExecutionPayloadV1;
      expect(payload.architecture.consistency?.consistent).toBe(true);
      expect(payload.architecture.consistency?.issues).toEqual([]);
    }
  });

  it("EXE-069 every consistency mismatch becomes an execution issue", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      architectureRetrievalAuditRecordPath: "mock/architecture-audit.json"
    };
    const capsuleArtifact = withRole(rawCapsule, "architecture");
    const auditArtifact = alignAuditToCapsule(withRole(rawAudit, "architecture"), capsuleArtifact);
    auditArtifact.budget = { ...(auditArtifact.budget as Record<string, unknown>), warnings: ["different"] };
    auditArtifact.truncation = { ...(auditArtifact.truncation as Record<string, unknown>), warnings: ["different"] };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: {
        "mock/architecture-capsule.json": {
          ok: true,
          artifactKind: "my-dev-kit-context-capsule-v1",
          sourcePath: "mock/architecture-capsule.json",
          schemaVersion: "1.0.0",
          schemaMajor: 1,
          artifact: capsuleArtifact,
          rawArtifact: capsuleArtifact
        }
      },
      audits: {
        "mock/architecture-audit.json": {
          ok: true,
          artifactKind: "my-dev-kit-retrieval-audit-record-v1",
          sourcePath: "mock/architecture-audit.json",
          schemaVersion: "1.0.0",
          schemaMajor: 1,
          artifact: auditArtifact,
          rawArtifact: auditArtifact
        }
      }
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      const inconsistentIssues = result.issues.filter((issue) => issue.code === "CONTEXT_ARTIFACT_INCONSISTENT");
      expect(inconsistentIssues).toHaveLength(2);
    }
  });

  it("EXE-070 consistency issue field paths use the pair prefix", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      architectureRetrievalAuditRecordPath: "mock/architecture-audit.json"
    };
    const capsuleArtifact = withRole(rawCapsule, "architecture");
    const auditArtifact = alignAuditToCapsule(withRole(rawAudit, "architecture"), capsuleArtifact);
    auditArtifact.freshness = { ...(auditArtifact.freshness as Record<string, unknown>), reason: "different" };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: {
        "mock/architecture-capsule.json": {
          ok: true,
          artifactKind: "my-dev-kit-context-capsule-v1",
          sourcePath: "mock/architecture-capsule.json",
          schemaVersion: "1.0.0",
          schemaMajor: 1,
          artifact: capsuleArtifact,
          rawArtifact: capsuleArtifact
        }
      },
      audits: {
        "mock/architecture-audit.json": {
          ok: true,
          artifactKind: "my-dev-kit-retrieval-audit-record-v1",
          sourcePath: "mock/architecture-audit.json",
          schemaVersion: "1.0.0",
          schemaMajor: 1,
          artifact: auditArtifact,
          rawArtifact: auditArtifact
        }
      }
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      const issue = result.issues.find((candidate) => candidate.code === "CONTEXT_ARTIFACT_INCONSISTENT");
      expect(issue?.fieldPath).toBe("architecture.freshness");
      expect(issue?.message).toBe('ContextCapsule and RetrievalAuditRecord are inconsistent at "architecture.freshness".');
    }
  });

  it("EXE-071 role issues are ordered before consistency issues for the same pair", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      architectureRetrievalAuditRecordPath: "mock/architecture-audit.json"
    };
    const capsuleArtifact = withRole(rawCapsule, "implementation");
    const auditArtifact = withRole(rawAudit, "architecture");
    auditArtifact.budget = { ...auditArtifact.budget, warnings: ["different"] };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: {
        "mock/architecture-capsule.json": {
          ok: true,
          artifactKind: "my-dev-kit-context-capsule-v1",
          sourcePath: "mock/architecture-capsule.json",
          schemaVersion: "1.0.0",
          schemaMajor: 1,
          artifact: capsuleArtifact,
          rawArtifact: capsuleArtifact
        }
      },
      audits: {
        "mock/architecture-audit.json": {
          ok: true,
          artifactKind: "my-dev-kit-retrieval-audit-record-v1",
          sourcePath: "mock/architecture-audit.json",
          schemaVersion: "1.0.0",
          schemaMajor: 1,
          artifact: auditArtifact,
          rawArtifact: auditArtifact
        }
      }
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      const roleIndex = result.issues.findIndex((issue) => issue.code === "CONTEXT_ROLE_MISMATCH");
      const consistencyIndex = result.issues.findIndex((issue) => issue.code === "CONTEXT_ARTIFACT_INCONSISTENT");
      expect(roleIndex).toBeGreaterThanOrEqual(0);
      expect(consistencyIndex).toBeGreaterThan(roleIndex);
    }
  });

  it("EXE-072 pair order follows configured loading order", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-plus-implementation-refresh",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json",
      implementationContextCapsulePath: "mock/implementation-capsule.json"
    };
    const architectureArtifact = withRole(rawCapsule, "implementation");
    const implementationArtifact = withRole(rawCapsule, "architecture");
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: {
        "mock/architecture-capsule.json": {
          ok: true,
          artifactKind: "my-dev-kit-context-capsule-v1",
          sourcePath: "mock/architecture-capsule.json",
          schemaVersion: "1.0.0",
          schemaMajor: 1,
          artifact: architectureArtifact,
          rawArtifact: architectureArtifact
        },
        "mock/implementation-capsule.json": {
          ok: true,
          artifactKind: "my-dev-kit-context-capsule-v1",
          sourcePath: "mock/implementation-capsule.json",
          schemaVersion: "1.0.0",
          schemaMajor: 1,
          artifact: implementationArtifact,
          rawArtifact: implementationArtifact
        }
      }
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.issues.map((issue) => issue.fieldPath)).toEqual([
        "architecture.contextCapsule.request.role",
        "architecture.contextCapsule.roleContext.role",
        "implementation.contextCapsule.request.role",
        "implementation.contextCapsule.roleContext.role"
      ]);
    }
  });

  it("EXE-073 artifact objects retain reader object identity", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json"
    };
    const successResult = capsuleSuccess("architecture", "mock/architecture-capsule.json");
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: { "mock/architecture-capsule.json": successResult }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = result.payload as ArchitectureContextOnlyExecutionPayloadV1;
      expect(payload.architecture.contextCapsule).toBe(successResult.artifact);
    }
  });

  it("EXE-074 expectation object retains reader object identity", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json"
    };
    const expectationResult = expectationsSuccess(EXPECTATIONS_PATH);
    const result = await loadWithMocks(input, {
      expectations: { [EXPECTATIONS_PATH]: expectationResult },
      capsules: { "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json") }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.expectations).toBe(expectationResult.fixture);
    }
  });

  it("EXE-075 no artifact is cloned", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json"
    };
    const successResult = capsuleSuccess("architecture", "mock/architecture-capsule.json");
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: { "mock/architecture-capsule.json": successResult }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = result.payload as ArchitectureContextOnlyExecutionPayloadV1;
      expect(payload.architecture.contextCapsule).toBe(successResult.rawArtifact);
    }
  });

  it("EXE-076 no artifact field is renamed", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: { "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json") }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = result.payload as ArchitectureContextOnlyExecutionPayloadV1;
      expect(payload.architecture.contextCapsule).toHaveProperty("contextAdequacy");
      expect(payload.architecture.contextCapsule).not.toHaveProperty("adequacy");
    }
  });

  it("EXE-077 no artifact array is sorted", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "full-workflow-library",
      expectationsPath: EXPECTATIONS_PATH,
      fullWorkflowLibraryFixturePath: "mock/full-workflow-library.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      library: { "mock/full-workflow-library.json": librarySuccess("mock/full-workflow-library.json") }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = result.payload as FullWorkflowLibraryExecutionPayloadV1;
      expect(payload.fullWorkflowLibrary.stageIds[0]).toBe("stage.feature.architecture");
    }
  });

  it("EXE-078 no artifact path is normalized", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "bounded-workflow-instruction-packet",
      expectationsPath: EXPECTATIONS_PATH,
      workflowInstructionPacketPath: "./mock/../mock/workflow-packet.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      packets: { "./mock/../mock/workflow-packet.json": packetSuccess("./mock/../mock/workflow-packet.json") }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = result.payload as BoundedWorkflowInstructionPacketExecutionPayloadV1;
      expect(payload.workflowInstructionPacketSourcePath).toBe("./mock/../mock/workflow-packet.json");
    }
  });

  it("EXE-079 no expectation matching occurs", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: { "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json") }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result).not.toHaveProperty("matchResults");
      expect(result).not.toHaveProperty("evidenceMatches");
    }
  });

  it("EXE-080 no metric is calculated", async () => {
    const input: V043StageContextStrategyInputV1 = {
      strategyId: "architecture-context-only",
      expectationsPath: EXPECTATIONS_PATH,
      architectureContextCapsulePath: "mock/architecture-capsule.json"
    };
    const result = await loadWithMocks(input, {
      expectations: DEFAULT_PLAN_EXPECTATIONS,
      capsules: { "mock/architecture-capsule.json": capsuleSuccess("architecture", "mock/architecture-capsule.json") }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result).not.toHaveProperty("metrics");
      expect(result).not.toHaveProperty("score");
    }
  });
});
