import type { ContextCapsule } from "../upstreamArtifacts/index.js";

export function selectContextCapsuleSchemaVersion(artifact: ContextCapsule): ContextCapsule["schemaVersion"] {
  return artifact.schemaVersion;
}

export function selectContextCapsuleGeneratedAt(artifact: ContextCapsule): ContextCapsule["generatedAt"] {
  return artifact.generatedAt;
}

export function selectContextCapsuleTool(artifact: ContextCapsule): ContextCapsule["tool"] {
  return artifact.tool;
}

export function selectContextCapsuleRequest(artifact: ContextCapsule): ContextCapsule["request"] {
  return artifact.request;
}

export function selectContextCapsuleIndex(artifact: ContextCapsule): ContextCapsule["index"] {
  return artifact.index;
}

export function selectContextCapsuleLimits(artifact: ContextCapsule): ContextCapsule["limits"] {
  return artifact.limits;
}

export function selectContextCapsuleRequiredContext(artifact: ContextCapsule): ContextCapsule["requiredContext"] {
  return artifact.requiredContext;
}

export function selectContextCapsuleOptionalSupportContext(
  artifact: ContextCapsule
): ContextCapsule["optionalSupportContext"] {
  return artifact.optionalSupportContext;
}

export function selectContextCapsuleDroppedContext(artifact: ContextCapsule): ContextCapsule["droppedContext"] {
  return artifact.droppedContext;
}

export function selectContextCapsuleWarnings(artifact: ContextCapsule): ContextCapsule["warnings"] {
  return artifact.warnings;
}

export function selectContextCapsuleContextAdequacy(artifact: ContextCapsule): ContextCapsule["contextAdequacy"] {
  return artifact.contextAdequacy;
}

export function selectContextCapsuleQueryPlan(artifact: ContextCapsule): ContextCapsule["queryPlan"] {
  return artifact.queryPlan;
}

export function selectContextCapsuleCandidateFiles(artifact: ContextCapsule): ContextCapsule["candidateFiles"] {
  return artifact.candidateFiles;
}

export function selectContextCapsuleCandidateNodes(artifact: ContextCapsule): ContextCapsule["candidateNodes"] {
  return artifact.candidateNodes;
}

export function selectContextCapsuleFocus(artifact: ContextCapsule): ContextCapsule["focus"] {
  return artifact.focus;
}

export function selectContextCapsuleSelectedGraph(artifact: ContextCapsule): ContextCapsule["selectedGraph"] {
  return artifact.selectedGraph;
}

export function selectContextCapsuleRetention(artifact: ContextCapsule): ContextCapsule["retention"] {
  return artifact.retention;
}

export function selectContextCapsuleSelectedSource(artifact: ContextCapsule): ContextCapsule["selectedSource"] {
  return artifact.selectedSource;
}

export function selectContextCapsuleSelectedSourceBundles(
  artifact: ContextCapsule
): ContextCapsule["selectedSourceBundles"] {
  return artifact.selectedSourceBundles;
}

export function selectContextCapsuleSemanticSummary(artifact: ContextCapsule): ContextCapsule["semanticSummary"] {
  return artifact.semanticSummary;
}

export function selectContextCapsuleClassificationSummary(
  artifact: ContextCapsule
): ContextCapsule["classificationSummary"] {
  return artifact.classificationSummary;
}

export function selectContextCapsuleArtifactReferenceSummary(
  artifact: ContextCapsule
): ContextCapsule["artifactReferenceSummary"] {
  return artifact.artifactReferenceSummary;
}

export function selectContextCapsulePruning(artifact: ContextCapsule): ContextCapsule["pruning"] {
  return artifact.pruning;
}

export function selectContextCapsuleConflicts(artifact: ContextCapsule): ContextCapsule["conflicts"] {
  return artifact.conflicts;
}

export function selectContextCapsuleModeEffects(artifact: ContextCapsule): ContextCapsule["modeEffects"] {
  return artifact.modeEffects;
}

export function selectContextCapsuleSourceControl(artifact: ContextCapsule): ContextCapsule["sourceControl"] {
  return artifact.sourceControl;
}

export function selectContextCapsuleDeferredRequestFields(
  artifact: ContextCapsule
): ContextCapsule["deferredRequestFields"] {
  return artifact.deferredRequestFields;
}

export function selectContextCapsuleRoleContext(artifact: ContextCapsule): ContextCapsule["roleContext"] {
  return artifact.roleContext;
}

export function selectContextCapsuleEvidenceGroups(artifact: ContextCapsule): ContextCapsule["evidenceGroups"] {
  return artifact.evidenceGroups;
}

export function selectContextCapsuleSelectedOwners(artifact: ContextCapsule): ContextCapsule["selectedOwners"] {
  return artifact.selectedOwners;
}

export function selectContextCapsuleSelectedContracts(artifact: ContextCapsule): ContextCapsule["selectedContracts"] {
  return artifact.selectedContracts;
}

export function selectContextCapsuleSelectedTests(artifact: ContextCapsule): ContextCapsule["selectedTests"] {
  return artifact.selectedTests;
}

export function selectContextCapsuleTestInfrastructure(
  artifact: ContextCapsule
): ContextCapsule["testInfrastructure"] {
  return artifact.testInfrastructure;
}

export function selectContextCapsuleUnresolvedItems(artifact: ContextCapsule): ContextCapsule["unresolvedItems"] {
  return artifact.unresolvedItems;
}

export function selectContextCapsuleGroupTruncation(artifact: ContextCapsule): ContextCapsule["groupTruncation"] {
  return artifact.groupTruncation;
}

export function selectContextCapsuleResponsibilityMappings(
  artifact: ContextCapsule
): ContextCapsule["responsibilityMappings"] {
  return artifact.responsibilityMappings;
}

export function selectContextCapsuleRoleAdequacy(artifact: ContextCapsule): ContextCapsule["roleAdequacy"] {
  return artifact.roleAdequacy;
}

export function selectContextCapsuleFreshness(artifact: ContextCapsule): ContextCapsule["freshness"] {
  return artifact.freshness;
}

export function selectContextCapsuleBudget(artifact: ContextCapsule): ContextCapsule["budget"] {
  return artifact.budget;
}

export function selectContextCapsuleTruncation(artifact: ContextCapsule): ContextCapsule["truncation"] {
  return artifact.truncation;
}

export function selectContextCapsuleFullFileFallback(artifact: ContextCapsule): ContextCapsule["fullFileFallback"] {
  return artifact.fullFileFallback;
}

export function selectContextCapsuleProvenance(artifact: ContextCapsule): ContextCapsule["provenance"] {
  return artifact.provenance;
}
