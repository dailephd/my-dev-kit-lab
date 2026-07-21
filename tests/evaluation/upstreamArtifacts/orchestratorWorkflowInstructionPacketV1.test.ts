import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readOrchestratorWorkflowInstructionPacketV1 } from "../../../src/evaluation/upstreamArtifacts/readOrchestratorWorkflowInstructionPacketV1.js";
import { validateOrchestratorWorkflowInstructionPacketV1 } from "../../../src/evaluation/upstreamArtifacts/validateOrchestratorWorkflowInstructionPacketV1.js";
import type { JsonObject } from "../../../src/evaluation/upstreamArtifacts/jsonTypes.js";
import {
  WORKFLOW_INSTRUCTION_PACKET_ENUM_CASES,
  WORKFLOW_INSTRUCTION_PACKET_NULLABLE_FIELD_PATHS,
  WORKFLOW_INSTRUCTION_PACKET_REQUIRED_FIELD_PATHS,
  deleteFieldAtPath,
  setFieldAtPath
} from "./schemaCases.js";

const COMPLETE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.1/workflow-instruction-packet/complete-v1.0.0.json";
const FUTURE_MINOR_PATH =
  "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.1/workflow-instruction-packet/future-minor-v1.1.0-additive.json";
const SOURCE_PATH = "fixture-workflow-instruction-packet.json";

function loadFixture(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

describe("readOrchestratorWorkflowInstructionPacketV1", () => {
  it("succeeds for the complete fixture", async () => {
    const result = await readOrchestratorWorkflowInstructionPacketV1(COMPLETE_PATH);
    expect(result.ok).toBe(true);
  });

  it("returns the same object reference for artifact and rawArtifact", async () => {
    const result = await readOrchestratorWorkflowInstructionPacketV1(COMPLETE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact).toBe(result.rawArtifact);
  });

  it("succeeds for the future-minor additive fixture", async () => {
    const result = await readOrchestratorWorkflowInstructionPacketV1(FUTURE_MINOR_PATH);
    expect(result.ok).toBe(true);
  });

  it("preserves unknown fields", async () => {
    const result = await readOrchestratorWorkflowInstructionPacketV1(FUTURE_MINOR_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.artifact as unknown as Record<string, unknown>).futureMinorRootField).toBe("preserved");
      expect((result.artifact.reportContract as unknown as Record<string, unknown>).futureNestedField).toBe("preserved");
    }
  });
});

describe("validateOrchestratorWorkflowInstructionPacketV1 field requirements", () => {
  const fixture = loadFixture(COMPLETE_PATH);

  it.each(WORKFLOW_INSTRUCTION_PACKET_REQUIRED_FIELD_PATHS)("fails when required field %s is removed", (fieldPath) => {
    const mutated = deleteFieldAtPath(fixture, fieldPath);
    const result = validateOrchestratorWorkflowInstructionPacketV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(false);
  });

  it.each(WORKFLOW_INSTRUCTION_PACKET_NULLABLE_FIELD_PATHS)("succeeds when nullable field %s is set to null", (fieldPath) => {
    const mutated = setFieldAtPath(fixture, fieldPath, null);
    const result = validateOrchestratorWorkflowInstructionPacketV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(true);
  });

  it.each(WORKFLOW_INSTRUCTION_PACKET_ENUM_CASES)("fails when $fieldPath has an invalid enum value", ({ fieldPath, invalidValue }) => {
    const mutated = setFieldAtPath(fixture, fieldPath, invalidValue);
    const result = validateOrchestratorWorkflowInstructionPacketV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(false);
  });
});

describe("validateOrchestratorWorkflowInstructionPacketV1 exact-mirror behavior", () => {
  const fixture = loadFixture(COMPLETE_PATH);

  it("keeps primaryEntry exact", () => {
    const result = validateOrchestratorWorkflowInstructionPacketV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.primaryEntry).toEqual(fixture.primaryEntry);
    }
  });

  it("keeps resolvedCommands as complete ResolvedCommandEntry objects", () => {
    const result = validateOrchestratorWorkflowInstructionPacketV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.resolvedCommands[0]).toMatchObject({
        id: "command.repo.build",
        kind: "command",
        sideEffect: "read-only",
        included: "required"
      });
    }
  });

  it("keeps resolvedRules as complete ResolvedRuleEntry objects", () => {
    const result = validateOrchestratorWorkflowInstructionPacketV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.resolvedRules[1]).toMatchObject({
        id: "rule.quality.prefer-tests",
        kind: "rule",
        included: "optional",
        depth: 1
      });
    }
  });

  it("keeps reportContract exact", () => {
    const result = validateOrchestratorWorkflowInstructionPacketV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.reportContract).toEqual(fixture.reportContract);
  });

  it("keeps budget exact", () => {
    const result = validateOrchestratorWorkflowInstructionPacketV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.budget).toEqual(fixture.budget);
  });

  it("keeps truncation exact", () => {
    const result = validateOrchestratorWorkflowInstructionPacketV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.truncation).toEqual(fixture.truncation);
  });

  it("keeps adequacy exact", () => {
    const result = validateOrchestratorWorkflowInstructionPacketV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.adequacy).toEqual(fixture.adequacy);
  });

  it("keeps resolutionProvenance exact", () => {
    const result = validateOrchestratorWorkflowInstructionPacketV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.resolutionProvenance).toEqual(fixture.resolutionProvenance);
  });

  it("keeps unresolvedReferences as string[], not an array of objects", () => {
    const result = validateOrchestratorWorkflowInstructionPacketV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.unresolvedReferences).toEqual(["command.repo.unresolved-example"]);
      expect(typeof result.artifact.unresolvedReferences[0]).toBe("string");
    }
  });

  it("preserves array order", () => {
    const result = validateOrchestratorWorkflowInstructionPacketV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.resolvedCommands.map((c) => c.id)).toEqual(["command.repo.build", "command.repo.lint"]);
    }
  });

  it("rejects duplicate resolved command IDs", () => {
    const withDuplicate: JsonObject = JSON.parse(JSON.stringify(fixture));
    (withDuplicate.resolvedCommands as unknown[]).push((withDuplicate.resolvedCommands as unknown[])[0]);
    const result = validateOrchestratorWorkflowInstructionPacketV1(withDuplicate, SOURCE_PATH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_RESOLVED_COMMAND_ID");
  });

  it("rejects duplicate resolved rule IDs", () => {
    const withDuplicate: JsonObject = JSON.parse(JSON.stringify(fixture));
    (withDuplicate.resolvedRules as unknown[]).push((withDuplicate.resolvedRules as unknown[])[0]);
    const result = validateOrchestratorWorkflowInstructionPacketV1(withDuplicate, SOURCE_PATH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_RESOLVED_RULE_ID");
  });

  it("does not reject an equal ID appearing once in resolvedCommands and once in resolvedRules", () => {
    const withSharedId: JsonObject = JSON.parse(JSON.stringify(fixture));
    (withSharedId.resolvedCommands as Array<Record<string, unknown>>)[0].id = "shared.fixture.id";
    (withSharedId.resolvedRules as Array<Record<string, unknown>>)[0].id = "shared.fixture.id";
    const result = validateOrchestratorWorkflowInstructionPacketV1(withSharedId, SOURCE_PATH);
    expect(result.ok).toBe(true);
  });

  it("accepts arbitrary nonempty strings for workflowId and stageId without catalog lookup", () => {
    const mutated = setFieldAtPath(fixture, "workflowId", "workflow.totally-unregistered-example");
    const result = validateOrchestratorWorkflowInstructionPacketV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(true);
  });
});
