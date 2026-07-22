import type { WorkflowInstructionPacket } from "../upstreamArtifacts/index.js";
import type { FullWorkflowLibraryFixtureV1 } from "../../experiments/plugins/contextStrategyComparison/v043FullWorkflowLibraryFixture.js";
import type { StageContextObservedEvidenceV1 } from "./types.js";

function dedupeEvidence(records: StageContextObservedEvidenceV1[]): StageContextObservedEvidenceV1[] {
  const seen = new Set<string>();
  const result: StageContextObservedEvidenceV1[] = [];
  for (const record of records) {
    const key = `${record.sourceInstance} ${record.category} ${record.targetKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }
  return result;
}

function workflowStableIdKey(sourceArtifact: string, category: string, id: string): string {
  return `${sourceArtifact}|${category}|id:${id}`;
}

function provenanceKey(sourceArtifact: string, evidenceId: string): string {
  return `${sourceArtifact}|provenance|evidenceId:${evidenceId}`;
}

export function collectWorkflowInstructionPacketEvidence(
  artifact: WorkflowInstructionPacket,
  sourceInstance: string
): StageContextObservedEvidenceV1[] {
  const SOURCE_ARTIFACT = "workflow-instruction-packet" as const;
  const records: StageContextObservedEvidenceV1[] = [];

  records.push({
    sourceArtifact: SOURCE_ARTIFACT,
    sourceInstance,
    category: "workflow",
    targetKey: workflowStableIdKey(SOURCE_ARTIFACT, "workflow", artifact.workflowId),
    sourceFieldPath: "workflowId"
  });
  records.push({
    sourceArtifact: SOURCE_ARTIFACT,
    sourceInstance,
    category: "stage",
    targetKey: workflowStableIdKey(SOURCE_ARTIFACT, "stage", artifact.stageId),
    sourceFieldPath: "stageId"
  });
  artifact.resolvedCommands.forEach((command, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "command",
      targetKey: workflowStableIdKey(SOURCE_ARTIFACT, "command", command.id),
      sourceFieldPath: `resolvedCommands[${index}].id`
    });
  });
  artifact.resolvedRules.forEach((rule, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "rule",
      targetKey: workflowStableIdKey(SOURCE_ARTIFACT, "rule", rule.id),
      sourceFieldPath: `resolvedRules[${index}].id`
    });
  });
  records.push({
    sourceArtifact: SOURCE_ARTIFACT,
    sourceInstance,
    category: "report-contract",
    targetKey: workflowStableIdKey(SOURCE_ARTIFACT, "report-contract", artifact.reportContract.id),
    sourceFieldPath: "reportContract.id"
  });
  artifact.resolutionProvenance.forEach((entry, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "provenance",
      targetKey: provenanceKey(SOURCE_ARTIFACT, entry.sourceEntryId),
      sourceFieldPath: `resolutionProvenance[${index}].sourceEntryId`
    });
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "provenance",
      targetKey: provenanceKey(SOURCE_ARTIFACT, entry.referencedEntryId),
      sourceFieldPath: `resolutionProvenance[${index}].referencedEntryId`
    });
  });

  return dedupeEvidence(records);
}

export function collectFullWorkflowLibraryEvidence(
  fixture: FullWorkflowLibraryFixtureV1,
  sourceInstance: string
): StageContextObservedEvidenceV1[] {
  const SOURCE_ARTIFACT = "full-workflow-library" as const;
  const records: StageContextObservedEvidenceV1[] = [];

  fixture.workflowIds.forEach((id, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "workflow",
      targetKey: workflowStableIdKey(SOURCE_ARTIFACT, "workflow", id),
      sourceFieldPath: `workflowIds[${index}]`
    });
  });
  fixture.stageIds.forEach((id, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "stage",
      targetKey: workflowStableIdKey(SOURCE_ARTIFACT, "stage", id),
      sourceFieldPath: `stageIds[${index}]`
    });
  });
  fixture.commandIds.forEach((id, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "command",
      targetKey: workflowStableIdKey(SOURCE_ARTIFACT, "command", id),
      sourceFieldPath: `commandIds[${index}]`
    });
  });
  fixture.ruleIds.forEach((id, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "rule",
      targetKey: workflowStableIdKey(SOURCE_ARTIFACT, "rule", id),
      sourceFieldPath: `ruleIds[${index}]`
    });
  });
  fixture.reportContractIds.forEach((id, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "report-contract",
      targetKey: workflowStableIdKey(SOURCE_ARTIFACT, "report-contract", id),
      sourceFieldPath: `reportContractIds[${index}]`
    });
  });
  fixture.provenanceEvidenceIds.forEach((id, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "provenance",
      targetKey: provenanceKey(SOURCE_ARTIFACT, id),
      sourceFieldPath: `provenanceEvidenceIds[${index}]`
    });
  });

  return dedupeEvidence(records);
}
