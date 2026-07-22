import type { StageContextExpectationFixtureV1 } from "../stageContextExpectations/index.js";
import { buildStageContextExpectationTargetKey } from "./targetKeys.js";
import type {
  StageContextCountMetricV1,
  StageContextExpectationMatchOutcome,
  StageContextExpectationMatchV1,
  StageContextObservedEvidenceV1,
  StageContextRatioMetricV1
} from "./types.js";

const INSTRUCTION_CATEGORIES = ["workflow", "stage", "command", "rule", "report-contract"];

function buildRatioMetric(
  filtered: readonly StageContextExpectationMatchV1[],
  targetOutcome: StageContextExpectationMatchOutcome,
  notApplicableReason: string
): StageContextRatioMetricV1 {
  if (filtered.length === 0) {
    return {
      availability: "not-applicable",
      numerator: null,
      denominator: null,
      rate: null,
      matchedExpectationIds: [],
      missingExpectationIds: [],
      reason: notApplicableReason
    };
  }

  const matchedExpectationIds: string[] = [];
  const missingExpectationIds: string[] = [];
  for (const match of filtered) {
    if (match.outcome === targetOutcome) {
      matchedExpectationIds.push(match.expectationId);
    } else {
      missingExpectationIds.push(match.expectationId);
    }
  }

  return {
    availability: "available",
    numerator: matchedExpectationIds.length,
    denominator: filtered.length,
    rate: matchedExpectationIds.length / filtered.length,
    matchedExpectationIds,
    missingExpectationIds,
    reason: null
  };
}

export function calculateRequiredEvidenceRecall(matches: readonly StageContextExpectationMatchV1[]): StageContextRatioMetricV1 {
  const filtered = matches.filter((match) => match.inclusion === "required");
  return buildRatioMetric(filtered, "matched", "The expectation fixture contains no required evidence items.");
}

export function calculateAllowedEvidenceCoverage(matches: readonly StageContextExpectationMatchV1[]): StageContextRatioMetricV1 {
  const filtered = matches.filter((match) => match.inclusion === "allowed");
  return buildRatioMetric(filtered, "matched", "The expectation fixture contains no allowed evidence items.");
}

export function calculateForbiddenEvidenceInclusion(matches: readonly StageContextExpectationMatchV1[]): StageContextRatioMetricV1 {
  const filtered = matches.filter((match) => match.inclusion === "forbidden");
  return buildRatioMetric(filtered, "violated", "The expectation fixture contains no forbidden evidence items.");
}

export function calculateRequiredProvenanceRecall(matches: readonly StageContextExpectationMatchV1[]): StageContextRatioMetricV1 {
  const filtered = matches.filter((match) => match.inclusion === "required" && match.category === "provenance");
  return buildRatioMetric(filtered, "matched", "The expectation fixture contains no required provenance items.");
}

export function calculateIrrelevantFileInclusion(
  expectations: StageContextExpectationFixtureV1,
  observedEvidence: readonly StageContextObservedEvidenceV1[]
): StageContextCountMetricV1 {
  const fileEvidence = observedEvidence.filter(
    (evidence) => evidence.sourceArtifact === "context-capsule" && evidence.category === "file"
  );
  if (fileEvidence.length === 0) {
    return {
      availability: "not-applicable",
      count: null,
      evidenceKeys: [],
      reason: "The completed strategy contains no context-capsule file evidence."
    };
  }

  const coveredKeys = new Set(
    expectations.expectedEvidence
      .filter(
        (item) =>
          item.sourceArtifact === "context-capsule" &&
          item.category === "file" &&
          (item.inclusion === "required" || item.inclusion === "allowed")
      )
      .map((item) => buildStageContextExpectationTargetKey(item))
  );

  const seen = new Set<string>();
  const evidenceKeys: string[] = [];
  for (const evidence of fileEvidence) {
    if (coveredKeys.has(evidence.targetKey)) continue;
    if (seen.has(evidence.targetKey)) continue;
    seen.add(evidence.targetKey);
    evidenceKeys.push(evidence.targetKey);
  }

  return { availability: "available", count: evidenceKeys.length, evidenceKeys, reason: null };
}

export function calculateIrrelevantInstructionInclusion(
  expectations: StageContextExpectationFixtureV1,
  observedEvidence: readonly StageContextObservedEvidenceV1[]
): StageContextCountMetricV1 {
  const instructionEvidence = observedEvidence.filter(
    (evidence) =>
      (evidence.sourceArtifact === "workflow-instruction-packet" || evidence.sourceArtifact === "full-workflow-library") &&
      INSTRUCTION_CATEGORIES.includes(evidence.category)
  );
  if (instructionEvidence.length === 0) {
    return {
      availability: "not-applicable",
      count: null,
      evidenceKeys: [],
      reason: "The completed strategy contains no workflow instruction evidence."
    };
  }

  const coveredKeys = new Set(
    expectations.expectedEvidence
      .filter(
        (item) => INSTRUCTION_CATEGORIES.includes(item.category) && (item.inclusion === "required" || item.inclusion === "allowed")
      )
      .map((item) => buildStageContextExpectationTargetKey(item))
  );

  const seen = new Set<string>();
  const evidenceKeys: string[] = [];
  for (const evidence of instructionEvidence) {
    if (coveredKeys.has(evidence.targetKey)) continue;
    if (seen.has(evidence.targetKey)) continue;
    seen.add(evidence.targetKey);
    evidenceKeys.push(evidence.targetKey);
  }

  return { availability: "available", count: evidenceKeys.length, evidenceKeys, reason: null };
}
