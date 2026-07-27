// v0.4.4 Batch 2: owner-selection evidence metrics. The lab never selects owners itself --
// it only reads the canonical owner identities the frozen my-dev-kit producer already
// selected (ContextCapsule.selectedOwners / RetrievalAuditRecord.selectedOwners) and
// compares them against explicit fixture owner expectations.
import type { EvidenceItemRef } from "../upstreamArtifacts/index.js";
import type { ProducerReadinessOwnerExpectationV1 } from "../stageContextExpectations/index.js";
import type { StageContextCountMetricV1, StageContextRatioMetricV1 } from "./types.js";
import type { OwnerMetricsV1, SelectedOwnerEvidenceV1 } from "./producerReadinessMetricTypes.js";

export function collectSelectedOwnerEvidence(
  selectedOwners: readonly EvidenceItemRef[],
  sourceArtifact: "context-capsule" | "retrieval-audit-record",
  sourceInstance: string
): SelectedOwnerEvidenceV1[] {
  return selectedOwners.map((item) => ({
    ownerId: item.id,
    sourceArtifact,
    sourceInstance,
    itemKind: item.itemKind,
    path: item.path ?? null,
    symbolId: item.symbolId ?? null,
    sourceFieldPath: `${sourceInstance}.selectedOwners`
  }));
}

function notApplicableRatio(reason: string): StageContextRatioMetricV1 {
  return { availability: "not-applicable", numerator: null, denominator: null, rate: null, matchedExpectationIds: [], missingExpectationIds: [], reason };
}

function unavailableRatio(reason: string): StageContextRatioMetricV1 {
  return { availability: "unavailable", numerator: null, denominator: null, rate: null, matchedExpectationIds: [], missingExpectationIds: [], reason };
}

function notApplicableCount(reason: string): StageContextCountMetricV1 {
  return { availability: "not-applicable", count: null, evidenceKeys: [], reason };
}

function unavailableCount(reason: string): StageContextCountMetricV1 {
  return { availability: "unavailable", count: null, evidenceKeys: [], reason };
}

export function calculateOwnerMetrics(
  selectedOwnerEvidence: readonly SelectedOwnerEvidenceV1[] | undefined,
  ownerExpectations: readonly ProducerReadinessOwnerExpectationV1[] | undefined
): OwnerMetricsV1 {
  const evidence = selectedOwnerEvidence ?? [];
  const evidenceUnavailable = selectedOwnerEvidence === undefined;
  const unavailableReason = "Producer selected-owner evidence was not supplied to this metric.";

  const requiredIds = new Set(
    (ownerExpectations ?? []).filter((e) => e.inclusion === "required").map((e) => e.ownerId)
  );
  const allowedIds = new Set(
    (ownerExpectations ?? []).filter((e) => e.inclusion === "allowed").map((e) => e.ownerId)
  );
  const forbiddenIds = new Set(
    (ownerExpectations ?? []).filter((e) => e.inclusion === "forbidden").map((e) => e.ownerId)
  );
  const hasClosedSet = requiredIds.size > 0 || allowedIds.size > 0;
  const observedIds = new Set(evidence.map((e) => e.ownerId));

  const expectedOwnerPresent: StageContextRatioMetricV1 = evidenceUnavailable
    ? unavailableRatio(unavailableReason)
    : requiredIds.size === 0
      ? notApplicableRatio("The expectation fixture contains no required owner expectations.")
      : (() => {
          const matched = [...requiredIds].filter((id) => observedIds.has(id));
          const missing = [...requiredIds].filter((id) => !observedIds.has(id));
          return {
            availability: "available",
            numerator: matched.length,
            denominator: requiredIds.size,
            rate: matched.length / requiredIds.size,
            matchedExpectationIds: matched,
            missingExpectationIds: missing,
            reason: null
          };
        })();

  const forbiddenOwnerPresent: StageContextRatioMetricV1 = evidenceUnavailable
    ? unavailableRatio(unavailableReason)
    : forbiddenIds.size === 0
      ? notApplicableRatio("The expectation fixture contains no forbidden owner expectations.")
      : (() => {
          const present = [...forbiddenIds].filter((id) => observedIds.has(id));
          const absent = [...forbiddenIds].filter((id) => !observedIds.has(id));
          return {
            availability: "available",
            numerator: present.length,
            denominator: forbiddenIds.size,
            rate: present.length / forbiddenIds.size,
            matchedExpectationIds: present,
            missingExpectationIds: absent,
            reason: null
          };
        })();

  const falsePositiveCount: StageContextCountMetricV1 = evidenceUnavailable
    ? unavailableCount(unavailableReason)
    : !hasClosedSet && forbiddenIds.size === 0
      ? notApplicableCount("The expectation fixture defines neither a closed owner set nor forbidden owners.")
      : (() => {
          const falsePositives = [...observedIds].filter(
            (id) => forbiddenIds.has(id) || (hasClosedSet && !requiredIds.has(id) && !allowedIds.has(id))
          );
          return { availability: "available", count: falsePositives.length, evidenceKeys: falsePositives, reason: null };
        })();

  const falseNegativeCount: StageContextCountMetricV1 = evidenceUnavailable
    ? unavailableCount(unavailableReason)
    : requiredIds.size === 0
      ? notApplicableCount("The expectation fixture contains no required owner expectations.")
      : (() => {
          const falseNegatives = [...requiredIds].filter((id) => !observedIds.has(id));
          return { availability: "available", count: falseNegatives.length, evidenceKeys: falseNegatives, reason: null };
        })();

  return { selectedOwnerEvidence: [...evidence], expectedOwnerPresent, forbiddenOwnerPresent, falsePositiveCount, falseNegativeCount };
}
