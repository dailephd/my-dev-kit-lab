import type { BaselineInvalidReason, PatchFileStatus, PatchPolicyRejectionCode, VerificationPhase, VerificationStatus } from "../../../evaluation/agentSuccess/index.js";
import type { ChangedFileV1 } from "../../../evaluation/changeSet/index.js";
import type { TaskLocality } from "../../../evaluation/types.js";
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
  /** Always null in deterministic-fixture mode: no agent runs. */
  agentDurationMs: null;
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
  /** Always null in deterministic-fixture mode. */
  agentTokenUsage: null;
  cleanup: AgentSuccessCleanupEvidenceV1;
  /** Artifact-relative patch paths; null when the artifact does not exist. */
  proposedPatchPath: string | null;
  appliedPatchPath: string | null;
  errors: AgentSuccessErrorV1[];
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
};
