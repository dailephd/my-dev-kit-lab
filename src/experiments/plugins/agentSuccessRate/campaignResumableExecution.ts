import { lstat, rmdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { runAgentPrompt } from "../../../agents/runAgentPrompt.js";
import { campaignAssert, canonicalCampaignJson, compareCampaignIdentity } from "./campaignIdentity.js";
import { buildCampaignQueue, type CampaignExecutionLimit } from "./campaignQueue.js";
import { createCampaignCheckpointV2, transitionCampaignCheckpointV2, validateCampaignLimitAuthorization, type CampaignCheckpointV2, type CampaignIntent, type CampaignUnitV2 } from "./campaignRecovery.js";
import { acquireCampaignDispatch, allocateCampaignEpoch, assertCampaignDispatch, persistCampaignSupportingArtifacts, prepareCampaignEpochTerminal, prepareCampaignProviderOutput, publishCampaignFinalArtifacts, readCampaignCheckpoint, readCampaignCheckpointV2, releaseCampaignDispatch, writeCampaignCheckpointV2 } from "./campaignCheckpointStore.js";
import { validatePreparedCampaign, type CampaignExecutionHooks, type PreparedCampaign } from "./campaignExecution.js";
import { boundMessage, executeAgentSuccessTreatment, resolveControlledBenchmarkProject, resolveSandboxRuntimeRoot } from "./execution.js";
import { executeAgentSuccessRepairTreatment } from "./repairExecution.js";
import { agentSuccessAgentArtifactDirectory, createRealAgentProposalSource } from "./realAgentExecution.js";
import { defaultContextDependencies, sealTask } from "./plugin.js";
import { projectAgentFacingTask } from "./agentTaskProjection.js";
import { AgentSuccessPackContextBuilder, buildContextTaskInput, buildRawFullFileContext, DEFAULT_AGENT_SUCCESS_KIT_COMMAND, type ForbiddenAgentValue } from "./contextGeneration.js";
import { analyzeAgentSuccessRate } from "./analysis.js";
import { buildAgentSuccessRateExecutionArtifact, validateAgentSuccessRateExecutionArtifact, AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE } from "./executionArtifact.js";
import { buildAgentSuccessRateAnalysisArtifact, validateAgentSuccessRateAnalysisArtifact, validateAgentSuccessRateArtifactFamily, AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE } from "./analysisArtifact.js";
import type { AgentSuccessCaseEvidenceV1 } from "./executionTypes.js";

export type CampaignResumableOptions = { intent: CampaignIntent; runId: string; limit: CampaignExecutionLimit; hooks?: CampaignExecutionHooks };
export type CampaignResumableOutcome = {
  status: "completed" | "already-complete" | "partial" | "provider-limit" | "recovery-required" | "failed";
  checkpoint: CampaignCheckpointV2 | null; errors: string[]; scientificArtifactsWritten: boolean;
  blockedUnit: { caseId: string; treatmentId: string; generation: number; revision: string; phase: string; reason: "provider-limit" | "potentially-invoked" | "reserved-not-replayed" | "terminal-incomplete" } | null;
};
function blocked(outcome: CampaignResumableOutcome, unit: CampaignUnitV2): void {
  const cp = outcome.checkpoint!; const epoch = unit.epochs.at(-1);
  outcome.status = unit.state === "paused-limit" ? "provider-limit" : "recovery-required";
  outcome.blockedUnit = { caseId: unit.caseId, treatmentId: unit.treatmentId, generation: cp.generation, revision: cp.integrity, phase: epoch?.phase ?? "pending", reason: unit.state === "paused-limit" ? "provider-limit" : epoch?.phase === "reserved" ? "reserved-not-replayed" : unit.state === "incomplete" ? "terminal-incomplete" : "potentially-invoked" };
}
export async function executeResumableCampaign(prepared: PreparedCampaign, args: CampaignResumableOptions): Promise<CampaignResumableOutcome> {
  const outcome: CampaignResumableOutcome = { status: "failed", checkpoint: null, errors: [], scientificArtifactsWritten: false, blockedUnit: null };
  let owner: Awaited<ReturnType<typeof acquireCampaignDispatch>> | undefined;
  let verified: Awaited<ReturnType<typeof validatePreparedCampaign>> | undefined;
  let packBuilder: AgentSuccessPackContextBuilder | undefined;
  let activeRuntime: string | undefined;
  const at = () => new Date().toISOString();
  try {
    campaignAssert(args.intent && ["new-resumable", "resume", "authorize-limit-continuation"].includes(args.intent.kind), "EXPLICIT_INTENT_REQUIRED");
    // The closed runtime intent also rejects force-replay or a generic resume boolean.
    campaignAssert(Object.keys(args.intent).sort().join(",") === (args.intent.kind === "authorize-limit-continuation" ? "authorization,kind" : "kind"), "INVALID_INTENT");
    verified = await validatePreparedCampaign(prepared);
    const { input, identity } = verified; const { boundary, tasks, provider } = input;
    if (provider.kind === "real-agent") campaignAssert(provider.includeRealAgents === true && provider.trustedExecutable && provider.trustedExecutable.providerId === provider.providerId, "REAL_PROVIDER_AUTHORIZATION_REQUIRED");
    const queue = buildCampaignQueue(tasks, input.treatments, "all-selected-cases");
    campaignAssert(["one-case", "all-selected-cases"].includes(args.limit), "INVALID_EXECUTION_LIMIT");
    owner = await acquireCampaignDispatch(boundary, identity);
    const fresh = async () => {
      const current = await validatePreparedCampaign(prepared);
      campaignAssert(compareCampaignIdentity(identity, current.identity) === "MATCH", "IDENTITY_CHANGED_BEFORE_DISPATCH");
      await assertCampaignDispatch(boundary, identity, owner!);
    };
    const read = async () => {
      await fresh();
      const stored = await readCampaignCheckpointV2(boundary, identity, tasks);
      campaignAssert(stored.identityVerification === "MATCH", "IDENTITY_UNVERIFIABLE");
      campaignAssert(stored.temporaryFiles.length === 0, "CHECKPOINT_PUBLICATION_UNRESOLVED");
      return stored;
    };
    const publish = async (cp: CampaignCheckpointV2) => {
      await fresh();
      await writeCampaignCheckpointV2(boundary, cp, tasks, phase => args.hooks?.publication?.(cp.generation, phase), owner);
      const stored = await read(); campaignAssert(stored.checkpoint?.integrity === cp.integrity, "CLAIM_READBACK_FAILED"); outcome.checkpoint = stored.checkpoint;
    };
    const stored = await read();
    if (args.intent.kind === "new-resumable") {
      campaignAssert(stored.checkpoint === null, "CAMPAIGN_ALREADY_EXISTS");
      // No copy or migration, even when a historical chain happens to share the identity.
      const legacy = await readCampaignCheckpoint(boundary, identity, tasks);
      campaignAssert(legacy.checkpoint === null && legacy.temporaryFiles.length === 0, "LEGACY_CAMPAIGN_READ_ONLY");
      await publish(createCampaignCheckpointV2(identity, tasks, args.runId, at()));
    } else {
      campaignAssert(stored.reusable && stored.checkpoint !== null, "RESUMABLE_CAMPAIGN_REQUIRED_NO_V1_MIGRATION");
      outcome.checkpoint = stored.checkpoint;
    }
    const alreadyComplete = outcome.checkpoint!.units.every(u => u.state === "completed");
    // Validate a continuation request before accepting any complete/blocked/no-work shortcut.
    let authorizedIndex: number | undefined;
    if (args.intent.kind === "authorize-limit-continuation") {
      authorizedIndex = outcome.checkpoint!.units.findIndex(u => u.state !== "completed");
      campaignAssert(authorizedIndex >= 0, "COMPLETED_IMMUTABLE");
      validateCampaignLimitAuthorization(args.intent.authorization, outcome.checkpoint!, outcome.checkpoint!.units[authorizedIndex]!);
    }
    if (!alreadyComplete && provider.kind === "trusted-simulated-provider") packBuilder = new AgentSuccessPackContextBuilder("trusted-simulated-kit", provider.contextDependencies);
    if (!alreadyComplete && provider.kind === "real-agent") packBuilder = new AgentSuccessPackContextBuilder(provider.kitCommand ?? DEFAULT_AGENT_SUCCESS_KIT_COMMAND, provider.contextDependencies ?? defaultContextDependencies());
    let caseProcessed: string | undefined;
    for (const unit of queue) {
      let state = outcome.checkpoint!.units[unit.checkpointIndex]!;
      if (state.state === "completed") continue;
      if (args.limit === "one-case" && caseProcessed !== undefined && caseProcessed !== unit.task.id) break;
      if (state.state !== "pending" && authorizedIndex !== unit.checkpointIndex) { blocked(outcome, state); return outcome; }
      caseProcessed = unit.task.id;
      // Read and verify the whole chain again before reserving. No local snapshot alone authorizes dispatch.
      const latest = (await read()).checkpoint!; campaignAssert(latest.integrity === outcome.checkpoint!.integrity, "STALE_REVISION");
      const reserve = transitionCampaignCheckpointV2(latest, tasks, { kind: "reserve", index: unit.checkpointIndex, epochId: randomUUID(), ...(authorizedIndex === unit.checkpointIndex && args.intent.kind === "authorize-limit-continuation" ? { authorization: args.intent.authorization } : {}) }, at());
      const epoch = reserve.units[unit.checkpointIndex]!.epochs.at(-1)!;
      const epochRoot = await allocateCampaignEpoch(boundary, identity, owner, epoch);
      await publish(reserve);
      // Context preparation occurs before provider authorization; a crash here does not create an implicit replay policy.
      const forbidden = new Map<string, ForbiddenAgentValue[]>();
      const executionTask = provider.kind === "deterministic-fixture" ? unit.task : sealTask(unit.task, forbidden);
      const canonicalProjectRoot = await resolveControlledBenchmarkProject(boundary.toolRoot, unit.task.benchmarkProject);
      const contextInput = buildContextTaskInput(executionTask);
      const contexts = packBuilder ? { "raw-full-file": await buildRawFullFileContext(contextInput, canonicalProjectRoot), "context-pack": await packBuilder.build(contextInput, canonicalProjectRoot) } : null;
      activeRuntime = await resolveSandboxRuntimeRoot(epochRoot, boundary.toolRoot);
      await publish(transitionCampaignCheckpointV2(outcome.checkpoint!, tasks, { kind: "authorize", index: unit.checkpointIndex }, at()));
      await fresh();
      const claimed = (await read()).checkpoint!;
      state = claimed.units[unit.checkpointIndex]!;
      campaignAssert(claimed.integrity === outcome.checkpoint!.integrity && state.epochs.at(-1)!.id === epoch.id && state.epochs.at(-1)!.phase === "invocation-authorized", "INVOCATION_NOT_AUTHORIZED");
      const common = { task: executionTask, treatmentId: unit.treatmentId, runId: `${outcome.checkpoint!.runId}-${epoch.id}`, canonicalProjectRoot, runtimeRoot: activeRuntime, privateRoots: [boundary.outputRoot, boundary.toolRoot], dependencies: input.dependencies };
      // Explicit fixture branch only. Missing provider context never selects a fixture patch.
      campaignAssert(provider.kind === "deterministic-fixture" || contexts !== null, "PROVIDER_CONTEXT_REQUIRED");
      const result = provider.kind !== "deterministic-fixture" && contexts ? await executeAgentSuccessRepairTreatment({ ...common, repair: {
        providerId: provider.providerId, repairAttempts: provider.repairAttempts,
        createProposalSource: ({ attemptNumber, feedback }) => createRealAgentProposalSource({ settings: { providerId: provider.providerId, timeoutMs: provider.timeoutMs, ...(provider.promptContract ? { promptContract: provider.promptContract } : {}), ...(provider.kind === "real-agent" ? { trustedExecutable: provider.trustedExecutable, env: provider.env } : {}), outDir: epochRoot, privateRoots: common.privateRoots, protectedRoots: [boundary.toolRoot, boundary.outputRoot, activeRuntime!, canonicalProjectRoot], runAgent: async request => {
          await fresh(); campaignAssert((await read()).checkpoint?.integrity === claimed.integrity, "STALE_INVOCATION_CLAIM");
          await prepareCampaignProviderOutput(boundary, identity, owner!, `${epoch.namespace}/${agentSuccessAgentArtifactDirectory(unit.task.benchmarkProject, unit.task.id, unit.treatmentId, attemptNumber)}`);
          return provider.kind === "real-agent" ? runAgentPrompt(request) : provider.runAgent(request);
        } }, runId: common.runId, task: projectAgentFacingTask(executionTask), contexts, forbidden: forbidden.get(unit.task.id) ?? [], attemptNumber, ...(feedback ? { repair: { feedback, maxAttempts: 1 + provider.repairAttempts } } : {}) })
      } }) : await executeAgentSuccessTreatment(common);
      await rmdir(activeRuntime); activeRuntime = undefined;
      await fresh();
      await persistCampaignSupportingArtifacts(boundary, identity, owner, unit.task, result, epoch);
      const reason = result.evidence.realAgent?.providerStatus === "agent-limit-reached" ? "provider-limit" : result.evidence.status === "completed" && result.evidence.availability === "complete" ? "evaluated" : "incomplete";
      const terminal = await prepareCampaignEpochTerminal(boundary, identity, unit.task, epoch, result.evidence, reason);
      await publish(transitionCampaignCheckpointV2(outcome.checkpoint!, tasks, { kind: "terminal", index: unit.checkpointIndex, terminal }, at()));
      authorizedIndex = undefined;
      if (reason !== "evaluated") { blocked(outcome, outcome.checkpoint!.units[unit.checkpointIndex]!); return outcome; }
    }
    const complete = outcome.checkpoint!.units.every(u => u.state === "completed");
    if (!complete) { outcome.status = "partial"; return outcome; }
    const cp = (await read()).checkpoint!; outcome.checkpoint = cp;
    {
      const cases: AgentSuccessCaseEvidenceV1[] = tasks.map((task, i) => ({ caseId: task.id, caseName: task.title, benchmarkProject: task.benchmarkProject, taskLocality: task.taskLocality, fixtureId: provider.kind === "deterministic-fixture" ? task.deterministicFixture!.id : "", treatments: [cp.units[i * 2]!.completion!.evidence, cp.units[i * 2 + 1]!.completion!.evidence] }));
      const analysis = analyzeAgentSuccessRate(tasks, cases, provider.kind === "deterministic-fixture" ? "deterministic-fixture" : "real-agent");
      // Stable final metadata also permits safe recovery after a partial final artifact publication.
      const completedAt = cp.finalization?.completedAt ?? cp.updatedAt;
      const common = { runId: cp.runId, pluginId: "agent-success-rate", pluginSchemaVersion: "1.0.0", startedAt: cp.createdAt, completedAt };
      const execution = buildAgentSuccessRateExecutionArtifact({ ...common, cases, ...(provider.kind === "deterministic-fixture" ? {} : { realAgent: { providerId: provider.providerId, timeoutMs: provider.timeoutMs, repairAttempts: provider.repairAttempts, attemptsPerTreatment: (1 + provider.repairAttempts) as 1 | 2 | 3, promptTransport: "stdin" as const, contextEffectEvaluated: analysis.contextEffectEvaluated } }) });
      const scientific = buildAgentSuccessRateAnalysisArtifact({ ...common, analysis });
      campaignAssert([...validateAgentSuccessRateExecutionArtifact(execution), ...validateAgentSuccessRateAnalysisArtifact(scientific), ...validateAgentSuccessRateArtifactFamily(execution, scientific)].length === 0, "SCIENTIFIC_ARTIFACT_INVALID");
      const finalization = await publishCampaignFinalArtifacts(boundary, identity, owner, [{ relativePath: AGENT_SUCCESS_RATE_EXECUTION_ARTIFACT_FILE, content: `${JSON.stringify(execution, null, 2)}\n` }, { relativePath: AGENT_SUCCESS_RATE_ANALYSIS_ARTIFACT_FILE, content: `${JSON.stringify(scientific, null, 2)}\n` }], cp.runId, completedAt);
      if (cp.finalization === null) await publish(transitionCampaignCheckpointV2(cp, tasks, { kind: "finalize", finalization }, at()));
      else campaignAssert(canonicalCampaignJson(finalization) === canonicalCampaignJson(cp.finalization), "FINAL_ARTIFACT_INCONSISTENT");
    }
    outcome.scientificArtifactsWritten = true; outcome.status = alreadyComplete ? "already-complete" : "completed";
  } catch (error) {
    outcome.status = "failed";
    outcome.errors.push(boundMessage(error instanceof Error ? error.message : "CAMPAIGN_FAILED", verified ? [verified.input.boundary.outputRoot, verified.input.boundary.toolRoot, verified.input.sourceRoot ?? ""] : []));
    if (owner && verified) try { outcome.checkpoint = (await readCampaignCheckpointV2(verified.input.boundary, verified.identity, verified.input.tasks)).checkpoint; } catch { outcome.errors.push("CHECKPOINT_READ_FAILED"); }
  } finally {
    if (packBuilder) try { campaignAssert((await packBuilder.dispose()) === null, "CONTEXT_CLEANUP_FAILED"); } catch { outcome.errors.push("CONTEXT_CLEANUP_FAILED"); outcome.status = "failed"; }
    if (activeRuntime) try { await rmdir(activeRuntime); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") { outcome.errors.push("RUNTIME_ROOT_NOT_REMOVED"); outcome.status = "failed"; } }
    if (owner && verified) try { await releaseCampaignDispatch(verified.input.boundary, verified.identity, owner); } catch { outcome.errors.push("DISPATCH_RELEASE_FAILED"); outcome.status = "failed"; }
  }
  return outcome;
}
