import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CAMPAIGN_CHECKPOINT_SCHEMA } from "../../../src/experiments/plugins/agentSuccessRate/campaignCheckpoint.js";
import { CAMPAIGN_CHECKPOINT_SCHEMA_V2 } from "../../../src/experiments/plugins/agentSuccessRate/campaignRecovery.js";
import {
  CAMPAIGN_COMPONENTS,
  CAMPAIGN_IDENTITY_VERSION,
  CAMPAIGN_IDENTITY_VERSION_V2,
  campaignHash,
  canonicalCampaignJson,
  validateCampaignIdentity
} from "../../../src/experiments/plugins/agentSuccessRate/campaignIdentity.js";
import {
  PROMPT_CONTRACT_ARTIFACT_FILE,
  createPromptContract,
  promptContractDigest,
  renderPromptContractArtifact,
  type PromptContractSelection
} from "../../../src/experiments/plugins/agentSuccessRate/promptContract.js";

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
  /** Skip writing prompt-contract.json artifacts. */
  omitContractArtifacts?: boolean;
  /** Write a contract artifact that does not match the identity. */
  tamperContractArtifact?: boolean;
  /** Corrupt the checkpoint integrity digest. */
  tamperCheckpoint?: boolean;
  omitAnalysis?: boolean;
};

const VALID_DEFAULT: UnitSpec = { status: "completed", finalAnswer: true, patchOutcome: "success", failureCategory: "none", taskSuccess: true };

function digestOf(label: string): string {
  return campaignHash(label);
}

function cleanEvidence(spec: UnitSpec, caseId: string, treatmentId: string, attempt: 1 | 2, providerId: string, sandboxId: string, withDirectory: boolean) {
  const status = spec.status ?? "completed";
  const invoked = status !== "not-invoked";
  const finalAnswer = spec.finalAnswer ?? status === "completed";
  return {
    treatmentId,
    status: "completed",
    availability: "available",
    sandboxId,
    sandboxBaseline: null,
    baselineTextLineCount: null,
    baselineVerification: null,
    baselineAssessment: null,
    patch: { attempted: finalAnswer, outcome: spec.patchOutcome === undefined ? "success" : spec.patchOutcome, code: spec.patchCode ?? null, message: null, appliedFiles: [], rejections: [], attemptedProtectedPaths: [], proposedPatchBytes: 0 },
    change: null,
    postEditVerification: null,
    protectedIntegrity: { status: "intact", mutatedPaths: [] },
    timing: { agentDurationMs: null, baselineVerificationDurationMs: null, patchPipelineDurationMs: null, postEditVerificationDurationMs: null, evaluationDurationMs: null },
    agentTokenUsage: null,
    cleanup: { attempted: false, removed: false, reason: null },
    proposedPatchPath: null,
    appliedPatchPath: null,
    errors: (spec.errors ?? []).map((code) => ({ code, message: "bounded" })),
    realAgent: {
      providerId,
      attempt,
      promptTransport: "stdin",
      providerInvoked: invoked,
      providerStatus: status,
      providerStatusReason: null,
      finalAnswerAvailable: finalAnswer,
      promptChars: invoked ? 100 : null,
      context: { contextMode: treatmentId, availability: "available", reason: null, selectionPolicyId: "p", myDevKitVersion: null, includedSourceFiles: [], contextChars: 0, estimatedContextTokens: 0, contextArtifactPath: invoked ? "context/c.txt" : null },
      agentArtifactDirectory: invoked && withDirectory ? `agent/${caseId}/${treatmentId}/attempt-${attempt}` : null,
      agentArtifacts: { prompt: null, result: null, stdout: null, stderr: null, telemetry: null },
      cwdCleanup: { attempted: false, removed: false, reason: null }
    }
  };
}

function treatmentOf(spec: UnitSpec, caseId: string, treatmentId: string, providerId: string, dirs: string[]) {
  const first = cleanEvidence(spec, caseId, treatmentId, 1, providerId, `${caseId}-${treatmentId}-1`, true);
  if (first.realAgent.agentArtifactDirectory) dirs.push(first.realAgent.agentArtifactDirectory);
  const makeAttempt = (unit: UnitSpec, evidence: ReturnType<typeof cleanEvidence>, number: 1 | 2, eligible: boolean) => ({
    attemptNumber: number,
    providerId,
    providerStatus: unit.status ?? "completed",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: null,
    tokenUsage: null,
    proposedPatchAvailability: "unavailable",
    patchApplicationOutcome: "not-attempted",
    baselineAssessment: null,
    postEditVerification: null,
    changeEvidenceAvailability: "unavailable",
    taskSuccess: unit.taskSuccess === undefined ? true : unit.taskSuccess,
    failureCategory: unit.failureCategory ?? "none",
    repairEligible: eligible,
    cleanupResult: { attempted: false, removed: false, reason: null },
    evidence
  });
  const attempts = [makeAttempt(spec, first, 1, spec.repair !== undefined)];
  let final = first;
  if (spec.repair) {
    const second = cleanEvidence(spec.repair, caseId, treatmentId, 2, providerId, `${caseId}-${treatmentId}-2`, true);
    if (second.realAgent.agentArtifactDirectory) dirs.push(second.realAgent.agentArtifactDirectory);
    attempts.push(makeAttempt(spec.repair, second, 2, false));
    final = second;
  }
  return { ...final, attempts };
}

/** Writes a complete, validator-clean run root. Returns the absolute root. */
export async function writeComparisonRun(root: string, spec: RunSpec): Promise<void> {
  const providerId = spec.providerId ?? "codex";
  const contractSelection: PromptContractSelection = { templateId: spec.templateId ?? "legacy-diff-v1", ...spec.contract };
  const contract = createPromptContract(providerId, contractSelection);
  const repairAttempts = spec.repairAttempts ?? 0;
  const timeoutMs = spec.timeoutMs ?? 60000;
  const contractDirs: string[] = [];

  const cases = spec.cases.map((entry) => ({
    caseId: entry.caseId,
    caseName: entry.caseId,
    benchmarkProject: entry.projectId ?? "project-a",
    taskLocality: "localized",
    fixtureId: "f",
    treatments: [
      treatmentOf({ ...VALID_DEFAULT, ...entry.raw }, entry.caseId, "raw-full-file", providerId, contractDirs),
      treatmentOf({ ...VALID_DEFAULT, ...entry.pack }, entry.caseId, "context-pack", providerId, contractDirs)
    ]
  }));

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
    cases,
    realAgent: { providerId, timeoutMs, attemptsPerTreatment: (1 + repairAttempts) as 1 | 2 | 3, repairAttempts, promptTransport: "stdin" }
  };
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "agent-success-rate-execution.json"), JSON.stringify(execution));

  const components = Object.fromEntries(
    CAMPAIGN_COMPONENTS.map((name) => {
      const override = spec.componentOverrides?.[name];
      return [name, { version: "1", digest: override === undefined ? digestOf(`component-${name}`) : override }];
    })
  );
  const v2 = (spec.identity ?? "v2") === "v2";
  const body = {
    schemaVersion: v2 ? CAMPAIGN_IDENTITY_VERSION_V2 : CAMPAIGN_IDENTITY_VERSION,
    algorithm: "sha256",
    pluginContract: "agent-success-rate/1.0.0",
    selected: spec.cases.map((entry) => ({ caseId: entry.caseId, projectId: entry.projectId ?? "project-a", taskDigest: entry.taskDigest ?? digestOf(`task-${entry.caseId}`) })),
    treatmentOrder: ["raw-full-file", "context-pack"],
    config: { providerId, timeoutMs, repairAttempts },
    components,
    ...(v2 ? { promptContract: contract, promptContractDigest: promptContractDigest(contract) } : {})
  };
  const identity = { ...body, digest: campaignHash(canonicalCampaignJson(body)) };
  validateCampaignIdentity(identity);

  const checkpointBody = {
    schemaVersion: v2 ? CAMPAIGN_CHECKPOINT_SCHEMA_V2 : CAMPAIGN_CHECKPOINT_SCHEMA,
    identity,
    ...(v2 ? { runId: spec.runId } : {}),
    generation: 1,
    parentIntegrity: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:10:00.000Z",
    units: [],
    ...(v2 ? { finalization: null } : {})
  };
  const integrity = spec.tamperCheckpoint ? "0".repeat(64) : campaignHash(canonicalCampaignJson(checkpointBody));
  const store = path.join(root, v2 ? "campaign-checkpoints-v2" : "campaign-checkpoints", identity.digest);
  await mkdir(store, { recursive: true });
  await writeFile(path.join(store, "generation-0000000001.json"), JSON.stringify({ ...checkpointBody, integrity }));

  if (!spec.omitContractArtifacts) {
    const expected = spec.tamperContractArtifact
      ? renderPromptContractArtifact(createPromptContract(providerId, { ...contractSelection, templateId: contractSelection.templateId === "strict-diff-v1" ? "legacy-diff-v1" : "strict-diff-v1" }))
      : renderPromptContractArtifact(contract);
    for (const dir of contractDirs) {
      await mkdir(path.join(root, ...dir.split("/")), { recursive: true });
      await writeFile(path.join(root, ...dir.split("/"), PROMPT_CONTRACT_ARTIFACT_FILE), expected);
    }
  }
}
