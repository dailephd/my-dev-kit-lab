// Read-only evidence loader for the prompt-template comparison. It reads persisted agent-success-rate artifacts
// from one run root, reuses the existing pure validators, and never mutates the root or calls a checkpoint
// operation that writes. Every read is bounded, physically contained and re-checked for concurrent change.

import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isSafeRelativeArtifactPath } from "../../gallery/galleryPathSafety.js";
import {
  AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE,
  AGENT_SUCCESS_RATE_ANALYSIS_SCHEMA_VERSION,
  validateAgentSuccessRateAnalysisArtifact,
  validateAgentSuccessRateArtifactFamily,
  type AgentSuccessRateAnalysisArtifactV1
} from "../../experiments/plugins/agentSuccessRate/analysisArtifact.js";
import {
  AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE,
  AGENT_SUCCESS_RATE_EXECUTION_SCHEMA_VERSION,
  validateAgentSuccessRateExecutionArtifact,
  type AgentSuccessRateExecutionArtifactV1
} from "../../experiments/plugins/agentSuccessRate/executionArtifact.js";
import { CAMPAIGN_CHECKPOINT_MAX_BYTES, CAMPAIGN_CHECKPOINT_SCHEMA } from "../../experiments/plugins/agentSuccessRate/campaignCheckpoint.js";
import { CAMPAIGN_CHECKPOINT_SCHEMA_V2 } from "../../experiments/plugins/agentSuccessRate/campaignRecovery.js";
import {
  CAMPAIGN_IDENTITY_VERSION_V2,
  campaignHash,
  canonicalCampaignJson,
  validateCampaignIdentity,
  type CampaignIdentity
} from "../../experiments/plugins/agentSuccessRate/campaignIdentity.js";
import { AGENT_SUCCESS_RATE_PLUGIN_ID, AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE } from "../../experiments/plugins/agentSuccessRate/metadata.js";
import {
  PROMPT_CONTRACT_ARTIFACT_FILE,
  createPromptContract,
  renderPromptContractArtifact,
  type PromptContractV1
} from "../../experiments/plugins/agentSuccessRate/promptContract.js";
import type { PromptComparisonSideEvidence, PromptIdentityBasis } from "./promptTemplateComparisonModel.js";

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_PROMPT_CONTRACT_BYTES = 64 * 1024;
const MAX_CASES = 1000;
const MAX_REASON_LENGTH = 200;
const STORES = ["campaign-checkpoints-v2", "campaign-checkpoints"] as const;
const GENERATION = /^generation-(\d{10})\.json$/;

class EvidenceError extends Error {}

function reason(text: string): string {
  return text.length > MAX_REASON_LENGTH ? `${text.slice(0, MAX_REASON_LENGTH)}...` : text;
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Bounded read of one regular file physically inside `realRoot`; fails when the file changes during the read. */
async function readContained(realRoot: string, relative: string, maxBytes: number): Promise<Buffer> {
  if (!isSafeRelativeArtifactPath(relative)) throw new EvidenceError(`unsafe artifact path`);
  const target = path.resolve(realRoot, ...relative.split("/"));
  const real = await realpath(target).catch(() => {
    throw new EvidenceError(`${path.basename(relative)} is missing or unreadable`);
  });
  if (!within(realRoot, real)) throw new EvidenceError(`${path.basename(relative)} resolves outside the run root`);
  const before = await stat(real);
  if (!before.isFile()) throw new EvidenceError(`${path.basename(relative)} is not an ordinary file`);
  if (before.size > maxBytes) throw new EvidenceError(`${path.basename(relative)} exceeds the ${maxBytes}-byte limit`);
  const handle = await open(real, "r");
  try {
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < before.size) {
      const { bytesRead } = await handle.read(buffer, offset, before.size - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new EvidenceError(`${path.basename(relative)} changed while it was being read`);
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

async function readJson(realRoot: string, relative: string, maxBytes: number): Promise<unknown> {
  const bytes = await readContained(realRoot, relative, maxBytes);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new EvidenceError(`${path.basename(relative)} is not valid JSON`);
  }
}

type LoadedIdentity = { identity: CampaignIdentity; checkpointRunId: string | null };

async function loadIdentity(realRoot: string, execution: AgentSuccessRateExecutionArtifactV1): Promise<LoadedIdentity> {
  const found: LoadedIdentity[] = [];
  for (const store of STORES) {
    let identityDirs: string[];
    try {
      identityDirs = (await readdir(path.join(realRoot, store))).filter((name) => /^[a-f0-9]{64}$/.test(name)).sort();
    } catch {
      continue;
    }
    for (const dir of identityDirs) {
      let generations: string[];
      try {
        generations = (await readdir(path.join(realRoot, store, dir))).filter((name) => GENERATION.test(name)).sort();
      } catch {
        continue;
      }
      const latest = generations[generations.length - 1];
      if (!latest) continue;
      const value = (await readJson(realRoot, `${store}/${dir}/${latest}`, CAMPAIGN_CHECKPOINT_MAX_BYTES)) as Record<string, unknown>;
      const schema = value.schemaVersion;
      if (schema !== CAMPAIGN_CHECKPOINT_SCHEMA && schema !== CAMPAIGN_CHECKPOINT_SCHEMA_V2) throw new EvidenceError("checkpoint schema is not supported");
      const { integrity, ...body } = value;
      if (typeof integrity !== "string" || integrity !== campaignHash(canonicalCampaignJson(body))) throw new EvidenceError("checkpoint integrity digest does not verify");
      try {
        validateCampaignIdentity(value.identity);
      } catch (error) {
        throw new EvidenceError(`campaign identity is invalid (${error instanceof Error ? error.message : "unknown"})`);
      }
      const identity = value.identity as CampaignIdentity;
      if (identity.digest !== dir) throw new EvidenceError("checkpoint directory does not match its campaign identity digest");
      found.push({ identity, checkpointRunId: schema === CAMPAIGN_CHECKPOINT_SCHEMA_V2 && typeof value.runId === "string" ? value.runId : null });
    }
  }
  const byRun = found.filter((entry) => entry.checkpointRunId === execution.runId);
  const candidates = byRun.length > 0 ? byRun : found.filter((entry) => entry.checkpointRunId === null);
  if (candidates.length === 0) throw new EvidenceError("no campaign identity checkpoint matches the execution run");
  if (candidates.length > 1) throw new EvidenceError("more than one campaign identity checkpoint matches the execution run");
  return candidates[0] as LoadedIdentity;
}

/** Loads and verifies one side. Verification failures become `unverifiable` reasons, never an exception. */
export async function loadPromptComparisonSide(rootPath: string, role: "baseline" | "candidate"): Promise<PromptComparisonSideEvidence> {
  const side: PromptComparisonSideEvidence = {
    role,
    identity: null,
    promptBasis: "unverified",
    promptContract: null,
    execution: null,
    unverifiable: [],
    unverifiedUnits: new Map(),
    warnings: []
  };
  let realRoot: string;
  try {
    realRoot = await realpath(rootPath);
    if (!(await stat(realRoot)).isDirectory()) throw new Error("not a directory");
  } catch {
    side.unverifiable.push("run root does not exist or is not a readable directory");
    return side;
  }

  let execution: AgentSuccessRateExecutionArtifactV1;
  try {
    const raw = (await readJson(realRoot, AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE, MAX_ARTIFACT_BYTES)) as AgentSuccessRateExecutionArtifactV1;
    if (typeof raw !== "object" || raw === null || raw.schemaVersion !== AGENT_SUCCESS_RATE_EXECUTION_SCHEMA_VERSION) throw new EvidenceError("execution artifact schema is not supported");
    if (raw.pluginId !== AGENT_SUCCESS_RATE_PLUGIN_ID) throw new EvidenceError("execution artifact plugin identity does not match");
    if (typeof raw.runId !== "string" || raw.runId.length === 0 || raw.runId.length > 200) throw new EvidenceError("execution artifact run identity is missing");
    if (!Array.isArray(raw.cases) || raw.cases.length > MAX_CASES) throw new EvidenceError("execution artifact case list is missing or too large");
    const problems = validateAgentSuccessRateExecutionArtifact(raw);
    if (problems.length > 0) throw new EvidenceError(`execution artifact is inconsistent (${problems.slice(0, 3).join("; ")})`);
    if (raw.executionMode !== AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE || !raw.realAgent) throw new EvidenceError("execution artifact is not a real-agent run");
    execution = raw;
    side.execution = raw;
  } catch (error) {
    side.unverifiable.push(reason(`execution evidence: ${error instanceof Error ? error.message : "unreadable"}`));
    return side;
  }

  try {
    const analysisRaw = await readJson(realRoot, AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE, MAX_ARTIFACT_BYTES).catch((error: unknown) => {
      if (error instanceof EvidenceError && /missing or unreadable/.test(error.message)) return null;
      throw error;
    });
    if (analysisRaw === null) {
      side.warnings.push("analysis artifact is absent; task-success verdicts come from persisted attempt evidence");
    } else {
      const analysis = analysisRaw as AgentSuccessRateAnalysisArtifactV1;
      if (analysis.schemaVersion !== AGENT_SUCCESS_RATE_ANALYSIS_SCHEMA_VERSION) throw new EvidenceError("analysis artifact schema is not supported");
      const problems = [...validateAgentSuccessRateAnalysisArtifact(analysis), ...validateAgentSuccessRateArtifactFamily(execution, analysis)];
      if (problems.length > 0) throw new EvidenceError(`analysis artifact is inconsistent (${problems.slice(0, 3).join("; ")})`);
    }
  } catch (error) {
    side.unverifiable.push(reason(`analysis evidence: ${error instanceof Error ? error.message : "unreadable"}`));
    return side;
  }

  let loaded: LoadedIdentity;
  try {
    loaded = await loadIdentity(realRoot, execution);
  } catch (error) {
    side.unverifiable.push(reason(`campaign identity: ${error instanceof Error ? error.message : "unreadable"}`));
    return side;
  }
  const identity = loaded.identity;
  side.identity = identity;

  const run = execution.realAgent as NonNullable<AgentSuccessRateExecutionArtifactV1["realAgent"]>;
  const executedIds = execution.cases.map((c) => c.caseId).sort();
  const selectedIds = identity.selected.map((row) => row.caseId).sort();
  if (identity.config.providerId !== run.providerId || identity.config.timeoutMs !== run.timeoutMs || identity.config.repairAttempts !== (run.repairAttempts ?? 0)) {
    side.unverifiable.push("campaign identity configuration disagrees with the execution run settings");
  }
  if (executedIds.join("\0") !== selectedIds.join("\0")) side.unverifiable.push("campaign identity cases differ from the executed cases");
  if (side.unverifiable.length > 0) return side;

  // Prompt identity: V2 carries a verified contract; V1 real-provider identity is the legacy default.
  let expected: PromptContractV1;
  let basis: PromptIdentityBasis;
  if (identity.schemaVersion === CAMPAIGN_IDENTITY_VERSION_V2) {
    expected = identity.promptContract;
    basis = "campaign-identity-v2-verified-contract";
  } else if (identity.config.providerId === "codex" || identity.config.providerId === "claude") {
    expected = createPromptContract(identity.config.providerId);
    basis = "legacy-v1-default-identity";
  } else {
    side.unverifiable.push("a deterministic-fixture identity carries no prompt template");
    return side;
  }
  const expectedBytes = renderPromptContractArtifact(expected);
  let verified = 0;
  for (const entry of execution.cases) {
    for (const treatment of entry.treatments) {
      const key = `${entry.caseId}/${treatment.treatmentId}`;
      const first = treatment.attempts && treatment.attempts.length > 0 ? treatment.attempts[0]!.evidence : treatment;
      const directory = first.realAgent?.agentArtifactDirectory ?? null;
      if (directory === null) continue; // provider not invoked: nothing was prompted
      try {
        const bytes = (await readContained(realRoot, `${directory}/${PROMPT_CONTRACT_ARTIFACT_FILE}`, MAX_PROMPT_CONTRACT_BYTES)).toString("utf8");
        if (bytes !== expectedBytes) {
          side.unverifiable.push(reason(`prompt contract artifact for ${key} does not match the campaign identity`));
          return side;
        }
        verified += 1;
      } catch (error) {
        if (basis === "legacy-v1-default-identity" && error instanceof EvidenceError && /missing or unreadable/.test(error.message)) continue; // pre-contract run
        side.unverifiedUnits.set(key, "prompt-contract-unverified");
      }
    }
  }
  side.promptContract = expected;
  side.promptBasis = basis;
  if (basis === "campaign-identity-v2-verified-contract" && verified === 0) {
    side.unverifiable.push("no persisted prompt-contract.json artifact could verify the campaign identity's prompt contract");
    side.promptBasis = "unverified";
  }
  return side;
}
