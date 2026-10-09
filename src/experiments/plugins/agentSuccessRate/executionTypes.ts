import type { BaselineInvalidReason, PatchFileStatus, PatchPolicyRejectionCode, VerificationPhase, VerificationStatus } from "../../../evaluation/agentSuccess/index.js";
import type { ChangedFileV1 } from "../../../evaluation/changeSet/index.js";
import type { TaskLocality } from "../../../evaluation/types.js";
import type { TokenUsageReliability, TokenUsageSource } from "../../../agents/types.js";
import type { ExperimentRunStatus } from "../../types.js";
import type { AgentSuccessRateTreatmentId } from "./metadata.js";

/** Why the evidence for one case/treatment is (or is not) a complete evaluation. Distinct from task success. */
export type AgentSuccessEvidenceAvailability =
  | "complete" // evaluable baseline, patch attempted, post-edit evidence fully recorded
  | "baseline-invalid" // the unmodified benchmark cannot evaluate an implementation (never an agent failure)
  | "incomplete" // some required evidence is indeterminate or could not be captured
  | "infrastructure-failure"; // the sandbox could not be created or its safety could not be established

export type AgentSuccessVerificationCheckEvidenceV1 = {
  checkId: string;
  class: "task" | "regression";
  status: VerificationStatus;
  exitCode: number | null;
  durationMs: number;
  /** Bounded; no stdout/stderr content and no machine-local path. */
  failureReason: string | null;
};

export type AgentSuccessVerificationEvidenceV1 = {
  phase: VerificationPhase;
  taskResults: AgentSuccessVerificationCheckEvidenceV1[];
  regressionResults: AgentSuccessVerificationCheckEvidenceV1[];
};

export type AgentSuccessPatchEvidenceV1 = {
  attempted: boolean;
  outcome: "parse-failure" | "policy-rejection" | "git-check-failure" | "git-apply-failure" | "success" | null;
  /** Failure code for parse failures; null otherwise. */
  code: string | null;
  /** Bounded, path-sanitized detail for git failures; null otherwise. */
  message: string | null;
  appliedFiles: Array<{ path: string; status: PatchFileStatus }>;
  rejections: Array<{ code: PatchPolicyRejectionCode; path: string | null }>;
  /** Protected paths the proposal tried to touch. A rejected proposal is not a mutation. */
  attemptedProtectedPaths: string[];
  proposedPatchBytes: number;
};

/** ChangeSetV1 without its diff body. */
export type AgentSuccessChangeEvidenceV1 = {
  baselineCommit: string;
  changedFiles: ChangedFileV1[];
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  changedCount: number;
  totalAdditions: number;
  totalDeletions: number;
};

export type AgentSuccessProtectedIntegrityEvidenceV1 = {
  /** intact = proven unchanged; mutated = proven changed; unproven = could not be checked. */
  status: "intact" | "mutated" | "unproven";
  mutatedPaths: string[];
};

export type AgentSuccessTimingEvidenceV1 = {
  /** Null in deterministic-fixture mode (no agent runs) and whenever no provider attempt was measured. */
  agentDurationMs: number | null;
  baselineVerificationDurationMs: number | null;
  patchPipelineDurationMs: number | null;
  postEditVerificationDurationMs: number | null;
  evaluationDurationMs: number | null;
};

export type AgentSuccessCleanupEvidenceV1 = {
  attempted: boolean;
  removed: boolean;
  reason: string | null;
};

export type AgentSuccessErrorV1 = { code: string; message: string };

/** Provider-reported usage as recorded by the existing agent adapters. A missing total is null, never an estimate. */
export type AgentSuccessAgentTokenEvidenceV1 = {
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  source: TokenUsageSource;
  reliability: TokenUsageReliability;
};

export type AgentSuccessRealAgentProviderId = "codex" | "claude";

/** not-invoked = no provider process was started; the other values are classifyAgentRunOutcome statuses. */
export type AgentSuccessProviderStatus =
  | "not-invoked"
  | "completed"
  | "failed"
  | "skipped"
  | "timeout"
  | "agent-unavailable"
  | "agent-limit-reached"
  | "invalid-output";

/** Bounded description of the context a treatment supplied. The context body lives in a separate artifact. */
export type AgentSuccessContextEvidenceV1 = {
  contextMode: AgentSuccessRateTreatmentId;
  availability: "available" | "partial" | "unavailable";
  reason: string | null;
  selectionPolicyId: string;
  myDevKitVersion: string | null;
  includedSourceFiles: string[];
  contextChars: number;
  /** A size estimate of the supplied context. It is never provider-reported usage. */
  estimatedContextTokens: number;
  contextArtifactPath: string | null;
};

/** Attempt numbers are one-based and bounded: one initial attempt plus at most two repairs. */
export type AgentSuccessAttemptNumber = 1 | 2 | 3;
export const AGENT_SUCCESS_MAX_REPAIR_ATTEMPTS = 2;
export const AGENT_SUCCESS_MAX_TOTAL_ATTEMPTS = 3;

/**
 * Fixed vocabulary describing how one attempt ended. The first group is repair-eligible (a completed provider attempt
 * produced an evaluable implementation failure); everything else is never retried.
 */
export type AgentSuccessFailureCategory =
  | "none"
  | "patch-malformed"
  | "patch-policy-rejected"
  | "patch-check-failed"
  | "patch-apply-failed"
  | "task-check-failed"
  | "regression-failed"
  | "required-behavior-unsatisfied"
  | "baseline-invalid"
  | "context-unavailable"
  | "provider-unavailable"
  | "provider-limit-reached"
  | "provider-timeout"
  | "provider-failed"
  | "provider-empty-answer"
  | "provider-not-invoked"
  | "infrastructure-failure"
  | "cleanup-failed"
  | "integrity-unproven"
  | "integrity-mutated"
  | "evidence-incomplete";

/** Closed, harness-authored description of the previous attempt. It never carries check ids, tests or stderr. */
export type AgentSuccessRepairFeedbackSummaryV1 = {
  /** The attempt whose outcome this feedback describes. */
  basedOnAttempt: AgentSuccessAttemptNumber;
  category: AgentSuccessFailureCategory;
  patchProduced: boolean;
  patchApplied: boolean;
  taskChecks: "all-passed" | "some-failed" | "not-evaluated";
  regressionChecks: "all-passed" | "some-failed" | "not-evaluated";
  requiredBehavior: "verified" | "not-verified" | "not-evaluated";
  failedTaskCheckCount: number | null;
  failedRegressionCheckCount: number | null;
  /** Whether the previous agent-authored patch was included, and whether it was cut to the bound. */
  previousPatchIncluded: boolean;
  previousPatchTruncated: boolean;
};

export type AgentSuccessRealAgentEvidenceV1 = {
  providerId: AgentSuccessRealAgentProviderId;
  attempt: AgentSuccessAttemptNumber;
  promptTransport: "stdin";
  providerInvoked: boolean;
  providerStatus: AgentSuccessProviderStatus;
  providerStatusReason: string | null;
  /** True only when the provider returned a non-empty final answer that was handed to the patch pipeline. */
  finalAnswerAvailable: boolean;
  promptChars: number | null;
  context: AgentSuccessContextEvidenceV1;
  /** Artifact-relative attempt directory and file paths; null when the provider was not invoked. */
  agentArtifactDirectory: string | null;
  agentArtifacts: { prompt: string | null; result: string | null; stdout: string | null; stderr: string | null; telemetry: string | null };
  cwdCleanup: AgentSuccessCleanupEvidenceV1;
  /** Present on repair attempts only; null for the initial attempt. */
  repairFeedback?: AgentSuccessRepairFeedbackSummaryV1 | null;
};

/** What a proposal source returns after the evaluable baseline is established. */
export type AgentSuccessProposal =
  | { kind: "proposal"; text: string; realAgent: AgentSuccessRealAgentEvidenceV1; agentDurationMs: number | null; agentTokenUsage: AgentSuccessAgentTokenEvidenceV1 | null; errors: AgentSuccessErrorV1[]; contextFile: AgentSuccessPatchFile | null }
  | { kind: "no-proposal"; realAgent: AgentSuccessRealAgentEvidenceV1; agentDurationMs: number | null; agentTokenUsage: AgentSuccessAgentTokenEvidenceV1 | null; errors: AgentSuccessErrorV1[]; contextFile: AgentSuccessPatchFile | null };

/** `invoke: false` asks only for not-invoked evidence (for example when the baseline is not evaluable). */
export type AgentSuccessProposalSource = (request: { treatmentId: AgentSuccessRateTreatmentId; invoke: boolean; notInvokedReason?: string }) => Promise<AgentSuccessProposal>;

export type AgentSuccessTreatmentEvidenceV1 = {
  treatmentId: AgentSuccessRateTreatmentId;
  status: ExperimentRunStatus;
  availability: AgentSuccessEvidenceAvailability;
  sandboxId: string;
  sandboxBaseline: { commit: string; fileCount: number; digest: string } | null;
  baselineTextLineCount: number | null;
  baselineVerification: AgentSuccessVerificationEvidenceV1 | null;
  baselineAssessment: { evaluable: boolean; reasons: BaselineInvalidReason[] } | null;
  patch: AgentSuccessPatchEvidenceV1;
  change: AgentSuccessChangeEvidenceV1 | null;
  postEditVerification: AgentSuccessVerificationEvidenceV1 | null;
  protectedIntegrity: AgentSuccessProtectedIntegrityEvidenceV1;
  timing: AgentSuccessTimingEvidenceV1;
  /** Null in deterministic-fixture mode and whenever no provider attempt ran. */
  agentTokenUsage: AgentSuccessAgentTokenEvidenceV1 | null;
  cleanup: AgentSuccessCleanupEvidenceV1;
  /** Artifact-relative patch paths; null when the artifact does not exist. */
  proposedPatchPath: string | null;
  appliedPatchPath: string | null;
  errors: AgentSuccessErrorV1[];
  /** Present only in real-agent mode; deterministic-fixture evidence never carries this key. */
  realAgent?: AgentSuccessRealAgentEvidenceV1;
  /**
   * Real-agent mode only. Ordered, contiguous, one-based attempt evidence. The top-level fields above describe the FINAL
   * evaluated attempt; the initial attempt is always attempts[0] and is never overwritten by a repair.
   */
  attempts?: AgentSuccessAttemptEvidenceV1[];
};

export type AgentSuccessAttemptEvidenceV1 = {
  attemptNumber: AgentSuccessAttemptNumber;
  providerId: AgentSuccessRealAgentProviderId;
  providerStatus: AgentSuccessProviderStatus;
  startedAt: string;
  completedAt: string;
  /** Provider wall time for this attempt; null when no provider ran. */
  durationMs: number | null;
  tokenUsage: AgentSuccessAgentTokenEvidenceV1 | null;
  proposedPatchAvailability: "available" | "unavailable";
  patchApplicationOutcome: NonNullable<AgentSuccessPatchEvidenceV1["outcome"]> | "not-attempted";
  baselineAssessment: AgentSuccessTreatmentEvidenceV1["baselineAssessment"];
  postEditVerification: AgentSuccessVerificationEvidenceV1 | null;
  changeEvidenceAvailability: "available" | "unavailable";
  /** The attempt's task-success verdict from the analysis owner; null when it could not be determined. */
  taskSuccess: boolean | null;
  failureCategory: AgentSuccessFailureCategory;
  /** True when this attempt ended in an eligible implementation failure (a repair may follow if allowance remains). */
  repairEligible: boolean;
  /** Sandbox cleanup for this attempt's own sandbox. */
  cleanupResult: AgentSuccessCleanupEvidenceV1;
  /** Complete per-attempt evidence (its own sandbox, patch, verification and artifact references). */
  evidence: AgentSuccessTreatmentEvidenceV1;
};

export type AgentSuccessCaseEvidenceV1 = {
  caseId: string;
  caseName: string;
  benchmarkProject: string;
  taskLocality: TaskLocality;
  fixtureId: string;
  /** Always in fixed treatment order. */
  treatments: AgentSuccessTreatmentEvidenceV1[];
};

/** Patch bodies are kept out of the evidence and persisted only as separate artifacts. */
export type AgentSuccessPatchFile = { relativePath: string; content: string };

export type AgentSuccessTreatmentResult = {
  evidence: AgentSuccessTreatmentEvidenceV1;
  patchFiles: AgentSuccessPatchFile[];
  /** Context bodies (real-agent mode only); never embedded in the evidence. */
  contextFiles: AgentSuccessPatchFile[];
};
