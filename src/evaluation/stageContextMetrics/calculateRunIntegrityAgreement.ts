// v0.4.5 Batch 3: bounded agreement metrics over OrchestratorRunIntegrityEvidenceV1
// (Batch 3 exact mirror of my-dev-kit-orchestrator v1.2.3's RunIntegrityGateResult /
// JudgeIntegrityResult / FinalReportEligibilityResult / lifecycle evidence). Every function
// here compares producer-supplied claims against producer-supplied evidence -- it never
// independently selects a prompt mode, derives an expected judge verdict, chooses a
// correction destination, authorizes a final report, or marks a stage complete. The
// orchestrator remains the sole source of truth for all of those; this module only reports
// agreement, contradiction, or insufficient evidence.
import type { OrchestratorRunIntegrityEvidenceV1 } from "../upstreamArtifacts/index.js";
import type {
  EligibilityFinalArtifactAgreementV1,
  ExpectedActualJudgeAgreementV1,
  JudgeCorrectionAgreementV1,
  JudgeFinalEligibilityAgreementV1,
  LifecycleEntryIntegrityV1,
  LifecycleIntegrityAgreementV1,
  ReadinessExpectedJudgeAgreementV1,
  ReadinessPromptAgreementV1,
  RunIntegrityAgreementComponentV1,
  RunIntegrityAgreementSummaryV1,
  RunIntegrityContradictionEvidenceV1,
  RunIntegrityEvaluationV1
} from "./runIntegrityAgreementTypes.js";
import type { AgreementOutcomeV1 } from "./producerReadinessMetricTypes.js";
import { selectStageMayRenderNormalPrompt } from "../stageContextSelectors/orchestratorRunIntegritySelectors.js";

const CONTEXT_SENSITIVE_STAGE_NAMES = ["implementation", "test-implementation"] as const;

function contradiction(
  code: string,
  fieldPath: string,
  expected: string | null,
  observed: string | null,
  reason: string
): RunIntegrityContradictionEvidenceV1 {
  return { code, fieldPath, expected, observed, reason };
}

// --- section 19: readiness vs prompt mode ----------------------------------------------

export function calculateReadinessPromptAgreement(
  evidence: OrchestratorRunIntegrityEvidenceV1,
  stageName: string
): ReadinessPromptAgreementV1 {
  const readinessClassification = evidence.gate.readinessClassification;
  const stageMayRenderNormalPrompt = selectStageMayRenderNormalPrompt(evidence, stageName) ?? null;

  if (!(CONTEXT_SENSITIVE_STAGE_NAMES as readonly string[]).includes(stageName)) {
    return {
      availability: "not-applicable",
      outcome: "not-applicable",
      readinessClassification,
      stageMayRenderNormalPrompt,
      contradictions: [],
      reason: `Stage "${stageName}" is not a context-sensitive stage; the gate does not attach a prompt-mode decision to it.`
    };
  }
  if (stageMayRenderNormalPrompt === null) {
    return {
      availability: "unavailable",
      outcome: "insufficient-evidence",
      readinessClassification,
      stageMayRenderNormalPrompt: null,
      contradictions: [],
      reason: "No prompt-mode decision was derivable for this stage."
    };
  }

  const contradictions: RunIntegrityContradictionEvidenceV1[] = [];
  if (readinessClassification === "ready" && !stageMayRenderNormalPrompt) {
    contradictions.push(
      contradiction("READY_BUT_PROMPT_NOT_NORMAL", "gate.readinessClassification", "ready", "refresh-only", "Readiness is ready but this stage may not render its normal prompt.")
    );
  }
  if (readinessClassification === "refresh-required" && stageMayRenderNormalPrompt) {
    contradictions.push(
      contradiction(
        "REFRESH_REQUIRED_BUT_PROMPT_NORMAL",
        "gate.readinessClassification",
        "refresh-required",
        "normal",
        "Readiness is refresh-required but this stage may still render its normal prompt."
      )
    );
  }

  return {
    availability: "available",
    outcome: contradictions.length > 0 ? "contradiction" : "agreement",
    readinessClassification,
    stageMayRenderNormalPrompt,
    contradictions,
    reason: contradictions.length > 0 ? "Readiness classification and stage prompt-mode evidence disagree." : null
  };
}

// --- section 20: readiness vs expected judge verdict ------------------------------------

export function calculateReadinessExpectedJudgeAgreement(evidence: OrchestratorRunIntegrityEvidenceV1): ReadinessExpectedJudgeAgreementV1 {
  const { contextReady, expectedJudgeVerdict } = evidence.gate;
  const contradictions: RunIntegrityContradictionEvidenceV1[] = [];

  if (contextReady && expectedJudgeVerdict !== "PASS") {
    contradictions.push(
      contradiction("CONTEXT_READY_BUT_EXPECTED_NOT_PASS", "gate.expectedJudgeVerdict", "PASS", expectedJudgeVerdict, "contextReady is true but expectedJudgeVerdict is not PASS.")
    );
  }
  if (!contextReady && expectedJudgeVerdict !== "NEED_CONTEXT") {
    contradictions.push(
      contradiction(
        "CONTEXT_NOT_READY_BUT_EXPECTED_NOT_NEED_CONTEXT",
        "gate.expectedJudgeVerdict",
        "NEED_CONTEXT",
        expectedJudgeVerdict,
        "contextReady is false but expectedJudgeVerdict is not NEED_CONTEXT."
      )
    );
  }

  return {
    availability: "available",
    outcome: contradictions.length > 0 ? "contradiction" : "agreement",
    contextReady,
    expectedJudgeVerdict,
    contradictions,
    reason: contradictions.length > 0 ? "The gate's own contextReady/expectedJudgeVerdict invariant does not hold for this evidence." : null
  };
}

// --- section 21: expected vs parsed (actual) judge verdict -------------------------------

export function calculateExpectedActualJudgeAgreement(evidence: OrchestratorRunIntegrityEvidenceV1): ExpectedActualJudgeAgreementV1 {
  const judgeIntegrity = evidence.judgeIntegrity;
  if (judgeIntegrity === undefined) {
    return {
      availability: "unavailable",
      outcome: "insufficient-evidence",
      expectedJudgeVerdict: evidence.gate.expectedJudgeVerdict,
      authoredJudgeVerdict: null,
      judgeVerdictParseStatus: null,
      judgeVerdictAccepted: null,
      contradictions: [],
      reason: "No judgeIntegrity evidence was supplied."
    };
  }

  const contradictions: RunIntegrityContradictionEvidenceV1[] = [];
  const { expectedJudgeVerdict, authoredJudgeVerdict, judgeVerdictParseStatus, judgeVerdictAccepted, judgeVerdictMatchesExpected, blockingCodes } =
    judgeIntegrity;

  if (judgeVerdictParseStatus === "unknown-verdict") {
    contradictions.push(contradiction("JUDGE_VERDICT_UNKNOWN", "judgeIntegrity.judgeVerdictParseStatus", "parsed", "unknown-verdict", "Judge report declares an unrecognized verdict."));
  } else if (judgeVerdictParseStatus === "missing-verdict") {
    contradictions.push(contradiction("JUDGE_VERDICT_MISSING", "judgeIntegrity.judgeVerdictParseStatus", "parsed", "missing-verdict", "Judge report does not declare a verdict."));
  } else if (judgeVerdictParseStatus === "missing-artifact") {
    contradictions.push(contradiction("JUDGE_REPORT_MISSING", "judgeIntegrity.judgeArtifactPresent", "true", "false", "No judge report artifact exists."));
  } else if (authoredJudgeVerdict === "PASS" && expectedJudgeVerdict === "NEED_CONTEXT") {
    // The exact upstream contradiction code (src/judgeIntegrity.ts
    // JUDGE_VERDICT_CONTRADICTS_RUN_INTEGRITY), preserved verbatim when present.
    contradictions.push(
      contradiction(
        blockingCodes.includes("JUDGE_VERDICT_CONTRADICTS_RUN_INTEGRITY") ? "JUDGE_VERDICT_CONTRADICTS_RUN_INTEGRITY" : "AUTHORED_PASS_CONTRADICTS_EXPECTED_NEED_CONTEXT",
        "judgeIntegrity.authoredJudgeVerdict",
        "NEED_CONTEXT",
        "PASS",
        'Judge report authored "PASS" but canonical readiness still requires NEED_CONTEXT.'
      )
    );
  } else if (judgeVerdictAccepted && judgeVerdictMatchesExpected === false && authoredJudgeVerdict !== null) {
    // A syntactically valid, accepted verdict that legitimately differs from the expected
    // one without being the PASS/NEED_CONTEXT contradiction above (e.g. a correction-route
    // verdict, or a terminal BLOCKED/SCOPE_VIOLATION verdict) is not itself an integrity
    // contradiction -- it is the normal correction-required or blocked shape.
  }

  return {
    availability: "available",
    outcome: contradictions.length > 0 ? "contradiction" : "agreement",
    expectedJudgeVerdict,
    authoredJudgeVerdict,
    judgeVerdictParseStatus,
    judgeVerdictAccepted,
    contradictions,
    reason: contradictions.length > 0 ? contradictions[0].reason : null
  };
}

// --- section 22: judge verdict vs correction route ---------------------------------------

const TERMINAL_BLOCKED_VERDICTS = ["SCOPE_VIOLATION", "BLOCKED"] as const;

export function calculateJudgeCorrectionAgreement(evidence: OrchestratorRunIntegrityEvidenceV1): JudgeCorrectionAgreementV1 {
  const judgeIntegrity = evidence.judgeIntegrity;
  if (judgeIntegrity === undefined) {
    return {
      availability: "unavailable",
      outcome: "insufficient-evidence",
      authoredJudgeVerdict: null,
      correctionRequired: null,
      acceptedCorrectionStage: null,
      routedStage: null,
      contradictions: [],
      reason: "No judgeIntegrity evidence was supplied."
    };
  }

  const { authoredJudgeVerdict, correctionRequired, correctionBlocked, acceptedCorrectionStage, acceptedCorrectionRoute } = judgeIntegrity;
  const routedStage = acceptedCorrectionRoute?.routedStage ?? null;
  const contradictions: RunIntegrityContradictionEvidenceV1[] = [];

  if (authoredJudgeVerdict === "PASS" && acceptedCorrectionRoute !== null) {
    contradictions.push(
      contradiction("PASS_WITH_ACTIVE_CORRECTION_ROUTE", "judgeIntegrity.acceptedCorrectionRoute", "null", "active", "Judge verdict is PASS but an active correction route is present.")
    );
  }
  if (
    authoredJudgeVerdict !== null &&
    authoredJudgeVerdict !== "PASS" &&
    !(TERMINAL_BLOCKED_VERDICTS as readonly string[]).includes(authoredJudgeVerdict) &&
    !correctionBlocked &&
    correctionRequired &&
    acceptedCorrectionRoute === null
  ) {
    contradictions.push(
      contradiction(
        "CORRECTIVE_VERDICT_WITHOUT_ROUTE",
        "judgeIntegrity.acceptedCorrectionRoute",
        "active",
        "null",
        `Judge verdict "${authoredJudgeVerdict}" requires correction but no correction route is present.`
      )
    );
  }
  if (acceptedCorrectionStage !== null && routedStage !== null && acceptedCorrectionStage !== routedStage) {
    contradictions.push(
      contradiction(
        "CORRECTION_DESTINATION_MISMATCH",
        "judgeIntegrity.acceptedCorrectionStage",
        routedStage,
        acceptedCorrectionStage,
        "acceptedCorrectionStage does not match the structured correction route's routedStage."
      )
    );
  }

  return {
    availability: "available",
    outcome: contradictions.length > 0 ? "contradiction" : "agreement",
    authoredJudgeVerdict,
    correctionRequired,
    acceptedCorrectionStage,
    routedStage,
    contradictions,
    reason: contradictions.length > 0 ? contradictions[0].reason : null
  };
}

// --- section 23: readiness/judge vs final-report eligibility -----------------------------

export function calculateJudgeFinalEligibilityAgreement(evidence: OrchestratorRunIntegrityEvidenceV1): JudgeFinalEligibilityAgreementV1 {
  const judgeIntegrity = evidence.judgeIntegrity;
  if (judgeIntegrity === undefined) {
    return {
      availability: "unavailable",
      outcome: "insufficient-evidence",
      authoredJudgeVerdict: null,
      judgeVerdictAccepted: null,
      judgeVerdictMatchesExpected: null,
      finalReportEligible: null,
      contradictions: [],
      reason: "No judgeIntegrity evidence was supplied."
    };
  }

  const { authoredJudgeVerdict, judgeVerdictAccepted, judgeVerdictMatchesExpected, finalReportEligible, judgeVerdictParseStatus } = judgeIntegrity;
  const contradictions: RunIntegrityContradictionEvidenceV1[] = [];

  if (finalReportEligible && authoredJudgeVerdict !== "PASS") {
    contradictions.push(
      contradiction(
        "ELIGIBLE_WITH_NON_PASS_JUDGE",
        "judgeIntegrity.finalReportEligible",
        "PASS",
        authoredJudgeVerdict,
        "finalReportEligible is true but the authored judge verdict is not PASS."
      )
    );
  }
  if (finalReportEligible && judgeVerdictParseStatus !== "parsed") {
    contradictions.push(
      contradiction(
        "ELIGIBLE_WITH_MALFORMED_OR_MISSING_JUDGE",
        "judgeIntegrity.finalReportEligible",
        "parsed",
        judgeVerdictParseStatus,
        "finalReportEligible is true but the judge verdict was not successfully parsed."
      )
    );
  }
  if (finalReportEligible && !judgeVerdictAccepted) {
    contradictions.push(
      contradiction("ELIGIBLE_WITH_UNACCEPTED_JUDGE", "judgeIntegrity.finalReportEligible", "true", "false", "finalReportEligible is true but judgeVerdictAccepted is false.")
    );
  }
  if (finalReportEligible && judgeVerdictMatchesExpected === false) {
    contradictions.push(
      contradiction(
        "ELIGIBLE_WITH_UNMATCHED_EXPECTED_VERDICT",
        "judgeIntegrity.finalReportEligible",
        "true",
        "false",
        "finalReportEligible is true but judgeVerdictMatchesExpected is false."
      )
    );
  }

  return {
    availability: "available",
    outcome: contradictions.length > 0 ? "contradiction" : "agreement",
    authoredJudgeVerdict,
    judgeVerdictAccepted,
    judgeVerdictMatchesExpected,
    finalReportEligible,
    contradictions,
    reason: contradictions.length > 0 ? contradictions[0].reason : null
  };
}

// --- section 24: final eligibility vs final artifact and verdict -------------------------

export function calculateEligibilityFinalArtifactAgreement(evidence: OrchestratorRunIntegrityEvidenceV1): EligibilityFinalArtifactAgreementV1 {
  const eligibility = evidence.finalReportEligibility;
  const finalArtifactPresent = evidence.finalArtifactPresent;
  const finalArtifactVerdict = evidence.finalArtifactVerdict ?? null;

  if (eligibility === undefined || finalArtifactPresent === undefined) {
    return {
      availability: "unavailable",
      outcome: "insufficient-evidence",
      eligible: eligibility?.eligible ?? null,
      finalArtifactPresent: finalArtifactPresent ?? null,
      finalArtifactVerdict,
      contradictions: [],
      reason: eligibility === undefined ? "No finalReportEligibility evidence was supplied." : "No finalArtifactPresent evidence was supplied."
    };
  }

  const { eligible } = eligibility;
  const contradictions: RunIntegrityContradictionEvidenceV1[] = [];

  if (eligible && !finalArtifactPresent) {
    contradictions.push(contradiction("ELIGIBLE_BUT_ARTIFACT_MISSING", "finalArtifactPresent", "true", "false", "The run is final-report eligible but no final artifact is present."));
  }
  if (!eligible && finalArtifactPresent) {
    contradictions.push(contradiction("INELIGIBLE_BUT_ARTIFACT_PRESENT", "finalArtifactPresent", "false", "true", "The run is not final-report eligible but a final artifact is present."));
  }
  if (!eligible && finalArtifactVerdict === "PASS") {
    // The required v0.4.5 failure detection: NEED_CONTEXT (or any other ineligible state)
    // followed by a normal PASS final report must report an integrity contradiction.
    const expectedJudge = evidence.gate.expectedJudgeVerdict;
    contradictions.push(
      contradiction(
        expectedJudge === "NEED_CONTEXT" ? "NEED_CONTEXT_FOLLOWED_BY_FINAL_PASS" : "INELIGIBLE_WITH_FINAL_PASS",
        "finalArtifactVerdict",
        "not PASS",
        "PASS",
        expectedJudge === "NEED_CONTEXT"
          ? "Canonical readiness required NEED_CONTEXT, yet a final report with verdict PASS exists."
          : "The run is not final-report eligible, yet a final report with verdict PASS exists."
      )
    );
  }
  if (finalArtifactPresent && evidence.finalArtifactVerdict === undefined) {
    contradictions.push(
      contradiction("FINAL_ARTIFACT_MALFORMED_VERDICT", "finalArtifactVerdict", "parsed", "undefined", "A final artifact is present but its verdict was not supplied.")
    );
  }

  return {
    availability: "available",
    outcome: contradictions.length > 0 ? "contradiction" : "agreement",
    eligible,
    finalArtifactPresent,
    finalArtifactVerdict,
    contradictions,
    reason: contradictions.length > 0 ? contradictions[0].reason : null
  };
}

// --- section 25: lifecycle integrity -----------------------------------------------------

export function calculateLifecycleIntegrityAgreement(evidence: OrchestratorRunIntegrityEvidenceV1): LifecycleIntegrityAgreementV1 {
  if (evidence.lifecycle.length === 0) {
    return { availability: "not-applicable", outcome: "not-applicable", entries: [], contradictions: [], reason: "No lifecycle evidence was supplied." };
  }

  const contradictions: RunIntegrityContradictionEvidenceV1[] = [];
  const entries: LifecycleEntryIntegrityV1[] = evidence.lifecycle.map((entry) => {
    const completionBasis: LifecycleEntryIntegrityV1["completionBasis"] =
      entry.resolvedState !== "complete" ? "not-complete" : entry.manualRecord === null ? "artifact-presence-only" : "manual-record";
    const markCompleteRejected = entry.manualRecord?.state === "complete" && entry.resolvedState !== "complete";

    const stageContextBlocked =
      (CONTEXT_SENSITIVE_STAGE_NAMES as readonly string[]).includes(entry.stageName) &&
      evidence.gate.blockedStageNames.includes(entry.stageName as "implementation" | "test-implementation");
    const finalReportIneligible = entry.stageName === "final-report" && evidence.finalReportEligibility?.eligible === false;
    const shouldBeBlocked = stageContextBlocked || finalReportIneligible;
    const bypassSucceeded = shouldBeBlocked && entry.resolvedState === "complete";

    if (bypassSucceeded) {
      contradictions.push(
        contradiction(
          "MANUAL_MARK_COMPLETE_BYPASS_SUCCEEDED",
          `lifecycle[${entry.stageName}].resolvedState`,
          "blocked",
          "complete",
          `Stage "${entry.stageName}" should be run-integrity-blocked but resolved to "complete"${completionBasis === "artifact-presence-only" ? " through artifact presence alone" : " despite a manual mark-complete record"}.`
        )
      );
    }

    return { artifactFile: entry.artifactFile, stageName: entry.stageName, resolvedState: entry.resolvedState, completionBasis, markCompleteRejected, bypassSucceeded };
  });

  return {
    availability: "available",
    outcome: contradictions.length > 0 ? "contradiction" : "agreement",
    entries,
    contradictions,
    reason: contradictions.length > 0 ? "At least one lifecycle entry resolved to complete despite required run-integrity blocking." : null
  };
}

// --- section 26: end-to-end aggregate summary ---------------------------------------------

function summarize(
  producerReadinessOutcome: AgreementOutcomeV1,
  readinessPrompt: AgreementOutcomeV1,
  readinessExpectedJudge: AgreementOutcomeV1,
  expectedActualJudge: AgreementOutcomeV1,
  judgeCorrection: AgreementOutcomeV1,
  judgeFinalEligibility: AgreementOutcomeV1,
  eligibilityFinalArtifact: AgreementOutcomeV1,
  lifecycleIntegrity: AgreementOutcomeV1
): RunIntegrityAgreementSummaryV1 {
  const componentOutcomes: Record<RunIntegrityAgreementComponentV1, AgreementOutcomeV1> = {
    producerReadiness: producerReadinessOutcome,
    readinessPrompt,
    readinessExpectedJudge,
    expectedActualJudge,
    judgeCorrection,
    judgeFinalEligibility,
    eligibilityFinalArtifact,
    lifecycleIntegrity
  };
  const contradictingComponents = (Object.keys(componentOutcomes) as RunIntegrityAgreementComponentV1[]).filter(
    (key) => componentOutcomes[key] === "contradiction"
  );
  const category: RunIntegrityAgreementSummaryV1["category"] =
    contradictingComponents.length > 0
      ? "contradiction-present"
      : Object.values(componentOutcomes).some((o) => o === "insufficient-evidence")
        ? "insufficient-evidence"
        : Object.values(componentOutcomes).some((o) => o === "unsupported-legacy-evidence")
          ? "unsupported-legacy-evidence"
          : "full-agreement";

  return { category, componentOutcomes, contradictingComponents };
}

export function evaluateRunIntegrity(
  evidence: OrchestratorRunIntegrityEvidenceV1,
  stageName: string,
  producerReadinessOutcome: AgreementOutcomeV1 = "not-applicable"
): RunIntegrityEvaluationV1 {
  const readinessPrompt = calculateReadinessPromptAgreement(evidence, stageName);
  const readinessExpectedJudge = calculateReadinessExpectedJudgeAgreement(evidence);
  const expectedActualJudge = calculateExpectedActualJudgeAgreement(evidence);
  const judgeCorrection = calculateJudgeCorrectionAgreement(evidence);
  const judgeFinalEligibility = calculateJudgeFinalEligibilityAgreement(evidence);
  const eligibilityFinalArtifact = calculateEligibilityFinalArtifactAgreement(evidence);
  const lifecycleIntegrity = calculateLifecycleIntegrityAgreement(evidence);

  return {
    readinessPrompt,
    readinessExpectedJudge,
    expectedActualJudge,
    judgeCorrection,
    judgeFinalEligibility,
    eligibilityFinalArtifact,
    lifecycleIntegrity,
    endToEndSummary: summarize(
      producerReadinessOutcome,
      readinessPrompt.outcome,
      readinessExpectedJudge.outcome,
      expectedActualJudge.outcome,
      judgeCorrection.outcome,
      judgeFinalEligibility.outcome,
      eligibilityFinalArtifact.outcome,
      lifecycleIntegrity.outcome
    )
  };
}
