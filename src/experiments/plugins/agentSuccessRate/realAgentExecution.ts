import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAgentPrompt } from "../../../agents/index.js";
import type { AgentRunResult } from "../../../agents/types.js";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import { isSameOrInside, resolvePhysicalPath } from "../../../evaluation/benchmarkSandbox/pathPolicy.js";
import { classifyAgentRunOutcome } from "../../../evaluation/classifyAgentRunOutcome.js";
import type { PromptVariant } from "../../../prompts/types.js";
import { sanitizePathSegment } from "../../outputPaths.js";
import type { AgentFacingTaskV1 } from "./agentTaskProjection.js";
import { findPromptLeaks, type AgentSuccessContextResult, type ForbiddenAgentValue } from "./contextGeneration.js";
import { boundMessage } from "./execution.js";
import type {
  AgentSuccessAttemptNumber,
  AgentSuccessAgentTokenEvidenceV1,
  AgentSuccessCleanupEvidenceV1,
  AgentSuccessErrorV1,
  AgentSuccessPatchFile,
  AgentSuccessProposal,
  AgentSuccessProposalSource,
  AgentSuccessProviderStatus,
  AgentSuccessRealAgentEvidenceV1,
  AgentSuccessRealAgentProviderId
} from "./executionTypes.js";
import type { AgentSuccessRateTreatmentId } from "./metadata.js";
import { buildAgentSuccessRealAgentPrompt } from "./realAgentPrompt.js";
import { summarizeAgentSuccessRepairFeedback, type AgentSuccessRepairFeedback } from "./repairFeedback.js";

export const AGENT_SUCCESS_RATE_DEFAULT_AGENT_TIMEOUT_MS = 240_000;
export const AGENT_SUCCESS_RATE_MAX_AGENT_TIMEOUT_MS = 1_800_000;

/** Lab seam so tests can prove provider semantics without a live provider. Production uses the shared agent runner. */
export type AgentSuccessRunAgent = typeof runAgentPrompt;

export type AgentSuccessRealAgentSettings = {
  providerId: AgentSuccessRealAgentProviderId;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  runAgent: AgentSuccessRunAgent;
  /** Experiment output root; agent attempt directories are created below it. */
  outDir: string;
  /** Roots the provider working directory must be disjoint from (repository, benchmarks, sandboxes, outputs, package). */
  protectedRoots: readonly string[];
  /** Roots replaced by <path> in any persisted message. */
  privateRoots: readonly string[];
  /**
   * Removal seam for the provider's neutral working directory so cleanup failure can be proven on every platform without
   * relying on permissions or timing. Production removes the directory it created, recursively.
   */
  removeDirectory?: (directory: string) => Promise<void>;
};

export function agentSuccessAgentArtifactDirectory(benchmarkProject: string, caseId: string, treatmentId: string, attemptNumber: AgentSuccessAttemptNumber = 1): string {
  return `agents/${sanitizePathSegment(benchmarkProject)}/${sanitizePathSegment(caseId)}/${sanitizePathSegment(treatmentId)}/attempt-${attemptNumber}`;
}

export function agentSuccessContextArtifactPath(benchmarkProject: string, caseId: string, treatmentId: string): string {
  return `contexts/${sanitizePathSegment(benchmarkProject)}/${sanitizePathSegment(caseId)}/${sanitizePathSegment(treatmentId)}/context.txt`;
}

/**
 * Minimal transport-only compatibility object for the shared agent runner, which still requires a legacy
 * PromptVariant. It carries only public case identity and neutral labels: no answer key, no profile, no metrics. The
 * adapters read only `id`, `strategy` and `complexityLevel`, and nothing here is scored or treated as evidence.
 */
function buildTransportVariant(task: AgentFacingTaskV1, treatmentId: AgentSuccessRateTreatmentId): PromptVariant {
  const neutral = {
    id: `${task.caseId}.${treatmentId}.transport`,
    caseId: task.caseId,
    benchmarkProject: task.benchmarkProject,
    strategy: treatmentId === "raw-full-file" ? "raw-full-file" : "my-dev-kit-guided",
    complexityLevel: "short",
    title: task.title,
    promptText: "",
    warnings: []
  };
  return neutral as unknown as PromptVariant;
}

const PROVIDER_STATUS_CODES: Record<Exclude<AgentSuccessProviderStatus, "not-invoked" | "completed">, string> = {
  failed: "PROVIDER_FAILED",
  skipped: "PROVIDER_SKIPPED",
  timeout: "PROVIDER_TIMEOUT",
  "agent-unavailable": "PROVIDER_UNAVAILABLE",
  "agent-limit-reached": "PROVIDER_LIMIT_REACHED",
  "invalid-output": "PROVIDER_FAILED"
};

function toProviderStatus(status: string): AgentSuccessProviderStatus {
  switch (status) {
    case "completed":
    case "failed":
    case "skipped":
    case "timeout":
    case "agent-unavailable":
    case "agent-limit-reached":
    case "invalid-output":
      return status;
    default:
      return "failed";
  }
}

function tokenEvidence(result: AgentRunResult): AgentSuccessAgentTokenEvidenceV1 {
  const finite = (value: number | undefined): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
  return {
    // Only provider-, agent-, CLI- or telemetry-reported totals count; a text-length estimate is not provider usage.
    totalTokens: result.tokenUsageSource === "unavailable" || result.tokenUsageSource === "estimated-from-text" ? null : finite(result.tokenUsage.totalTokens),
    inputTokens: finite(result.tokenUsage.inputTokens),
    outputTokens: finite(result.tokenUsage.outputTokens),
    source: result.tokenUsageSource,
    reliability: result.tokenUsageReliability
  };
}

async function directoryHasEntries(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).length > 0;
  } catch {
    return false;
  }
}

async function assertNeutralCwd(cwd: string, protectedRoots: readonly string[]): Promise<boolean> {
  const physicalCwd = await resolvePhysicalPath(cwd);
  for (const root of protectedRoots) {
    const physicalRoot = await resolvePhysicalPath(root);
    if (isSameOrInside(physicalRoot, physicalCwd) || isSameOrInside(physicalCwd, physicalRoot)) return false;
  }
  return true;
}

/**
 * Builds the single-attempt proposal source for one case/treatment. It runs after the evaluable baseline is established
 * and returns either the provider's final answer (to be handed to the Lab-owned patch pipeline) or truthful
 * no-proposal evidence. It never reads the reference patch, trusted checks or edit scopes: it receives only the
 * agent-facing projection, the already-generated context and a leak guard.
 */
export function createRealAgentProposalSource(args: {
  settings: AgentSuccessRealAgentSettings;
  runId: string;
  task: AgentFacingTaskV1;
  contexts: Readonly<Record<AgentSuccessRateTreatmentId, AgentSuccessContextResult>>;
  forbidden: readonly ForbiddenAgentValue[];
  /** One-based attempt number; the initial attempt is 1. */
  attemptNumber?: AgentSuccessAttemptNumber;
  /** Repair attempts only: the harness-authored feedback about the previous attempt. */
  repair?: { feedback: AgentSuccessRepairFeedback; maxAttempts: number };
}): AgentSuccessProposalSource {
  const { settings } = args;
  const attemptNumber: AgentSuccessAttemptNumber = args.attemptNumber ?? 1;
  return async ({ treatmentId, invoke, notInvokedReason }): Promise<AgentSuccessProposal> => {
    const context = args.contexts[treatmentId];
    const task = args.task;
    const contextArtifactPath = context.text !== null ? agentSuccessContextArtifactPath(task.benchmarkProject, task.caseId, treatmentId) : null;
    const realAgent: AgentSuccessRealAgentEvidenceV1 = {
      providerId: settings.providerId,
      attempt: attemptNumber,
      promptTransport: "stdin",
      providerInvoked: false,
      providerStatus: "not-invoked",
      providerStatusReason: null,
      finalAnswerAvailable: false,
      promptChars: null,
      context: {
        contextMode: treatmentId,
        availability: context.availability,
        reason: context.reason,
        selectionPolicyId: context.selectionPolicyId,
        myDevKitVersion: context.myDevKitVersion,
        includedSourceFiles: [...context.includedSourceFiles],
        contextChars: context.contextChars,
        estimatedContextTokens: context.estimatedContextTokens,
        contextArtifactPath
      },
      agentArtifactDirectory: null,
      agentArtifacts: { prompt: null, result: null, stdout: null, stderr: null, telemetry: null },
      cwdCleanup: { attempted: false, removed: false, reason: null },
      ...(args.repair ? { repairFeedback: summarizeAgentSuccessRepairFeedback(args.repair.feedback) } : {})
    };
    let contextFile: AgentSuccessPatchFile | null = contextArtifactPath !== null && context.text !== null ? { relativePath: contextArtifactPath, content: context.text } : null;
    const noProposal = (
      reason: string,
      code: string,
      message: string,
      measured: { agentDurationMs?: number | null; agentTokenUsage?: AgentSuccessAgentTokenEvidenceV1 | null } = {}
    ): AgentSuccessProposal => {
      realAgent.providerStatusReason = boundMessage(reason, settings.privateRoots);
      return {
        kind: "no-proposal",
        realAgent,
        agentDurationMs: measured.agentDurationMs ?? null,
        agentTokenUsage: measured.agentTokenUsage ?? null,
        errors: [{ code, message: boundMessage(message, settings.privateRoots) }],
        contextFile
      };
    };

    if (!invoke) {
      realAgent.context.contextArtifactPath = null;
      realAgent.providerStatusReason = boundMessage(notInvokedReason ?? "not-invoked", settings.privateRoots);
      return { kind: "no-proposal", realAgent, agentDurationMs: null, agentTokenUsage: null, errors: [], contextFile: null };
    }

    if (context.availability === "unavailable" || context.text === null) {
      return noProposal(`context-unavailable: ${context.reason ?? "unknown"}`, "CONTEXT_UNAVAILABLE", `The ${treatmentId} context could not be built (${context.reason ?? "unknown"}); the provider was not invoked.`);
    }

    const promptText = buildAgentSuccessRealAgentPrompt({
      task,
      treatmentId,
      contextText: context.text,
      ...(args.repair ? { repair: { feedback: args.repair.feedback, attemptNumber, maxAttempts: args.repair.maxAttempts } } : {})
    });
    const leaks = findPromptLeaks(promptText, args.forbidden);
    if (leaks.length > 0) {
      contextFile = null;
      realAgent.context.contextArtifactPath = null;
      return noProposal("prompt-isolation-violation", "PROMPT_ISOLATION_VIOLATION", `The assembled prompt contained forbidden benchmark data (${leaks.join(", ")}); the provider was not invoked.`);
    }
    realAgent.promptChars = promptText.length;

    const attemptDirectory = agentSuccessAgentArtifactDirectory(task.benchmarkProject, task.caseId, treatmentId, attemptNumber);
    let attemptAbsolute: string;
    try {
      attemptAbsolute = resolveWithinRoot(settings.outDir, attemptDirectory);
    } catch {
      return noProposal("agent-artifact-path-invalid", "AGENT_ARTIFACT_PATH_INVALID", "The agent attempt directory could not be resolved inside the output root; the provider was not invoked.");
    }
    if (await directoryHasEntries(attemptAbsolute)) {
      return noProposal("agent-artifact-directory-exists", "AGENT_ARTIFACT_EXISTS", "The agent attempt directory already exists; the provider was not invoked and nothing was overwritten.");
    }

    // A fresh private working directory, disjoint from every protected root and removed after the single attempt.
    let neutralCwd: string | null = null;
    let result: AgentRunResult | null = null;
    let invocationError: string | null = null;
    const wallStarted = Date.now();
    try {
      neutralCwd = await mkdtemp(path.join(os.tmpdir(), "my-dev-kit-lab-asr-agent-"));
      if (!(await assertNeutralCwd(neutralCwd, settings.protectedRoots))) {
        invocationError = "cwd-not-neutral";
      } else {
        realAgent.providerInvoked = true;
        realAgent.agentArtifactDirectory = attemptDirectory;
        result = await settings.runAgent({
          runId: `${task.caseId}.${settings.providerId}.${treatmentId}${attemptNumber === 1 ? "" : `.repair${attemptNumber - 1}`}`,
          agentId: settings.providerId,
          promptVariant: buildTransportVariant(task, treatmentId),
          promptText,
          promptTransport: "stdin",
          timeoutMs: settings.timeoutMs,
          requireAvailable: false,
          env: settings.env,
          cwd: neutralCwd,
          outDir: attemptAbsolute
        });
      }
    } catch (error) {
      invocationError = error instanceof Error ? error.message : String(error);
    } finally {
      const cleanup: AgentSuccessCleanupEvidenceV1 = { attempted: neutralCwd !== null, removed: neutralCwd === null, reason: null };
      if (neutralCwd !== null) {
        try {
          await (settings.removeDirectory ?? ((directory: string) => rm(directory, { recursive: true, force: true })))(neutralCwd);
          cleanup.removed = true;
        } catch (error) {
          cleanup.removed = false;
          cleanup.reason = boundMessage(error instanceof Error ? error.message : String(error), [neutralCwd, ...settings.privateRoots]);
        }
      }
      realAgent.cwdCleanup = cleanup;
    }

    if (result === null) {
      const notNeutral = invocationError === "cwd-not-neutral";
      realAgent.providerInvoked = realAgent.providerInvoked && !notNeutral;
      if (!notNeutral) realAgent.providerStatus = "failed";
      if (notNeutral || !realAgent.providerInvoked) realAgent.agentArtifactDirectory = null;
      return noProposal(
        notNeutral ? "provider-cwd-not-neutral" : "provider-invocation-error",
        notNeutral ? "AGENT_CWD_NOT_NEUTRAL" : "PROVIDER_FAILED",
        notNeutral ? "The provider working directory overlapped a protected root; the provider was not invoked." : `The provider invocation raised an error: ${invocationError ?? "unknown"}`,
        { agentDurationMs: notNeutral ? null : Date.now() - wallStarted }
      );
    }

    // Provider health is classified with the answer text withheld: patch content must never be read as a limit/timeout.
    const classification = classifyAgentRunOutcome({ agentRunResult: { ...result, finalAnswerText: "" } });
    const providerStatus = toProviderStatus(classification.status);
    realAgent.providerStatus = providerStatus;
    const base = (name: string | undefined): string | null => (name ? `${attemptDirectory}/${path.basename(name)}` : null);
    realAgent.agentArtifacts = {
      prompt: `${attemptDirectory}/prompt.txt`,
      result: `${attemptDirectory}/agent-run-result.json`,
      stdout: base(result.stdoutPath),
      stderr: base(result.stderrPath),
      telemetry: base(result.telemetryPath)
    };
    const agentDurationMs = Number.isFinite(result.durationMs) && result.durationMs >= 0 ? result.durationMs : Date.now() - wallStarted;
    const agentTokenUsage = tokenEvidence(result);

    if (providerStatus !== "completed") {
      return noProposal(classification.statusReason, PROVIDER_STATUS_CODES[providerStatus as keyof typeof PROVIDER_STATUS_CODES] ?? "PROVIDER_FAILED", `Provider ${settings.providerId} ended with status ${providerStatus}: ${classification.statusReason}`, {
        agentDurationMs,
        agentTokenUsage
      });
    }
    if (result.finalAnswerText.trim() === "") {
      return noProposal("empty-final-answer", "PROVIDER_EMPTY_ANSWER", "The provider completed without a usable final answer.", { agentDurationMs, agentTokenUsage });
    }
    realAgent.finalAnswerAvailable = true;
    realAgent.providerStatusReason = null;
    return { kind: "proposal", text: result.finalAnswerText, realAgent, agentDurationMs, agentTokenUsage, errors: [] as AgentSuccessErrorV1[], contextFile };
  };
}
