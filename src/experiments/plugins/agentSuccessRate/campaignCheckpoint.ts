import type { AgentSuccessTaskV1 } from "../../../evaluation/agentSuccess/index.js";
import type { AgentSuccessTreatmentEvidenceV1 } from "./executionTypes.js";
import { agentSuccessPatchArtifactPath } from "./execution.js";
import { agentSuccessContextArtifactPath, agentSuccessAgentArtifactDirectory } from "./realAgentExecution.js";
import { classifyAgentSuccessAttempt } from "./repairPolicy.js";
import { analyzeAgentSuccessTreatment } from "./analysis.js";
import { campaignAssert, campaignExact, campaignHash, campaignIdentifier, canonicalCampaignJson, isCampaignDigest, validateCampaignIdentity, type CampaignIdentity } from "./campaignIdentity.js";

export const CAMPAIGN_CHECKPOINT_SCHEMA = "my-dev-kit-lab-agent-success-rate-campaign-checkpoint-v1";
export const CAMPAIGN_CHECKPOINT_MAX_BYTES = 16 * 1024 * 1024;
export type CampaignUnitState = "pending" | "in-progress" | "completed" | "incomplete" | "paused-limit";
export type CampaignArtifactIntegrity = { path: string; kind: "patch" | "context" | "provider"; sha256: string; bytes: number };
export type CampaignCompletion = { sourceSchema: "my-dev-kit-lab-agent-success-rate-execution-v1"; evidence: AgentSuccessTreatmentEvidenceV1; taskSuccess: boolean; artifacts: CampaignArtifactIntegrity[] };
export type CampaignCheckpoint = { schemaVersion: typeof CAMPAIGN_CHECKPOINT_SCHEMA; identity: CampaignIdentity; generation: number; parentIntegrity: string | null; createdAt: string; updatedAt: string; units: Array<{ caseId: string; treatmentId: "raw-full-file" | "context-pack"; state: CampaignUnitState; errorCode: "INTERRUPTED" | "INVALID_EVIDENCE" | "PROVIDER_LIMIT" | null; completion: CampaignCompletion | null }>; integrity: string };

type Rule = (value: unknown) => void;
const nullable = (rule: Rule): Rule => (v) => { if (v !== null) rule(v); };
const nil: Rule = (v) => campaignAssert(v === null);
const bool: Rule = (v) => campaignAssert(typeof v === "boolean");
const number: Rule = (v) => campaignAssert(typeof v === "number" && Number.isFinite(v) && v >= 0);
const integer: Rule = (v) => { number(v); campaignAssert(Number.isSafeInteger(v)); };
const identifier: Rule = (v) => campaignAssert(campaignIdentifier(v));
const digest: Rule = (v) => campaignAssert(isCampaignDigest(v));
const one = (...values: unknown[]): Rule => (v) => campaignAssert(values.includes(v));
const list = (rule: Rule, max = 2000): Rule => (v) => { campaignAssert(Array.isArray(v) && v.length <= max, "DATA_BOUND"); v.forEach(rule); };
const shape = (rules: Record<string, Rule>, optional: Record<string, Rule> = {}): Rule => (v) => {
  campaignAssert(typeof v === "object" && v !== null && !Array.isArray(v));
  const row = v as Record<string, unknown>;
  campaignAssert(Object.keys(row).every((k) => Object.hasOwn(rules, k) || Object.hasOwn(optional, k)));
  for (const [k, r] of Object.entries(rules)) r(row[k]);
  for (const [k, r] of Object.entries(optional)) if (Object.hasOwn(row, k)) r(row[k]);
};
const timestamp: Rule = (v) => campaignAssert(typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
export function validateCampaignRelativePath(v: unknown): asserts v is string {
  campaignAssert(typeof v === "string" && v.length > 0 && v.length <= 512 && /^[A-Za-z0-9._/-]+$/.test(v) && !v.startsWith("/") && v.split("/").every((p) => p !== "" && p !== "." && p !== ".." && !p.endsWith(".") && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)), "UNSAFE_PATH");
}
const rel: Rule = validateCampaignRelativePath;
const cleanup = shape({ attempted: bool, removed: bool, reason: nil });
const check = shape({ checkId: identifier, class: one("task", "regression"), status: one("passed", "failed", "timeout", "error"), exitCode: nullable((v) => campaignAssert(typeof v === "number" && Number.isSafeInteger(v))), durationMs: number, failureReason: nil });
const verification = shape({ phase: one("baseline", "post-edit"), taskResults: list(check), regressionResults: list(check) });
const assessment = shape({ evaluable: bool, reasons: list(one("NO_CHECKS", "ALL_TASK_CHECKS_PASSED", "REGRESSION_CHECK_FAILED", "CHECK_NOT_EVALUABLE"), 4) });
const token = shape({ totalTokens: nullable(integer), inputTokens: nullable(integer), outputTokens: nullable(integer), source: one("provider-reported", "agent-reported", "cli-json", "otel", "estimated-from-text", "unavailable"), reliability: one("high", "medium", "low", "unavailable") });
const providerStatus = one("not-invoked", "completed", "failed", "skipped", "timeout", "agent-unavailable", "agent-limit-reached", "invalid-output");
const failure = one("none", "patch-malformed", "patch-policy-rejected", "patch-check-failed", "patch-apply-failed", "task-check-failed", "regression-failed", "required-behavior-unsatisfied", "baseline-invalid", "context-unavailable", "provider-unavailable", "provider-limit-reached", "provider-timeout", "provider-failed", "provider-empty-answer", "provider-not-invoked", "infrastructure-failure", "cleanup-failed", "integrity-unproven", "integrity-mutated", "evidence-incomplete");
const feedback = shape({ basedOnAttempt: one(1, 2, 3), category: failure, patchProduced: bool, patchApplied: bool, taskChecks: one("all-passed", "some-failed", "not-evaluated"), regressionChecks: one("all-passed", "some-failed", "not-evaluated"), requiredBehavior: one("verified", "not-verified", "not-evaluated"), failedTaskCheckCount: nullable(integer), failedRegressionCheckCount: nullable(integer), previousPatchIncluded: bool, previousPatchTruncated: bool });
const realAgent = shape({ providerId: one("codex", "claude"), attempt: one(1, 2, 3), promptTransport: one("stdin"), providerInvoked: bool, providerStatus, providerStatusReason: nil, finalAnswerAvailable: bool, promptChars: nullable(integer), context: shape({ contextMode: one("raw-full-file", "context-pack"), availability: one("available", "partial", "unavailable"), reason: nil, selectionPolicyId: identifier, myDevKitVersion: nullable(identifier), includedSourceFiles: list(rel), contextChars: integer, estimatedContextTokens: integer, contextArtifactPath: nullable(rel) }), agentArtifactDirectory: nullable(rel), agentArtifacts: shape({ prompt: nullable(rel), result: nullable(rel), stdout: nullable(rel), stderr: nullable(rel), telemetry: nullable(rel) }), cwdCleanup: cleanup }, { repairFeedback: nullable(feedback) });
const fileStatus = one("added", "modified", "deleted");
const patch = shape({ attempted: bool, outcome: nullable(one("parse-failure", "policy-rejection", "git-check-failure", "git-apply-failure", "success")), code: nullable(identifier), message: nil, appliedFiles: list(shape({ path: rel, status: fileStatus })), rejections: list(shape({ code: identifier, path: nullable(rel) }), 20), attemptedProtectedPaths: list(rel), proposedPatchBytes: integer });
const change = shape({ baselineCommit: identifier, changedFiles: list(shape({ relativePath: rel, status: fileStatus, beforeSha256: nullable(digest), afterSha256: nullable(digest), additions: nullable(integer), deletions: nullable(integer) })), addedCount: integer, modifiedCount: integer, deletedCount: integer, changedCount: integer, totalAdditions: integer, totalDeletions: integer });
const baseRules = { treatmentId: one("raw-full-file", "context-pack"), status: one("completed", "partial", "failed", "skipped"), availability: one("complete", "baseline-invalid", "incomplete", "infrastructure-failure"), sandboxId: identifier, sandboxBaseline: nullable(shape({ commit: identifier, fileCount: integer, digest })), baselineTextLineCount: nullable(integer), baselineVerification: nullable(verification), baselineAssessment: nullable(assessment), patch, change: nullable(change), postEditVerification: nullable(verification), protectedIntegrity: shape({ status: one("intact", "mutated", "unproven"), mutatedPaths: list(rel) }), timing: shape({ agentDurationMs: nullable(number), baselineVerificationDurationMs: nullable(number), patchPipelineDurationMs: nullable(number), postEditVerificationDurationMs: nullable(number), evaluationDurationMs: nullable(number) }), agentTokenUsage: nullable(token), cleanup, proposedPatchPath: nullable(rel), appliedPatchPath: nullable(rel), errors: list(shape({ code: identifier, message: one("details-omitted") }), 100) };
const singleEvidence = shape(baseRules, { realAgent });
const attempt = shape({ attemptNumber: one(1, 2, 3), providerId: one("codex", "claude"), providerStatus, startedAt: timestamp, completedAt: timestamp, durationMs: nullable(number), tokenUsage: nullable(token), proposedPatchAvailability: one("available", "unavailable"), patchApplicationOutcome: one("parse-failure", "policy-rejection", "git-check-failure", "git-apply-failure", "success", "not-attempted"), baselineAssessment: nullable(assessment), postEditVerification: nullable(verification), changeEvidenceAvailability: one("available", "unavailable"), taskSuccess: nullable(bool), failureCategory: failure, repairEligible: bool, cleanupResult: cleanup, evidence: singleEvidence });
const treatment = shape(baseRules, { realAgent, attempts: list(attempt, 3) });

/** Discard free-form explanations only; unknown fields still fail the closed decoder. Original evidence is never mutated. */
export function projectCampaignTreatmentEvidence(source: AgentSuccessTreatmentEvidenceV1): AgentSuccessTreatmentEvidenceV1 {
  canonicalCampaignJson(source);
  const walk = (v: unknown): unknown => Array.isArray(v) ? v.map(walk) : v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "message" && Object.keys(v).length === 2 && Object.hasOwn(v, "code") ? "details-omitted" : ["message", "reason", "failureReason", "providerStatusReason"].includes(k) ? null : walk(x)])) : v;
  const result = walk(source); treatment(result); return result as AgentSuccessTreatmentEvidenceV1;
}

export function requiredCampaignArtifacts(e: AgentSuccessTreatmentEvidenceV1, task: AgentSuccessTaskV1, allowUnfinished = false): Array<{ path: string; kind: CampaignArtifactIntegrity["kind"] }> {
  const refs = new Map<string, CampaignArtifactIntegrity["kind"]>();
  const attempts = e.attempts?.map((a) => a.evidence) ?? [e];
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i]!;
    for (const kind of ["proposed", "applied"] as const) { const p = kind === "proposed" ? a.proposedPatchPath : a.appliedPatchPath; if (p !== null) { campaignAssert(p === agentSuccessPatchArtifactPath(task.benchmarkProject, task.id, a.treatmentId, kind, (i + 1) as 1 | 2 | 3)); campaignAssert(!refs.has(p)); refs.set(p, "patch"); } }
    const real = a.realAgent;
    if (real) {
      const context = real.context.contextArtifactPath;
      if (context !== null || !allowUnfinished) { campaignAssert(context === agentSuccessContextArtifactPath(task.benchmarkProject, task.id, a.treatmentId)); refs.set(context, "context"); }
      if (real.agentArtifactDirectory !== null || !allowUnfinished) campaignAssert(real.agentArtifactDirectory === agentSuccessAgentArtifactDirectory(task.benchmarkProject, task.id, a.treatmentId, (i + 1) as 1 | 2 | 3));
      else campaignAssert(!real.providerInvoked && Object.values(real.agentArtifacts).every(p => p === null), "MISSING_PROVIDER_REFERENCES");
      for (const [key, p] of Object.entries(real.agentArtifacts)) if (p !== null) { campaignAssert(real.agentArtifactDirectory !== null && p.startsWith(`${real.agentArtifactDirectory}/`) && !p.slice(real.agentArtifactDirectory.length + 1).includes("/") && /\.(json|txt|log)$/.test(p), "UNSAFE_PROVIDER_ARTIFACT"); campaignAssert(key !== "prompt" || p.endsWith(".txt")); campaignAssert(!refs.has(p)); refs.set(p, "provider"); }
    }
  }
  return [...refs].map(([path, kind]) => ({ path, kind })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export function validateCampaignCompletion(value: unknown, identity: CampaignIdentity, task: AgentSuccessTaskV1, treatmentId: string): asserts value is CampaignCompletion {
  validateCampaignIdentity(identity);
  campaignAssert(identity.selected.some((s) => s.caseId === task.id && s.projectId === task.benchmarkProject && s.taskDigest === campaignHash(canonicalCampaignJson(task))), "TASK_IDENTITY_MISMATCH");
  campaignExact(value, ["sourceSchema", "evidence", "taskSuccess", "artifacts"]);
  campaignAssert(value.sourceSchema === "my-dev-kit-lab-agent-success-rate-execution-v1"); bool(value.taskSuccess); treatment(value.evidence);
  const e = value.evidence as AgentSuccessTreatmentEvidenceV1;
  const rows = e.attempts?.map((a) => a.evidence) ?? [e];
  campaignAssert(rows.length > 0 && rows.length <= 1 + identity.config.repairAttempts);
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]!;
    campaignAssert(a.treatmentId === treatmentId && a.status === "completed" && a.availability === "complete" && a.cleanup.attempted && a.cleanup.removed && a.protectedIntegrity.status !== "unproven" && a.sandboxBaseline !== null && a.baselineAssessment?.evaluable === true && a.baselineAssessment.reasons.length === 0 && a.patch.attempted && a.patch.outcome !== null && a.proposedPatchPath !== null && a.baselineVerification !== null, "INCOMPLETE_EVIDENCE");
    campaignAssert(a.protectedIntegrity.status !== "intact" || a.protectedIntegrity.mutatedPaths.length === 0);
    campaignAssert(a.protectedIntegrity.status !== "mutated" || a.protectedIntegrity.mutatedPaths.length > 0);
    campaignAssert(a.protectedIntegrity.mutatedPaths.every((p) => task.protectedFiles.includes(p)), "PROTECTED_PROOF_MISMATCH");
    campaignAssert(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(a.sandboxBaseline.commit) && a.sandboxBaseline.fileCount > 0, "BASELINE_PROOF_MISMATCH");
    if (a.change !== null) {
      const changes = a.change;
      campaignAssert(changes.baselineCommit === a.sandboxBaseline.commit && changes.changedCount === changes.changedFiles.length && new Set(changes.changedFiles.map((f) => f.relativePath)).size === changes.changedFiles.length, "CHANGE_SUMMARY_MISMATCH");
      for (const [status, count] of [["added", changes.addedCount], ["modified", changes.modifiedCount], ["deleted", changes.deletedCount]] as const) campaignAssert(count === changes.changedFiles.filter((f) => f.status === status).length, "CHANGE_SUMMARY_MISMATCH");
      campaignAssert(changes.totalAdditions === changes.changedFiles.reduce((sum, f) => sum + (f.additions ?? 0), 0) && changes.totalDeletions === changes.changedFiles.reduce((sum, f) => sum + (f.deletions ?? 0), 0), "CHANGE_SUMMARY_MISMATCH");
      campaignAssert(changes.changedFiles.every((f) => f.status === "added" ? f.beforeSha256 === null && f.afterSha256 !== null : f.status === "deleted" ? f.beforeSha256 !== null && f.afterSha256 === null : f.beforeSha256 !== null && f.afterSha256 !== null), "CHANGE_DIGEST_MISMATCH");
    }
    campaignAssert((a.appliedPatchPath !== null) === (a.patch.outcome === "success")); campaignAssert(a.patch.outcome === "success" ? a.change !== null && a.postEditVerification !== null : a.change === null && a.postEditVerification === null);
    for (const [phase, v] of [["baseline", a.baselineVerification], ["post-edit", a.postEditVerification]] as const) {
      if (v === null) continue; campaignAssert(v.phase === phase);
      for (const [checkClass, definitions, results] of [["task", task.taskChecks, v.taskResults], ["regression", task.regressionChecks, v.regressionResults]] as const) {
        campaignAssert(results.length === definitions.length && results.every((r, j) => r.checkId === definitions[j]!.id && r.class === checkClass && ["passed", "failed"].includes(r.status) && (r.status === "passed" ? r.exitCode === 0 : r.exitCode !== null && r.exitCode !== 0)), "VERIFICATION_MISSING");
      }
    }
    campaignAssert(a.baselineVerification.taskResults.some((r) => r.status === "failed") && a.baselineVerification.regressionResults.every((r) => r.status === "passed"));
    if (identity.config.providerId === "deterministic-fixture") campaignAssert(a.realAgent === undefined && a.agentTokenUsage === null && a.timing.agentDurationMs === null);
    else { const r = a.realAgent; campaignAssert(r && r.providerId === identity.config.providerId && r.attempt === i + 1 && r.providerInvoked && r.providerStatus === "completed" && r.finalAnswerAvailable && r.cwdCleanup.attempted && r.cwdCleanup.removed && r.context.contextMode === treatmentId && r.context.availability !== "unavailable" && r.agentArtifacts.prompt !== null && r.agentArtifacts.result !== null); }
    const record = e.attempts?.[i];
    if (a.realAgent?.repairFeedback !== undefined && a.realAgent.repairFeedback !== null) campaignAssert(i > 0 && a.realAgent.repairFeedback.basedOnAttempt === i && a.realAgent.repairFeedback.category === e.attempts![i - 1]!.failureCategory, "REPAIR_FEEDBACK_MISMATCH");
    if (record) { const classification = classifyAgentSuccessAttempt(a, analyzeAgentSuccessTreatment(task, a).metrics); campaignAssert(record.failureCategory === classification.category && record.repairEligible === classification.repairEligible && record.taskSuccess === classification.taskSuccess && record.durationMs === a.timing.agentDurationMs && canonicalCampaignJson(record.tokenUsage) === canonicalCampaignJson(a.agentTokenUsage) && record.proposedPatchAvailability === (a.proposedPatchPath === null ? "unavailable" : "available") && record.patchApplicationOutcome === (a.patch.outcome ?? "not-attempted") && canonicalCampaignJson(record.baselineAssessment) === canonicalCampaignJson(a.baselineAssessment) && canonicalCampaignJson(record.postEditVerification) === canonicalCampaignJson(a.postEditVerification) && record.changeEvidenceAvailability === (a.change === null ? "unavailable" : "available")); campaignAssert(record.attemptNumber === i + 1 && record.providerId === identity.config.providerId && record.providerStatus === a.realAgent?.providerStatus && record.taskSuccess === (analyzeAgentSuccessTreatment(task, a).metrics.taskSuccess.value === true) && canonicalCampaignJson(record.cleanupResult) === canonicalCampaignJson(a.cleanup) && record.completedAt >= record.startedAt); if (i > 0) campaignAssert(e.attempts![i - 1]!.repairEligible && e.attempts![i - 1]!.taskSuccess === false); }
  }
  campaignAssert(new Set(rows.map((r) => r.sandboxId)).size === rows.length);
  if (e.attempts) { const { attempts: _attempts, ...final } = e; campaignAssert(canonicalCampaignJson(final) === canonicalCampaignJson(rows[rows.length - 1])); }
  campaignAssert(value.taskSuccess === (analyzeAgentSuccessTreatment(task, e).metrics.taskSuccess.value === true));
  const expected = requiredCampaignArtifacts(e, task);
  list(shape({ path: rel, kind: one("patch", "context", "provider"), sha256: digest, bytes: integer }), 32)(value.artifacts);
  const artifacts = value.artifacts as CampaignArtifactIntegrity[];
  campaignAssert(canonicalCampaignJson(artifacts.map(({ path, kind }) => ({ path, kind }))) === canonicalCampaignJson(expected), "ARTIFACT_REFERENCE_MISMATCH");
}

export function sealCampaignCheckpoint(body: Omit<CampaignCheckpoint, "integrity">): CampaignCheckpoint { return { ...body, integrity: campaignHash(canonicalCampaignJson(body)) }; }
export function validateCampaignCheckpoint(value: unknown, tasks: readonly AgentSuccessTaskV1[]): asserts value is CampaignCheckpoint {
  campaignAssert(Buffer.byteLength(canonicalCampaignJson(value)) <= CAMPAIGN_CHECKPOINT_MAX_BYTES, "DATA_BOUND");
  campaignExact(value, ["schemaVersion", "identity", "generation", "parentIntegrity", "createdAt", "updatedAt", "units", "integrity"]);
  campaignAssert(value.schemaVersion === CAMPAIGN_CHECKPOINT_SCHEMA, "UNSUPPORTED_SCHEMA"); validateCampaignIdentity(value.identity); integer(value.generation); campaignAssert(Number(value.generation) >= 1 && Number(value.generation) <= 1_000_000); nullable(digest)(value.parentIntegrity); timestamp(value.createdAt); timestamp(value.updatedAt); campaignAssert(String(value.updatedAt) >= String(value.createdAt));
  const identity = value.identity; campaignAssert(tasks.length === identity.selected.length && tasks.every((t, i) => t.id === identity.selected[i]!.caseId && t.benchmarkProject === identity.selected[i]!.projectId && campaignHash(canonicalCampaignJson(t)) === identity.selected[i]!.taskDigest), "TASK_IDENTITY_MISMATCH");
  campaignAssert(Array.isArray(value.units) && value.units.length === tasks.length * 2);
  for (let i = 0; i < value.units.length; i++) { const u = value.units[i]; campaignExact(u, ["caseId", "treatmentId", "state", "errorCode", "completion"]); const task = tasks[Math.floor(i / 2)]!; campaignAssert(u.caseId === task.id && u.treatmentId === value.identity.treatmentOrder[i % 2]); one("pending", "in-progress", "completed", "incomplete", "paused-limit")(u.state); nullable(one("INTERRUPTED", "INVALID_EVIDENCE", "PROVIDER_LIMIT"))(u.errorCode); if (u.state === "completed") { campaignAssert(u.errorCode === null); validateCampaignCompletion(u.completion, value.identity, task, String(u.treatmentId)); } else { campaignAssert(u.completion === null); campaignAssert(u.state === "paused-limit" ? u.errorCode === "PROVIDER_LIMIT" : u.state === "incomplete" ? ["INTERRUPTED", "INVALID_EVIDENCE"].includes(String(u.errorCode)) : u.errorCode === null); } }
  const { integrity, ...body } = value; campaignAssert(isCampaignDigest(integrity) && integrity === campaignHash(canonicalCampaignJson(body)), "CHECKPOINT_INTEGRITY");
}
export function createCampaignCheckpoint(identity: CampaignIdentity, tasks: readonly AgentSuccessTaskV1[], at: string): CampaignCheckpoint {
  const result = sealCampaignCheckpoint({ schemaVersion: CAMPAIGN_CHECKPOINT_SCHEMA, identity: structuredClone(identity), generation: 1, parentIntegrity: null, createdAt: at, updatedAt: at, units: identity.selected.flatMap((s) => identity.treatmentOrder.map((treatmentId) => ({ caseId: s.caseId, treatmentId, state: "pending" as const, errorCode: null, completion: null }))) }); validateCampaignCheckpoint(result, tasks); return result;
}
export function transitionCampaignCheckpoint(previous: CampaignCheckpoint, tasks: readonly AgentSuccessTaskV1[], index: number, next: CampaignUnitState, at: string, completion: CampaignCompletion | null = null, classifiedProviderOutcome: "agent-limit-reached" | null = null): CampaignCheckpoint {
  validateCampaignCheckpoint(previous, tasks); campaignAssert(Number.isSafeInteger(index) && index >= 0 && index < previous.units.length);
  campaignAssert(next !== "paused-limit" || (classifiedProviderOutcome === "agent-limit-reached" && previous.identity.config.providerId !== "deterministic-fixture"), "LIMIT_CLASSIFICATION_REQUIRED"); const state = previous.units[index]!.state;
  campaignAssert(state === "pending" ? next === "in-progress" : state === "in-progress" && ["completed", "incomplete", "paused-limit"].includes(next), "INVALID_TRANSITION");
  const { integrity, ...body } = structuredClone(previous); body.generation++; body.parentIntegrity = integrity; body.updatedAt = at;
  body.units[index] = { ...body.units[index]!, state: next, errorCode: next === "incomplete" ? "INTERRUPTED" : next === "paused-limit" ? "PROVIDER_LIMIT" : null, completion };
  const result = sealCampaignCheckpoint(body); validateCampaignCheckpoint(result, tasks); return result;
}
export function validateCampaignHistory(previous: CampaignCheckpoint, next: CampaignCheckpoint): void {
  campaignAssert(previous.identity.digest === next.identity.digest && next.generation === previous.generation + 1 && next.parentIntegrity === previous.integrity && next.createdAt === previous.createdAt && next.updatedAt >= previous.updatedAt, "INVALID_HISTORY");
  let changes = 0;
  previous.units.forEach((u, i) => { const v = next.units[i]!; if (canonicalCampaignJson(u) === canonicalCampaignJson(v)) return; changes++; campaignAssert(u.caseId === v.caseId && u.treatmentId === v.treatmentId && (u.state === "pending" ? v.state === "in-progress" : u.state === "in-progress" && ["completed", "incomplete", "paused-limit"].includes(v.state)), "INVALID_HISTORY"); });
  campaignAssert(changes === 1, "INVALID_HISTORY");
}
