import type { RetrievalAuditRecord } from "../upstreamArtifacts/index.js";

export function selectRetrievalAuditRecordSchemaVersion(
  artifact: RetrievalAuditRecord
): RetrievalAuditRecord["schemaVersion"] {
  return artifact.schemaVersion;
}

export function selectRetrievalAuditRecordGeneratedAt(
  artifact: RetrievalAuditRecord
): RetrievalAuditRecord["generatedAt"] {
  return artifact.generatedAt;
}

export function selectRetrievalAuditRecordTool(artifact: RetrievalAuditRecord): RetrievalAuditRecord["tool"] {
  return artifact.tool;
}

export function selectRetrievalAuditRecordRequest(artifact: RetrievalAuditRecord): RetrievalAuditRecord["request"] {
  return artifact.request;
}

export function selectRetrievalAuditRecordIndex(artifact: RetrievalAuditRecord): RetrievalAuditRecord["index"] {
  return artifact.index;
}

export function selectRetrievalAuditRecordSteps(artifact: RetrievalAuditRecord): RetrievalAuditRecord["steps"] {
  return artifact.steps;
}

export function selectRetrievalAuditRecordFallbacks(
  artifact: RetrievalAuditRecord
): RetrievalAuditRecord["fallbacks"] {
  return artifact.fallbacks;
}

export function selectRetrievalAuditRecordFullFileReadRecommendations(
  artifact: RetrievalAuditRecord
): RetrievalAuditRecord["fullFileReadRecommendations"] {
  return artifact.fullFileReadRecommendations;
}

export function selectRetrievalAuditRecordWarnings(
  artifact: RetrievalAuditRecord
): RetrievalAuditRecord["warnings"] {
  return artifact.warnings;
}

export function selectRetrievalAuditRecordContextAdequacy(
  artifact: RetrievalAuditRecord
): RetrievalAuditRecord["contextAdequacy"] {
  return artifact.contextAdequacy;
}

export function selectRetrievalAuditRecordRoleContext(
  artifact: RetrievalAuditRecord
): RetrievalAuditRecord["roleContext"] {
  return artifact.roleContext;
}

export function selectRetrievalAuditRecordResponsibilityMappings(
  artifact: RetrievalAuditRecord
): RetrievalAuditRecord["responsibilityMappings"] {
  return artifact.responsibilityMappings;
}

export function selectRetrievalAuditRecordRoleAdequacy(
  artifact: RetrievalAuditRecord
): RetrievalAuditRecord["roleAdequacy"] {
  return artifact.roleAdequacy;
}

export function selectRetrievalAuditRecordFreshness(
  artifact: RetrievalAuditRecord
): RetrievalAuditRecord["freshness"] {
  return artifact.freshness;
}

export function selectRetrievalAuditRecordBudget(artifact: RetrievalAuditRecord): RetrievalAuditRecord["budget"] {
  return artifact.budget;
}

export function selectRetrievalAuditRecordTruncation(
  artifact: RetrievalAuditRecord
): RetrievalAuditRecord["truncation"] {
  return artifact.truncation;
}

export function selectRetrievalAuditRecordFullFileFallback(
  artifact: RetrievalAuditRecord
): RetrievalAuditRecord["fullFileFallback"] {
  return artifact.fullFileFallback;
}

export function selectRetrievalAuditRecordProvenance(
  artifact: RetrievalAuditRecord
): RetrievalAuditRecord["provenance"] {
  return artifact.provenance;
}
