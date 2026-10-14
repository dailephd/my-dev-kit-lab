import { createHash } from "node:crypto";
import { validateAgentSuccessTask, type AgentSuccessTaskV1 } from "../../../evaluation/agentSuccess/index.js";
import { AGENT_SUCCESS_RATE_TREATMENT_IDS } from "./metadata.js";
import { assertPromptContractShape, promptContractDigest, type PromptContractV1 } from "./promptContract.js";

export const CAMPAIGN_IDENTITY_VERSION = "my-dev-kit-lab-agent-success-rate-campaign-identity-v1";
/** V2 extends V1 with the normalized prompt contract and its digest; V1 evidence stays readable and unchanged. */
export const CAMPAIGN_IDENTITY_VERSION_V2 = "my-dev-kit-lab-agent-success-rate-campaign-identity-v2";
export const CAMPAIGN_COMPONENTS = ["corpus", "tasks", "projects", "checks", "behavior", "context", "retrieval", "execution", "providerBuild"] as const;
export const CAMPAIGN_SOURCE_FILES = ["src/agents/types.ts", "src/agents/normalizeAgentTelemetry.ts", "src/agents/parseAgentTokenUsage.ts", "src/agents/runAgentPrompt.ts", "src/agents/adapters/codexAdapter.ts", "src/agents/adapters/claudeAdapter.ts", "src/evaluation/classifyAgentRunOutcome.ts", "src/experiments/plugins/agentSuccessRate/execution.ts", "src/experiments/plugins/agentSuccessRate/realAgentExecution.ts", "src/experiments/plugins/agentSuccessRate/contextGeneration.ts", "src/experiments/plugins/agentSuccessRate/repairExecution.ts", "src/experiments/plugins/agentSuccessRate/repairPolicy.ts", "src/experiments/plugins/agentSuccessRate/analysis.ts", "src/experiments/plugins/agentSuccessRate/plugin.ts"] as const;
/** Additional transitive execution/safety owners; a missing source contract cannot certify reuse. */
export const CAMPAIGN_DEPENDENCY_FILES = ["src/experiments/plugins/agentSuccessRate/executionTypes.ts", "src/experiments/plugins/agentSuccessRate/analysisTypes.ts", "src/experiments/plugins/agentSuccessRate/attemptEvidence.ts", "src/experiments/plugins/agentSuccessRate/campaignIdentity.ts", "src/experiments/plugins/agentSuccessRate/campaignCheckpoint.ts", "src/experiments/plugins/agentSuccessRate/campaignCheckpointStore.ts", "src/evaluation/agentSuccess/patchTypes.ts", "src/evaluation/agentSuccess/taskTypes.ts", "src/evaluation/agentSuccess/verificationTypes.ts", "src/evaluation/agentSuccess/corpusTypes.ts", "src/evaluation/benchmarkSandbox/types.ts", "src/evaluation/benchmarkSandbox/errors.ts", "src/evaluation/changeSet/types.ts","src/agents/agentRegistry.ts", "src/core/pathSafety.ts", "src/core/runMeasuredCommand.ts", "src/core/resolveCommand.ts", "src/core/processTree.ts", "src/core/fileGlobs.ts", "src/core/countTokens.ts", "src/core/commandLine.ts", "src/runtime/managedProcess.ts", "src/evaluation/runMyDevKitRetrieval.ts", "src/evaluation/agentSuccess/assessBaseline.ts", "src/evaluation/agentSuccess/applyPatchToSandbox.ts", "src/evaluation/agentSuccess/extractPatchCandidate.ts", "src/evaluation/agentSuccess/parseUnifiedDiff.ts", "src/evaluation/agentSuccess/runVerificationCheck.ts", "src/evaluation/agentSuccess/taskPaths.ts", "src/evaluation/agentSuccess/validatePatchPolicy.ts", "src/evaluation/agentSuccess/validateAgentSuccessTask.ts", "src/evaluation/agentSuccess/readAgentSuccessCorpus.ts", "src/evaluation/agentSuccess/validateAgentSuccessCorpus.ts", "src/evaluation/benchmarkSandbox/createBenchmarkSandbox.ts", "src/evaluation/benchmarkSandbox/removeBenchmarkSandbox.ts", "src/evaluation/benchmarkSandbox/pathPolicy.ts", "src/evaluation/benchmarkSandbox/treeSnapshot.ts", "src/evaluation/benchmarkSandbox/gitExecutor.ts", "src/evaluation/benchmarkSandbox/minimalHostEnv.ts", "src/evaluation/changeSet/captureChangeSet.ts", "src/experiments/plugins/agentSuccessRate/agentTaskProjection.ts", "src/experiments/plugins/agentSuccessRate/realAgentPrompt.ts", "src/experiments/plugins/agentSuccessRate/promptContract.ts", "src/experiments/plugins/agentSuccessRate/strictDiffResponse.ts", "src/experiments/plugins/agentSuccessRate/repairFeedback.ts", "src/experiments/plugins/agentSuccessRate/repairAnalysis.ts", "src/experiments/plugins/agentSuccessRate/metadata.ts", "src/experiments/plugins/agentSuccessRate/config.ts", "src/experiments/plugins/agentSuccessRate/executionArtifact.ts", "src/experiments/plugins/agentSuccessRate/analysisArtifact.ts", "src/experiments/outputPaths.ts"] as const;
export type CampaignIdentityV1 = {
  schemaVersion: typeof CAMPAIGN_IDENTITY_VERSION;
  algorithm: "sha256";
  pluginContract: "agent-success-rate/1.0.0";
  digest: string;
  selected: Array<{ caseId: string; projectId: string; taskDigest: string }>;
  treatmentOrder: ["raw-full-file", "context-pack"];
  config: { providerId: "codex" | "claude" | "deterministic-fixture"; timeoutMs: number; repairAttempts: 0 | 1 | 2 };
  components: Record<(typeof CAMPAIGN_COMPONENTS)[number], { version: "1"; digest: string | null }>;
};
export type CampaignIdentityV2 = Omit<CampaignIdentityV1, "schemaVersion"> & {
  schemaVersion: typeof CAMPAIGN_IDENTITY_VERSION_V2;
  promptContract: PromptContractV1;
  promptContractDigest: string;
};
export type CampaignIdentity = CampaignIdentityV1 | CampaignIdentityV2;

export function campaignAssert(condition: unknown, code = "INVALID_CHECKPOINT"): asserts condition {
  if (!condition) throw new Error(code);
}
export function campaignHash(bytes: string | Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
export function isCampaignDigest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
export function campaignIdentifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && value !== "." && value !== ".."; }

/** Bounded finite JSON canonicalization; arrays retain semantic order. No implicit undefined/NaN coercion. */
export function canonicalCampaignJson(value: unknown): string {
  let visited = 0;
  const encode = (v: unknown, depth: number): string => {
    campaignAssert(++visited <= 200_000 && depth <= 24, "DATA_BOUND");
    if (v === null || typeof v === "boolean") return JSON.stringify(v);
    if (typeof v === "number") { campaignAssert(Number.isFinite(v)); return JSON.stringify(v); }
    if (typeof v === "string") { campaignAssert(v.length <= 1_048_576, "DATA_BOUND"); return JSON.stringify(v); }
    if (Array.isArray(v)) { campaignAssert(v.length <= 10_000, "DATA_BOUND"); return `[${v.map((x) => encode(x, depth + 1)).join(",")}]`; }
    campaignAssert(typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype);
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${encode((v as Record<string, unknown>)[k], depth + 1)}`).join(",")}}`;
  };
  return encode(value, 0);
}
export function campaignExact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  campaignAssert(typeof value === "object" && value !== null && !Array.isArray(value));
  campaignAssert(Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"));
}

export function validateCampaignIdentity(value: unknown): asserts value is CampaignIdentity {
  const v2 = typeof value === "object" && value !== null && (value as Record<string, unknown>).schemaVersion === CAMPAIGN_IDENTITY_VERSION_V2;
  const baseKeys = ["schemaVersion", "algorithm", "pluginContract", "digest", "selected", "treatmentOrder", "config", "components"];
  campaignExact(value, v2 ? [...baseKeys, "promptContract", "promptContractDigest"] : baseKeys);
  campaignAssert(value.schemaVersion === (v2 ? CAMPAIGN_IDENTITY_VERSION_V2 : CAMPAIGN_IDENTITY_VERSION) && value.algorithm === "sha256" && value.pluginContract === "agent-success-rate/1.0.0", "INCOMPATIBLE_IDENTITY");
  campaignAssert(Array.isArray(value.selected) && value.selected.length > 0 && value.selected.length <= 1000);
  const ids = new Set<string>();
  for (const row of value.selected) { campaignExact(row, ["caseId", "projectId", "taskDigest"]); campaignAssert(campaignIdentifier(row.caseId) && campaignIdentifier(row.projectId) && isCampaignDigest(row.taskDigest) && !ids.has(row.caseId)); ids.add(row.caseId); }
  campaignAssert(canonicalCampaignJson(value.treatmentOrder) === canonicalCampaignJson(AGENT_SUCCESS_RATE_TREATMENT_IDS));
  campaignExact(value.config, ["providerId", "timeoutMs", "repairAttempts"]);
  campaignAssert(["codex", "claude", "deterministic-fixture"].includes(String(value.config.providerId)) && Number.isSafeInteger(value.config.timeoutMs) && Number(value.config.timeoutMs) > 0 && Number(value.config.timeoutMs) <= 1_800_000 && [0, 1, 2].includes(Number(value.config.repairAttempts)) && typeof value.config.repairAttempts === "number");
  campaignExact(value.components, CAMPAIGN_COMPONENTS);
  for (const name of CAMPAIGN_COMPONENTS) { const component = value.components[name]; campaignExact(component, ["version", "digest"]); campaignAssert(component.version === "1" && (component.digest === null || isCampaignDigest(component.digest))); }
  if (v2) {
    try { assertPromptContractShape(value.promptContract); } catch { campaignAssert(false, "PROMPT_CONTRACT_INVALID"); }
    const contract = value.promptContract as PromptContractV1;
    campaignAssert(contract.providerId === (value.config as { providerId: string }).providerId, "PROMPT_CONTRACT_PROVIDER_MISMATCH");
    campaignAssert(isCampaignDigest(value.promptContractDigest) && value.promptContractDigest === promptContractDigest(contract), "PROMPT_CONTRACT_DIGEST");
  }
  const { digest, ...body } = value;
  campaignAssert(isCampaignDigest(digest) && digest === campaignHash(canonicalCampaignJson(body)), "IDENTITY_INTEGRITY");
}

/** Trusted caller supplies current corpus/project/source bytes. Never reads paths, executes a provider, or stores bodies. */
export function createCampaignIdentity(input: {
  tasks: readonly AgentSuccessTaskV1[];
  corpusBytes: Uint8Array | null;
  projects: Array<{ projectId: string; files: Array<{ path: string; bytes: Uint8Array }> }> | null;
  sourceFiles: Array<{ path: string; bytes: Uint8Array }> | null;
  config: CampaignIdentity["config"];
  contextConfiguration: unknown;
  retrievalConfiguration: unknown;
  /** Actual trusted runtime observation bytes only; null when not observed. No provider is probed here. */
  verifiedProviderObservation: Uint8Array | null;
  /** Present only for a real-provider run with an explicit or non-legacy prompt contract; selects CampaignIdentityV2. */
  promptContract?: PromptContractV1 | null;
}): CampaignIdentity {
  campaignAssert(input.tasks.length > 0 && input.tasks.length <= 1000);
  input.tasks.forEach((t) => campaignAssert(validateAgentSuccessTask(t).ok));
  const digest = (v: unknown): string => campaignHash(canonicalCampaignJson(v));
  const manifest = (files: Array<{ path: string; bytes: Uint8Array }>): Array<{ path: string; digest: string }> => {
    campaignAssert(files.length <= 10_000 && new Set(files.map((f) => f.path)).size === files.length);
    return files.map((f) => { campaignAssert(typeof f.path === "string" && f.path.length <= 512 && !f.path.includes("\\") && !f.path.includes(":") && !f.path.startsWith("/") && f.path.split("/").every((p) => p !== "" && p !== "." && p !== "..") && !f.path.includes("\0")); return { path: f.path, digest: campaignHash(f.bytes) }; }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  };
  let source: string | null = null;
  if (input.sourceFiles !== null) { campaignAssert([...CAMPAIGN_SOURCE_FILES, ...CAMPAIGN_DEPENDENCY_FILES].every((required) => input.sourceFiles!.some((f) => f.path === required)), "SOURCE_CONTRACT_MISSING"); source = digest(manifest(input.sourceFiles)); }
  let projects: string | null = null;
  if (input.projects !== null) { campaignAssert([...input.projects.map((p) => p.projectId)].sort().join("\0") === [...new Set(input.tasks.map((t) => t.benchmarkProject))].sort().join("\0")); projects = digest(input.projects.map((p) => ({ projectId: p.projectId, files: manifest(p.files) })).sort((a, b) => a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0)); }
  const values = { corpus: input.corpusBytes === null ? null : campaignHash(input.corpusBytes), tasks: digest(input.tasks), projects, checks: digest(input.tasks.map((t) => ({ id: t.id, task: t.taskChecks, regression: t.regressionChecks, protected: t.protectedFiles }))), behavior: digest(input.tasks.map((t) => ({ id: t.id, facts: t.behaviorFacts, expected: t.expectedEditFiles, allowed: t.allowedEditFiles }))), context: input.contextConfiguration === null ? null : digest(input.contextConfiguration), retrieval: input.retrievalConfiguration === null ? null : digest(input.retrievalConfiguration), execution: source, providerBuild: input.config.providerId === "deterministic-fixture" ? digest("no-provider-invocation-v1") : input.verifiedProviderObservation === null ? null : campaignHash(input.verifiedProviderObservation) };
  const contract = input.promptContract ?? null;
  if (contract !== null) { assertPromptContractShape(contract); campaignAssert(input.config.providerId !== "deterministic-fixture" && contract.providerId === input.config.providerId, "PROMPT_CONTRACT_PROVIDER_MISMATCH"); }
  const body = { schemaVersion: contract === null ? CAMPAIGN_IDENTITY_VERSION : CAMPAIGN_IDENTITY_VERSION_V2, algorithm: "sha256" as const, pluginContract: "agent-success-rate/1.0.0" as const, selected: input.tasks.map((t) => ({ caseId: t.id, projectId: t.benchmarkProject, taskDigest: digest(t) })), treatmentOrder: [...AGENT_SUCCESS_RATE_TREATMENT_IDS] as CampaignIdentity["treatmentOrder"], config: structuredClone(input.config), components: Object.fromEntries(CAMPAIGN_COMPONENTS.map((key) => [key, { version: "1", digest: values[key] }])) as CampaignIdentity["components"], ...(contract === null ? {} : { promptContract: structuredClone(contract), promptContractDigest: promptContractDigest(contract) }) };
  const result = { ...body, digest: digest(body) } as CampaignIdentity; validateCampaignIdentity(result); return result;
}

export function compareCampaignIdentity(left: unknown, right: unknown): "MATCH" | "MISMATCH" | "UNVERIFIABLE" {
  try { validateCampaignIdentity(left); validateCampaignIdentity(right); } catch { return "UNVERIFIABLE"; }
  if (left.schemaVersion !== right.schemaVersion) return "MISMATCH";
  if (left.schemaVersion === CAMPAIGN_IDENTITY_VERSION_V2 && right.schemaVersion === CAMPAIGN_IDENTITY_VERSION_V2 && (canonicalCampaignJson(left.promptContract) !== canonicalCampaignJson(right.promptContract) || left.promptContractDigest !== right.promptContractDigest)) return "MISMATCH";
  if (canonicalCampaignJson(left.selected) !== canonicalCampaignJson(right.selected) || canonicalCampaignJson(left.config) !== canonicalCampaignJson(right.config)) return "MISMATCH";
  let missing = false;
  for (const name of CAMPAIGN_COMPONENTS) { const a = left.components[name]; const b = right.components[name]; if (a.digest === null || b.digest === null) missing = true; else if (a.version !== b.version || a.digest !== b.digest) return "MISMATCH"; }
  return missing ? "UNVERIFIABLE" : "MATCH";
}
