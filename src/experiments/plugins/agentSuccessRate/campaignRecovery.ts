import type { AgentSuccessTaskV1 } from "../../../evaluation/agentSuccess/index.js";
import type { AgentSuccessTreatmentEvidenceV1 } from "./executionTypes.js";
import { campaignAssert, campaignExact, campaignHash, campaignIdentifier, canonicalCampaignJson, isCampaignDigest, validateCampaignIdentity, type CampaignIdentity } from "./campaignIdentity.js";
import { CAMPAIGN_CHECKPOINT_MAX_BYTES, createCampaignCheckpoint, projectCampaignTreatmentEvidence, requiredCampaignArtifacts, validateCampaignCompletion, validateCampaignRelativePath, type CampaignArtifactIntegrity, type CampaignCompletion } from "./campaignCheckpoint.js";
import { analyzeAgentSuccessTreatment } from "./analysis.js";
import { classifyAgentSuccessAttempt } from "./repairPolicy.js";

export const CAMPAIGN_CHECKPOINT_SCHEMA_V2 = "my-dev-kit-lab-agent-success-rate-campaign-checkpoint-v2";
export const CAMPAIGN_EPOCH_SCHEMA = "campaign-invocation-epoch-v1";
export type CampaignLimitAuthorization = {
  identityDigest: string; generation: number; revision: string; caseId: string; treatmentId: string;
  acknowledgeInvocation: true; acknowledgeExternalLimit: true;
};
export type CampaignIntent = { kind: "new-resumable" } | { kind: "resume" }
  | { kind: "authorize-limit-continuation"; authorization: CampaignLimitAuthorization };
export type CampaignEpoch = {
  schemaVersion: typeof CAMPAIGN_EPOCH_SCHEMA; caseId: string; treatmentId: "raw-full-file" | "context-pack";
  ordinal: 1 | 2; id: string; previousEpochId: string | null; parentRevision: string;
  phase: "reserved" | "invocation-authorized" | "terminal" | "uncertain";
  configuration: CampaignIdentity["config"]; namespace: string;
  authorization: { intent: "initial"; scope: null } | { intent: "limit-continuation"; scope: CampaignLimitAuthorization };
  reservedAt: string; authorizedAt: string | null; terminalAt: string | null;
  terminal: { outcome: "completed" | "agent-limit-reached" | "failed" | "timeout" | "agent-unavailable" | "skipped" | "invalid-output" | "not-invoked";
    reason: "evaluated" | "provider-limit" | "incomplete"; evidence: AgentSuccessTreatmentEvidenceV1; artifacts: CampaignArtifactIntegrity[] } | null;
};
export type CampaignUnitV2 = {
  caseId: string; treatmentId: "raw-full-file" | "context-pack";
  state: "pending" | "in-progress" | "completed" | "paused-limit" | "incomplete" | "uncertain";
  epochs: CampaignEpoch[]; completion: CampaignCompletion | null;
};
export type CampaignCheckpointV2 = {
  schemaVersion: typeof CAMPAIGN_CHECKPOINT_SCHEMA_V2; identity: CampaignIdentity; runId: string;
  generation: number; parentIntegrity: string | null; createdAt: string; updatedAt: string;
  units: CampaignUnitV2[]; finalization: { completedAt: string; artifacts: CampaignArtifactIntegrity[] } | null; integrity: string;
};
const equal = (a: unknown, b: unknown) => canonicalCampaignJson(a) === canonicalCampaignJson(b);
function timestamp(value: unknown): asserts value is string {
  campaignAssert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value, "INVALID_TIMESTAMP");
}
function generation(value: unknown): asserts value is number { campaignAssert(Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 1_000_000, "INVALID_GENERATION"); }
export function campaignEpochNamespace(caseId: string, treatmentId: string, ordinal: number, id: string): string {
  campaignAssert(campaignIdentifier(caseId) && ["raw-full-file", "context-pack"].includes(treatmentId) && [1, 2].includes(ordinal) && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id), "INVALID_EPOCH_ID");
  // Compact, deterministic case/treatment labels leave room for Git's internal paths on Windows.
  // The full epoch UUID is retained (without separators); the marker also binds the full case identity.
  const relative = `campaign-epochs-v2/${campaignHash(caseId).slice(0, 12)}/${treatmentId === "raw-full-file" ? "raw" : "pack"}/${ordinal}-${id.replace(/-/g, "")}`;
  validateCampaignRelativePath(relative); return relative;
}
/** Only artifact references change. Source/check/protected paths and scientific evidence remain untouched. */
export function mapCampaignEpochEvidence(source: AgentSuccessTreatmentEvidenceV1, namespace: string, direction: "prefix" | "strip"): AgentSuccessTreatmentEvidenceV1 {
  validateCampaignRelativePath(namespace);
  const evidence = structuredClone(source);
  const map = (value: string | null): string | null => {
    if (value === null) return null;
    validateCampaignRelativePath(value);
    if (direction === "prefix") return `${namespace}/${value}`;
    campaignAssert(value.startsWith(`${namespace}/`), "EPOCH_ARTIFACT_SCOPE");
    const relative = value.slice(namespace.length + 1); validateCampaignRelativePath(relative); return relative;
  };
  const apply = (e: AgentSuccessTreatmentEvidenceV1) => {
    e.proposedPatchPath = map(e.proposedPatchPath); e.appliedPatchPath = map(e.appliedPatchPath);
    if (e.realAgent) {
      e.realAgent.context.contextArtifactPath = map(e.realAgent.context.contextArtifactPath);
      e.realAgent.agentArtifactDirectory = map(e.realAgent.agentArtifactDirectory);
      for (const key of Object.keys(e.realAgent.agentArtifacts) as Array<keyof typeof e.realAgent.agentArtifacts>) e.realAgent.agentArtifacts[key] = map(e.realAgent.agentArtifacts[key]);
    }
  };
  apply(evidence); evidence.attempts?.forEach(a => apply(a.evidence)); return evidence;
}
export function validateCampaignEpochArtifacts(value: unknown, expected: Array<{ path: string; kind: CampaignArtifactIntegrity["kind"] }>): asserts value is CampaignArtifactIntegrity[] {
  campaignAssert(Array.isArray(value) && value.length <= 32, "ARTIFACT_REFERENCE_MISMATCH");
  value.forEach(r => { campaignExact(r, ["path", "kind", "sha256", "bytes"]); validateCampaignRelativePath(r.path); campaignAssert(["patch", "context", "provider"].includes(String(r.kind)) && isCampaignDigest(r.sha256) && Number.isSafeInteger(r.bytes) && Number(r.bytes) >= 0 && Number(r.bytes) <= 32 * 1024 * 1024); });
  campaignAssert(equal(value.map(({ path, kind }) => ({ path, kind })), expected), "ARTIFACT_REFERENCE_MISMATCH");
}
export function validateCampaignLimitAuthorization(value: unknown, cp: CampaignCheckpointV2, unit: CampaignUnitV2): asserts value is CampaignLimitAuthorization {
  campaignExact(value, ["identityDigest", "generation", "revision", "caseId", "treatmentId", "acknowledgeInvocation", "acknowledgeExternalLimit"]);
  campaignAssert(value.identityDigest === cp.identity.digest && value.generation === cp.generation && value.revision === cp.integrity && value.caseId === unit.caseId && value.treatmentId === unit.treatmentId && value.acknowledgeInvocation === true && value.acknowledgeExternalLimit === true, "LIMIT_AUTHORIZATION_MISMATCH");
  const previous = unit.epochs.at(-1);
  campaignAssert(unit.state === "paused-limit" && unit.epochs.length === 1 && previous?.phase === "terminal" && previous.terminal?.reason === "provider-limit" && unit.completion === null, "LIMIT_CONTINUATION_NOT_ELIGIBLE");
}
export function sealCampaignCheckpointV2(body: Omit<CampaignCheckpointV2, "integrity">): CampaignCheckpointV2 { return { ...body, integrity: campaignHash(canonicalCampaignJson(body)) }; }
export function createCampaignCheckpointV2(identity: CampaignIdentity, tasks: readonly AgentSuccessTaskV1[], runId: string, at: string): CampaignCheckpointV2 {
  const old = createCampaignCheckpoint(identity, tasks, at);
  const cp = sealCampaignCheckpointV2({ schemaVersion: CAMPAIGN_CHECKPOINT_SCHEMA_V2, identity: structuredClone(identity), runId, generation: 1, parentIntegrity: null, createdAt: at, updatedAt: at, units: old.units.map(u => ({ caseId: u.caseId, treatmentId: u.treatmentId, state: "pending", epochs: [], completion: null })), finalization: null });
  validateCampaignCheckpointV2(cp, tasks); return cp;
}
export function validateCampaignCheckpointV2(value: unknown, tasks: readonly AgentSuccessTaskV1[]): asserts value is CampaignCheckpointV2 {
  campaignAssert(Buffer.byteLength(canonicalCampaignJson(value)) <= CAMPAIGN_CHECKPOINT_MAX_BYTES, "DATA_BOUND");
  campaignExact(value, ["schemaVersion", "identity", "runId", "generation", "parentIntegrity", "createdAt", "updatedAt", "units", "finalization", "integrity"]);
  campaignAssert(value.schemaVersion === CAMPAIGN_CHECKPOINT_SCHEMA_V2, "UNSUPPORTED_SCHEMA"); validateCampaignIdentity(value.identity);
  generation(value.generation); campaignAssert(campaignIdentifier(value.runId)); timestamp(value.createdAt); timestamp(value.updatedAt); campaignAssert(value.updatedAt >= value.createdAt && (value.parentIntegrity === null || isCampaignDigest(value.parentIntegrity)));
  const identity = value.identity; const createdAt = value.createdAt; const updatedAt = value.updatedAt;
  campaignAssert(tasks.length === identity.selected.length && tasks.every((t, i) => t.id === identity.selected[i]!.caseId && t.benchmarkProject === identity.selected[i]!.projectId && campaignHash(canonicalCampaignJson(t)) === identity.selected[i]!.taskDigest), "TASK_IDENTITY_MISMATCH");
  campaignAssert(Array.isArray(value.units) && value.units.length === tasks.length * 2);
  const ids = new Set<string>();
  value.units.forEach((u, index) => {
    campaignExact(u, ["caseId", "treatmentId", "state", "epochs", "completion"]);
    const task = tasks[Math.floor(index / 2)]!;
    campaignAssert(u.caseId === task.id && u.treatmentId === identity.treatmentOrder[index % 2] && Array.isArray(u.epochs) && u.epochs.length <= 2, "UNIT_IDENTITY");
    campaignAssert(["pending", "in-progress", "completed", "paused-limit", "incomplete", "uncertain"].includes(String(u.state)));
    const epochs = u.epochs;
    epochs.forEach((e, i) => {
      campaignExact(e, ["schemaVersion", "caseId", "treatmentId", "ordinal", "id", "previousEpochId", "parentRevision", "phase", "configuration", "namespace", "authorization", "reservedAt", "authorizedAt", "terminalAt", "terminal"]);
      campaignAssert(e.schemaVersion === CAMPAIGN_EPOCH_SCHEMA && e.caseId === u.caseId && e.treatmentId === u.treatmentId && e.ordinal === i + 1 && !ids.has(String(e.id)), "EPOCH_IDENTITY"); ids.add(String(e.id));
      campaignAssert(e.namespace === campaignEpochNamespace(String(u.caseId), String(u.treatmentId), i + 1, String(e.id)) && isCampaignDigest(e.parentRevision) && equal(e.configuration, identity.config), "EPOCH_CONFIGURATION");
      timestamp(e.reservedAt); campaignAssert(e.reservedAt >= createdAt && e.reservedAt <= updatedAt);
      campaignExact(e.authorization, ["intent", "scope"]);
      if (i === 0) campaignAssert(e.previousEpochId === null && e.authorization.intent === "initial" && e.authorization.scope === null);
      else {
        const prior = epochs[i - 1]!;
        campaignAssert(e.previousEpochId === prior.id && prior.phase === "terminal" && prior.terminal?.reason === "provider-limit" && e.authorization.intent === "limit-continuation", "EPOCH_CONTINUATION");
        const scope = e.authorization.scope; campaignExact(scope, ["identityDigest", "generation", "revision", "caseId", "treatmentId", "acknowledgeInvocation", "acknowledgeExternalLimit"]);
        generation(scope.generation); campaignAssert(scope.identityDigest === identity.digest && scope.revision === e.parentRevision && scope.caseId === u.caseId && scope.treatmentId === u.treatmentId && scope.acknowledgeInvocation === true && scope.acknowledgeExternalLimit === true && Number(scope.generation) < Number(value.generation));
      }
      campaignAssert(["reserved", "invocation-authorized", "terminal", "uncertain"].includes(String(e.phase)));
      if (e.phase === "reserved") campaignAssert(e.authorizedAt === null && e.terminalAt === null && e.terminal === null);
      else { timestamp(e.authorizedAt); campaignAssert(e.authorizedAt >= e.reservedAt && e.authorizedAt <= updatedAt); }
      if (e.phase !== "terminal") campaignAssert(e.terminalAt === null && e.terminal === null);
      else {
        timestamp(e.terminalAt); campaignAssert(e.terminalAt >= String(e.authorizedAt) && e.terminalAt <= updatedAt);
        const t = e.terminal; campaignExact(t, ["outcome", "reason", "evidence", "artifacts"]);
        campaignAssert(["evaluated", "provider-limit", "incomplete"].includes(String(t.reason)));
        const evidence = t.evidence as AgentSuccessTreatmentEvidenceV1;
        campaignAssert(equal(evidence, projectCampaignTreatmentEvidence(evidence)), "PRIVATE_OR_INVALID_EVIDENCE");
        const local = mapCampaignEpochEvidence(evidence, String(e.namespace), "strip");
        campaignAssert(local.treatmentId === u.treatmentId && t.outcome === (local.realAgent?.providerStatus ?? "not-invoked"), "TERMINAL_OUTCOME");
        const rows = local.attempts?.map(a => a.evidence) ?? [local]; campaignAssert(rows.length > 0 && rows.length <= 1 + identity.config.repairAttempts, "ATTEMPT_BOUND");
        rows.forEach((a, j) => campaignAssert(a.treatmentId === u.treatmentId && (!a.realAgent || (a.realAgent.providerId === identity.config.providerId && a.realAgent.attempt === j + 1)) && (!local.attempts || local.attempts[j]!.attemptNumber === j + 1), "ATTEMPT_IDENTITY"));
        if (local.attempts) {
          const { attempts: _attempts, ...final } = local; campaignAssert(equal(final, rows.at(-1)), "FINAL_ATTEMPT_MISMATCH");
          local.attempts.forEach((a, j) => {
            const row = rows[j]!; const classification = classifyAgentSuccessAttempt(row, analyzeAgentSuccessTreatment(task, row).metrics);
            campaignAssert(a.providerId === identity.config.providerId && a.providerStatus === row.realAgent?.providerStatus && a.failureCategory === classification.category && a.repairEligible === classification.repairEligible && a.taskSuccess === classification.taskSuccess && equal(a.cleanupResult, row.cleanup) && equal(a.tokenUsage, row.agentTokenUsage) && a.durationMs === row.timing.agentDurationMs && a.completedAt >= a.startedAt, "ATTEMPT_PROOF_MISMATCH");
            if (j > 0) campaignAssert(local.attempts![j - 1]!.repairEligible && local.attempts![j - 1]!.taskSuccess === false, "REPAIR_NOT_ELIGIBLE");
          });
        }
        campaignAssert(t.reason === "provider-limit" || t.outcome !== "agent-limit-reached", "LIMIT_CLASSIFICATION_REQUIRED");
        const expected = requiredCampaignArtifacts(local, task, t.reason !== "evaluated").map(r => ({ ...r, path: `${e.namespace}/${r.path}` }));
        validateCampaignEpochArtifacts(t.artifacts, expected);
        if (t.reason === "provider-limit") campaignAssert(t.outcome === "agent-limit-reached" && local.realAgent?.providerInvoked === true && local.availability !== "complete" && !local.patch.attempted && local.cleanup.attempted && local.cleanup.removed && local.realAgent.cwdCleanup.attempted && local.realAgent.cwdCleanup.removed && local.protectedIntegrity.status === "intact", "LIMIT_TERMINAL_PROOF");
        if (t.reason === "evaluated") {
          const completion: CampaignCompletion = { sourceSchema: "my-dev-kit-lab-agent-success-rate-execution-v1", evidence: local, taskSuccess: analyzeAgentSuccessTreatment(task, local).metrics.taskSuccess.value === true, artifacts: (t.artifacts as CampaignArtifactIntegrity[]).map(r => ({ ...r, path: r.path.slice(String(e.namespace).length + 1) })) };
          validateCampaignCompletion(completion, identity, task, String(u.treatmentId));
        }
      }
    });
    const last = u.epochs.at(-1);
    if (u.state === "pending") campaignAssert(last === undefined && u.completion === null);
    else {
      campaignAssert(last !== undefined);
      if (u.state === "in-progress") campaignAssert(["reserved", "invocation-authorized"].includes(last.phase));
      if (u.state === "uncertain") campaignAssert(last.phase === "uncertain");
      if (["completed", "paused-limit", "incomplete"].includes(String(u.state))) campaignAssert(last.phase === "terminal" && last.terminal?.reason === (u.state === "completed" ? "evaluated" : u.state === "paused-limit" ? "provider-limit" : "incomplete"));
      if (u.state === "completed") campaignAssert(equal(u.completion, { sourceSchema: "my-dev-kit-lab-agent-success-rate-execution-v1", evidence: last.terminal!.evidence, taskSuccess: analyzeAgentSuccessTreatment(task, last.terminal!.evidence).metrics.taskSuccess.value === true, artifacts: last.terminal!.artifacts }));
      else campaignAssert(u.completion === null);
    }
  });
  if (value.finalization !== null) {
    campaignExact(value.finalization, ["completedAt", "artifacts"]); timestamp(value.finalization.completedAt);
    campaignAssert(value.units.every(u => u.state === "completed") && value.finalization.completedAt <= value.updatedAt);
    validateCampaignEpochArtifacts(value.finalization.artifacts, [{ path: "agent-success-rate-analysis.json", kind: "provider" }, { path: "agent-success-rate-execution.json", kind: "provider" }]);
  }
  const { integrity, ...body } = value; campaignAssert(isCampaignDigest(integrity) && integrity === campaignHash(canonicalCampaignJson(body)), "CHECKPOINT_INTEGRITY");
}

export type CampaignRecoveryAction =
  | { kind: "reserve"; index: number; epochId: string; authorization?: CampaignLimitAuthorization }
  | { kind: "authorize"; index: number }
  | { kind: "uncertain"; index: number }
  | { kind: "terminal"; index: number; terminal: NonNullable<CampaignEpoch["terminal"]> }
  | { kind: "finalize"; finalization: NonNullable<CampaignCheckpointV2["finalization"]> };
export function transitionCampaignCheckpointV2(previous: CampaignCheckpointV2, tasks: readonly AgentSuccessTaskV1[], action: CampaignRecoveryAction, at: string): CampaignCheckpointV2 {
  validateCampaignCheckpointV2(previous, tasks); campaignAssert(previous.finalization === null, "COMPLETED_IMMUTABLE");
  const { integrity, ...body } = structuredClone(previous); body.generation++; body.parentIntegrity = integrity; body.updatedAt = at;
  if (action.kind === "finalize") { campaignAssert(body.units.every(u => u.state === "completed"), "INCOMPLETE_CAMPAIGN"); body.finalization = structuredClone(action.finalization); }
  else {
    campaignAssert(Number.isSafeInteger(action.index) && action.index >= 0 && action.index < body.units.length);
    campaignAssert(body.units.slice(0, action.index).every(u => u.state === "completed"), "QUEUE_ORDER");
    const u = body.units[action.index]!; const last = u.epochs.at(-1);
    campaignAssert(u.state !== "completed", "COMPLETED_IMMUTABLE");
    if (action.kind === "reserve") {
      if (action.authorization) validateCampaignLimitAuthorization(action.authorization, previous, previous.units[action.index]!);
      else campaignAssert(u.state === "pending" && u.epochs.length === 0, "UNIT_NOT_PENDING");
      const ordinal = (u.epochs.length + 1) as 1 | 2;
      const e: CampaignEpoch = { schemaVersion: CAMPAIGN_EPOCH_SCHEMA, caseId: u.caseId, treatmentId: u.treatmentId, ordinal, id: action.epochId, previousEpochId: last?.id ?? null, parentRevision: integrity, phase: "reserved", configuration: structuredClone(previous.identity.config), namespace: campaignEpochNamespace(u.caseId, u.treatmentId, ordinal, action.epochId), authorization: action.authorization ? { intent: "limit-continuation", scope: structuredClone(action.authorization) } : { intent: "initial", scope: null }, reservedAt: at, authorizedAt: null, terminalAt: null, terminal: null };
      u.epochs.push(e); u.state = "in-progress";
    } else {
      campaignAssert(last && u.state === "in-progress", "INVALID_EPOCH_TRANSITION");
      if (action.kind === "authorize") { campaignAssert(last.phase === "reserved"); last.phase = "invocation-authorized"; last.authorizedAt = at; }
      else { campaignAssert(last.phase === "invocation-authorized");
        if (action.kind === "uncertain") { last.phase = "uncertain"; u.state = "uncertain"; }
        else { last.phase = "terminal"; last.terminalAt = at; last.terminal = structuredClone(action.terminal); u.state = action.terminal.reason === "evaluated" ? "completed" : action.terminal.reason === "provider-limit" ? "paused-limit" : "incomplete";
          if (u.state === "completed") u.completion = { sourceSchema: "my-dev-kit-lab-agent-success-rate-execution-v1", evidence: structuredClone(action.terminal.evidence), taskSuccess: analyzeAgentSuccessTreatment(tasks[Math.floor(action.index / 2)]!, action.terminal.evidence).metrics.taskSuccess.value === true, artifacts: structuredClone(action.terminal.artifacts) };
        }
      }
    }
  }
  const result = sealCampaignCheckpointV2(body); validateCampaignCheckpointV2(result, tasks); return result;
}
/** Reconstruct the exact permitted transition; no last-writer-wins or arbitrary unit replacement. */
export function validateCampaignHistoryV2(previous: CampaignCheckpointV2, next: CampaignCheckpointV2, tasks: readonly AgentSuccessTaskV1[]): void {
  let action: CampaignRecoveryAction;
  if (previous.finalization === null && next.finalization !== null) action = { kind: "finalize", finalization: next.finalization };
  else {
    const changes = next.units.map((u, i) => equal(u, previous.units[i]) ? -1 : i).filter(i => i >= 0); campaignAssert(changes.length === 1, "INVALID_HISTORY");
    const index = changes[0]!; const a = previous.units[index]!, b = next.units[index]!; const e = b.epochs.at(-1); campaignAssert(e !== undefined, "INVALID_HISTORY");
    if (b.epochs.length === a.epochs.length + 1) action = { kind: "reserve", index, epochId: e.id, ...(e.authorization.intent === "limit-continuation" ? { authorization: e.authorization.scope } : {}) };
    else if (e.phase === "invocation-authorized") action = { kind: "authorize", index };
    else if (e.phase === "uncertain") action = { kind: "uncertain", index };
    else { campaignAssert(e.phase === "terminal" && e.terminal !== null, "INVALID_HISTORY"); action = { kind: "terminal", index, terminal: e.terminal }; }
  }
  campaignAssert(equal(transitionCampaignCheckpointV2(previous, tasks, action, next.updatedAt), next), "INVALID_HISTORY");
}
