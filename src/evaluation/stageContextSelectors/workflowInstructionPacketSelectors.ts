import type { WorkflowInstructionPacket } from "../upstreamArtifacts/index.js";

export function selectWorkflowInstructionPacketSchemaVersion(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["schemaVersion"] {
  return artifact.schemaVersion;
}

export function selectWorkflowInstructionPacketCatalogSchemaVersion(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["catalogSchemaVersion"] {
  return artifact.catalogSchemaVersion;
}

export function selectWorkflowInstructionPacketCatalogVersion(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["catalogVersion"] {
  return artifact.catalogVersion;
}

export function selectWorkflowInstructionPacketWorkflowId(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["workflowId"] {
  return artifact.workflowId;
}

export function selectWorkflowInstructionPacketStageId(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["stageId"] {
  return artifact.stageId;
}

export function selectWorkflowInstructionPacketPrimaryEntry(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["primaryEntry"] {
  return artifact.primaryEntry;
}

export function selectWorkflowInstructionPacketResolvedCommands(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["resolvedCommands"] {
  return artifact.resolvedCommands;
}

export function selectWorkflowInstructionPacketResolvedRules(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["resolvedRules"] {
  return artifact.resolvedRules;
}

export function selectWorkflowInstructionPacketReportContract(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["reportContract"] {
  return artifact.reportContract;
}

export function selectWorkflowInstructionPacketValidationRequirements(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["validationRequirements"] {
  return artifact.validationRequirements;
}

export function selectWorkflowInstructionPacketStopConditions(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["stopConditions"] {
  return artifact.stopConditions;
}

export function selectWorkflowInstructionPacketResolutionProvenance(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["resolutionProvenance"] {
  return artifact.resolutionProvenance;
}

export function selectWorkflowInstructionPacketBudget(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["budget"] {
  return artifact.budget;
}

export function selectWorkflowInstructionPacketTruncation(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["truncation"] {
  return artifact.truncation;
}

export function selectWorkflowInstructionPacketAdequacy(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["adequacy"] {
  return artifact.adequacy;
}

export function selectWorkflowInstructionPacketUnresolvedReferences(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["unresolvedReferences"] {
  return artifact.unresolvedReferences;
}

export function selectWorkflowInstructionPacketWarnings(
  artifact: WorkflowInstructionPacket
): WorkflowInstructionPacket["warnings"] {
  return artifact.warnings;
}
