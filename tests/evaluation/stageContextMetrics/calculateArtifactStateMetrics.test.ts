import { describe, expect, it } from "vitest";
import { readMyDevKitContextCapsuleV1, readMyDevKitRetrievalAuditRecordV1, readOrchestratorWorkflowInstructionPacketV1 } from "../../../src/evaluation/upstreamArtifacts/index.js";
import {
  compareExpectedContextCapsuleState,
  compareExpectedRetrievalAuditState,
  compareExpectedTargetImmutabilityState,
  compareExpectedWorkflowInstructionPacketState
} from "../../../src/evaluation/stageContextMetrics/calculateArtifactStateMetrics.js";
import type { ContextCapsule, RetrievalAuditRecord, WorkflowInstructionPacket } from "../../../src/evaluation/upstreamArtifacts/index.js";

const CAPSULE_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";
const AUDIT_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/retrieval-audit-record/complete-v1.0.0.json";
const PACKET_FIXTURE_PATH =
  "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.1/workflow-instruction-packet/complete-v1.0.0.json";

async function loadCapsule(): Promise<ContextCapsule> {
  const result = await readMyDevKitContextCapsuleV1(CAPSULE_FIXTURE_PATH);
  if (!result.ok) throw new Error("fixture read failed unexpectedly");
  return result.artifact;
}

async function loadAudit(): Promise<RetrievalAuditRecord> {
  const result = await readMyDevKitRetrievalAuditRecordV1(AUDIT_FIXTURE_PATH);
  if (!result.ok) throw new Error("fixture read failed unexpectedly");
  return result.artifact;
}

async function loadPacket(): Promise<WorkflowInstructionPacket> {
  const result = await readOrchestratorWorkflowInstructionPacketV1(PACKET_FIXTURE_PATH);
  if (!result.ok) throw new Error("fixture read failed unexpectedly");
  return result.artifact;
}

describe("compareExpectedContextCapsuleState", () => {
  it("MET-118 context adequacy compares contextAdequacy.status", async () => {
    const artifact = await loadCapsule();
    const result = compareExpectedContextCapsuleState(
      { contextAdequacyStatus: artifact.contextAdequacy.status },
      artifact,
      "instance"
    );
    expect(result[0].artifactFieldPath).toBe("contextAdequacy.status");
    expect(result[0].matched).toBe(true);
  });

  it("MET-119 role adequacy compares roleAdequacy.status separately", async () => {
    const artifact = await loadCapsule();
    const result = compareExpectedContextCapsuleState(
      { contextAdequacyStatus: artifact.contextAdequacy.status, roleAdequacyStatus: artifact.roleAdequacy.status },
      artifact,
      "instance"
    );
    const contextEntry = result.find((r) => r.expectationFieldPath === "contextAdequacyStatus");
    const roleEntry = result.find((r) => r.expectationFieldPath === "roleAdequacyStatus");
    expect(roleEntry?.artifactFieldPath).toBe("roleAdequacy.status");
    expect(contextEntry).not.toBe(roleEntry);
  });

  it("MET-120 freshness compares freshness.state", async () => {
    const artifact = await loadCapsule();
    const result = compareExpectedContextCapsuleState({ freshnessState: "stale" }, artifact, "instance");
    expect(result[0].artifactFieldPath).toBe("freshness.state");
    expect(result[0].matched).toBe(false);
  });

  it("MET-121 truncation compares truncation.truncated", async () => {
    const artifact = await loadCapsule();
    const result = compareExpectedContextCapsuleState({ truncated: true }, artifact, "instance");
    expect(result[0].artifactFieldPath).toBe("truncation.truncated");
    expect(result[0].matched).toBe(artifact.truncation.truncated === true);
  });

  it("MET-122 fallback use compares fullFileFallback.used as a number", async () => {
    const artifact = await loadCapsule();
    const result = compareExpectedContextCapsuleState({ fullFileFallbackUsed: artifact.fullFileFallback.used }, artifact, "instance");
    expect(result[0].artifactFieldPath).toBe("fullFileFallback.used");
    expect(typeof result[0].actual).toBe("number");
    expect(result[0].matched).toBe(true);
  });

  it("MET-123 capsule unresolvedItemIds is unavailable", async () => {
    const artifact = await loadCapsule();
    const result = compareExpectedContextCapsuleState({ unresolvedItemIds: ["a"] }, artifact, "instance");
    expect(result[0].availability).toBe("unavailable");
    expect(result[0].artifactFieldPath).toBeNull();
    expect(result[0].matched).toBeNull();
  });

  it("MET-124 capsule unresolved items are not assigned synthetic IDs", async () => {
    const artifact = await loadCapsule();
    const result = compareExpectedContextCapsuleState({ unresolvedItemIds: ["a"] }, artifact, "instance");
    expect(result[0].reason).toBe("ContextCapsule unresolvedItems do not expose stable item IDs.");
  });

  it("MET-125 capsule warningCount compares warnings.length", async () => {
    const artifact = await loadCapsule();
    const result = compareExpectedContextCapsuleState({ warningCount: artifact.warnings.length }, artifact, "instance");
    expect(result[0].artifactFieldPath).toBe("warnings.length");
    expect(result[0].matched).toBe(true);
  });

  it("MET-133 absent expected state returns no comparison", async () => {
    const artifact = await loadCapsule();
    const result = compareExpectedContextCapsuleState(undefined, artifact, "instance");
    expect(result).toEqual([]);
  });

  it("MET-134 absent expected field returns no comparison", async () => {
    const artifact = await loadCapsule();
    const result = compareExpectedContextCapsuleState({}, artifact, "instance");
    expect(result).toEqual([]);
  });

  it("MET-137a capsule and expectation objects are not mutated", async () => {
    const artifact = await loadCapsule();
    const expected = { contextAdequacyStatus: artifact.contextAdequacy.status };
    const artifactBefore = JSON.stringify(artifact);
    const expectedBefore = JSON.stringify(expected);
    compareExpectedContextCapsuleState(expected, artifact, "instance");
    expect(JSON.stringify(artifact)).toBe(artifactBefore);
    expect(JSON.stringify(expected)).toBe(expectedBefore);
  });
});

describe("compareExpectedRetrievalAuditState", () => {
  it("MET-126 audit state uses exact audit field paths", async () => {
    const artifact = await loadAudit();
    const result = compareExpectedRetrievalAuditState({ freshnessState: artifact.freshness.state }, artifact, "instance");
    expect(result[0].artifactFieldPath).toBe("freshness.state");
    expect(result[0].sourceArtifact).toBe("retrieval-audit-record");
  });

  it("MET-127 audit unresolvedItemIds is unavailable", async () => {
    const artifact = await loadAudit();
    const result = compareExpectedRetrievalAuditState({ unresolvedItemIds: ["a"] }, artifact, "instance");
    expect(result[0].availability).toBe("unavailable");
    expect(result[0].reason).toBe("RetrievalAuditRecord does not serialize unresolved item IDs.");
  });
});

describe("compareExpectedWorkflowInstructionPacketState", () => {
  it("MET-128 packet adequacy compares adequacy.status", async () => {
    const artifact = await loadPacket();
    const result = compareExpectedWorkflowInstructionPacketState({ adequacyStatus: artifact.adequacy.status }, artifact, "instance");
    expect(result[0].artifactFieldPath).toBe("adequacy.status");
    expect(result[0].matched).toBe(true);
  });

  it("MET-129 packet truncation compares truncation.truncated", async () => {
    const artifact = await loadPacket();
    const result = compareExpectedWorkflowInstructionPacketState({ truncated: artifact.truncation.truncated }, artifact, "instance");
    expect(result[0].artifactFieldPath).toBe("truncation.truncated");
    expect(result[0].matched).toBe(true);
  });

  it("MET-130 packet unresolvedReferences compares ordered arrays", async () => {
    const artifact = await loadPacket();
    const result = compareExpectedWorkflowInstructionPacketState(
      { unresolvedReferences: [...artifact.unresolvedReferences] },
      artifact,
      "instance"
    );
    expect(result[0].matched).toBe(true);
  });

  it("MET-131 reordered packet unresolvedReferences do not match", async () => {
    const artifact = await loadPacket();
    artifact.unresolvedReferences = ["a", "b"];
    const result = compareExpectedWorkflowInstructionPacketState({ unresolvedReferences: ["b", "a"] }, artifact, "instance");
    expect(result[0].matched).toBe(false);
  });

  it("MET-132 packet warningCount compares warnings.length", async () => {
    const artifact = await loadPacket();
    const result = compareExpectedWorkflowInstructionPacketState({ warningCount: artifact.warnings.length }, artifact, "instance");
    expect(result[0].artifactFieldPath).toBe("warnings.length");
    expect(result[0].matched).toBe(true);
  });
});

describe("compareExpectedTargetImmutabilityState", () => {
  it("MET-135 target immutability expectation is unavailable when no context is supplied", () => {
    const result = compareExpectedTargetImmutabilityState({ newMutationCount: 0 }, undefined);
    expect(result[0].availability).toBe("unavailable");
    expect(result[0].sourceArtifact).toBe("target-immutability");
    expect(result[0].reason).toBe("Target immutability configuration was not supplied for this strategy run.");
  });

  it("MET-135b absent expectation returns no comparison", () => {
    expect(compareExpectedTargetImmutabilityState(undefined, undefined)).toEqual([]);
  });
});

describe("state comparison ordering", () => {
  it("MET-136 state comparison order follows Sections 43-46", async () => {
    const artifact = await loadCapsule();
    const result = compareExpectedContextCapsuleState(
      {
        contextAdequacyStatus: artifact.contextAdequacy.status,
        roleAdequacyStatus: artifact.roleAdequacy.status,
        freshnessState: artifact.freshness.state,
        truncated: artifact.truncation.truncated,
        fullFileFallbackUsed: artifact.fullFileFallback.used,
        unresolvedItemIds: ["a"],
        warningCount: artifact.warnings.length
      },
      artifact,
      "instance"
    );
    expect(result.map((r) => r.expectationFieldPath)).toEqual([
      "contextAdequacyStatus",
      "roleAdequacyStatus",
      "freshnessState",
      "truncated",
      "fullFileFallbackUsed",
      "unresolvedItemIds",
      "warningCount"
    ]);
  });

  it("MET-137 artifacts and expectations are not mutated", async () => {
    const artifact = await loadPacket();
    const before = JSON.stringify(artifact);
    compareExpectedWorkflowInstructionPacketState({ adequacyStatus: "adequate" }, artifact, "instance");
    expect(JSON.stringify(artifact)).toBe(before);
  });
});
