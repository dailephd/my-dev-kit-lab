import { describe, expect, it } from "vitest";
import { readOrchestratorWorkflowInstructionPacketV1 } from "../../../src/evaluation/upstreamArtifacts/readOrchestratorWorkflowInstructionPacketV1.js";
import type { WorkflowInstructionPacket } from "../../../src/evaluation/upstreamArtifacts/index.js";
import * as selectors from "../../../src/evaluation/stageContextSelectors/workflowInstructionPacketSelectors.js";

const COMPLETE_PATH =
  "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.1/workflow-instruction-packet/complete-v1.0.0.json";

interface SelectorCase {
  name: string;
  select: (artifact: WorkflowInstructionPacket) => unknown;
  expected: (artifact: WorkflowInstructionPacket) => unknown;
}

const SELECTOR_CASES: SelectorCase[] = [
  {
    name: "selectWorkflowInstructionPacketSchemaVersion",
    select: selectors.selectWorkflowInstructionPacketSchemaVersion,
    expected: (a) => a.schemaVersion
  },
  {
    name: "selectWorkflowInstructionPacketCatalogSchemaVersion",
    select: selectors.selectWorkflowInstructionPacketCatalogSchemaVersion,
    expected: (a) => a.catalogSchemaVersion
  },
  {
    name: "selectWorkflowInstructionPacketCatalogVersion",
    select: selectors.selectWorkflowInstructionPacketCatalogVersion,
    expected: (a) => a.catalogVersion
  },
  {
    name: "selectWorkflowInstructionPacketWorkflowId",
    select: selectors.selectWorkflowInstructionPacketWorkflowId,
    expected: (a) => a.workflowId
  },
  {
    name: "selectWorkflowInstructionPacketStageId",
    select: selectors.selectWorkflowInstructionPacketStageId,
    expected: (a) => a.stageId
  },
  {
    name: "selectWorkflowInstructionPacketPrimaryEntry",
    select: selectors.selectWorkflowInstructionPacketPrimaryEntry,
    expected: (a) => a.primaryEntry
  },
  {
    name: "selectWorkflowInstructionPacketResolvedCommands",
    select: selectors.selectWorkflowInstructionPacketResolvedCommands,
    expected: (a) => a.resolvedCommands
  },
  {
    name: "selectWorkflowInstructionPacketResolvedRules",
    select: selectors.selectWorkflowInstructionPacketResolvedRules,
    expected: (a) => a.resolvedRules
  },
  {
    name: "selectWorkflowInstructionPacketReportContract",
    select: selectors.selectWorkflowInstructionPacketReportContract,
    expected: (a) => a.reportContract
  },
  {
    name: "selectWorkflowInstructionPacketValidationRequirements",
    select: selectors.selectWorkflowInstructionPacketValidationRequirements,
    expected: (a) => a.validationRequirements
  },
  {
    name: "selectWorkflowInstructionPacketStopConditions",
    select: selectors.selectWorkflowInstructionPacketStopConditions,
    expected: (a) => a.stopConditions
  },
  {
    name: "selectWorkflowInstructionPacketResolutionProvenance",
    select: selectors.selectWorkflowInstructionPacketResolutionProvenance,
    expected: (a) => a.resolutionProvenance
  },
  {
    name: "selectWorkflowInstructionPacketBudget",
    select: selectors.selectWorkflowInstructionPacketBudget,
    expected: (a) => a.budget
  },
  {
    name: "selectWorkflowInstructionPacketTruncation",
    select: selectors.selectWorkflowInstructionPacketTruncation,
    expected: (a) => a.truncation
  },
  {
    name: "selectWorkflowInstructionPacketAdequacy",
    select: selectors.selectWorkflowInstructionPacketAdequacy,
    expected: (a) => a.adequacy
  },
  {
    name: "selectWorkflowInstructionPacketUnresolvedReferences",
    select: selectors.selectWorkflowInstructionPacketUnresolvedReferences,
    expected: (a) => a.unresolvedReferences
  },
  {
    name: "selectWorkflowInstructionPacketWarnings",
    select: selectors.selectWorkflowInstructionPacketWarnings,
    expected: (a) => a.warnings
  }
];

async function loadArtifact(): Promise<WorkflowInstructionPacket> {
  const result = await readOrchestratorWorkflowInstructionPacketV1(COMPLETE_PATH);
  if (!result.ok) throw new Error("fixture read failed unexpectedly");
  return result.artifact;
}

describe("workflowInstructionPacketSelectors", () => {
  it("reads the complete fixture successfully", async () => {
    const result = await readOrchestratorWorkflowInstructionPacketV1(COMPLETE_PATH);
    expect(result.ok).toBe(true);
  });

  it.each(SELECTOR_CASES)("$name returns the exact field value", async ({ select, expected }) => {
    const artifact = await loadArtifact();
    expect(select(artifact)).toBe(expected(artifact));
  });

  it("selectWorkflowInstructionPacketPrimaryEntry returns the complete object", async () => {
    const artifact = await loadArtifact();
    const primaryEntry = selectors.selectWorkflowInstructionPacketPrimaryEntry(artifact);
    expect(primaryEntry).toBe(artifact.primaryEntry);
    expect(Object.keys(primaryEntry).sort()).toEqual(Object.keys(artifact.primaryEntry).sort());
  });

  it("selectWorkflowInstructionPacketResolvedCommands and selectWorkflowInstructionPacketResolvedRules preserve nested entries", async () => {
    const artifact = await loadArtifact();
    const resolvedCommands = selectors.selectWorkflowInstructionPacketResolvedCommands(artifact);
    const resolvedRules = selectors.selectWorkflowInstructionPacketResolvedRules(artifact);
    expect(resolvedCommands).toBe(artifact.resolvedCommands);
    expect(resolvedRules).toBe(artifact.resolvedRules);
    for (let i = 0; i < resolvedCommands.length; i += 1) expect(resolvedCommands[i]).toBe(artifact.resolvedCommands[i]);
    for (let i = 0; i < resolvedRules.length; i += 1) expect(resolvedRules[i]).toBe(artifact.resolvedRules[i]);
  });

  it("selectWorkflowInstructionPacketReportContract, selectWorkflowInstructionPacketBudget, selectWorkflowInstructionPacketTruncation, and selectWorkflowInstructionPacketAdequacy return exact objects", async () => {
    const artifact = await loadArtifact();
    expect(selectors.selectWorkflowInstructionPacketReportContract(artifact)).toBe(artifact.reportContract);
    expect(selectors.selectWorkflowInstructionPacketBudget(artifact)).toBe(artifact.budget);
    expect(selectors.selectWorkflowInstructionPacketTruncation(artifact)).toBe(artifact.truncation);
    expect(selectors.selectWorkflowInstructionPacketAdequacy(artifact)).toBe(artifact.adequacy);
  });

  it("selectWorkflowInstructionPacketResolutionProvenance returns the exact array", async () => {
    const artifact = await loadArtifact();
    expect(selectors.selectWorkflowInstructionPacketResolutionProvenance(artifact)).toBe(artifact.resolutionProvenance);
  });

  it("selectWorkflowInstructionPacketUnresolvedReferences remains string[]", async () => {
    const artifact = await loadArtifact();
    const unresolvedReferences = selectors.selectWorkflowInstructionPacketUnresolvedReferences(artifact);
    for (const entry of unresolvedReferences) expect(typeof entry).toBe("string");
  });

  it("selectWorkflowInstructionPacketWorkflowId and selectWorkflowInstructionPacketStageId remain opaque strings", async () => {
    const artifact = await loadArtifact();
    expect(selectors.selectWorkflowInstructionPacketWorkflowId(artifact)).toBe("workflow.feature");
    expect(selectors.selectWorkflowInstructionPacketStageId(artifact)).toBe("stage.feature.implementation");
  });

  it("no selector mutates the packet", async () => {
    const artifact = await loadArtifact();
    const before = JSON.stringify(artifact);
    for (const { select } of SELECTOR_CASES) select(artifact);
    expect(JSON.stringify(artifact)).toBe(before);
  });
});
