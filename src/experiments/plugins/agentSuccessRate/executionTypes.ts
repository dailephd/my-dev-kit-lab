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

export type AgentSuccessRealAgentEvidenceV1 = {
  providerId: AgentSuccessRealAgentProviderId;
  attempt: 1;
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
