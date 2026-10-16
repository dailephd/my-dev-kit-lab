import {
  CAMPAIGN_COMPONENTS,
  CAMPAIGN_IDENTITY_VERSION,
  CAMPAIGN_IDENTITY_VERSION_V2,
  type CampaignIdentity
} from "../../../src/experiments/plugins/agentSuccessRate/campaignIdentity.js";
import {
  createPromptContract,
  promptContractDigest,
  type PromptContractSelection
} from "../../../src/experiments/plugins/agentSuccessRate/promptContract.js";
import type { AgentSuccessRateExecutionArtifactV1 } from "../../../src/experiments/plugins/agentSuccessRate/executionArtifact.js";
import type { PromptComparisonSideEvidence } from "../../../src/report/experiments/promptTemplateComparisonModel.js";

// In-memory evidence for the pure comparison model. The model never reads files, so these sides carry exactly the
// fields it uses. Filesystem/campaign-integrity behavior is tested against real campaign outputs instead.

export type UnitSpec = {
  status?: "completed" | "timeout" | "agent-unavailable" | "agent-limit-reached" | "failed" | "invalid-output" | "not-invoked";
  finalAnswer?: boolean;
  errors?: string[];
  patchOutcome?: "parse-failure" | "policy-rejection" | "git-check-failure" | "git-apply-failure" | "success" | null;
  patchCode?: string | null;
  failureCategory?: string;
  taskSuccess?: boolean | null;
  /** A second (repair) attempt. */
  repair?: UnitSpec;
};

export type CaseSpec = { caseId: string; projectId?: string; taskDigest?: string; raw?: UnitSpec; pack?: UnitSpec };

export type RunSpec = {
  runId: string;
  providerId?: "codex" | "claude";
  templateId?: "legacy-diff-v1" | "strict-diff-v1";
  contract?: PromptContractSelection;
  identity?: "v1" | "v2";
  repairAttempts?: 0 | 1 | 2;
  timeoutMs?: number;
  cases: CaseSpec[];
  componentOverrides?: Partial<Record<(typeof CAMPAIGN_COMPONENTS)[number], string | null>>;
  unverifiedUnits?: Record<string, string>;
};

const VALID_DEFAULT: UnitSpec = { status: "completed", finalAnswer: true, patchOutcome: "success", failureCategory: "none", taskSuccess: true };

function evidenceOf(spec: UnitSpec, caseId: string, treatmentId: string, attempt: 1 | 2, providerId: string) {
  const status = spec.status ?? "completed";
  const invoked = status !== "not-invoked";
  const finalAnswer = spec.finalAnswer ?? status === "completed";
  return {
    treatmentId,
    status: "completed",
    availability: "available",
    sandboxId: `${caseId}-${treatmentId}-${attempt}`,
    patch: { attempted: finalAnswer, outcome: spec.patchOutcome === undefined ? "success" : spec.patchOutcome, code: spec.patchCode ?? null, message: null, appliedFiles: [], rejections: [], attemptedProtectedPaths: [], proposedPatchBytes: 0 },
    errors: (spec.errors ?? []).map((code) => ({ code, message: "bounded" })),
    realAgent: {
      providerId,
      attempt,
      promptTransport: "stdin",
      providerInvoked: invoked,
      providerStatus: status,
      providerStatusReason: null,
      finalAnswerAvailable: finalAnswer,
      agentArtifactDirectory: invoked ? `agent/${caseId}/${treatmentId}/attempt-${attempt}` : null
    }
  };
}

function treatmentOf(spec: UnitSpec, caseId: string, treatmentId: string, providerId: string) {
  const first = evidenceOf(spec, caseId, treatmentId, 1, providerId);
  const attemptOf = (unit: UnitSpec, evidence: ReturnType<typeof evidenceOf>, number: 1 | 2, eligible: boolean) => ({
    attemptNumber: number,
    providerId,
    providerStatus: unit.status ?? "completed",
    taskSuccess: unit.taskSuccess === undefined ? true : unit.taskSuccess,
    failureCategory: unit.failureCategory ?? "none",
    repairEligible: eligible,
    evidence
  });
  const attempts = [attemptOf(spec, first, 1, spec.repair !== undefined)];
  let final = first;
  if (spec.repair) {
    const second = evidenceOf(spec.repair, caseId, treatmentId, 2, providerId);
    attempts.push(attemptOf(spec.repair, second, 2, false));
    final = second;
  }
  return { ...final, attempts };
}

function digestOf(label: string): string {
  return label.padEnd(64, "0").slice(0, 64);
}

export function memorySide(role: "baseline" | "candidate", spec: RunSpec): PromptComparisonSideEvidence {
  const providerId = spec.providerId ?? "codex";
  const contract = createPromptContract(providerId, { templateId: spec.templateId ?? "legacy-diff-v1", ...spec.contract });
  const v2 = (spec.identity ?? "v2") === "v2";
  const components = Object.fromEntries(
    CAMPAIGN_COMPONENTS.map((name) => {
      const override = spec.componentOverrides?.[name];
      return [name, { version: "1", digest: override === undefined ? digestOf(`component-${name}`) : override }];
    })
  );
  const identity = {
    schemaVersion: v2 ? CAMPAIGN_IDENTITY_VERSION_V2 : CAMPAIGN_IDENTITY_VERSION,
    algorithm: "sha256",
    pluginContract: "agent-success-rate/1.0.0",
    digest: digestOf(`identity-${role}-${spec.runId}`),
    selected: spec.cases.map((entry) => ({ caseId: entry.caseId, projectId: entry.projectId ?? "project-a", taskDigest: entry.taskDigest ?? digestOf(`task-${entry.caseId}`) })),
    treatmentOrder: ["raw-full-file", "context-pack"],
    config: { providerId, timeoutMs: spec.timeoutMs ?? 60000, repairAttempts: spec.repairAttempts ?? 0 },
    components,
    ...(v2 ? { promptContract: contract, promptContractDigest: promptContractDigest(contract) } : {})
  } as unknown as CampaignIdentity;
  const execution = {
    schemaVersion: "my-dev-kit-lab-agent-success-rate-execution-v1",
    runId: spec.runId,
    pluginId: "agent-success-rate",
    pluginSchemaVersion: "1.0.0",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:10:00.000Z",
    executionMode: "real-agent",
    contextEffectEvaluated: true,
    treatmentOrder: ["raw-full-file", "context-pack"],
    cases: spec.cases.map((entry) => ({
      caseId: entry.caseId,
      treatments: [
        treatmentOf({ ...VALID_DEFAULT, ...entry.raw }, entry.caseId, "raw-full-file", providerId),
        treatmentOf({ ...VALID_DEFAULT, ...entry.pack }, entry.caseId, "context-pack", providerId)
      ]
    })),
    realAgent: { providerId, timeoutMs: spec.timeoutMs ?? 60000, attemptsPerTreatment: 1, repairAttempts: spec.repairAttempts ?? 0, promptTransport: "stdin" }
  } as unknown as AgentSuccessRateExecutionArtifactV1;
  return {
    role,
    identity,
    promptBasis: v2 ? "campaign-identity-v2-verified-contract" : "unverified",
    promptContract: v2 ? contract : null,
    execution,
    unverifiable: v2 ? [] : ["historical V1 prompt identity cannot be proven from independently bound template evidence"],
    unverifiedUnits: new Map(Object.entries(spec.unverifiedUnits ?? {})),
    warnings: []
  };
}
