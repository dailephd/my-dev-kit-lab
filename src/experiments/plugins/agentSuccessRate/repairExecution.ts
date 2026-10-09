import type { AgentSuccessTaskV1 } from "../../../evaluation/agentSuccess/index.js";
import { analyzeAgentSuccessTreatment } from "./analysis.js";
import { executeAgentSuccessTreatment, type AgentSuccessCaseResult, type AgentSuccessRateDependencies } from "./execution.js";
import {
  AGENT_SUCCESS_MAX_TOTAL_ATTEMPTS,
  type AgentSuccessAttemptEvidenceV1,
  type AgentSuccessAttemptNumber,
  type AgentSuccessPatchFile,
  type AgentSuccessProposalSource,
  type AgentSuccessRealAgentProviderId,
  type AgentSuccessTreatmentEvidenceV1,
  type AgentSuccessTreatmentResult,
  type AgentSuccessCaseEvidenceV1
} from "./executionTypes.js";
import { AGENT_SUCCESS_RATE_TREATMENT_IDS, type AgentSuccessRateTreatmentId } from "./metadata.js";
import { buildAgentSuccessRepairFeedback, type AgentSuccessRepairFeedback } from "./repairFeedback.js";
import { classifyAgentSuccessAttempt, shouldRepairAgentSuccessAttempt } from "./repairPolicy.js";

/** Everything the repair loop needs from the plugin: the provider identity, the allowance and a per-attempt proposal source. */
export type AgentSuccessRepairRuntime = {
  providerId: AgentSuccessRealAgentProviderId;
  /** 0 = initial attempt only; 1 or 2 = at most that many repairs after the initial attempt. */
  repairAttempts: number;
  /** Builds the proposal source for one attempt. Attempt 1 receives no feedback; a repair receives the previous outcome. */
  createProposalSource(request: { attemptNumber: AgentSuccessAttemptNumber; feedback: AgentSuccessRepairFeedback | null }): AgentSuccessProposalSource;
  now?: () => Date;
};

function attemptSummary(args: {
  attemptNumber: AgentSuccessAttemptNumber;
  providerId: AgentSuccessRealAgentProviderId;
  startedAt: string;
  completedAt: string;
  evidence: AgentSuccessTreatmentEvidenceV1;
  classification: ReturnType<typeof classifyAgentSuccessAttempt>;
}): AgentSuccessAttemptEvidenceV1 {
  const { evidence } = args;
  return {
    attemptNumber: args.attemptNumber,
    providerId: args.providerId,
    providerStatus: evidence.realAgent?.providerStatus ?? "not-invoked",
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    durationMs: evidence.realAgent?.providerInvoked ? evidence.timing.agentDurationMs : null,
    tokenUsage: evidence.agentTokenUsage,
    proposedPatchAvailability: evidence.proposedPatchPath !== null ? "available" : "unavailable",
    patchApplicationOutcome: evidence.patch.outcome ?? "not-attempted",
    baselineAssessment: evidence.baselineAssessment,
    postEditVerification: evidence.postEditVerification,
    changeEvidenceAvailability: evidence.change !== null ? "available" : "unavailable",
    taskSuccess: args.classification.taskSuccess,
    failureCategory: args.classification.category,
    repairEligible: args.classification.repairEligible,
    cleanupResult: { ...evidence.cleanup },
    evidence
  };
}

/**
 * Runs one case/treatment with bounded repair. Every attempt is a complete, independent execution of the existing
 * Lab-owned pipeline: a NEW clean sandbox from the canonical baseline, a complete replacement proposal, its own
 * verification and cleanup. Nothing from a previous attempt's filesystem state is reused, patches are never combined,
 * and the loop stops at success, at a non-repairable outcome, at the configured allowance, or after three attempts.
 */
export async function executeAgentSuccessRepairTreatment(args: {
  task: AgentSuccessTaskV1;
  treatmentId: AgentSuccessRateTreatmentId;
  runId: string;
  canonicalProjectRoot: string;
  runtimeRoot: string;
  privateRoots: readonly string[];
  dependencies?: Partial<AgentSuccessRateDependencies>;
  repair: AgentSuccessRepairRuntime;
}): Promise<AgentSuccessTreatmentResult> {
  const now = args.repair.now ?? (() => new Date());
  const allowance = Math.min(Math.max(Math.trunc(args.repair.repairAttempts), 0), AGENT_SUCCESS_MAX_TOTAL_ATTEMPTS - 1);
  const attempts: AgentSuccessAttemptEvidenceV1[] = [];
  const patchFiles: AgentSuccessPatchFile[] = [];
  const contextFiles: AgentSuccessPatchFile[] = [];
  let feedback: AgentSuccessRepairFeedback | null = null;

  for (let number = 1; number <= AGENT_SUCCESS_MAX_TOTAL_ATTEMPTS; number += 1) {
    const attemptNumber = number as AgentSuccessAttemptNumber;
    const startedAt = now().toISOString();
    const result = await executeAgentSuccessTreatment({
      task: args.task,
      treatmentId: args.treatmentId,
      runId: args.runId,
      canonicalProjectRoot: args.canonicalProjectRoot,
      runtimeRoot: args.runtimeRoot,
      privateRoots: args.privateRoots,
      dependencies: args.dependencies,
      attemptNumber,
      proposalSource: args.repair.createProposalSource({ attemptNumber, feedback })
    });
    const completedAt = now().toISOString();
    const metrics = analyzeAgentSuccessTreatment(args.task, result.evidence).metrics;
    const classification = classifyAgentSuccessAttempt(result.evidence, metrics);
    attempts.push(attemptSummary({ attemptNumber, providerId: args.repair.providerId, startedAt, completedAt, evidence: result.evidence, classification }));
    patchFiles.push(...result.patchFiles);
    // The treatment context is built once and persisted once; repairs reuse it unchanged.
    if (attemptNumber === 1) contextFiles.push(...result.contextFiles);

    if (!shouldRepairAgentSuccessAttempt({ classification, attemptsExecuted: attemptNumber, repairAttemptsAllowed: allowance })) break;
    const proposedText = result.patchFiles.find((file) => file.relativePath === result.evidence.proposedPatchPath)?.content ?? null;
    feedback = buildAgentSuccessRepairFeedback({ attemptNumber, category: classification.category, evidence: result.evidence, metrics, proposedPatchText: proposedText });
  }

  const final = attempts[attempts.length - 1]!.evidence;
  const evidence: AgentSuccessTreatmentEvidenceV1 = { ...structuredClone(final), attempts: structuredClone(attempts) };
  return { evidence, patchFiles, contextFiles };
}

/** Executes both mandatory treatments, in fixed order, each with its own bounded attempt sequence. */
export async function executeAgentSuccessRepairCase(args: {
  task: AgentSuccessTaskV1;
  runId: string;
  canonicalProjectRoot: string;
  runtimeRoot: string;
  privateRoots: readonly string[];
  dependencies?: Partial<AgentSuccessRateDependencies>;
  /** Builds the repair runtime for one treatment so each treatment keeps its own context and proposal sources. */
  repairFor(treatmentId: AgentSuccessRateTreatmentId): AgentSuccessRepairRuntime;
}): Promise<AgentSuccessCaseResult> {
  const treatments: AgentSuccessTreatmentEvidenceV1[] = [];
  const patchFiles: AgentSuccessPatchFile[] = [];
  const contextFiles: AgentSuccessPatchFile[] = [];
  for (const treatmentId of AGENT_SUCCESS_RATE_TREATMENT_IDS) {
    const result = await executeAgentSuccessRepairTreatment({
      task: args.task,
      treatmentId,
      runId: args.runId,
      canonicalProjectRoot: args.canonicalProjectRoot,
      runtimeRoot: args.runtimeRoot,
      privateRoots: args.privateRoots,
      dependencies: args.dependencies,
      repair: args.repairFor(treatmentId)
    });
    treatments.push(result.evidence);
    patchFiles.push(...result.patchFiles);
    contextFiles.push(...result.contextFiles);
  }
  const evidence: AgentSuccessCaseEvidenceV1 = {
    caseId: args.task.id,
    caseName: args.task.title,
    benchmarkProject: args.task.benchmarkProject,
    taskLocality: args.task.taskLocality,
    // Real-agent mode never reads the fixture, so it has no fixture identity.
    fixtureId: "",
    treatments
  };
  return { evidence, patchFiles, contextFiles };
}
