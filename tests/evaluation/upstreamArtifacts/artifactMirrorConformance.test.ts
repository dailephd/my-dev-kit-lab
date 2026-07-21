import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateMyDevKitContextCapsuleV1 } from "../../../src/evaluation/upstreamArtifacts/validateMyDevKitContextCapsuleV1.js";
import { validateMyDevKitRetrievalAuditRecordV1 } from "../../../src/evaluation/upstreamArtifacts/validateMyDevKitRetrievalAuditRecordV1.js";
import { validateOrchestratorWorkflowInstructionPacketV1 } from "../../../src/evaluation/upstreamArtifacts/validateOrchestratorWorkflowInstructionPacketV1.js";
import type { JsonObject } from "../../../src/evaluation/upstreamArtifacts/jsonTypes.js";

const CAPSULE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";
const AUDIT_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/retrieval-audit-record/complete-v1.0.0.json";
const PACKET_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.1/workflow-instruction-packet/complete-v1.0.0.json";

function loadFixture(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

describe("artifact mirror conformance", () => {
  it("ContextCapsule.contextAdequacy contains status, summary, assumptions, gaps", () => {
    const result = validateMyDevKitContextCapsuleV1(loadFixture(CAPSULE_PATH), "fixture.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.artifact.contextAdequacy).sort()).toEqual(["assumptions", "gaps", "status", "summary"]);
    }
  });

  it("ContextCapsule.roleAdequacy contains all eleven exact fields", () => {
    const result = validateMyDevKitContextCapsuleV1(loadFixture(CAPSULE_PATH), "fixture.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.artifact.roleAdequacy).sort()).toEqual(
        [
          "affectedResponsibilityIds",
          "blockingConditions",
          "freshnessImpact",
          "missingConditions",
          "requiredConditions",
          "role",
          "satisfiedConditions",
          "status",
          "supportingEvidence",
          "truncationImpact",
          "warnings"
        ].sort()
      );
    }
  });

  it("ContextCapsule.freshness contains state, role, evidenceUsed, evidenceUnavailable, comparedIdentities, reason, relevantChangedPaths, warnings", () => {
    const result = validateMyDevKitContextCapsuleV1(loadFixture(CAPSULE_PATH), "fixture.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.artifact.freshness).sort()).toEqual(
        ["state", "role", "evidenceUsed", "evidenceUnavailable", "comparedIdentities", "reason", "relevantChangedPaths", "warnings"].sort()
      );
    }
  });

  it("freshness compared-identity value accepts null", () => {
    const result = validateMyDevKitContextCapsuleV1(loadFixture(CAPSULE_PATH), "fixture.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.freshness.comparedIdentities.some((identity) => identity.value === null)).toBe(true);
    }
  });

  it("RetrievalAuditRecord uses steps[].inputs and steps[].outputs", () => {
    const result = validateMyDevKitRetrievalAuditRecordV1(loadFixture(AUDIT_PATH), "fixture.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.steps[0]).toHaveProperty("inputs");
      expect(result.artifact.steps[0]).toHaveProperty("outputs");
      expect(result.artifact.steps[0]).not.toHaveProperty("input");
      expect(result.artifact.steps[0]).not.toHaveProperty("output");
    }
  });

  it("RetrievalAuditRecord does not have candidate-detail properties", () => {
    const result = validateMyDevKitRetrievalAuditRecordV1(loadFixture(AUDIT_PATH), "fixture.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const artifact = result.artifact as unknown as Record<string, unknown>;
      expect(artifact.candidateFiles).toBeUndefined();
      expect(artifact.candidateNodes).toBeUndefined();
      expect(artifact.selectedGraph).toBeUndefined();
      expect(artifact.selectedSource).toBeUndefined();
      expect(artifact.evidenceGroups).toBeUndefined();
      expect(artifact.consideredButUnselectedReads).toBeUndefined();
      expect(artifact.unnecessaryReads).toBeUndefined();
    }
  });

  it("WorkflowInstructionPacket.unresolvedReferences is string[]", () => {
    const result = validateOrchestratorWorkflowInstructionPacketV1(loadFixture(PACKET_PATH), "fixture.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const entry of result.artifact.unresolvedReferences) {
        expect(typeof entry).toBe("string");
      }
    }
  });

  it("InstructionBudgetAccounting.perEntryCharacters is Record<string, number>", () => {
    const result = validateOrchestratorWorkflowInstructionPacketV1(loadFixture(PACKET_PATH), "fixture.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const value of Object.values(result.artifact.budget.perEntryCharacters)) {
        expect(typeof value).toBe("number");
      }
    }
  });

  it("PacketTruncation retains all six exact fields", () => {
    const result = validateOrchestratorWorkflowInstructionPacketV1(loadFixture(PACKET_PATH), "fixture.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.artifact.truncation).sort()).toEqual(
        [
          "truncated",
          "records",
          "droppedOptionalCommandIds",
          "droppedOptionalRuleIds",
          "droppedOptionalDependencyIds",
          "warnings"
        ].sort()
      );
    }
  });

  it("PacketAdequacy retains all six exact fields", () => {
    const result = validateOrchestratorWorkflowInstructionPacketV1(loadFixture(PACKET_PATH), "fixture.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.artifact.adequacy).sort()).toEqual(
        ["status", "reasons", "requiredContentComplete", "requiredBudgetSatisfied", "optionalContentDropped", "affectedEntryIds"].sort()
      );
    }
  });

  it("no exported type contains the previously invented paths adequacy.overall, adequacy.roleStatus, adequacy.reasons, freshness.status, freshness.reasons", () => {
    const capsuleResult = validateMyDevKitContextCapsuleV1(loadFixture(CAPSULE_PATH), "fixture.json");
    expect(capsuleResult.ok).toBe(true);
    if (capsuleResult.ok) {
      const artifact = capsuleResult.artifact as unknown as Record<string, unknown>;
      expect(artifact.adequacy).toBeUndefined();
      expect((artifact.freshness as Record<string, unknown>).status).toBeUndefined();
      expect((artifact.freshness as Record<string, unknown>).reasons).toBeUndefined();
    }
  });
});
