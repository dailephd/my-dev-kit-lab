// v0.4.5 Batch 5: builds the bounded ContextIntegrityReportV1 from already-calculated
// Batch 1-4 results. Never recalculates allocation, condition coverage, agreement states,
// hashes, determinism, or immutability -- it only bounds and reshapes values the caller
// already computed via evaluateProducerReadinessBridge, verifyFixtureHashes, and
// calculateStageContextDeterminism.
import { V043_REPORT_DETAIL_LIMIT, type V043BoundedReportListV1 } from "./contextStrategyComparisonV043ReportModel.js";
import type {
  ContextIntegrityFixtureKind,
  ContextIntegrityReportAgreementV1,
  ContextIntegrityReportContradictionV1,
  ContextIntegrityReportV1
} from "./contextIntegrityReportModel.js";
import type { ContextCapsule, RetrievalAuditRecord } from "../../evaluation/upstreamArtifacts/index.js";
import type { ProducerReadinessBridgeEvaluationResultV1 } from "../../evaluation/stageContextMetrics/evaluateProducerReadinessBridge.js";
import type { EcosystemFixtureManifestV1 } from "../../evaluation/ecosystemFixtures/manifestTypes.js";
import type { FixtureHashVerificationResult } from "../../evaluation/ecosystemFixtures/verifyFixtureHashes.js";
import type { StageContextDeterminismResultV1 } from "../../evaluation/stageContextDeterminism/types.js";
import type { RunIntegrityContradictionEvidenceV1, RunIntegrityEvaluationV1 } from "../../evaluation/stageContextMetrics/runIntegrityAgreementTypes.js";
import type { AgreementOutcomeV1 } from "../../evaluation/stageContextMetrics/producerReadinessMetricTypes.js";

const CORRECTED_REPLAY_LIMITATION =
  "This corrected-replay fixture is a hand-distilled representation of the exact validated local my-dev-kit v1.10.4 and my-dev-kit-orchestrator v1.2.3 contracts, applied to the same request, target, and active-index identity as the paired failed-run fixture. It is not a live capture of a complete ten-stage AI-authored implementation workflow, and it is not proof that every future run against these contracts will behave identically.";

function boundItems<T>(source: readonly T[], limit = V043_REPORT_DETAIL_LIMIT): V043BoundedReportListV1<T> {
  const items = source.slice(0, limit);
  return { totalCount: source.length, displayedCount: items.length, omittedCount: source.length - items.length, items };
}

function toContradiction(c: RunIntegrityContradictionEvidenceV1): ContextIntegrityReportContradictionV1 {
  return { code: c.code, fieldPath: c.fieldPath, expected: c.expected, observed: c.observed, reason: c.reason };
}

function agreementFromRunIntegrity(component: {
  availability: string;
  outcome: AgreementOutcomeV1;
  contradictions: RunIntegrityContradictionEvidenceV1[];
  reason: string | null;
}): ContextIntegrityReportAgreementV1 {
  return {
    availability: component.availability as ContextIntegrityReportAgreementV1["availability"],
    outcome: component.outcome,
    contradictions: boundItems(component.contradictions.map(toContradiction)),
    reason: component.reason
  };
}

function unavailableAgreement(reason: string): ContextIntegrityReportAgreementV1 {
  return { availability: "unavailable", outcome: "insufficient-evidence", contradictions: boundItems([]), reason };
}

export interface BuildContextIntegrityReportInput {
  fixtureKind: ContextIntegrityFixtureKind;
  manifest: EcosystemFixtureManifestV1;
  hashVerification: FixtureHashVerificationResult;
  capsule: ContextCapsule | null;
  audit: RetrievalAuditRecord | null;
  bridgeResult: ProducerReadinessBridgeEvaluationResultV1;
  determinism?: StageContextDeterminismResultV1;
  fixtureSelfImmutable?: boolean;
  fixtureSelfImmutableReason?: string;
}

export function buildContextIntegrityReport(input: BuildContextIntegrityReportInput): ContextIntegrityReportV1 {
  const { manifest, hashVerification, capsule, bridgeResult } = input;
  const side = bridgeResult.implementation ?? bridgeResult.testImplementation;
  const runIntegrity: RunIntegrityEvaluationV1 | null = bridgeResult.runIntegrityEvaluation;

  const derivedCount = manifest.artifacts.filter((a) => a.derived).length;
  const byteExactCount = manifest.artifacts.filter((a) => a.byteExact).length;

  const allocationAgg = side?.groupAllocationEvaluation.aggregate ?? null;
  const spillover = side?.groupAllocationEvaluation.spillover ?? null;
  const conditionCoverage = side?.conditionCoverageEvaluation ?? null;
  const conditionAwareTruncation = side?.conditionAwareTruncationEvaluation ?? null;

  const unavailableSections: string[] = [];
  const notes: string[] = [];
  if (!side) unavailableSections.push("producer");
  if (!runIntegrity) unavailableSections.push("run-integrity");
  if (conditionCoverage?.availability !== "available") unavailableSections.push("condition-coverage");

  return {
    schemaVersion: "1.0.0",
    detailLimit: V043_REPORT_DETAIL_LIMIT,
    fixture: {
      fixtureId: manifest.fixtureId,
      kind: input.fixtureKind,
      description: manifest.description,
      myDevKitCommit: manifest.myDevKit.commit,
      orchestratorCommit: manifest.orchestrator.commit,
      targetRepositoryIdentity: manifest.targetRepositoryIdentity,
      activeIndexIdentity: manifest.activeIndexIdentity,
      manifestSchemaVersion: manifest.manifestSchemaVersion,
      trackedArtifactCount: manifest.artifacts.length,
      derivedArtifactCount: derivedCount,
      byteExactArtifactCount: byteExactCount,
      artifacts: boundItems(
        manifest.artifacts.map((a) => ({
          fixtureRelativePath: a.fixtureRelativePath,
          role: a.role,
          derived: a.derived,
          byteExact: a.byteExact,
          provenanceOnly: a.provenanceOnly
        }))
      ),
      hashVerification: {
        ok: hashVerification.ok,
        checkedCount: hashVerification.checkedCount,
        issues: boundItems(hashVerification.issues.map((i) => ({ code: i.code, fixtureRelativePath: i.fixtureRelativePath, message: i.message })))
      },
      correctedReplayLimitation: input.fixtureKind === "corrected-replay" ? CORRECTED_REPLAY_LIMITATION : ""
    },
    producerIdentity: {
      toolName: capsule?.tool.name ?? null,
      toolVersion: capsule?.tool.version ?? null,
      role: capsule?.request.role ?? null,
      projectRoot: capsule?.index.projectRoot ?? null,
      indexPath: capsule?.index.indexPath ?? null,
      roleAdequacyStatus: capsule?.roleAdequacy.status ?? null
    },
    allocation: {
      availability: allocationAgg?.availability ?? "unavailable",
      groupCount: allocationAgg?.groupCount ?? 0,
      totalRequiredOmitted: allocationAgg?.totalRequiredOmitted ?? null,
      totalOptionalOmitted: allocationAgg?.totalOptionalOmitted ?? null,
      aggregateCapacityUsed: null,
      aggregateCapacityRemaining: null,
      groupsWithRequiredOmission: allocationAgg?.groupsWithRequiredOmission ?? [],
      groupsWithOptionalOnlyOmission: allocationAgg?.groupsWithOptionalOnlyOmission ?? [],
      perGroup: boundItems(
        (side?.groupAllocationEvaluation.perGroup ?? []).map((g) => ({
          groupId: g.groupId,
          availability: g.availability,
          required: g.required,
          reservation: g.reservation,
          initiallySelectedCount: g.initiallySelectedCount,
          unusedReservationContributed: g.unusedReservationContributed,
          borrowedCapacity: g.borrowedCapacity,
          requiredOmittedCount: g.requiredOmittedCount,
          optionalOmittedCount: g.optionalOmittedCount,
          adequacyAffected: g.adequacyAffected
        }))
      )
    },
    spillover: {
      availability: spillover?.availability ?? "unavailable",
      groupsContributing: spillover?.groupsContributing ?? [],
      groupsBorrowing: spillover?.groupsBorrowing ?? [],
      totalContributed: spillover?.totalContributed ?? null,
      totalBorrowed: spillover?.totalBorrowed ?? null,
      contributionCoversBorrowing: spillover?.contributionCoversBorrowing ?? null,
      reason: spillover?.reason ?? null
    },
    truncation: {
      availability: conditionAwareTruncation?.availability ?? "unavailable",
      state: conditionAwareTruncation?.state ?? "unsupported-legacy-diagnostics",
      requiredEvidenceLost: conditionAwareTruncation?.requiredEvidenceLost ?? null,
      requiredOmittedTotal: conditionAwareTruncation?.requiredOmittedTotal ?? null,
      optionalOmittedTotal: conditionAwareTruncation?.optionalOmittedTotal ?? null,
      lostRequiredConditionIds: conditionAwareTruncation?.lostRequiredConditionIds ?? [],
      contradictions: boundItems((conditionAwareTruncation?.contradictionCodes ?? []).map((code) => ({ code, fieldPath: "truncation", expected: null, observed: null, reason: conditionAwareTruncation?.reason ?? "" })))
    },
    conditionCoverage: {
      availability: conditionCoverage?.availability ?? "unavailable",
      requiredConditionsTotal: conditionCoverage?.requiredConditionsTotal.count ?? null,
      requiredConditionsSatisfied: conditionCoverage?.requiredConditionsSatisfied.count ?? null,
      requiredConditionsMissing: conditionCoverage?.requiredConditionsMissing.evidenceKeys ?? [],
      requiredConditionsLost: conditionCoverage?.requiredConditionsLost.evidenceKeys ?? [],
      lastWitnessLossCount: conditionCoverage?.lastWitnessLoss.count ?? null,
      witnessEvidence: boundItems(
        (conditionCoverage?.witnessEvidence ?? []).map((w) => ({
          conditionId: w.conditionId,
          required: w.required,
          coverageState: w.coverageState,
          retainedWitnessCount: w.retainedWitnessCount,
          retainedWitnessIds: boundItems(w.retainedWitnessIds),
          adequateWitnessRemains: w.adequateWitnessRemains,
          lossReason: w.lossReason,
          evidenceGroupIds: w.evidenceGroupIds
        }))
      ),
      reason: conditionCoverage?.reason ?? null
    },
    producerConditionAgreement: side
      ? {
          availability: side.producerConditionAgreement.availability,
          outcome: side.producerConditionAgreement.outcome,
          contradictions: boundItems(
            side.producerConditionAgreement.contradictionCodes.map((code) => ({ code, fieldPath: "roleAdequacy", expected: null, observed: null, reason: side.producerConditionAgreement.reason ?? "" }))
          ),
          reason: side.producerConditionAgreement.reason
        }
      : unavailableAgreement("No producer side was supplied."),
    requiredEvidenceLossAgreement: side
      ? {
          availability: side.requiredEvidenceLossAgreement.availability,
          outcome: side.requiredEvidenceLossAgreement.outcome,
          contradictions: boundItems(
            side.requiredEvidenceLossAgreement.contradictionCodes.map((code) => ({ code, fieldPath: "truncation.requiredEvidenceLost", expected: null, observed: null, reason: side.requiredEvidenceLossAgreement.reason ?? "" }))
          ),
          reason: side.requiredEvidenceLossAgreement.reason
        }
      : unavailableAgreement("No producer side was supplied."),
    capsuleAuditAgreement: side
      ? {
          availability: side.capsuleAuditConditionAgreement.availability,
          consistent: side.capsuleAuditConditionAgreement.consistent,
          contradictingFieldPaths: side.capsuleAuditConditionAgreement.contradictingFieldPaths
        }
      : { availability: "unavailable", consistent: null, contradictingFieldPaths: [] },
    supplementalRawAgreement:
      side?.packetAgreement || side?.reportAgreement
        ? {
            availability: "available",
            contradictingFields: [...(side.packetAgreement?.contradictions ?? []), ...(side.reportAgreement?.contradictions ?? [])].map((f) => f.field),
            upstreamProducerParityPreserved: side.packetAgreement?.upstreamProducerParityPreserved ?? side.reportAgreement?.upstreamProducerParityPreserved ?? null
          }
        : null,
    producerReadinessAgreement: bridgeResult.producerReadinessRelationship
      ? {
          availability: bridgeResult.producerReadinessRelationship.availability,
          outcome: bridgeResult.producerReadinessRelationship.outcome,
          contradictions: boundItems(
            bridgeResult.producerReadinessRelationship.contradictionCodes.map((code) => ({ code, fieldPath: "readiness", expected: null, observed: null, reason: bridgeResult.producerReadinessRelationship!.reason ?? "" }))
          ),
          reason: bridgeResult.producerReadinessRelationship.reason
        }
      : unavailableAgreement("No producer/readiness relationship was calculated."),
    readinessPromptAgreement: runIntegrity ? agreementFromRunIntegrity(runIntegrity.readinessPrompt) : unavailableAgreement("No run-integrity evidence was supplied."),
    readinessExpectedJudgeAgreement: runIntegrity ? agreementFromRunIntegrity(runIntegrity.readinessExpectedJudge) : unavailableAgreement("No run-integrity evidence was supplied."),
    expectedActualJudgeAgreement: runIntegrity ? agreementFromRunIntegrity(runIntegrity.expectedActualJudge) : unavailableAgreement("No run-integrity evidence was supplied."),
    judgeCorrectionAgreement: runIntegrity ? agreementFromRunIntegrity(runIntegrity.judgeCorrection) : unavailableAgreement("No run-integrity evidence was supplied."),
    judgeFinalEligibilityAgreement: runIntegrity ? agreementFromRunIntegrity(runIntegrity.judgeFinalEligibility) : unavailableAgreement("No run-integrity evidence was supplied."),
    eligibilityFinalArtifactAgreement: runIntegrity ? agreementFromRunIntegrity(runIntegrity.eligibilityFinalArtifact) : unavailableAgreement("No run-integrity evidence was supplied."),
    lifecycleIntegrityAgreement: runIntegrity ? agreementFromRunIntegrity(runIntegrity.lifecycleIntegrity) : unavailableAgreement("No run-integrity evidence was supplied."),
    endToEnd: runIntegrity
      ? { category: runIntegrity.endToEndSummary.category, componentOutcomes: runIntegrity.endToEndSummary.componentOutcomes, contradictingComponents: runIntegrity.endToEndSummary.contradictingComponents }
      : null,
    determinism: input.determinism
      ? {
          availability: input.determinism.availability,
          repeatCount: input.determinism.repeatCount,
          deterministic: input.determinism.deterministic,
          baselineSha256: input.determinism.baselineSha256,
          mismatchRunNumbers: input.determinism.mismatchRunNumbers,
          reason: input.determinism.reason
        }
      : { availability: "not-applicable", repeatCount: 1, deterministic: null, baselineSha256: null, mismatchRunNumbers: [], reason: "Determinism was not evaluated for this report." },
    immutability: {
      fixtureSelfImmutable: input.fixtureSelfImmutable ?? null,
      fixtureImmutabilityReason: input.fixtureSelfImmutableReason ?? (input.fixtureSelfImmutable === undefined ? "Fixture self-immutability was not checked for this report." : null)
    },
    limitations: { unavailableSections, notes }
  };
}
