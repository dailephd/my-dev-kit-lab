// v0.4.5 Batch 3: bounded pure selectors over OrchestratorRunIntegrityEvidenceV1. Each
// selector returns the exact upstream value (or undefined/null when the upstream field is
// itself absent/null) -- none defaults a missing field, and none interprets policy.
import type { JudgeVerdictParseStatus, OrchestratorRunIntegrityEvidenceV1 } from "../upstreamArtifacts/index.js";

export function selectReadinessClassification(
  evidence: OrchestratorRunIntegrityEvidenceV1
): OrchestratorRunIntegrityEvidenceV1["gate"]["readinessClassification"] {
  return evidence.gate.readinessClassification;
}

export function selectContextReady(evidence: OrchestratorRunIntegrityEvidenceV1): boolean {
  return evidence.gate.contextReady;
}

export function selectBlockingCodes(evidence: OrchestratorRunIntegrityEvidenceV1): readonly string[] {
  return evidence.gate.blockingCodes;
}

export function selectRecommendedCorrectionStage(evidence: OrchestratorRunIntegrityEvidenceV1): string | null {
  return evidence.gate.recommendedCorrectionStage;
}

export function selectExpectedJudgeVerdict(
  evidence: OrchestratorRunIntegrityEvidenceV1
): OrchestratorRunIntegrityEvidenceV1["gate"]["expectedJudgeVerdict"] {
  return evidence.gate.expectedJudgeVerdict;
}

// Prompt mode is not a field the exact v1.2.3 gate contract exposes as a literal string --
// it is a derived per-stage decision (evaluateStageRunIntegrity()). The lab represents it
// via the same contextReady/blockedStageNames facts the gate already exposes rather than
// inventing a separate "promptMode" string the upstream contract does not itself declare.
export function selectStageMayRenderNormalPrompt(
  evidence: OrchestratorRunIntegrityEvidenceV1,
  stageName: string
): boolean | undefined {
  const contextSensitive = evidence.gate.blockedStageNames.length > 0 || stageName === "implementation" || stageName === "test-implementation";
  if (!contextSensitive) return undefined;
  return !evidence.gate.blockedStageNames.includes(stageName as "implementation" | "test-implementation");
}

export function selectJudgeArtifactPresent(evidence: OrchestratorRunIntegrityEvidenceV1): boolean | undefined {
  return evidence.judgeIntegrity?.judgeArtifactPresent;
}

export function selectJudgeVerdictParseStatus(evidence: OrchestratorRunIntegrityEvidenceV1): JudgeVerdictParseStatus | undefined {
  return evidence.judgeIntegrity?.judgeVerdictParseStatus;
}

export function selectAuthoredJudgeVerdict(evidence: OrchestratorRunIntegrityEvidenceV1) {
  return evidence.judgeIntegrity?.authoredJudgeVerdict;
}

export function selectJudgeVerdictMatchesExpected(evidence: OrchestratorRunIntegrityEvidenceV1): boolean | undefined {
  return evidence.judgeIntegrity?.judgeVerdictMatchesExpected;
}

export function selectJudgeVerdictAccepted(evidence: OrchestratorRunIntegrityEvidenceV1): boolean | undefined {
  return evidence.judgeIntegrity?.judgeVerdictAccepted;
}

export function selectAcceptedCorrectionStage(evidence: OrchestratorRunIntegrityEvidenceV1): string | null | undefined {
  return evidence.judgeIntegrity?.acceptedCorrectionStage;
}

export function selectAcceptedCorrectionRoute(evidence: OrchestratorRunIntegrityEvidenceV1) {
  return evidence.judgeIntegrity?.acceptedCorrectionRoute;
}

export function selectJudgeFinalReportEligible(evidence: OrchestratorRunIntegrityEvidenceV1): boolean | undefined {
  return evidence.judgeIntegrity?.finalReportEligible;
}

export function selectFinalReportEligible(evidence: OrchestratorRunIntegrityEvidenceV1): boolean | undefined {
  return evidence.finalReportEligibility?.eligible;
}

export function selectFinalArtifactPresent(evidence: OrchestratorRunIntegrityEvidenceV1): boolean | undefined {
  return evidence.finalArtifactPresent;
}

export function selectFinalArtifactVerdict(evidence: OrchestratorRunIntegrityEvidenceV1) {
  return evidence.finalArtifactVerdict;
}

export function selectLifecycleEntries(evidence: OrchestratorRunIntegrityEvidenceV1) {
  return evidence.lifecycle;
}

export function selectLifecycleEntryForStage(evidence: OrchestratorRunIntegrityEvidenceV1, stageName: string) {
  return evidence.lifecycle.find((entry) => entry.stageName === stageName);
}
