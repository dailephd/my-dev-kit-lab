import type { AgentSuccessTaskV1 } from "../../../evaluation/agentSuccess/index.js";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { isSameOrInside, resolvePhysicalPath } from "../../../evaluation/benchmarkSandbox/pathPolicy.js";
import { normalizeAgentDurationV091 as normalizedDuration, normalizeAgentTokenUsageV091 as normalizedTokens } from "../../../agents/normalizeAgentTelemetry.js";
import { validateAgentSuccessRateExecutionArtifact, type AgentSuccessRateExecutionArtifactV1 } from "./executionArtifact.js";
import { validateAgentSuccessRateAnalysisArtifact, validateAgentSuccessRateArtifactFamily, type AgentSuccessRateAnalysisArtifactV1 } from "./analysisArtifact.js";
import { readCampaignCheckpointV2, type CampaignStoreBoundary } from "./campaignCheckpointStore.js";
import { campaignAssert, campaignExact, campaignHash, campaignIdentifier, canonicalCampaignJson, isCampaignDigest, type CampaignIdentity } from "./campaignIdentity.js";
import { CAMPAIGN_CHECKPOINT_SCHEMA_V2, type CampaignUnitV2 } from "./campaignRecovery.js";
import { campaignAttemptTelemetry, classifyCampaignEvidence, CAMPAIGN_QUANTITIES, QUALITY_REASONS, type CampaignComparisonEvidence } from "./campaignEvidenceQuality.js";

export const CAMPAIGN_PROGRESS_SCHEMA = "my-dev-kit-lab-agent-success-rate-campaign-progress-v1";
export const CAMPAIGN_UNIT_STATES = ["pending", "in-progress", "completed", "paused-limit", "incomplete", "uncertain"] as const;
export const CAMPAIGN_LIMITATIONS = [
  "Completed evaluation does not mean successful task outcome. Trusted task checks determine success.",
  "Matched subset values exclude unfinished or unavailable cases; pending outcomes are never failures.",
  "Differences are context-pack minus raw-full-file, with no ranking, composite score, significance test or causal inference.",
  "Duration is Lab wall-clock time, not provider-native execution time.",
  "Token channels do not prove direct measurement of every field. Estimates are not billing usage.",
  "Historical provider-limit epochs are operational history; only the authorized evaluated epoch contributes scientific evidence.",
  "Deterministic-fixture mode validates the evaluation pipeline; it measures no coding agent or context selection effect."
] as const;
export type CampaignProgressV1 = {
  schemaVersion: typeof CAMPAIGN_PROGRESS_SCHEMA; campaignIdentity: string; checkpointSchemaVersion: typeof CAMPAIGN_CHECKPOINT_SCHEMA_V2;
  checkpointGeneration: number; checkpointRevision: string; executionMode: "deterministic-fixture" | "provider";
  selectedCaseCount: number; totalTreatmentUnits: number; treatmentOrder: ["raw-full-file", "context-pack"];
  unitCounts: Record<CampaignUnitV2["state"], number>;
  caseCounts: { completed: number; partiallyCompleted: number; pending: number; paused: number; blockedUncertain: number };
  state: "complete" | "partial" | "pending" | "paused-limit" | "blocked-uncertain";
  completedCaseIds: string[]; unfinishedCaseIds: string[];
  cases: Array<{ caseId: string; state: keyof CampaignProgressV1["caseCounts"]; treatments: Array<{ treatmentId: "raw-full-file" | "context-pack"; state: CampaignUnitV2["state"]; evaluatedTaskSuccess: boolean | null; epochCount: number; historicalProviderLimitCount: number; diagnostics: Array<"PROVIDER_LIMIT" | "INVOCATION_UNCERTAIN" | "INCOMPLETE_EVALUATION">; attempts: ReturnType<typeof campaignAttemptTelemetry> }> }>;
  knownProviderLimit: boolean; knownUncertainty: boolean; scientificCompleteness: "complete" | "partial" | "unavailable";
  diagnostics: Array<"CHECKPOINT_PUBLICATION_UNRESOLVED" | "DISPATCH_OWNERSHIP_PRESENT" | "INVOCATION_UNCERTAIN" | "INCOMPLETE_EVALUATION" | "PROVIDER_LIMIT">;
  finalScientificArtifactsAvailable: boolean; comparisons: CampaignComparisonEvidence[]; limitations: string[];
};
export type ValidatedCampaignProgress = { readonly model: CampaignProgressV1 };
const snapshots = new WeakMap<ValidatedCampaignProgress, { boundary: CampaignStoreBoundary; canonical: string; checkpoint: import("./campaignRecovery.js").CampaignCheckpointV2 }>();
export function assertValidatedCampaignProgress(snapshot: ValidatedCampaignProgress, boundary: CampaignStoreBoundary): void {
  const proof = snapshots.get(snapshot);
  campaignAssert(proof && proof.boundary.outputRoot === boundary.outputRoot && proof.boundary.toolRoot === boundary.toolRoot && proof.canonical === canonicalCampaignJson(snapshot.model), "UNVALIDATED_PROGRESS_SNAPSHOT");
  validateCampaignProgress(snapshot.model);
}
function caseState(states: readonly CampaignUnitV2["state"][]): keyof CampaignProgressV1["caseCounts"] {
  if (states.every(s => s === "completed")) return "completed";
  if (states.some(s => ["in-progress", "incomplete", "uncertain"].includes(s))) return "blockedUncertain";
  if (states.includes("paused-limit")) return "paused";
  return states.includes("completed") ? "partiallyCompleted" : "pending";
}
/** Filesystem validation is mandatory; an absent, corrupt or untrusted checkpoint never becomes empty progress. */
export async function readCampaignProgress(boundary: CampaignStoreBoundary, identity: CampaignIdentity, tasks: readonly AgentSuccessTaskV1[]): Promise<ValidatedCampaignProgress> {
  const stored = await readCampaignCheckpointV2(boundary, identity, tasks);
  campaignAssert(stored.checkpoint && stored.identityVerification === "MATCH", "PROGRESS_CHECKPOINT_UNAVAILABLE");
  const cp = stored.checkpoint;
  // Presence is a blocker, never evidence of a stale owner or permission to remove its marker.
  const present = async (file: string) => {
    try { const s = await lstat(file); campaignAssert(s.isFile() && !s.isSymbolicLink(), "PROGRESS_OWNERSHIP_UNSAFE"); return true; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
  };
  const publicationUnresolved = stored.temporaryFiles.length > 0 || await present(path.join(boundary.outputRoot, "campaign-checkpoints-v2", identity.digest, "writer.json"));
  const dispatchPresent = await present(path.join(boundary.outputRoot, "campaign-dispatch.json"));
  const cases = tasks.map((task, i) => {
    const units = cp.units.slice(i * 2, i * 2 + 2);
    return { caseId: task.id, state: caseState(units.map(u => u.state)), treatments: units.map(u => ({ treatmentId: u.treatmentId, state: u.state, evaluatedTaskSuccess: u.completion?.taskSuccess ?? null, epochCount: u.epochs.length, historicalProviderLimitCount: u.epochs.slice(0, -1).filter(e => e.terminal?.reason === "provider-limit").length,
      diagnostics: (u.state === "paused-limit" ? ["PROVIDER_LIMIT"] : ["in-progress", "uncertain"].includes(u.state) ? ["INVOCATION_UNCERTAIN"] : u.state === "incomplete" ? ["INCOMPLETE_EVALUATION"] : []) as CampaignProgressV1["cases"][number]["treatments"][number]["diagnostics"], attempts: u.completion ? campaignAttemptTelemetry(u.completion.evidence) : [] })) };
  });
  const unitCounts = Object.fromEntries(CAMPAIGN_UNIT_STATES.map(s => [s, cp.units.filter(u => u.state === s).length])) as CampaignProgressV1["unitCounts"];
  const caseCounts = Object.fromEntries(["completed", "partiallyCompleted", "pending", "paused", "blockedUncertain"].map(s => [s, cases.filter(c => c.state === s).length])) as CampaignProgressV1["caseCounts"];
  const knownUncertainty = caseCounts.blockedUncertain > 0 || publicationUnresolved || dispatchPresent;
  const diagnostics: CampaignProgressV1["diagnostics"] = [];
  if (publicationUnresolved) diagnostics.push("CHECKPOINT_PUBLICATION_UNRESOLVED");
  if (dispatchPresent) diagnostics.push("DISPATCH_OWNERSHIP_PRESENT");
  if (unitCounts["in-progress"] || unitCounts.uncertain) diagnostics.push("INVOCATION_UNCERTAIN");
  if (unitCounts.incomplete) diagnostics.push("INCOMPLETE_EVALUATION");
  if (unitCounts["paused-limit"]) diagnostics.push("PROVIDER_LIMIT");
  const state = knownUncertainty ? "blocked-uncertain" : unitCounts["paused-limit"] ? "paused-limit" : unitCounts.completed === cp.units.length ? "complete" : unitCounts.completed ? "partial" : "pending";
  const model: CampaignProgressV1 = { schemaVersion: CAMPAIGN_PROGRESS_SCHEMA, campaignIdentity: cp.identity.digest, checkpointSchemaVersion: cp.schemaVersion, checkpointGeneration: cp.generation, checkpointRevision: cp.integrity, executionMode: cp.identity.config.providerId === "deterministic-fixture" ? "deterministic-fixture" : "provider", selectedCaseCount: tasks.length, totalTreatmentUnits: cp.units.length, treatmentOrder: ["raw-full-file", "context-pack"], unitCounts, caseCounts, state, completedCaseIds: cases.filter(c => c.state === "completed").map(c => c.caseId), unfinishedCaseIds: cases.filter(c => c.state !== "completed").map(c => c.caseId), cases, knownProviderLimit: unitCounts["paused-limit"] > 0, knownUncertainty, diagnostics, scientificCompleteness: unitCounts.completed === cp.units.length ? "complete" : unitCounts.completed ? "partial" : "unavailable", finalScientificArtifactsAvailable: cp.finalization !== null, comparisons: classifyCampaignEvidence(cp, tasks), limitations: [...CAMPAIGN_LIMITATIONS] };
  validateCampaignProgress(model);
  const snapshot = { model }; snapshots.set(snapshot, { boundary: { ...boundary }, canonical: canonicalCampaignJson(model), checkpoint: cp }); return snapshot;
}
/** Load only the existing finalized scientific family, bound to the exact snapshot's content proofs. */
export async function readCampaignProgressScientificFamily(snapshot: ValidatedCampaignProgress, boundary: CampaignStoreBoundary) {
  assertValidatedCampaignProgress(snapshot, boundary);
  const cp = snapshots.get(snapshot)!.checkpoint;
  if (!cp.finalization) return null;
  const load = async (name: string) => {
    const ref = cp.finalization!.artifacts.find(a => a.path === name)!;
    const file = path.join(boundary.outputRoot, name), stat = await lstat(file);
    const [physicalRoot, physicalFile] = await Promise.all([resolvePhysicalPath(boundary.outputRoot), resolvePhysicalPath(file)]);
    campaignAssert(stat.isFile() && !stat.isSymbolicLink() && stat.size === ref.bytes && isSameOrInside(physicalRoot, physicalFile) && path.dirname(physicalFile) === physicalRoot, "SCIENTIFIC_ARTIFACT_UNSAFE");
    const bytes = await readFile(file); campaignAssert(bytes.length === ref.bytes && campaignHash(bytes) === ref.sha256, "SCIENTIFIC_ARTIFACT_CHANGED"); return JSON.parse(bytes.toString("utf8"));
  };
  const execution = await load("agent-success-rate-execution.json") as AgentSuccessRateExecutionArtifactV1;
  const analysis = await load("agent-success-rate-analysis.json") as AgentSuccessRateAnalysisArtifactV1;
  campaignAssert([...validateAgentSuccessRateExecutionArtifact(execution), ...validateAgentSuccessRateAnalysisArtifact(analysis), ...validateAgentSuccessRateArtifactFamily(execution, analysis)].length === 0, "SCIENTIFIC_FAMILY_INVALID");
  return { execution, analysis };
}
/** Closed durable schema, including reconciliation of identities, counts, quality and measurement availability. */
export function validateCampaignProgress(value: unknown): asserts value is CampaignProgressV1 {
  campaignExact(value, ["schemaVersion", "campaignIdentity", "checkpointSchemaVersion", "checkpointGeneration", "checkpointRevision", "executionMode", "selectedCaseCount", "totalTreatmentUnits", "treatmentOrder", "unitCounts", "caseCounts", "state", "completedCaseIds", "unfinishedCaseIds", "cases", "knownProviderLimit", "knownUncertainty", "diagnostics", "scientificCompleteness", "finalScientificArtifactsAvailable", "comparisons", "limitations"]);
  const m = value as CampaignProgressV1;
  campaignAssert(m.schemaVersion === CAMPAIGN_PROGRESS_SCHEMA && m.checkpointSchemaVersion === CAMPAIGN_CHECKPOINT_SCHEMA_V2 && isCampaignDigest(m.campaignIdentity) && isCampaignDigest(m.checkpointRevision), "INVALID_PROGRESS_SCHEMA");
  const count = (n: unknown, max = 2000) => campaignAssert(Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= max, "INVALID_PROGRESS_COUNT");
  count(m.checkpointGeneration, 1_000_000); campaignAssert(m.checkpointGeneration > 0);
  count(m.selectedCaseCount, 1000); campaignAssert(m.selectedCaseCount > 0 && m.totalTreatmentUnits === 2 * m.selectedCaseCount && JSON.stringify(m.treatmentOrder) === '["raw-full-file","context-pack"]');
  campaignAssert(["provider", "deterministic-fixture"].includes(m.executionMode) && Array.isArray(m.cases) && m.cases.length === m.selectedCaseCount);
  campaignExact(m.unitCounts, CAMPAIGN_UNIT_STATES); campaignExact(m.caseCounts, ["completed", "partiallyCompleted", "pending", "paused", "blockedUncertain"]);
  const ids: string[] = [], states: CampaignUnitV2["state"][] = [];
  for (const c of m.cases) {
    campaignExact(c, ["caseId", "state", "treatments"]); campaignAssert(campaignIdentifier(c.caseId) && !ids.includes(c.caseId) && Array.isArray(c.treatments) && c.treatments.length === 2); ids.push(c.caseId);
    c.treatments.forEach((t, i) => {
      campaignExact(t, ["treatmentId", "state", "evaluatedTaskSuccess", "epochCount", "historicalProviderLimitCount", "diagnostics", "attempts"]);
      campaignAssert(t.treatmentId === m.treatmentOrder[i] && CAMPAIGN_UNIT_STATES.includes(t.state)); states.push(t.state); count(t.epochCount, 2); count(t.historicalProviderLimitCount, 1);
      campaignAssert(t.historicalProviderLimitCount < Math.max(1, t.epochCount) && (t.state === "completed" ? typeof t.evaluatedTaskSuccess === "boolean" : t.evaluatedTaskSuccess === null));
      const expected = t.state === "paused-limit" ? ["PROVIDER_LIMIT"] : ["in-progress", "uncertain"].includes(t.state) ? ["INVOCATION_UNCERTAIN"] : t.state === "incomplete" ? ["INCOMPLETE_EVALUATION"] : [];
      campaignAssert(JSON.stringify(t.diagnostics) === JSON.stringify(expected) && Array.isArray(t.attempts) && t.attempts.length <= 3 && (t.state === "completed" ? t.attempts.length > 0 : t.attempts.length === 0));
      t.attempts.forEach((a, j) => {
        campaignExact(a, ["attemptNumber", "providerInvoked", "duration", "tokens", "tokenInterpretation"]);
        campaignAssert(a.attemptNumber === j + 1 && typeof a.providerInvoked === "boolean");
        campaignExact(a.duration, ["durationMs", "source", "reason"]);
        campaignAssert(canonicalCampaignJson(a.duration) === canonicalCampaignJson(normalizedDuration(a.duration.durationMs)));
        campaignExact(a.tokens, ["source", "reliability", "evidenceLevel", "classificationReason", "numericAvailability", "condition", "totalTokens", "inputTokens", "outputTokens", "cachedInputTokens", "reasoningTokens", "numericReasons"]);
        campaignAssert(["provider-reported", "cli-json", "agent-reported", "otel", "estimated-from-text", "unavailable"].includes(a.tokens.source) && ["high", "medium", "low", "unavailable"].includes(a.tokens.reliability));
        const n = normalizedTokens({ source: a.tokens.source, ...(a.tokens.totalTokens === null ? {} : { totalTokens: a.tokens.totalTokens }), ...(a.tokens.inputTokens === null ? {} : { inputTokens: a.tokens.inputTokens }), ...(a.tokens.outputTokens === null ? {} : { outputTokens: a.tokens.outputTokens }) }, a.tokens.reliability);
        campaignAssert(canonicalCampaignJson(a.tokens) === canonicalCampaignJson(n));
        campaignAssert(a.tokenInterpretation === (a.tokens.source === "estimated-from-text" ? "estimated" : a.tokens.totalTokens === null ? "unavailable" : "recorded-with-channel-provenance"));
      });
    });
    campaignAssert(c.state === caseState(c.treatments.map(t => t.state)));
  }
  for (const s of CAMPAIGN_UNIT_STATES) { count(m.unitCounts[s]); campaignAssert(m.unitCounts[s] === states.filter(t => t === s).length); }
  for (const s of Object.keys(m.caseCounts) as Array<keyof typeof m.caseCounts>) { count(m.caseCounts[s]); campaignAssert(m.caseCounts[s] === m.cases.filter(c => c.state === s).length); }
  campaignAssert(JSON.stringify(m.completedCaseIds) === JSON.stringify(m.cases.filter(c => c.state === "completed").map(c => c.caseId)) && JSON.stringify(m.unfinishedCaseIds) === JSON.stringify(m.cases.filter(c => c.state !== "completed").map(c => c.caseId)));
  campaignAssert(m.knownProviderLimit === (m.unitCounts["paused-limit"] > 0) && typeof m.knownUncertainty === "boolean" && (m.caseCounts.blockedUncertain === 0 || m.knownUncertainty));
  campaignAssert(Array.isArray(m.diagnostics) && new Set(m.diagnostics).size === m.diagnostics.length && m.diagnostics.every(d => ["CHECKPOINT_PUBLICATION_UNRESOLVED", "DISPATCH_OWNERSHIP_PRESENT", "INVOCATION_UNCERTAIN", "INCOMPLETE_EVALUATION", "PROVIDER_LIMIT"].includes(d)));
  campaignAssert(m.knownUncertainty === (m.caseCounts.blockedUncertain > 0 || m.diagnostics.includes("CHECKPOINT_PUBLICATION_UNRESOLVED") || m.diagnostics.includes("DISPATCH_OWNERSHIP_PRESENT")) && m.diagnostics.includes("INVOCATION_UNCERTAIN") === (m.unitCounts["in-progress"] + m.unitCounts.uncertain > 0) && m.diagnostics.includes("INCOMPLETE_EVALUATION") === (m.unitCounts.incomplete > 0) && m.diagnostics.includes("PROVIDER_LIMIT") === m.knownProviderLimit);
  campaignAssert(m.state === (m.knownUncertainty ? "blocked-uncertain" : m.knownProviderLimit ? "paused-limit" : m.unitCounts.completed === m.totalTreatmentUnits ? "complete" : m.unitCounts.completed ? "partial" : "pending"));
  campaignAssert(m.scientificCompleteness === (m.unitCounts.completed === m.totalTreatmentUnits ? "complete" : m.unitCounts.completed ? "partial" : "unavailable") && typeof m.finalScientificArtifactsAvailable === "boolean" && (!m.finalScientificArtifactsAvailable || m.scientificCompleteness === "complete"));
  campaignAssert(Array.isArray(m.comparisons) && m.comparisons.length === CAMPAIGN_QUANTITIES.length);
  m.comparisons.forEach((q, i) => {
    campaignExact(q, ["quantity", "basis", "measurementBasis", "unit", "quality", "selectedCaseCount", "matchedCaseIds", "excludedCaseIds", "rawFullFileMean", "contextPackMean", "meanDifference", "reasons", "reasonExplanations"]);
    campaignAssert(q.quantity === CAMPAIGN_QUANTITIES[i] && q.selectedCaseCount === ids.length && Array.isArray(q.matchedCaseIds) && new Set(q.matchedCaseIds).size === q.matchedCaseIds.length);
    campaignAssert(JSON.stringify(q.matchedCaseIds) === JSON.stringify(ids.filter(id => q.matchedCaseIds.includes(id))) && q.matchedCaseIds.every(id => m.completedCaseIds.includes(id)) && JSON.stringify(q.excludedCaseIds) === JSON.stringify(ids.filter(id => !q.matchedCaseIds.includes(id))));
    const token = q.quantity.endsWith("Tokens"), duration = q.quantity.endsWith("Duration");
    campaignAssert(q.unit === (token ? "tokens" : duration ? "ms" : q.quantity === "regressionFailureCount" ? "count" : "ratio"));
    campaignAssert(q.basis === (q.quantity.startsWith("first") || q.quantity === "initialTaskSuccess" ? "first-attempt" : q.quantity.startsWith("total") ? "total-across-attempts" : "final-attempt") && q.measurementBasis === (token ? "recorded-token-channel" : duration ? "lab-wall-clock" : q.quantity.endsWith("TaskSuccess") ? "trusted-task-evaluation" : "trusted-check-evaluation"));
    campaignAssert(q.quality === (q.matchedCaseIds.length === 0 ? "unavailable" : q.excludedCaseIds.length || token ? "partial" : "strong"));
    for (const n of [q.rawFullFileMean, q.contextPackMean, q.meanDifference]) campaignAssert(q.quality === "unavailable" ? n === null : typeof n === "number" && Number.isFinite(n));
    campaignAssert(Array.isArray(q.reasons) && new Set(q.reasons).size === q.reasons.length && q.reasons.every(r => Object.hasOwn(QUALITY_REASONS, r)));
    campaignAssert(JSON.stringify(q.reasonExplanations) === JSON.stringify(q.reasons.map(r => QUALITY_REASONS[r])));
    campaignAssert(q.reasons.includes("NO_MATCHED_OBSERVATIONS") === (q.matchedCaseIds.length === 0) && q.reasons.includes("SELECTED_CASES_EXCLUDED") === (q.excludedCaseIds.length > 0) && (!token || q.quality === "unavailable" || q.reasons.includes("TOKEN_FIELD_PROVENANCE_UNPROVEN")));
  });
  campaignAssert(JSON.stringify(m.limitations) === JSON.stringify(CAMPAIGN_LIMITATIONS));
  canonicalCampaignJson(m);
}
