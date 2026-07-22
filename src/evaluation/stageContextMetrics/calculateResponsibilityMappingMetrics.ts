import type { ContextCapsule, RetrievalAuditRecord } from "../upstreamArtifacts/index.js";
import type { StageContextResponsibilityMappingMetricV1 } from "./types.js";

function buildMetric(
  sourceArtifact: "context-capsule" | "retrieval-audit-record",
  sourceInstance: string,
  requested: boolean,
  operational: boolean,
  mappings: readonly { mappingStatus: string }[]
): StageContextResponsibilityMappingMetricV1 {
  let mappedCount = 0;
  let partiallyMappedCount = 0;
  let unmappedCount = 0;
  let notApplicableCount = 0;

  for (const mapping of mappings) {
    if (mapping.mappingStatus === "mapped") mappedCount += 1;
    else if (mapping.mappingStatus === "partially-mapped") partiallyMappedCount += 1;
    else if (mapping.mappingStatus === "unmapped") unmappedCount += 1;
    else if (mapping.mappingStatus === "not-applicable") notApplicableCount += 1;
  }

  const denominator = mappedCount + partiallyMappedCount + unmappedCount;
  const mappedRate = denominator > 0 ? mappedCount / denominator : null;

  return {
    sourceArtifact,
    sourceInstance,
    requested,
    operational,
    mappedCount,
    partiallyMappedCount,
    unmappedCount,
    notApplicableCount,
    denominator,
    mappedRate
  };
}

export function calculateContextCapsuleResponsibilityMappingMetric(
  artifact: ContextCapsule,
  sourceInstance: string
): StageContextResponsibilityMappingMetricV1 {
  return buildMetric(
    "context-capsule",
    sourceInstance,
    artifact.responsibilityMappings.requested,
    artifact.responsibilityMappings.operational,
    artifact.responsibilityMappings.mappings
  );
}

export function calculateRetrievalAuditResponsibilityMappingMetric(
  artifact: RetrievalAuditRecord,
  sourceInstance: string
): StageContextResponsibilityMappingMetricV1 {
  return buildMetric(
    "retrieval-audit-record",
    sourceInstance,
    artifact.responsibilityMappings.requested,
    artifact.responsibilityMappings.operational,
    artifact.responsibilityMappings.mappings
  );
}
