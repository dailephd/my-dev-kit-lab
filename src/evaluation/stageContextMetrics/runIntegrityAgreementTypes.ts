// v0.4.5 Batch 3: bounded agreement-result shapes for orchestrator run-integrity evidence.
// Reuses the Batch 2 AgreementOutcomeV1 vocabulary (agreement/contradiction/
// insufficient-evidence/unsupported-legacy-evidence/not-applicable) rather than inventing a
// second availability or agreement-outcome model. No composite score, grade, ranking, or
// competing release verdict exists anywhere in this file.
import type { AgreementOutcomeV1 } from "./producerReadinessMetricTypes.js";

export interface RunIntegrityContradictionEvidenceV1 {
  code: string;
  fieldPath: string;
  expected: string | null;
  observed: string | null;
  reason: string;
}

export interface ReadinessPromptAgreementV1 {
  availability: "available" | "unavailable" | "not-applicable";
  outcome: AgreementOutcomeV1;
  readinessClassification: string | null;
  stageMayRenderNormalPrompt: boolean | null;
  contradictions: RunIntegrityContradictionEvidenceV1[];
  reason: string | null;
}

export interface ReadinessExpectedJudgeAgreementV1 {
  availability: "available" | "unavailable";
  outcome: AgreementOutcomeV1;
  contextReady: boolean | null;
  expectedJudgeVerdict: string | null;
  contradictions: RunIntegrityContradictionEvidenceV1[];
  reason: string | null;
}

export interface ExpectedActualJudgeAgreementV1 {
  availability: "available" | "unavailable";
  outcome: AgreementOutcomeV1;
  expectedJudgeVerdict: string | null;
  authoredJudgeVerdict: string | null;
  judgeVerdictParseStatus: string | null;
  judgeVerdictAccepted: boolean | null;
  contradictions: RunIntegrityContradictionEvidenceV1[];
  reason: string | null;
}

export interface JudgeCorrectionAgreementV1 {
  availability: "available" | "unavailable";
  outcome: AgreementOutcomeV1;
  authoredJudgeVerdict: string | null;
  correctionRequired: boolean | null;
  acceptedCorrectionStage: string | null;
  routedStage: string | null;
  contradictions: RunIntegrityContradictionEvidenceV1[];
  reason: string | null;
}

export interface JudgeFinalEligibilityAgreementV1 {
  availability: "available" | "unavailable";
  outcome: AgreementOutcomeV1;
  authoredJudgeVerdict: string | null;
  judgeVerdictAccepted: boolean | null;
  judgeVerdictMatchesExpected: boolean | null;
  finalReportEligible: boolean | null;
  contradictions: RunIntegrityContradictionEvidenceV1[];
  reason: string | null;
}

export interface EligibilityFinalArtifactAgreementV1 {
  availability: "available" | "unavailable";
  outcome: AgreementOutcomeV1;
  eligible: boolean | null;
  finalArtifactPresent: boolean | null;
  finalArtifactVerdict: string | null;
  contradictions: RunIntegrityContradictionEvidenceV1[];
  reason: string | null;
}

export interface LifecycleEntryIntegrityV1 {
  artifactFile: string;
  stageName: string;
  resolvedState: string;
  completionBasis: "manual-record" | "artifact-presence-only" | "not-complete";
  markCompleteRejected: boolean;
  bypassSucceeded: boolean;
}

export interface LifecycleIntegrityAgreementV1 {
  availability: "available" | "unavailable" | "not-applicable";
  outcome: AgreementOutcomeV1;
  entries: LifecycleEntryIntegrityV1[];
  contradictions: RunIntegrityContradictionEvidenceV1[];
  reason: string | null;
}

export type RunIntegrityAgreementComponentV1 =
  | "producerReadiness"
  | "readinessPrompt"
  | "readinessExpectedJudge"
  | "expectedActualJudge"
  | "judgeCorrection"
  | "judgeFinalEligibility"
  | "eligibilityFinalArtifact"
  | "lifecycleIntegrity";

export interface RunIntegrityAgreementSummaryV1 {
  category: "full-agreement" | "contradiction-present" | "insufficient-evidence" | "unsupported-legacy-evidence";
  componentOutcomes: Record<RunIntegrityAgreementComponentV1, AgreementOutcomeV1>;
  contradictingComponents: RunIntegrityAgreementComponentV1[];
}

export interface RunIntegrityEvaluationV1 {
  readinessPrompt: ReadinessPromptAgreementV1;
  readinessExpectedJudge: ReadinessExpectedJudgeAgreementV1;
  expectedActualJudge: ExpectedActualJudgeAgreementV1;
  judgeCorrection: JudgeCorrectionAgreementV1;
  judgeFinalEligibility: JudgeFinalEligibilityAgreementV1;
  eligibilityFinalArtifact: EligibilityFinalArtifactAgreementV1;
  lifecycleIntegrity: LifecycleIntegrityAgreementV1;
  endToEndSummary: RunIntegrityAgreementSummaryV1;
}
