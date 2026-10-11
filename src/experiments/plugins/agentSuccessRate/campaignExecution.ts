import { lstat, mkdtemp, readFile, realpath, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runAgentPrompt } from "../../../agents/index.js";
import { trustedProviderObservation, type TrustedProviderExecutable } from "../../../agents/providerBuildObservation.js";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import type { AgentSuccessTaskV1 } from "../../../evaluation/agentSuccess/index.js";
import { scanProjectTree } from "../../../evaluation/benchmarkSandbox/treeSnapshot.js";
import { buildCampaignQueue, type CampaignExecutionLimit } from "./campaignQueue.js";
import { campaignAssert, canonicalCampaignJson, compareCampaignIdentity, createCampaignIdentity, type CampaignIdentity } from "./campaignIdentity.js";
import { createCampaignCheckpoint, transitionCampaignCheckpoint, type CampaignCheckpoint } from "./campaignCheckpoint.js";
import { acquireCampaignDispatch, assertCampaignDispatch, persistCampaignArtifact, persistCampaignSupportingArtifacts, prepareCampaignCompletion, prepareCampaignProviderOutput, readCampaignCheckpoint, releaseCampaignDispatch, writeCampaignCheckpoint, type CampaignStoreBoundary } from "./campaignCheckpointStore.js";
import { boundMessage, executeAgentSuccessTreatment, resolveControlledBenchmarkProject, resolveSandboxRuntimeRoot, type AgentSuccessRateDependencies } from "./execution.js";
import type { AgentSuccessCaseEvidenceV1, AgentSuccessPatchFile, AgentSuccessTreatmentEvidenceV1 } from "./executionTypes.js";
import type { AgentSuccessRateTreatmentId } from "./metadata.js";
import { executeAgentSuccessRepairTreatment } from "./repairExecution.js";
import { agentSuccessAgentArtifactDirectory, createRealAgentProposalSource, type AgentSuccessRunAgent } from "./realAgentExecution.js";
import { projectAgentFacingTask } from "./agentTaskProjection.js";
import { AgentSuccessPackContextBuilder, buildContextTaskInput, buildRawFullFileContext, type AgentSuccessContextDependencies, type ForbiddenAgentValue } from "./contextGeneration.js";
import { analyzeAgentSuccessRate } from "./analysis.js";
import { buildAgentSuccessRateExecutionArtifact, validateAgentSuccessRateExecutionArtifact, AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE } from "./executionArtifact.js";
import { buildAgentSuccessRateAnalysisArtifact, validateAgentSuccessRateAnalysisArtifact, validateAgentSuccessRateArtifactFamily, AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE } from "./analysisArtifact.js";
import { defaultContextDependencies, sealTask, writeAgentSuccessRateArtifactTargets } from "./plugin.js";
import { DEFAULT_AGENT_SUCCESS_KIT_COMMAND } from "./contextGeneration.js";
import { executeResumableCampaign, type CampaignResumableOptions } from "./campaignResumableExecution.js";

/** Explicit trusted test seam. These bytes certify a simulation, never a live executable. */
export type CampaignProvider =
  | { kind: "deterministic-fixture" }
  | { kind: "real-agent"; providerId: "codex" | "claude"; timeoutMs: number; repairAttempts: 0 | 1 | 2; includeRealAgents?: true; trustedExecutable?: TrustedProviderExecutable; kitCommand?: string; contextDependencies?: AgentSuccessContextDependencies; env?: NodeJS.ProcessEnv }
  | { kind: "trusted-simulated-provider"; simulationId: string; providerId: "codex" | "claude"; timeoutMs: number; repairAttempts: 0 | 1 | 2; runAgent: AgentSuccessRunAgent; contextDependencies: AgentSuccessContextDependencies };

export type CampaignPreparationInput = {
  boundary: CampaignStoreBoundary;
  /** Current source checkout, including uncommitted source bytes; defaults to this module's checkout root. */
  sourceRoot?: string;
  /** Current corpus file bytes, never an asserted digest. Missing corpus proof stays unavailable. */
  corpusFile: string | null;
  tasks: readonly AgentSuccessTaskV1[];
  treatments: readonly AgentSuccessRateTreatmentId[];
  provider: CampaignProvider;
  dependencies?: Partial<AgentSuccessRateDependencies>;
};
export type PreparedCampaign = { readonly identity: CampaignIdentity };
const preparations = new WeakMap<PreparedCampaign, CampaignPreparationInput>();

async function currentBytes(file: string): Promise<Buffer> {
  const stat = await lstat(file);
  campaignAssert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32 * 1024 * 1024, "IDENTITY_INPUT_UNSAFE");
  campaignAssert(path.resolve(await realpath(file)).toLowerCase() === path.resolve(file).toLowerCase(), "IDENTITY_INPUT_ALIAS");
  const bytes = await readFile(file);
  campaignAssert(bytes.length === stat.size, "IDENTITY_INPUT_CHANGED");
  return bytes;
}

async function produceIdentity(input: CampaignPreparationInput): Promise<CampaignIdentity> {
  buildCampaignQueue(input.tasks, input.treatments, "all-selected-cases");
  const sourceRoot = input.sourceRoot ?? fileURLToPath(new URL("../../../../", import.meta.url));
  const sources = await scanProjectTree(path.join(sourceRoot, "src"), [".git", "node_modules"]);
  campaignAssert(sources.length <= 9998, "DATA_BOUND");
  const sourceFiles = [];
  for (const file of [...sources.map((p) => `src/${p}`), "package.json", "package-lock.json"]) sourceFiles.push({ path: file, bytes: await currentBytes(resolveWithinRoot(sourceRoot, file)) });
  const projects = [];
  for (const projectId of new Set(input.tasks.map((t) => t.benchmarkProject))) {
    const root = await resolveControlledBenchmarkProject(input.boundary.toolRoot, projectId);
    const paths = await scanProjectTree(root, [".git"]);
    const files = [];
    for (const file of paths) files.push({ path: file, bytes: await currentBytes(resolveWithinRoot(root, file)) });
    projects.push({ projectId, files });
  }
  const provider = input.provider;
  const allowed = provider.kind === "deterministic-fixture" ? ["kind"] : provider.kind === "trusted-simulated-provider" ? ["kind", "simulationId", "providerId", "timeoutMs", "repairAttempts", "runAgent", "contextDependencies"] : ["kind", "providerId", "timeoutMs", "repairAttempts", "includeRealAgents", "trustedExecutable", "kitCommand", "contextDependencies", "env"];
  campaignAssert(Object.keys(provider).every(key => allowed.includes(key)), "INCONSISTENT_EXECUTION_MODE");
  const simulated = provider.kind === "trusted-simulated-provider";
  campaignAssert(["deterministic-fixture", "trusted-simulated-provider", "real-agent"].includes(provider.kind), "INVALID_EXECUTION_MODE");
  if (simulated) campaignAssert(provider.runAgent !== runAgentPrompt && /^[A-Za-z0-9._-]+$/.test(provider.simulationId), "SIMULATION_CONTRACT_INVALID");
  const real = provider.kind === "real-agent";
  if (real) campaignAssert(provider.includeRealAgents === undefined || provider.includeRealAgents === true, "REAL_PROVIDER_AUTHORIZATION_REQUIRED");
  const observed = real && provider.includeRealAgents === true && provider.trustedExecutable ? await trustedProviderObservation(provider.trustedExecutable, provider.providerId) : null;
  let retrievalVersion: string | null = null;
  if (real && observed !== null) {
    const commandsDir = await mkdtemp(path.join(os.tmpdir(), "lab-campaign-kit-proof-"));
    try {
      retrievalVersion = (await (provider.contextDependencies ?? defaultContextDependencies()).probeVersion({ kitCommand: provider.kitCommand ?? DEFAULT_AGENT_SUCCESS_KIT_COMMAND, commandsDir })).version ?? null;
      campaignAssert(typeof retrievalVersion === "string" && retrievalVersion.length > 0 && retrievalVersion.length <= 256, "RETRIEVAL_IDENTITY_UNVERIFIABLE");
    } finally { await rm(commandsDir, { recursive: true, force: true }); }
  }
  const functions = (object: object) => Object.entries(object).map(([key, value]) => ({ key, source: String(value) })).sort((a, b) => a.key < b.key ? -1 : 1);
  return createCampaignIdentity({
    tasks: input.tasks,
    corpusBytes: input.corpusFile === null ? null : await currentBytes(input.corpusFile), projects, sourceFiles,
    config: provider.kind === "deterministic-fixture" ? { providerId: provider.kind, timeoutMs: 1000, repairAttempts: 0 } : { providerId: provider.providerId, timeoutMs: provider.timeoutMs, repairAttempts: provider.repairAttempts },
    contextConfiguration: { contract: "existing-agent-success-context-v1", treatments: [...input.treatments] },
    retrievalConfiguration: { contract: simulated ? "trusted-simulated-retrieval-v1" : real ? "real-provider-retrieval-v1" : "no-retrieval-fixture-v1", dependencies: simulated ? functions(provider.contextDependencies) : real ? functions(provider.contextDependencies ?? defaultContextDependencies()) : [], ...(real ? { kitCommand: provider.kitCommand ?? DEFAULT_AGENT_SUCCESS_KIT_COMMAND, version: retrievalVersion } : {}), executionDependencies: functions(input.dependencies ?? {}) },
    verifiedProviderObservation: simulated ? Buffer.from(canonicalCampaignJson({ contract: "trusted-simulated-provider-v1", simulationId: provider.simulationId, implementation: String(provider.runAgent) })) : observed
  });
}

/** Reads trusted current-byte inputs itself. The capability cannot be constructed from a claimed verified identity. */
export async function prepareAgentSuccessCampaign(input: CampaignPreparationInput): Promise<PreparedCampaign> {
  const snapshot = { ...input, boundary: { ...input.boundary }, tasks: structuredClone(input.tasks), treatments: [...input.treatments], provider: { ...input.provider }, dependencies: input.dependencies ? { ...input.dependencies } : undefined };
  const identity = await produceIdentity(snapshot);
  const prepared = Object.freeze({ identity: structuredClone(identity) });
  preparations.set(prepared, snapshot);
  return prepared;
}

/** Internal v2 gate: retained producer capability and newly observed current bytes are both required. */
export async function validatePreparedCampaign(prepared: PreparedCampaign): Promise<{ input: CampaignPreparationInput; identity: CampaignIdentity }> {
  const input = preparations.get(prepared); campaignAssert(input, "IDENTITY_PRODUCER_REQUIRED");
  const identity = await produceIdentity(input);
  campaignAssert(compareCampaignIdentity(identity, prepared.identity) === "MATCH", "IDENTITY_PROOF_MISSING_OR_CHANGED");
  return { input: { ...input, boundary: { ...input.boundary }, tasks: structuredClone(input.tasks), treatments: [...input.treatments], provider: { ...input.provider }, dependencies: input.dependencies ? { ...input.dependencies } : undefined }, identity };
}
/** Explicit resumable internal API; the Prompt4 entrypoint and its default behavior stay intact. */
export async function executeAgentSuccessCampaignV2(prepared: PreparedCampaign, args: CampaignResumableOptions) {
  return executeResumableCampaign(prepared, args);
}

export type CampaignExecutionOutcome = {
  status: "completed" | "partial" | "incomplete" | "provider-limit" | "resume-not-yet-supported" | "failed";
  checkpoint: CampaignCheckpoint | null;
  treatmentEvidence: Array<{ caseId: string; evidence: AgentSuccessTreatmentEvidenceV1 }>;
  completedCaseIds: string[];
  errors: string[];
  scientificArtifactsWritten: boolean;
};
export type CampaignExecutionHooks = {
  /** Failure-only publication seam. Cannot bypass persistence or validation. */
  publication?: (generation: number, phase: "temporary-opened" | "temporary-written" | "before-publication" | "published") => void | Promise<void>;
};

/** Internal entrypoint only. New campaign dispatch; reopening any existing generation belongs to Prompt 5. */
export async function executeAgentSuccessCampaign(prepared: PreparedCampaign, args: { runId: string; limit: CampaignExecutionLimit; hooks?: CampaignExecutionHooks }): Promise<CampaignExecutionOutcome> {
  const outcome: CampaignExecutionOutcome = { status: "failed", checkpoint: null, treatmentEvidence: [], completedCaseIds: [], errors: [], scientificArtifactsWritten: false };
  const input = preparations.get(prepared);
  if (!input) { outcome.errors.push("IDENTITY_PRODUCER_REQUIRED"); return outcome; }
  let identity: CampaignIdentity;
  try { identity = await produceIdentity(input); } catch { outcome.errors.push("IDENTITY_INPUT_UNAVAILABLE"); return outcome; }
  if (compareCampaignIdentity(identity, prepared.identity) !== "MATCH") { outcome.errors.push("IDENTITY_PROOF_MISSING_OR_CHANGED"); return outcome; }
  // Preserve historical proof diagnostics, then block live mode before any v1 state or dispatch.
  if (input.provider.kind === "real-agent") { outcome.errors.push("REAL_PROVIDER_REQUIRES_V2"); return outcome; }
  const { boundary, tasks, provider } = input;
  const queue = buildCampaignQueue(tasks, input.treatments, args.limit);
  let ownership: Awaited<ReturnType<typeof acquireCampaignDispatch>> | undefined;
  let packBuilder: AgentSuccessPackContextBuilder | undefined;
  let ownedRuntimeRoot: string | undefined;
  const patchFiles: AgentSuccessPatchFile[] = [], contextFiles: AgentSuccessPatchFile[] = [], cases: AgentSuccessCaseEvidenceV1[] = [];
  const at = () => new Date().toISOString();
  const publish = async (checkpoint: CampaignCheckpoint) => {
    await writeCampaignCheckpoint(boundary, checkpoint, tasks, (phase) => args.hooks?.publication?.(checkpoint.generation, phase), ownership);
    outcome.checkpoint = checkpoint;
  };
  try {
    ownership = await acquireCampaignDispatch(boundary, identity);
    const existing = await readCampaignCheckpoint(boundary, identity, tasks);
    if (existing.checkpoint || existing.temporaryFiles.length) { outcome.checkpoint = existing.checkpoint; outcome.status = "resume-not-yet-supported"; return outcome; }
    await publish(createCampaignCheckpoint(identity, tasks, at()));
    const runtimeRoot = await resolveSandboxRuntimeRoot(boundary.outputRoot, boundary.toolRoot);
    try { await lstat(runtimeRoot); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; ownedRuntimeRoot = runtimeRoot; }
    if (provider.kind === "trusted-simulated-provider") packBuilder = new AgentSuccessPackContextBuilder("trusted-simulated-kit", provider.contextDependencies);
    for (let i = 0; i < queue.length; i += 2) {
      const task = queue[i]!.task;
      const forbiddenByTask = new Map<string, ForbiddenAgentValue[]>();
      const executionTask = provider.kind === "deterministic-fixture" ? task : sealTask(task, forbiddenByTask);
      const canonicalProjectRoot = await resolveControlledBenchmarkProject(boundary.toolRoot, task.benchmarkProject);
      const contextInput = buildContextTaskInput(executionTask);
      const contexts = packBuilder ? { "raw-full-file": await buildRawFullFileContext(contextInput, canonicalProjectRoot), "context-pack": await packBuilder.build(contextInput, canonicalProjectRoot) } : null;
      const treatments: AgentSuccessTreatmentEvidenceV1[] = [];
      for (const unit of queue.slice(i, i + 2)) {
        await assertCampaignDispatch(boundary, identity, ownership);
        // Reverify current-byte identity before every dispatch, including the second treatment.
        campaignAssert(compareCampaignIdentity(identity, await produceIdentity(input)) === "MATCH", "IDENTITY_CHANGED_BEFORE_DISPATCH");
        campaignAssert(outcome.checkpoint!.units[unit.checkpointIndex]!.state === "pending", "UNIT_NOT_PENDING");
        await publish(transitionCampaignCheckpoint(outcome.checkpoint!, tasks, unit.checkpointIndex, "in-progress", at()));
        const common = { task: executionTask, treatmentId: unit.treatmentId, runId: args.runId, canonicalProjectRoot, runtimeRoot, privateRoots: [boundary.outputRoot, boundary.toolRoot], dependencies: input.dependencies };
        const result = provider.kind === "trusted-simulated-provider" && contexts ? await executeAgentSuccessRepairTreatment({ ...common, repair: {
          providerId: provider.providerId, repairAttempts: provider.repairAttempts,
          createProposalSource: ({ attemptNumber, feedback }) => createRealAgentProposalSource({
            settings: { providerId: provider.providerId, timeoutMs: provider.timeoutMs, outDir: boundary.outputRoot, privateRoots: common.privateRoots, protectedRoots: [boundary.toolRoot, boundary.outputRoot, runtimeRoot, canonicalProjectRoot],
              runAgent: async (request) => {
                await assertCampaignDispatch(boundary, identity, ownership!);
                await prepareCampaignProviderOutput(boundary, identity, ownership!, agentSuccessAgentArtifactDirectory(task.benchmarkProject, task.id, unit.treatmentId, attemptNumber));
                return provider.runAgent(request);
              } },
            runId: args.runId, task: projectAgentFacingTask(executionTask), contexts,
            forbidden: forbiddenByTask.get(task.id) ?? [], attemptNumber,
            ...(feedback ? { repair: { feedback, maxAttempts: 1 + provider.repairAttempts } } : {})
          })
        } }) : await executeAgentSuccessTreatment(common);
        outcome.treatmentEvidence.push({ caseId: task.id, evidence: result.evidence });
        treatments.push(result.evidence);
        const limit = result.evidence.realAgent?.providerStatus === "agent-limit-reached";
        if (limit || result.evidence.status !== "completed" || result.evidence.availability !== "complete") {
          await publish(transitionCampaignCheckpoint(outcome.checkpoint!, tasks, unit.checkpointIndex, limit ? "paused-limit" : "incomplete", at(), null, limit ? "agent-limit-reached" : null));
          outcome.status = limit ? "provider-limit" : "incomplete";
          return outcome;
        }
        await persistCampaignSupportingArtifacts(boundary, identity, ownership, task, result);
        const completion = await prepareCampaignCompletion(boundary, identity, task, result.evidence);
        await publish(transitionCampaignCheckpoint(outcome.checkpoint!, tasks, unit.checkpointIndex, "completed", at(), completion));
        patchFiles.push(...result.patchFiles); contextFiles.push(...result.contextFiles);
      }
      outcome.completedCaseIds.push(task.id);
      cases.push({ caseId: task.id, caseName: task.title, benchmarkProject: task.benchmarkProject, taskLocality: task.taskLocality, fixtureId: provider.kind === "deterministic-fixture" ? task.deterministicFixture!.id : "", treatments });
    }
    const complete = outcome.checkpoint!.units.every((u) => u.state === "completed");
    outcome.status = complete ? "completed" : "partial";
    if (complete) {
      const executionMode = provider.kind === "deterministic-fixture" ? "deterministic-fixture" : "real-agent";
      const analysis = analyzeAgentSuccessRate(tasks, cases, executionMode);
      const common = { runId: args.runId, pluginId: "agent-success-rate", pluginSchemaVersion: "1.0.0", startedAt: outcome.checkpoint!.createdAt, completedAt: at() };
      const execution = buildAgentSuccessRateExecutionArtifact({ ...common, cases, ...(provider.kind === "deterministic-fixture" ? {} : { realAgent: { providerId: provider.providerId, timeoutMs: provider.timeoutMs, repairAttempts: provider.repairAttempts, attemptsPerTreatment: (1 + provider.repairAttempts) as 1 | 2 | 3, promptTransport: "stdin" as const, contextEffectEvaluated: analysis.contextEffectEvaluated } }) });
      const scientific = buildAgentSuccessRateAnalysisArtifact({ ...common, analysis });
      campaignAssert([...validateAgentSuccessRateExecutionArtifact(execution), ...validateAgentSuccessRateAnalysisArtifact(scientific), ...validateAgentSuccessRateArtifactFamily(execution, scientific)].length === 0, "SCIENTIFIC_ARTIFACT_INVALID");
      const targets = [...contextFiles, ...patchFiles].map((f) => ({ filePath: resolveWithinRoot(boundary.outputRoot, f.relativePath), content: f.content }));
      targets.push({ filePath: resolveWithinRoot(boundary.outputRoot, AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE), content: `${JSON.stringify(execution, null, 2)}\n` }, { filePath: resolveWithinRoot(boundary.outputRoot, AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE), content: `${JSON.stringify(scientific, null, 2)}\n` });
      await writeAgentSuccessRateArtifactTargets(targets, {
        ensureDirectory: async () => {},
        exists: async (file) => { try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } },
        writeFile: (file, content) => persistCampaignArtifact(boundary, identity, ownership!, path.relative(boundary.outputRoot, file).replace(/\\/g, "/"), content),
        // Durable campaign evidence is never rolled back by final scientific publication.
        removeFile: async () => {}
      }, async (target) => {
        await persistCampaignArtifact(boundary, identity, ownership!, path.relative(boundary.outputRoot, target.filePath).replace(/\\/g, "/"), target.content, outcome.checkpoint!);
        return true;
      });
      outcome.scientificArtifactsWritten = true;
    }
  } catch (error) {
    outcome.status = "failed";
    outcome.errors.push(boundMessage(error instanceof Error ? error.message : "CAMPAIGN_FAILED", [boundary.outputRoot, boundary.toolRoot, input.sourceRoot ?? ""]));
    // Publication can fail after committing. Read the durable truth; never dispatch again in this invocation.
    if (ownership) try { outcome.checkpoint = (await readCampaignCheckpoint(boundary, identity, tasks)).checkpoint; } catch { outcome.errors.push("CHECKPOINT_READ_FAILED"); }
  } finally {
    if (packBuilder) try { const reason = await packBuilder.dispose(); if (reason) { outcome.errors.push("CONTEXT_CLEANUP_FAILED"); outcome.status = "failed"; } } catch { outcome.errors.push("CONTEXT_CLEANUP_FAILED"); outcome.status = "failed"; }
    if (ownedRuntimeRoot) try { await rmdir(ownedRuntimeRoot); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") { outcome.errors.push("RUNTIME_ROOT_NOT_REMOVED"); outcome.status = "failed"; } }
    if (ownership) try { await releaseCampaignDispatch(boundary, identity, ownership); } catch { outcome.errors.push("DISPATCH_RELEASE_FAILED"); outcome.status = "failed"; }
  }
  return outcome;
}
