// v0.4.4 Batch 2: criticality-overlay and mapped-critical-responsibility-completeness
// metrics. Reads only the already-preserved raw ResponsibilityMapping evidence
// (criticality + mappingStatus) my-dev-kit's own producer already computed; the lab never
// infers criticality from responsibility names and never reimplements the orchestrator's
// TestStrategyPacket criticality overlay.
import type { ResponsibilityMapping } from "../upstreamArtifacts/index.js";
import type { ProducerReadinessCriticalityExpectationV1 } from "../stageContextExpectations/index.js";
import type { CriticalityMetricsV1, CriticalityOverlayEntryV1 } from "./producerReadinessMetricTypes.js";

function findMapping(
  mappings: readonly ResponsibilityMapping[] | undefined,
  responsibilityId: string
): ResponsibilityMapping | undefined {
  return mappings?.find((m) => m.responsibilityId === responsibilityId);
}

export function calculateCriticalityMetrics(
  mappings: readonly ResponsibilityMapping[] | undefined,
  expectations: readonly ProducerReadinessCriticalityExpectationV1[] | undefined
): CriticalityMetricsV1 {
  const list = expectations ?? [];

  const overlayAgreement: CriticalityOverlayEntryV1[] = [];
  const missingCriticalityResponsibilityIds: string[] = [];
  const conflictingCriticalityResponsibilityIds: string[] = [];

  for (const e of list) {
    if (!e.applicable) {
      overlayAgreement.push({
        responsibilityId: e.responsibilityId,
        expectedCriticality: e.expectedCriticality,
        observedCriticality: findMapping(mappings, e.responsibilityId)?.criticality ?? null,
        agreement: null,
        availability: "not-applicable",
        reason: "Expectation is marked not applicable."
      });
      continue;
    }
    if (mappings === undefined) {
      overlayAgreement.push({
        responsibilityId: e.responsibilityId,
        expectedCriticality: e.expectedCriticality,
        observedCriticality: null,
        agreement: null,
        availability: "unavailable",
        reason: "No raw responsibility-mapping evidence was supplied."
      });
      missingCriticalityResponsibilityIds.push(e.responsibilityId);
      continue;
    }
    const mapping = findMapping(mappings, e.responsibilityId);
    if (mapping === undefined) {
      overlayAgreement.push({
        responsibilityId: e.responsibilityId,
        expectedCriticality: e.expectedCriticality,
        observedCriticality: null,
        agreement: null,
        availability: "unavailable",
        reason: "No raw mapping entry exists for this responsibility ID."
      });
      missingCriticalityResponsibilityIds.push(e.responsibilityId);
      continue;
    }
    const agreement = mapping.criticality === e.expectedCriticality;
    overlayAgreement.push({
      responsibilityId: e.responsibilityId,
      expectedCriticality: e.expectedCriticality,
      observedCriticality: mapping.criticality,
      agreement,
      availability: "available",
      reason: null
    });
    if (!agreement) conflictingCriticalityResponsibilityIds.push(e.responsibilityId);
  }

  const unexpectedCriticalityResponsibilityIds: string[] =
    list.length === 0 || mappings === undefined
      ? []
      : mappings.filter((m) => !list.some((e) => e.responsibilityId === m.responsibilityId)).map((m) => m.responsibilityId);

  const fullyMappedCriticalIds: string[] = [];
  const partiallyMappedCriticalIds: string[] = [];
  const unmappedCriticalIds: string[] = [];
  const missingMappingEvidenceCriticalIds: string[] = [];

  for (const e of list) {
    if (!e.applicable || !e.requiresFullMapping || e.expectedCriticality !== "critical") continue;
    const mapping = findMapping(mappings, e.responsibilityId);
    if (mapping === undefined) {
      missingMappingEvidenceCriticalIds.push(e.responsibilityId);
      continue;
    }
    if (mapping.mappingStatus === "mapped") fullyMappedCriticalIds.push(e.responsibilityId);
    else if (mapping.mappingStatus === "partially-mapped") partiallyMappedCriticalIds.push(e.responsibilityId);
    else if (mapping.mappingStatus === "unmapped") unmappedCriticalIds.push(e.responsibilityId);
    // mapping.mappingStatus === "not-applicable": excluded from the denominator entirely.
  }

  const denominator = fullyMappedCriticalIds.length + partiallyMappedCriticalIds.length + unmappedCriticalIds.length;
  const mappedCriticalCompleteness =
    denominator === 0
      ? {
          availability: "not-applicable" as const,
          numerator: null,
          denominator: null,
          rate: null,
          matchedExpectationIds: [],
          missingExpectationIds: [],
          reason: "No applicable critical responsibility requiring full mapping has resolvable mapping status."
        }
      : {
          availability: "available" as const,
          numerator: fullyMappedCriticalIds.length,
          denominator,
          rate: fullyMappedCriticalIds.length / denominator,
          matchedExpectationIds: fullyMappedCriticalIds,
          missingExpectationIds: [...partiallyMappedCriticalIds, ...unmappedCriticalIds],
          reason: null
        };

  return {
    overlayAgreement,
    missingCriticalityResponsibilityIds,
    conflictingCriticalityResponsibilityIds,
    unexpectedCriticalityResponsibilityIds,
    mappedCriticalCompleteness,
    fullyMappedCriticalIds,
    partiallyMappedCriticalIds,
    unmappedCriticalIds,
    missingMappingEvidenceCriticalIds
  };
}
