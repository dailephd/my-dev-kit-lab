import { describe, expect, it } from "vitest";
import { readOrchestratorWorkflowInstructionPacketV1 } from "../../../src/evaluation/upstreamArtifacts/index.js";
import {
  collectFullWorkflowLibraryEvidence,
  collectWorkflowInstructionPacketEvidence
} from "../../../src/evaluation/stageContextMetrics/collectWorkflowInstructionEvidence.js";
import type { WorkflowInstructionPacket } from "../../../src/evaluation/upstreamArtifacts/index.js";
import type { FullWorkflowLibraryFixtureV1 } from "../../../src/experiments/plugins/contextStrategyComparison/v043FullWorkflowLibraryFixture.js";

const PACKET_FIXTURE_PATH =
  "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.1/workflow-instruction-packet/complete-v1.0.0.json";

async function loadPacket(): Promise<WorkflowInstructionPacket> {
  const result = await readOrchestratorWorkflowInstructionPacketV1(PACKET_FIXTURE_PATH);
  if (!result.ok) throw new Error("fixture read failed unexpectedly");
  return result.artifact;
}

function buildLibraryFixture(overrides: Partial<FullWorkflowLibraryFixtureV1> = {}): FullWorkflowLibraryFixtureV1 {
  return {
    schemaVersion: "1.0.0",
    fixtureId: "FULL-WORKFLOW-LIBRARY-V043-001",
    title: "Library",
    description: "Library description.",
    workflowIds: ["workflow.a", "workflow.b"],
    stageIds: ["stage.a"],
    commandIds: ["command.a"],
    ruleIds: ["rule.a"],
    reportContractIds: ["report.a"],
    provenanceEvidenceIds: ["provenance.a"],
    rawText: "some text with workflow.hidden inside it",
    warnings: [],
    ...overrides
  };
}

describe("collectWorkflowInstructionPacketEvidence", () => {
  it("MET-059 packet workflowId produces workflow evidence", async () => {
    const artifact = await loadPacket();
    const evidence = collectWorkflowInstructionPacketEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) => e.category === "workflow" && e.targetKey === "workflow-instruction-packet|workflow|id:workflow.feature"
      )
    ).toBe(true);
  });

  it("MET-060 packet stageId produces stage evidence", async () => {
    const artifact = await loadPacket();
    const evidence = collectWorkflowInstructionPacketEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) => e.category === "stage" && e.targetKey === "workflow-instruction-packet|stage|id:stage.feature.implementation"
      )
    ).toBe(true);
  });

  it("MET-061 packet command IDs produce command evidence", async () => {
    const artifact = await loadPacket();
    const evidence = collectWorkflowInstructionPacketEvidence(artifact, "instance");
    expect(
      evidence.some((e) => e.category === "command" && e.targetKey === "workflow-instruction-packet|command|id:command.repo.build")
    ).toBe(true);
  });

  it("MET-062 packet rule IDs produce rule evidence", async () => {
    const artifact = await loadPacket();
    const evidence = collectWorkflowInstructionPacketEvidence(artifact, "instance");
    expect(
      evidence.some((e) => e.category === "rule" && e.targetKey === "workflow-instruction-packet|rule|id:rule.quality.no-dead-code")
    ).toBe(true);
  });

  it("MET-063 packet reportContract ID produces report-contract evidence", async () => {
    const artifact = await loadPacket();
    const evidence = collectWorkflowInstructionPacketEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) =>
          e.category === "report-contract" &&
          e.targetKey === "workflow-instruction-packet|report-contract|id:report.implementation-summary"
      )
    ).toBe(true);
  });

  it("MET-064 packet provenance collects sourceEntryId before referencedEntryId", async () => {
    const artifact = await loadPacket();
    const evidence = collectWorkflowInstructionPacketEvidence(artifact, "instance");
    const sourceIndex = evidence.findIndex((e) => e.sourceFieldPath === "resolutionProvenance[0].sourceEntryId");
    const referencedIndex = evidence.findIndex((e) => e.sourceFieldPath === "resolutionProvenance[0].referencedEntryId");
    expect(sourceIndex).toBeGreaterThanOrEqual(0);
    expect(referencedIndex).toBeGreaterThan(sourceIndex);
  });

  it("MET-065 packet provenance excludes root IDs", async () => {
    const artifact = await loadPacket();
    const evidence = collectWorkflowInstructionPacketEvidence(artifact, "instance");
    expect(evidence.some((e) => e.targetKey.includes(artifact.resolutionProvenance[0].rootWorkflowId) && e.category === "provenance")).toBe(false);
  });

  it("MET-066 packet provenance excludes inclusionReason", async () => {
    const artifact = await loadPacket();
    const evidence = collectWorkflowInstructionPacketEvidence(artifact, "instance");
    expect(evidence.some((e) => e.targetKey.includes(artifact.resolutionProvenance[0].inclusionReason))).toBe(false);
  });

  it("MET-067 packet arrays preserve order", async () => {
    const artifact = await loadPacket();
    artifact.resolvedCommands = [
      { ...artifact.resolvedCommands[0], id: "command.repo.a" },
      { ...artifact.resolvedCommands[0], id: "command.repo.b" }
    ];
    const evidence = collectWorkflowInstructionPacketEvidence(artifact, "instance");
    const commandEvidence = evidence.filter((e) => e.category === "command");
    expect(commandEvidence.map((e) => e.targetKey)).toEqual([
      "workflow-instruction-packet|command|id:command.repo.a",
      "workflow-instruction-packet|command|id:command.repo.b"
    ]);
  });

  it("MET-068 packet IDs remain opaque", async () => {
    const artifact = await loadPacket();
    const evidence = collectWorkflowInstructionPacketEvidence(artifact, "instance");
    const workflowEvidence = evidence.find((e) => e.category === "workflow");
    expect(workflowEvidence?.targetKey).toContain("workflow.feature");
  });

  it("MET-077a workflow packet input object is not mutated", async () => {
    const artifact = await loadPacket();
    const before = JSON.stringify(artifact);
    collectWorkflowInstructionPacketEvidence(artifact, "instance");
    expect(JSON.stringify(artifact)).toBe(before);
  });
});

describe("collectFullWorkflowLibraryEvidence", () => {
  it("MET-069 full library workflow IDs produce workflow evidence", () => {
    const fixture = buildLibraryFixture();
    const evidence = collectFullWorkflowLibraryEvidence(fixture, "instance");
    expect(evidence.some((e) => e.category === "workflow" && e.targetKey === "full-workflow-library|workflow|id:workflow.a")).toBe(true);
  });

  it("MET-070 full library stage IDs produce stage evidence", () => {
    const fixture = buildLibraryFixture();
    const evidence = collectFullWorkflowLibraryEvidence(fixture, "instance");
    expect(evidence.some((e) => e.category === "stage" && e.targetKey === "full-workflow-library|stage|id:stage.a")).toBe(true);
  });

  it("MET-071 full library command IDs produce command evidence", () => {
    const fixture = buildLibraryFixture();
    const evidence = collectFullWorkflowLibraryEvidence(fixture, "instance");
    expect(evidence.some((e) => e.category === "command" && e.targetKey === "full-workflow-library|command|id:command.a")).toBe(true);
  });

  it("MET-072 full library rule IDs produce rule evidence", () => {
    const fixture = buildLibraryFixture();
    const evidence = collectFullWorkflowLibraryEvidence(fixture, "instance");
    expect(evidence.some((e) => e.category === "rule" && e.targetKey === "full-workflow-library|rule|id:rule.a")).toBe(true);
  });

  it("MET-073 full library report-contract IDs produce report-contract evidence", () => {
    const fixture = buildLibraryFixture();
    const evidence = collectFullWorkflowLibraryEvidence(fixture, "instance");
    expect(
      evidence.some((e) => e.category === "report-contract" && e.targetKey === "full-workflow-library|report-contract|id:report.a")
    ).toBe(true);
  });

  it("MET-074 full library provenance IDs produce provenance evidence", () => {
    const fixture = buildLibraryFixture();
    const evidence = collectFullWorkflowLibraryEvidence(fixture, "instance");
    expect(
      evidence.some((e) => e.category === "provenance" && e.targetKey === "full-workflow-library|provenance|evidenceId:provenance.a")
    ).toBe(true);
  });

  it("MET-075 full library rawText is not parsed for IDs", () => {
    const fixture = buildLibraryFixture();
    const evidence = collectFullWorkflowLibraryEvidence(fixture, "instance");
    expect(evidence.some((e) => e.targetKey.includes("workflow.hidden"))).toBe(false);
  });

  it("MET-076 full library array order is preserved", () => {
    const fixture = buildLibraryFixture({ workflowIds: ["workflow.z", "workflow.a", "workflow.m"] });
    const evidence = collectFullWorkflowLibraryEvidence(fixture, "instance");
    const workflowEvidence = evidence.filter((e) => e.category === "workflow");
    expect(workflowEvidence.map((e) => e.targetKey)).toEqual([
      "full-workflow-library|workflow|id:workflow.z",
      "full-workflow-library|workflow|id:workflow.a",
      "full-workflow-library|workflow|id:workflow.m"
    ]);
  });

  it("MET-077 neither input object is mutated", () => {
    const fixture = buildLibraryFixture();
    const before = JSON.stringify(fixture);
    collectFullWorkflowLibraryEvidence(fixture, "instance");
    expect(JSON.stringify(fixture)).toBe(before);
  });
});
