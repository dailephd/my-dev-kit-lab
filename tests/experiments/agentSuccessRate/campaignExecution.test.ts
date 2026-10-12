import { mkdir, readFile, readdir, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { executeAgentSuccessCampaign, prepareAgentSuccessCampaign, type CampaignProvider } from "../../../src/experiments/plugins/agentSuccessRate/campaignExecution.js";
import type { AgentSuccessRunAgent } from "../../../src/experiments/plugins/agentSuccessRate/realAgentExecution.js";
import { acquireCampaignDispatch, assertCampaignDispatch, persistCampaignArtifact, readCampaignCheckpoint, releaseCampaignDispatch, writeCampaignCheckpoint } from "../../../src/experiments/plugins/agentSuccessRate/campaignCheckpointStore.js";
import { createCampaignCheckpoint, transitionCampaignCheckpoint } from "../../../src/experiments/plugins/agentSuccessRate/campaignCheckpoint.js";
import { AGENT_SUCCESS_RATE_TREATMENT_IDS } from "../../../src/experiments/plugins/agentSuccessRate/metadata.js";
import { defaultAgentSuccessRateDependencies, agentSuccessPatchArtifactPath } from "../../../src/experiments/plugins/agentSuccessRate/execution.js";
import { validateAgentSuccessRateExecutionArtifact } from "../../../src/experiments/plugins/agentSuccessRate/executionArtifact.js";
import { validateAgentSuccessRateAnalysisArtifact, validateAgentSuccessRateArtifactFamily } from "../../../src/experiments/plugins/agentSuccessRate/analysisArtifact.js";
import { codexAdapter } from "../../../src/agents/adapters/codexAdapter.js";
import { claudeAdapter } from "../../../src/agents/adapters/claudeAdapter.js";
import { makeTask, makeToolRoot, makeTempDir, PROTECTED_PATCH } from "./agentSuccessRateTestHelpers.js";
import { makeScriptedProvider, GOOD_ANSWER, MALFORMED_ANSWER, DECOY_REFERENCE_PATCH } from "./repairTestHelpers.js";
import { fakeAgentResult, makeSeamAgent, makeSourceBackedKit } from "./realAgentTestHelpers.js";
import { useSandboxTestCleanup } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
import type { AgentSuccessTaskV1 } from "../../../src/evaluation/agentSuccess/index.js";
import type { AgentSuccessRateDependencies } from "../../../src/experiments/plugins/agentSuccessRate/execution.js";

useSandboxTestCleanup();
const at = "2026-10-10T00:00:00.000Z";
const request = { runId: "campaign-test", limit: "all-selected-cases" as const };
async function fixture(options: { tasks?: AgentSuccessTaskV1[]; provider?: CampaignProvider; dependencies?: Partial<AgentSuccessRateDependencies>; missingCorpus?: boolean } = {}) {
  const toolRoot = makeToolRoot();
  const outputRoot = makeTempDir("lab-campaign-out-");
  const tasks = options.tasks ?? [makeTask()];
  const corpusFile = path.join(toolRoot, "corpus.json");
  await writeFile(corpusFile, JSON.stringify(tasks));
  const boundary = { toolRoot, outputRoot };
  const input = { boundary, sourceRoot: process.cwd(), corpusFile: options.missingCorpus ? null : corpusFile, corpusRoot: toolRoot, tasks, treatments: AGENT_SUCCESS_RATE_TREATMENT_IDS, provider: options.provider ?? { kind: "deterministic-fixture" as const }, dependencies: options.dependencies };
  const prepared = await prepareAgentSuccessCampaign(input);
  const stored = () => readCampaignCheckpoint(boundary, prepared.identity, tasks);
  return { toolRoot, outputRoot, tasks, boundary, input, prepared, stored };
}
function simulated(runAgent: AgentSuccessRunAgent, repairAttempts: 0 | 1 | 2 = 0): CampaignProvider {
  return { kind: "trusted-simulated-provider", simulationId: "campaign-test-provider-v1", providerId: "codex", timeoutMs: 30000, repairAttempts, runAgent, contextDependencies: makeSourceBackedKit().dependencies };
}

describe("checkpoint-integrated campaign execution (no paid providers)", () => {
  it("IDENTITY-PHYSICAL-ROOT accepts current files under the canonical identity of the authorized roots", async () => {
    const f = await fixture();
    const canonicalSourceRoot = await realpath(process.cwd());
    const canonicalToolRoot = await realpath(f.toolRoot);
    const prepared = await prepareAgentSuccessCampaign({ ...f.input, sourceRoot: canonicalSourceRoot, boundary: { ...f.boundary, toolRoot: canonicalToolRoot } });
    expect(prepared.identity).toEqual(f.prepared.identity);
  });

  it("IDENTITY-UNTRUSTED-ANCESTOR rejects a corpus redirected by a symlink or junction before provider/checkpoint use", async () => {
    const f = await fixture();
    const outside = makeTempDir("lab-campaign-outside-");
    await writeFile(path.join(outside, "corpus.json"), "[]");
    const alias = path.join(f.toolRoot, "corpus-alias");
    await symlink(outside, alias, process.platform === "win32" ? "junction" : "dir");
    const agent = makeScriptedProvider(() => ({ answer: GOOD_ANSWER }));
    const input = { ...f.input, corpusFile: path.join(alias, "corpus.json"), provider: simulated(agent.runAgent) };
    await expect(prepareAgentSuccessCampaign(input)).rejects.toThrow("IDENTITY_INPUT_UNSAFE");
    expect(agent.requests).toHaveLength(0);
    expect(await readdir(f.outputRoot)).toEqual([]);
  });

  it.each(["absolute escape", "relative traversal", "symlink input file"])("IDENTITY-UNSAFE-CORPUS rejects %s before provider/checkpoint use", async (kind) => {
    const f = await fixture();
    const outside = makeTempDir("lab-campaign-outside-");
    const outsideCorpus = path.join(outside, "corpus.json");
    await writeFile(outsideCorpus, "[]");
    const corpusFile = kind === "absolute escape" ? outsideCorpus : kind === "relative traversal" ? path.join(f.toolRoot, "..", "outside", "corpus.json") : path.join(f.toolRoot, "corpus-link.json");
    if (kind === "symlink input file") await symlink(outsideCorpus, corpusFile, "file");
    const agent = makeScriptedProvider(() => ({ answer: GOOD_ANSWER }));
    await expect(prepareAgentSuccessCampaign({ ...f.input, corpusFile, provider: simulated(agent.runAgent) })).rejects.toThrow("IDENTITY_INPUT_UNSAFE");
    expect(agent.requests).toHaveLength(0);
    expect(await readdir(f.outputRoot)).toEqual([]);
    expect(await readFile(outsideCorpus, "utf8")).toBe("[]");
  });

  it("QUEUE-ORDER / TREATMENT-BOUNDARY / CLAIM-BEFORE-EXECUTION / SANDBOX-ISOLATION through the existing simulated provider pipeline", async () => {
    const tasks = [makeTask({ id: "z-case" }, DECOY_REFERENCE_PATCH), makeTask({ id: "a-case" }, DECOY_REFERENCE_PATCH)];
    const snapshots: string[][] = [];
    let f: Awaited<ReturnType<typeof fixture>>;
    const agent = makeSeamAgent(async () => {
      const cp = (await f.stored()).checkpoint!;
      snapshots.push(cp.units.map((u) => u.state));
      expect(cp.units.filter((u) => u.state === "in-progress")).toHaveLength(1);
      expect((await readdir(f.outputRoot))).toContain("campaign-dispatch.json");
      return fakeAgentResult({ finalAnswerText: GOOD_ANSWER });
    });
    const created: string[] = [], removed: string[] = [];
    f = await fixture({ tasks, provider: simulated(agent.runAgent), dependencies: {
      createSandbox: async (args) => { const sandbox = await defaultAgentSuccessRateDependencies.createSandbox(args); created.push(sandbox.sandboxId); return sandbox; },
      removeSandbox: async (args) => { const result = await defaultAgentSuccessRateDependencies.removeSandbox(args); expect(result.removed).toBe(true); removed.push(args.sandboxId); return result; }
    } });
    const result = await executeAgentSuccessCampaign(f.prepared, request);
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("completed");
    expect(agent.requests.map((r) => r.runId)).toEqual(["z-case.codex.raw-full-file", "z-case.codex.context-pack", "a-case.codex.raw-full-file", "a-case.codex.context-pack"]);
    expect(snapshots).toEqual([["in-progress", "pending", "pending", "pending"], ["completed", "in-progress", "pending", "pending"], ["completed", "completed", "in-progress", "pending"], ["completed", "completed", "completed", "in-progress"]]);
    expect(new Set(created).size).toBe(4); expect(removed).toEqual(created);
    expect(result.checkpoint!.generation).toBe(9);
    expect((await f.stored()).checkpoint).toEqual(result.checkpoint);
    expect(result.checkpoint!.units.every((u) => u.completion!.taskSuccess)).toBe(true);
    // TOKEN-SEPARATION: unavailable usage does not change completed provider or correctness.
    expect(result.checkpoint!.units[0]!.completion!.evidence.agentTokenUsage!.totalTokens).toBeNull();
    expect(result.checkpoint!.units[0]!.completion!.evidence.realAgent!.providerStatus).toBe("completed");
    expect(result.scientificArtifactsWritten).toBe(true);
    const execution = JSON.parse(await readFile(path.join(f.outputRoot, "agent-success-rate-execution.json"), "utf8"));
    const analysis = JSON.parse(await readFile(path.join(f.outputRoot, "agent-success-rate-analysis.json"), "utf8"));
    expect(validateAgentSuccessRateExecutionArtifact(execution)).toEqual([]); expect(validateAgentSuccessRateAnalysisArtifact(analysis)).toEqual([]); expect(validateAgentSuccessRateArtifactFamily(execution, analysis)).toEqual([]);
  }, 60000);

  it("ONE-CASE commits both treatments, never starts the second case, and emits no complete scientific report", async () => {
    const agent = makeScriptedProvider(() => ({ answer: GOOD_ANSWER }));
    const f = await fixture({ tasks: [makeTask({ id: "first" }, DECOY_REFERENCE_PATCH), makeTask({ id: "second" }, DECOY_REFERENCE_PATCH)], provider: simulated(agent.runAgent) });
    const result = await executeAgentSuccessCampaign(f.prepared, { ...request, limit: "one-case" });
    expect(result.status).toBe("partial"); expect(result.completedCaseIds).toEqual(["first"]);
    expect(agent.requests).toHaveLength(2);
    expect(result.checkpoint!.units.map((u) => u.state)).toEqual(["completed", "completed", "pending", "pending"]);
    expect(result.scientificArtifactsWritten).toBe(false);
    expect(await readdir(f.outputRoot)).not.toContain("agent-success-rate-execution.json");
  }, 60000);

  it("CLAIM-WRITE-FAILURE stops before fake provider invocation and preserves the prior generation", async () => {
    const agent = makeScriptedProvider(() => ({ answer: GOOD_ANSWER }));
    const f = await fixture({ provider: simulated(agent.runAgent) });
    const result = await executeAgentSuccessCampaign(f.prepared, { ...request, hooks: { publication: (g, phase) => { if (g === 2 && phase === "before-publication") throw new Error("INJECTED_PUBLICATION_FAILURE"); } } });
    expect(result.status).toBe("failed"); expect(result.errors).toContain("INJECTED_PUBLICATION_FAILURE"); expect(agent.requests).toHaveLength(0);
    expect(result.checkpoint!.generation).toBe(1); expect((await f.stored()).checkpoint!.units.every((u) => u.state === "pending")).toBe(true);
  }, 60000);

  it("EXCLUSIVE-DISPATCH denies independent dispatcher and foreign checkpoint writer while provider is active", async () => {
    let announce!: () => void, finish!: () => void;
    const started = new Promise<void>((resolve) => { announce = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const agent = makeSeamAgent(async () => { announce(); await gate; return fakeAgentResult({ finalAnswerText: GOOD_ANSWER }); });
    const f = await fixture({ provider: simulated(agent.runAgent) });
    const independent = await prepareAgentSuccessCampaign(f.input);
    const running = executeAgentSuccessCampaign(f.prepared, request);
    await started;
    try {
      const second = await executeAgentSuccessCampaign(independent, request);
      expect(second.errors).toContain("DISPATCH_OWNERSHIP_CONFLICT"); expect(agent.requests).toHaveLength(1);
      const cp = (await f.stored()).checkpoint!;
      await expect(writeCampaignCheckpoint(f.boundary, transitionCampaignCheckpoint(cp, f.tasks, 1, "in-progress", new Date().toISOString()), f.tasks)).rejects.toThrow("DISPATCH_OWNERSHIP_REQUIRED");
    } finally { finish(); }
    expect((await running).status).toBe("completed");
  }, 60000);

  it.each(["unknown", "stale"])("DISPATCH-OWNER-FAILURE never steals a %s marker", async (kind) => {
    const agent = makeScriptedProvider(() => ({ answer: GOOD_ANSWER })); const f = await fixture({ provider: simulated(agent.runAgent) });
    const marker = path.join(f.outputRoot, "campaign-dispatch.json"); await writeFile(marker, kind);
    const result = await executeAgentSuccessCampaign(f.prepared, request);
    expect(result.errors).toContain("DISPATCH_OWNERSHIP_CONFLICT"); expect(agent.requests).toHaveLength(0); expect(await readFile(marker, "utf8")).toBe(kind);
  }, 60000);

  it("ownership replacement causes release failure and the replacement is preserved", async () => {
    const f = await fixture(); const owner = await acquireCampaignDispatch(f.boundary, f.prepared.identity);
    await writeFile(path.join(f.outputRoot, "campaign-dispatch.json"), "replacement");
    await expect(assertCampaignDispatch(f.boundary, f.prepared.identity, owner)).rejects.toThrow("DISPATCH_OWNER_CHANGED");
    await expect(releaseCampaignDispatch(f.boundary, f.prepared.identity, owner)).rejects.toThrow("DISPATCH_OWNER_CHANGED");
    expect(await readFile(path.join(f.outputRoot, "campaign-dispatch.json"), "utf8")).toBe("replacement");
  }, 60000);

  it("UNSUCCESSFUL-COMPLETION / PROTECTED-FILES commit evaluated policy rejection as taskSuccess=false", async () => {
    const f = await fixture({ tasks: [makeTask({}, PROTECTED_PATCH)] });
    const result = await executeAgentSuccessCampaign(f.prepared, request);
    expect(result.status).toBe("completed");
    for (const unit of result.checkpoint!.units) { expect(unit.completion!.taskSuccess).toBe(false); expect(unit.completion!.evidence.patch.outcome).toBe("policy-rejection"); expect(unit.completion!.evidence.protectedIntegrity.status).toBe("intact"); }
    expect(result.scientificArtifactsWritten).toBe(true);
  }, 60000);

  it("MISSING-ARTIFACT leaves the treatment noncompleted after an otherwise evaluated fake provider", async () => {
    const seam = makeSeamAgent(() => fakeAgentResult({ finalAnswerText: GOOD_ANSWER }));
    const agent = async (r: Parameters<typeof seam.runAgent>[0]) => { const result = await seam.runAgent(r); await unlink(path.join(r.outDir, "agent-run-result.json")); return result; };
    const f = await fixture({ provider: simulated(agent) });
    const result = await executeAgentSuccessCampaign(f.prepared, request);
    expect(result.status).toBe("failed"); expect(result.checkpoint!.units[0]!.state).toBe("in-progress"); expect(seam.requests).toHaveLength(1);
  }, 60000);

  it.each(["different bytes", "identical unrelated bytes"])("ARTIFACT-COLLISION refuses %s", async (mode) => {
    const task = makeTask(); const f = await fixture({ tasks: [task] });
    const relative = agentSuccessPatchArtifactPath(task.benchmarkProject, task.id, "raw-full-file", "proposed"); const target = path.join(f.outputRoot, relative);
    const text = mode === "different bytes" ? "unrelated" : task.deterministicFixture!.patch;
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, text);
    const result = await executeAgentSuccessCampaign(f.prepared, request);
    expect(result.status).toBe("failed"); expect(result.errors).toContain("ARTIFACT_COLLISION"); expect(await readFile(target, "utf8")).toBe(text); expect(result.checkpoint!.units[0]!.state).toBe("in-progress");
  }, 60000);

  it("ARTIFACT-REUSE verifies committed ownership and exact bytes; final legacy writer reused them", async () => {
    const f = await fixture(); const result = await executeAgentSuccessCampaign(f.prepared, request); expect(result.status).toBe("completed");
    const reference = result.checkpoint!.units[0]!.completion!.artifacts[0]!; const target = path.join(f.outputRoot, reference.path); const before = await readFile(target, "utf8");
    const owner = await acquireCampaignDispatch(f.boundary, f.prepared.identity);
    try { await persistCampaignArtifact(f.boundary, f.prepared.identity, owner, reference.path, before, result.checkpoint!); await expect(persistCampaignArtifact(f.boundary, f.prepared.identity, owner, reference.path, "different", result.checkpoint!)).rejects.toThrow("ARTIFACT_COLLISION"); } finally { await releaseCampaignDispatch(f.boundary, f.prepared.identity, owner); }
    expect(await readFile(target, "utf8")).toBe(before); expect(result.scientificArtifactsWritten).toBe(true);
  }, 60000);

  it("PARTIAL-CAMPAIGN / PROVIDER-LIMIT preserves earlier cases, classified outcome, artifacts and stops repairs/dispatch", async () => {
    const agent = makeScriptedProvider((facts) => facts.caseId === "later" ? { outcome: "limit" } : { answer: GOOD_ANSWER });
    const f = await fixture({ tasks: [makeTask({ id: "first" }, DECOY_REFERENCE_PATCH), makeTask({ id: "later" }, DECOY_REFERENCE_PATCH), makeTask({ id: "never" }, DECOY_REFERENCE_PATCH)], provider: simulated(agent.runAgent, 2) });
    const result = await executeAgentSuccessCampaign(f.prepared, request);
    expect(result.status).toBe("provider-limit"); expect(agent.requests).toHaveLength(3);
    expect(result.checkpoint!.units.map((u) => u.state)).toEqual(["completed", "completed", "paused-limit", "pending", "pending", "pending"]);
    expect(result.checkpoint!.units[2]!.errorCode).toBe("PROVIDER_LIMIT"); expect(result.treatmentEvidence[2]!.evidence.attempts![0]!.failureCategory).toBe("provider-limit-reached");
    expect(result.completedCaseIds).toEqual(["first"]); expect((await f.stored()).checkpoint).toEqual(result.checkpoint);
    for (const unit of result.checkpoint!.units.slice(0, 2)) for (const artifact of unit.completion!.artifacts) expect((await readFile(path.join(f.outputRoot, artifact.path))).length).toBe(artifact.bytes);
    expect(result.scientificArtifactsWritten).toBe(false);
  }, 60000);

  it("INTERRUPTED-TREATMENT / NO-AUTO-RESUME never repeats uncertain in-flight work", async () => {
    const agent = makeScriptedProvider(() => ({ answer: GOOD_ANSWER })); const f = await fixture({ provider: simulated(agent.runAgent) });
    const failed = await executeAgentSuccessCampaign(f.prepared, { ...request, hooks: { publication: (g, phase) => { if (g === 2 && phase === "published") throw new Error("INTERRUPTION"); } } });
    expect(failed.checkpoint!.units[0]!.state).toBe("in-progress"); expect(agent.requests).toHaveLength(0);
    const retry = await executeAgentSuccessCampaign(f.prepared, request);
    // Writer marker left by uncertain publication fails closed before reuse.
    expect(retry.status).toBe("failed"); expect(retry.errors).toContain("WRITER_OWNERSHIP_CONFLICT"); expect(agent.requests).toHaveLength(0);
  }, 60000);

  it("NO-AUTO-RESUME explicitly rejects even pending or completed existing campaigns", async () => {
    const f = await fixture(); const initial = createCampaignCheckpoint(f.prepared.identity, f.tasks, at); await writeCampaignCheckpoint(f.boundary, initial, f.tasks);
    const result = await executeAgentSuccessCampaign(f.prepared, request); expect(result.status).toBe("resume-not-yet-supported"); expect(result.treatmentEvidence).toEqual([]); expect((await f.stored()).checkpoint).toEqual(initial);
  }, 60000);

  it("INTERRUPTED-TREATMENT completion write failure preserves active evidence and rejects replay", async () => {
    const agent = makeScriptedProvider(() => ({ answer: GOOD_ANSWER })); const f = await fixture({ provider: simulated(agent.runAgent) });
    const result = await executeAgentSuccessCampaign(f.prepared, { ...request, hooks: { publication: (g, phase) => { if (g === 3 && phase === "before-publication") throw new Error("TERMINAL_PUBLICATION_FAILURE"); } } });
    expect(result.status).toBe("failed"); expect(result.checkpoint!.units.map((u) => u.state)).toEqual(["in-progress", "pending"]); expect(agent.requests).toHaveLength(1);
    const retry = await executeAgentSuccessCampaign(f.prepared, request); expect(retry.status).toBe("resume-not-yet-supported"); expect(agent.requests).toHaveLength(1);
    expect(result.treatmentEvidence[0]!.evidence.realAgent!.providerStatus).toBe("completed");
  }, 60000);

  it("MISSING-ARTIFACT at publication cannot commit completion", async () => {
    const f = await fixture();
    const result = await executeAgentSuccessCampaign(f.prepared, { ...request, hooks: { publication: async (g, phase) => {
      if (g === 3 && phase === "before-publication") await unlink(path.join(f.outputRoot, agentSuccessPatchArtifactPath(f.tasks[0]!.benchmarkProject, f.tasks[0]!.id, "raw-full-file", "proposed")));
    } } });
    expect(result.status).toBe("failed"); expect(result.checkpoint!.units.map((u) => u.state)).toEqual(["in-progress", "pending"]);
  }, 60000);

  it("DISPATCH release failure is reported after a committed claim without provider invocation", async () => {
    const agent = makeScriptedProvider(() => ({ answer: GOOD_ANSWER })); const f = await fixture({ provider: simulated(agent.runAgent) });
    const result = await executeAgentSuccessCampaign(f.prepared, { ...request, hooks: { publication: async (g, phase) => {
      if (g === 2 && phase === "published") { await writeFile(path.join(f.outputRoot, "campaign-dispatch.json"), "replacement"); throw new Error("INTERRUPTION"); }
    } } });
    expect(result.status).toBe("failed"); expect(result.errors).toContain("DISPATCH_RELEASE_FAILED"); expect(agent.requests).toHaveLength(0); expect(await readFile(path.join(f.outputRoot, "campaign-dispatch.json"), "utf8")).toBe("replacement");
  }, 60000);

  it("BOUNDED-REPAIR uses exactly three new sandboxes per treatment and preserves final-attempt semantics", async () => {
    const agent = makeScriptedProvider(() => ({ answer: MALFORMED_ANSWER })); const f = await fixture({ provider: simulated(agent.runAgent, 2) });
    const result = await executeAgentSuccessCampaign(f.prepared, request);
    expect(result.status).toBe("completed"); expect(agent.requests).toHaveLength(6);
    for (const unit of result.checkpoint!.units) { expect(unit.completion!.taskSuccess).toBe(false); expect(unit.completion!.evidence.attempts!.map((a) => a.attemptNumber)).toEqual([1, 2, 3]); expect(new Set(unit.completion!.evidence.attempts!.map((a) => a.evidence.sandboxId)).size).toBe(3); expect(unit.completion!.evidence.attempts!.every((a) => a.evidence.cleanup.removed)).toBe(true); }
  }, 60000);

  it("COMPLETED-EVIDENCE rejects cleanup failure and never starts the second treatment", async () => {
    const f = await fixture({ dependencies: { removeSandbox: async (args) => { await defaultAgentSuccessRateDependencies.removeSandbox(args); return { removed: false, reason: "injected cleanup uncertainty" }; } } });
    const result = await executeAgentSuccessCampaign(f.prepared, request); expect(result.status).toBe("incomplete"); expect(result.checkpoint!.units.map((u) => u.state)).toEqual(["incomplete", "pending"]); expect(result.treatmentEvidence).toHaveLength(1);
  }, 60000);

  it.each(["missing-corpus", "missing-live-provider", "changed-corpus", "forged-capability"])("IDENTITY-FAIL-CLOSED: %s", async (kind) => {
    const f = await fixture({ missingCorpus: kind === "missing-corpus", ...(kind === "missing-live-provider" ? { provider: { kind: "real-agent", providerId: "codex", timeoutMs: 30000, repairAttempts: 0 } as CampaignProvider } : {}) });
    if (kind === "changed-corpus") await writeFile(f.input.corpusFile!, "changed");
    const codex = vi.spyOn(codexAdapter, "runPrompt").mockRejectedValue(new Error("FORBIDDEN")); const claude = vi.spyOn(claudeAdapter, "runPrompt").mockRejectedValue(new Error("FORBIDDEN"));
    try { const result = await executeAgentSuccessCampaign(kind === "forged-capability" ? { identity: f.prepared.identity } : f.prepared, request); expect(result.status).toBe("failed"); expect(result.checkpoint).toBeNull(); expect(result.errors).toContain(kind === "forged-capability" ? "IDENTITY_PRODUCER_REQUIRED" : "IDENTITY_PROOF_MISSING_OR_CHANGED"); expect(codex).not.toHaveBeenCalled(); expect(claude).not.toHaveBeenCalled(); } finally { vi.restoreAllMocks(); }
  }, 60000);

  it("OUTPUT-CONTAINMENT rejects protected output roots without mutating their sentinel", async () => {
    const f = await fixture(); const root = path.join(f.toolRoot, "src"); await mkdir(root); await writeFile(path.join(root, "sentinel"), "keep");
    const prepared = await prepareAgentSuccessCampaign({ ...f.input, boundary: { ...f.boundary, outputRoot: root } });
    const result = await executeAgentSuccessCampaign(prepared, request); expect(result.errors).toContain("PROTECTED_OUTPUT_ROOT"); expect(await readFile(path.join(root, "sentinel"), "utf8")).toBe("keep");
  }, 60000);

  it("LEGACY-SCIENTIFIC-ARTIFACTS final output collision preserves completed checkpoint evidence", async () => {
    const f = await fixture(); await writeFile(path.join(f.outputRoot, "agent-success-rate-analysis.json"), "unrelated");
    const result = await executeAgentSuccessCampaign(f.prepared, request); expect(result.status).toBe("failed"); expect(result.checkpoint!.units.every((u) => u.state === "completed")).toBe(true); expect(result.scientificArtifactsWritten).toBe(false); expect(await readFile(path.join(f.outputRoot, "agent-success-rate-analysis.json"), "utf8")).toBe("unrelated");
  }, 60000);
});
