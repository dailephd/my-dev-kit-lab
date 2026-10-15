// Read-only evidence loader for the prompt-template comparison. It reads persisted agent-success-rate artifacts
// from one run root and verifies them with the campaign owners' own validators: the complete checkpoint store
// read (every generation, history, artifact integrity, V2 authorization state) against trusted task definitions
// that are authenticated by the persisted campaign identity's task digests. Nothing is written, no provider is
// invoked, and every read is bounded, physically contained and change-detected.

import { statSync } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSafeRelativeArtifactPath } from "../../gallery/galleryPathSafety.js";
import { assertReadAgentSuccessCorpus, type AgentSuccessTaskV1 } from "../../evaluation/agentSuccess/index.js";
import {
  AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE,
  AGENT_SUCCESS_RATE_ANALYSIS_SCHEMA_VERSION,
  validateAgentSuccessRateAnalysisArtifact,
  validateAgentSuccessRateArtifactFamily,
  type AgentSuccessRateAnalysisArtifactV1
} from "../../experiments/plugins/agentSuccessRate/analysisArtifact.js";
import { attemptEvidenceOf } from "../../experiments/plugins/agentSuccessRate/attemptEvidence.js";
import {
  AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE,
  AGENT_SUCCESS_RATE_EXECUTION_SCHEMA_VERSION,
  validateAgentSuccessRateExecutionArtifact,
  type AgentSuccessRateExecutionArtifactV1
} from "../../experiments/plugins/agentSuccessRate/executionArtifact.js";
import { CAMPAIGN_CHECKPOINT_MAX_BYTES, CAMPAIGN_CHECKPOINT_SCHEMA } from "../../experiments/plugins/agentSuccessRate/campaignCheckpoint.js";
import { readCampaignCheckpoint, readCampaignCheckpointV2 } from "../../experiments/plugins/agentSuccessRate/campaignCheckpointStore.js";
import { CAMPAIGN_CHECKPOINT_SCHEMA_V2, type CampaignCheckpointV2 } from "../../experiments/plugins/agentSuccessRate/campaignRecovery.js";
import {
  CAMPAIGN_IDENTITY_VERSION_V2,
  validateCampaignIdentity,
  type CampaignIdentity
} from "../../experiments/plugins/agentSuccessRate/campaignIdentity.js";
import { AGENT_SUCCESS_RATE_PLUGIN_ID, AGENT_SUCCESS_RATE_REAL_AGENT_EXECUTION_MODE } from "../../experiments/plugins/agentSuccessRate/metadata.js";
import {
  PROMPT_CONTRACT_ARTIFACT_FILE,
  assertPromptContractShape,
  promptContractDigest,
  renderPromptContractArtifact,
  type PromptContractV1
} from "../../experiments/plugins/agentSuccessRate/promptContract.js";
import type { PromptComparisonSideEvidence, PromptIdentityBasis } from "./promptTemplateComparisonModel.js";

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_PROMPT_CONTRACT_BYTES = 64 * 1024;
const MAX_CASES = 1000;
const MAX_REASON_LENGTH = 240;
const STORES = ["campaign-checkpoints-v2", "campaign-checkpoints"] as const;
const GENERATION = /^generation-(\d{10})\.json$/;
const CORPUS_CATALOG = "benchmarks/contracts/agent-success-rate-tasks.json";

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

// ---------------------------------------------------------------------------
// Trusted task corpus
// ---------------------------------------------------------------------------

export type TrustedTasksResult = { ok: true; tasks: AgentSuccessTaskV1[] } | { ok: false; reason: string };

export type PromptComparisonLoadOptions = {
  /**
   * Supplies trusted task definitions for the identity's selected cases, in selection order. Authentication is by the
   * identity's task digests inside the checkpoint validator; a supplier cannot make a mismatching task verify.
   */
  loadTrustedTasks?: (identity: CampaignIdentity) => Promise<TrustedTasksResult>;
  /** Package/tool root used for the protected-root check and the default corpus. */
  toolRoot?: string;
};

function defaultToolRoot(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const up of ["../../../", "../../../../"]) {
    const candidate = path.resolve(here, up);
    try {
      if (statSyncIsFile(path.join(candidate, ...CORPUS_CATALOG.split("/")))) return candidate;
    } catch {
      // try the next layout
    }
  }
  return path.resolve(here, "../../../");
}

function statSyncIsFile(file: string): boolean {
  return statSync(file).isFile();
}

async function defaultTrustedTasks(identity: CampaignIdentity, toolRoot: string): Promise<TrustedTasksResult> {
  let corpusTasks: AgentSuccessTaskV1[];
  try {
    corpusTasks = assertReadAgentSuccessCorpus(toolRoot).tasks;
  } catch {
    return { ok: false, reason: "the trusted task corpus is unavailable for this installation" };
  }
  const byId = new Map(corpusTasks.map((task) => [task.id, task]));
  const tasks: AgentSuccessTaskV1[] = [];
  for (const selected of identity.selected) {
    const task = byId.get(selected.caseId);
    if (!task) return { ok: false, reason: `the trusted task corpus does not contain case ${selected.caseId}` };
    tasks.push(task);
  }
  return { ok: true, tasks };
}

// ---------------------------------------------------------------------------
// Checkpoint verification
// ---------------------------------------------------------------------------

type VerifiedCheckpoint = {
  identity: CampaignIdentity;
  units: Array<{ caseId: string; treatmentId: string; state: string; taskSuccess: boolean | null; patchOutcome: string | null; patchCode: string | null }>;
  finalized: boolean | null;
};

async function discoverIdentity(realRoot: string, execution: AgentSuccessRateExecutionArtifactV1): Promise<{ identity: CampaignIdentity; v2: boolean }> {
  const found: Array<{ identity: CampaignIdentity; v2: boolean; runId: string | null }> = [];
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
      try {
        validateCampaignIdentity(value.identity);
      } catch (error) {
        throw new EvidenceError(`campaign identity is invalid (${error instanceof Error ? error.message : "unknown"})`);
      }
      const identity = value.identity as CampaignIdentity;
      if (identity.digest !== dir) throw new EvidenceError("checkpoint directory does not match its campaign identity digest");
      found.push({ identity, v2: schema === CAMPAIGN_CHECKPOINT_SCHEMA_V2, runId: schema === CAMPAIGN_CHECKPOINT_SCHEMA_V2 && typeof value.runId === "string" ? value.runId : null });
    }
  }
  const byRun = found.filter((entry) => entry.runId === execution.runId);
  if (found.some((entry) => entry.runId !== null && entry.runId !== execution.runId) && byRun.length === 0) {
    throw new EvidenceError("checkpoint run id does not match the execution run");
  }
  const candidates = byRun.length > 0 ? byRun : found.filter((entry) => entry.runId === null);
  if (candidates.length === 0) throw new EvidenceError("no campaign identity checkpoint matches the execution run");
  if (candidates.length > 1) throw new EvidenceError("more than one campaign identity checkpoint matches the execution run");
  return { identity: candidates[0]!.identity, v2: candidates[0]!.v2 };
}

async function verifyCheckpoint(realRoot: string, execution: AgentSuccessRateExecutionArtifactV1, options: PromptComparisonLoadOptions): Promise<VerifiedCheckpoint> {
  const { identity, v2 } = await discoverIdentity(realRoot, execution);
  const toolRoot = options.toolRoot ?? defaultToolRoot();
  const trusted = options.loadTrustedTasks ? await options.loadTrustedTasks(identity) : await defaultTrustedTasks(identity, toolRoot);
  if (!trusted.ok) throw new EvidenceError(`complete checkpoint validation needs the trusted task corpus: ${trusted.reason}`);
  const boundary = { outputRoot: realRoot, toolRoot };
  let stored: { checkpoint: unknown };
  try {
    stored = v2 ? await readCampaignCheckpointV2(boundary, identity, trusted.tasks) : await readCampaignCheckpoint(boundary, identity, trusted.tasks);
  } catch (error) {
    throw new EvidenceError(`checkpoint validation failed (${error instanceof Error ? error.message : "unknown"})`);
  }
  if (stored.checkpoint === null || typeof stored.checkpoint !== "object") throw new EvidenceError("checkpoint store holds no committed checkpoint for the campaign identity");
  const checkpoint = stored.checkpoint as { units: Array<{ caseId: string; treatmentId: string; state: string; completion: { taskSuccess: boolean; evidence: { patch: { outcome: string | null; code: string | null } } } | null }> };
  return {
    identity,
    units: checkpoint.units.map((unit) => ({
      caseId: unit.caseId,
      treatmentId: unit.treatmentId,
      state: unit.state,
      taskSuccess: unit.completion ? unit.completion.taskSuccess : null,
      patchOutcome: unit.completion ? unit.completion.evidence.patch.outcome : null,
      patchCode: unit.completion ? unit.completion.evidence.patch.code : null
    })),
    finalized: v2 ? (checkpoint as unknown as CampaignCheckpointV2).finalization !== null : null
  };
}

// ---------------------------------------------------------------------------
// Side loader
// ---------------------------------------------------------------------------

/** Loads and verifies one side. Verification failures become `unverifiable` reasons, never an exception. */
export async function loadPromptComparisonSide(
  rootPath: string,
  role: "baseline" | "candidate",
  options: PromptComparisonLoadOptions = {}
): Promise<PromptComparisonSideEvidence> {
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

  let verified: VerifiedCheckpoint;
  try {
    verified = await verifyCheckpoint(realRoot, execution, options);
  } catch (error) {
    side.unverifiable.push(reason(`campaign checkpoint: ${error instanceof Error ? error.message : "unverifiable"}`));
    return side;
  }
  const identity = verified.identity;
  side.identity = identity;

  const run = execution.realAgent as NonNullable<AgentSuccessRateExecutionArtifactV1["realAgent"]>;
  const executedIds = execution.cases.map((c) => c.caseId).sort();
  const selectedIds = identity.selected.map((row) => row.caseId).sort();
  if (identity.config.providerId !== run.providerId || identity.config.timeoutMs !== run.timeoutMs || identity.config.repairAttempts !== (run.repairAttempts ?? 0)) {
    side.unverifiable.push("campaign identity configuration disagrees with the execution run settings");
  }
  if (executedIds.join("\0") !== selectedIds.join("\0")) side.unverifiable.push("campaign identity cases differ from the executed cases");
  if (side.unverifiable.length > 0) return side;

  // Relationship between persisted execution evidence and the validated checkpoint units.
  const checkpointUnits = new Map(verified.units.map((unit) => [`${unit.caseId}/${unit.treatmentId}`, unit]));
  for (const entry of execution.cases) {
    for (const treatment of entry.treatments) {
      const key = `${entry.caseId}/${treatment.treatmentId}`;
      const unit = checkpointUnits.get(key);
      if (!unit) {
        side.unverifiable.push(reason(`execution unit ${key} is absent from the validated checkpoint`));
        return side;
      }
      if (unit.state !== "completed") {
        side.unverifiedUnits.set(key, `checkpoint-unit-${unit.state}`);
        continue;
      }
      const attempts = treatment.attempts && treatment.attempts.length > 0 ? treatment.attempts : null;
      const finalTaskSuccess = attempts ? attempts[attempts.length - 1]!.taskSuccess : null;
      if ((finalTaskSuccess !== null && unit.taskSuccess !== finalTaskSuccess) || (unit.patchOutcome !== null && unit.patchOutcome !== treatment.patch.outcome) || (unit.patchCode !== null && unit.patchCode !== treatment.patch.code)) {
        side.unverifiable.push(reason(`execution evidence for ${key} contradicts the checkpoint completion evidence`));
        return side;
      }
    }
  }
  if (verified.finalized === false) side.warnings.push("the V2 campaign checkpoint is not finalized");

  // Prompt identity: independently established from persisted, integrity-checked prompt-contract artifacts.
  const attemptDirectories: Array<{ unit: string; directory: string }> = [];
  for (const entry of execution.cases) {
    for (const treatment of entry.treatments) {
      for (const evidence of attemptEvidenceOf(treatment)) {
        const directory = evidence.realAgent?.agentArtifactDirectory ?? null;
        if (directory !== null) attemptDirectories.push({ unit: `${entry.caseId}/${treatment.treatmentId}`, directory });
      }
    }
  }
  const isV2 = identity.schemaVersion === CAMPAIGN_IDENTITY_VERSION_V2;
  if (identity.config.providerId === "deterministic-fixture") {
    side.unverifiable.push("a deterministic-fixture identity carries no prompt template");
    return side;
  }
  if (!isV2) {
    // V1 remains readable and its checkpoint has already been validated, but the closed V1 identity does not bind a
    // prompt contract. Neither a sidecar digest nor a checkpoint hash for prompt bytes identifies the template.
    side.unverifiable.push("historical V1 prompt identity cannot be proven from independently bound template evidence");
    return side;
  }
  if (attemptDirectories.length === 0) {
    side.unverifiable.push("no provider attempt artifact exists to establish the prompt identity");
    return side;
  }

  const parsed: Array<{ unit: string; contract: PromptContractV1 | null; problem: string | null }> = [];
  for (const item of attemptDirectories) {
    try {
      const bytes = (await readContained(realRoot, `${item.directory}/${PROMPT_CONTRACT_ARTIFACT_FILE}`, MAX_PROMPT_CONTRACT_BYTES)).toString("utf8");
      const document = JSON.parse(bytes) as { promptContract?: unknown; promptContractDigest?: unknown };
      assertPromptContractShape(document.promptContract);
      const contract = document.promptContract as PromptContractV1;
      if (document.promptContractDigest !== promptContractDigest(contract) || bytes !== renderPromptContractArtifact(contract)) {
        parsed.push({ unit: item.unit, contract: null, problem: "prompt-contract artifact is not self-consistent" });
      } else {
        parsed.push({ unit: item.unit, contract, problem: null });
      }
    } catch (error) {
      parsed.push({ unit: item.unit, contract: null, problem: error instanceof EvidenceError ? error.message : "prompt-contract artifact is unreadable or malformed" });
    }
  }

  let contract: PromptContractV1;
  let basis: PromptIdentityBasis;
  const expected = renderPromptContractArtifact(identity.promptContract);
  for (const item of parsed) {
    if (item.contract !== null && renderPromptContractArtifact(item.contract) !== expected) {
      side.unverifiable.push(reason(`prompt contract artifact for ${item.unit} does not match the campaign identity`));
      return side;
    }
    if (item.contract === null) {
      if (/self-consistent|malformed|outside/.test(item.problem ?? "")) {
        side.unverifiable.push(reason(`prompt contract artifact for ${item.unit} is invalid: ${item.problem}`));
        return side;
      }
      side.unverifiedUnits.set(item.unit, "prompt-contract-unverified");
    }
  }
  if (parsed.every((item) => item.contract === null)) {
    side.unverifiable.push("no persisted prompt-contract.json artifact could verify the campaign identity's prompt contract");
    return side;
  }
  contract = identity.promptContract;
  basis = "campaign-identity-v2-verified-contract";
  side.promptContract = contract;
  side.promptBasis = basis;
  return side;
}
