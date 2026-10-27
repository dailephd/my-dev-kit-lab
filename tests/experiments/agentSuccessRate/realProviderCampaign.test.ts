import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runExperimentRunCommandFromArgs } from "../../../src/commands/runExperimentRunCommand.js";
import { codexAdapter } from "../../../src/agents/adapters/codexAdapter.js";
import { claudeAdapter } from "../../../src/agents/adapters/claudeAdapter.js";
import { observeProviderBuild } from "../../../src/agents/providerBuildObservation.js";
import { prepareAgentSuccessCampaign, executeAgentSuccessCampaignV2, executeAgentSuccessCampaign, type CampaignProvider } from "../../../src/experiments/plugins/agentSuccessRate/campaignExecution.js";
import { validateAgentSuccessRateExecutionArtifact } from "../../../src/experiments/plugins/agentSuccessRate/executionArtifact.js";
import { validateAgentSuccessRateAnalysisArtifact, validateAgentSuccessRateArtifactFamily } from "../../../src/experiments/plugins/agentSuccessRate/analysisArtifact.js";
import { AGENT_SUCCESS_RATE_TREATMENT_IDS } from "../../../src/experiments/plugins/agentSuccessRate/metadata.js";
import { makeTask, FIXTURE_FILES, writeProjectFiles } from "./agentSuccessRateTestHelpers.js";
import { makeProviderShim, makeSourceBackedKit } from "./realAgentTestHelpers.js";
import { GOOD_ANSWER, DECOY_REFERENCE_PATCH } from "./repairTestHelpers.js";
import { campaignTemp, captureCommand, cliFixture, latestCheckpoint, useCampaignCleanup } from "./realProviderCampaignTestHelpers.js";

useCampaignCleanup();
const args = { intent: { kind: "new-resumable" as const }, runId: "real-test", limit: "all-selected-cases" as const };
describe("explicit real-provider campaign routing through fake process transport", () => {
  it("RSP-002 inconsistent fixture/simulation/real mode fields are rejected", async () => {
    const f = await cliFixture();
    const input = { boundary: { toolRoot: f.toolRoot, outputRoot: f.outputRoot }, sourceRoot: process.cwd(), corpusFile: path.join(f.toolRoot, "benchmarks/contracts/agent-success-rate-tasks.json"), corpusRoot: f.toolRoot, tasks: [f.task], treatments: AGENT_SUCCESS_RATE_TREATMENT_IDS };
    for (const provider of [{ kind: "deterministic-fixture", providerId: "codex", includeRealAgents: true }, { kind: "real-agent", providerId: "codex", timeoutMs: 5000, repairAttempts: 0, runAgent: () => { throw new Error("never"); } }]) await expect(prepareAgentSuccessCampaign({ ...input, provider: provider as unknown as CampaignProvider })).rejects.toThrow("INCONSISTENT_EXECUTION_MODE");
    expect(f.shim.invocationKeys()).toEqual([]);
  }, 60000);
  it.each(["codex", "claude"] as const)("RSP-001/RSP-002/RSP-011/RSP-012/RSP-013/RSP-014/RSP-016/RSP-018/RSP-028/RSP-042 decisive CLI to %s adapter to trusted checks", async providerId => {
    const f = await cliFixture(providerId); const adapter = providerId === "codex" ? codexAdapter : claudeAdapter;
    const original = adapter.runPrompt;
    const snapshots: number[] = [];
    const invoked = vi.spyOn(adapter, "runPrompt").mockImplementation(async request => {
      const cp = await latestCheckpoint(f.outputRoot);
      expect(cp.units.find(u => u.state === "in-progress")!.epochs.at(-1)!.phase).toBe("invocation-authorized");
      expect(await readdir(f.outputRoot)).toContain("campaign-dispatch.json"); snapshots.push(cp.generation);
      expect(request.trustedExecutable?.providerId).toBe(providerId); expect(request.commandTemplate).toBeUndefined(); expect(request.promptTransport).toBe("stdin");
      return original.call(adapter, request);
    });
    const before = await readFile(path.join(f.toolRoot, "benchmarks/projects", f.task.benchmarkProject, "src/validation.js"));
    const r = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "new", "--agent", providerId, "--include-real-agents", "--timeout-preset", "standard"], { context: f.context, campaignRuntime: f.runtime }));
    expect(r.stderr).toBe(""); expect(r.code).toBe(0); expect(r.stdout).toContain("Status: completed"); expect(invoked).toHaveBeenCalledTimes(2); expect(snapshots).toEqual([3, 6]);
    const cp = await latestCheckpoint(f.outputRoot); expect(cp.units.every(u => u.completion?.taskSuccess === true)).toBe(true); expect(cp.identity.config.providerId).toBe(providerId);
    expect(cp.units.every(u => u.epochs[0]!.terminal!.evidence.realAgent!.providerInvoked)).toBe(true);
    const proposed = cp.units[0]!.completion!.evidence.proposedPatchPath!;
    expect(await readFile(path.join(f.outputRoot, proposed), "utf8")).toContain("return normalized.trim()");
    expect(f.response).not.toBe(f.task.deterministicFixture!.patch);
    expect(await readFile(path.join(f.toolRoot, "benchmarks/projects", f.task.benchmarkProject, "src/validation.js"))).toEqual(before);
    for (const mode of AGENT_SUCCESS_RATE_TREATMENT_IDS) {
      const prompt = f.shim.prompt(f.task.id, mode)!; expect(prompt).toContain(`Context mode: ${mode}`); expect(prompt).not.toContain(f.task.deterministicFixture!.patch); expect(prompt).not.toContain("tests/regression.check.mjs");
      const meta = f.shim.meta(f.task.id, mode)!; expect(meta.cwd.startsWith(f.toolRoot)).toBe(false); expect(meta.cwd.startsWith(f.outputRoot)).toBe(false);
    }
    expect(JSON.stringify(cp)).not.toContain("Case ID:"); expect(JSON.stringify(cp)).not.toContain("shim 1.0.0");
    const execution = JSON.parse(await readFile(path.join(f.outputRoot, "agent-success-rate-execution.json"), "utf8"));
    const analysis = JSON.parse(await readFile(path.join(f.outputRoot, "agent-success-rate-analysis.json"), "utf8"));
    expect(validateAgentSuccessRateExecutionArtifact(execution)).toEqual([]); expect(validateAgentSuccessRateAnalysisArtifact(analysis)).toEqual([]); expect(validateAgentSuccessRateArtifactFamily(execution, analysis)).toEqual([]);
    const resume = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "resume", "--agent", providerId, "--include-real-agents", "--timeout-ms", "240000"], { context: f.context, campaignRuntime: f.runtime }));
    expect(resume.code).toBe(0); expect(resume.stdout).toContain("already-complete"); expect(resume.stdout).toContain("New provider work: none"); expect(invoked).toHaveBeenCalledTimes(2);
  }, 180000);
  it("RSP-002 private decoy fixture cannot become the real proposal; historical v1 refuses live mode", async () => {
    const root = await campaignTemp(); const toolRoot = path.join(root, "tool"), outputRoot = path.join(root, "out"); await mkdir(outputRoot); writeProjectFiles(path.join(toolRoot, "benchmarks/projects/fixture"), FIXTURE_FILES);
    const task = makeTask({}, DECOY_REFERENCE_PATCH); const corpusFile = path.join(root, "corpus.json"); await writeFile(corpusFile, JSON.stringify([task]));
    const shim = makeProviderShim("codex"); shim.respond(task.id, "raw-full-file", GOOD_ANSWER); shim.respond(task.id, "context-pack", GOOD_ANSWER);
    const prepared = await prepareAgentSuccessCampaign({ boundary: { toolRoot, outputRoot }, sourceRoot: process.cwd(), corpusFile, corpusRoot: root, tasks: [task], treatments: AGENT_SUCCESS_RATE_TREATMENT_IDS, provider: { kind: "real-agent", includeRealAgents: true, providerId: "codex", timeoutMs: 5000, repairAttempts: 0, trustedExecutable: await observeProviderBuild("codex", { env: shim.env }), env: shim.env, contextDependencies: makeSourceBackedKit().dependencies } });
    expect((await executeAgentSuccessCampaign(prepared, args)).errors).toContain("REAL_PROVIDER_REQUIRES_V2");
    const result = await executeAgentSuccessCampaignV2(prepared, args); expect(result.errors).toEqual([]); expect(result.status).toBe("completed"); expect(result.checkpoint!.units.every(u => u.completion!.taskSuccess)).toBe(true); expect(shim.invocationKeys()).toHaveLength(2);
  }, 120000);
  // The fake-only fixture creates its shim under os.tmpdir(); stubbing the temp variables places it beneath a controlled ancestor package scope.
  it.each(["inherited", "module", "untyped"] as const)("RSP-003 empty output never falls back to a correct fixture (%s ancestor package scope)", async scope => {
    try {
      if (scope !== "inherited") {
        const scopeDir = await campaignTemp(); await writeFile(path.join(scopeDir, "package.json"), JSON.stringify(scope === "untyped" ? {} : { type: scope }));
        for (const key of ["TEMP", "TMP", "TMPDIR"]) vi.stubEnv(key, scopeDir);
        expect(path.resolve(os.tmpdir())).toBe(path.resolve(scopeDir));
      }
      await emptyOutputNeverFallsBack();
    } finally { vi.unstubAllEnvs(); }
  }, 120000);
  async function emptyOutputNeverFallsBack() {
    const f = await cliFixture(); f.shim.behave(f.task.id, "raw-full-file", { emptyOutput: true });
    const r = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "new", "--agent", "codex", "--include-real-agents"], { context: f.context, campaignRuntime: f.runtime }));
    expect(r.code).toBe(1); const cp = await latestCheckpoint(f.outputRoot); expect(cp.units[0]!.completion).toBeNull(); const evidence = cp.units[0]!.epochs[0]!.terminal!.evidence; expect(evidence.realAgent!.providerStatus).toBe("completed"); expect(evidence.realAgent!.finalAnswerAvailable).toBe(false); expect(evidence.errors.some(e => e.code === "PROVIDER_EMPTY_ANSWER")).toBe(true); expect(evidence.patch.attempted).toBe(false); expect(cp.finalization).toBeNull();
    expect(f.shim.invocationKeys()).toContain(`${f.task.id}.raw-full-file`);
  }
  it("RSP-015 failed context prevents that provider invocation without fabricating a pack", async () => {
    const f = await cliFixture(); const runtime = { ...f.runtime, contextDependencies: makeSourceBackedKit({ failIndex: true }).dependencies };
    const r = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "new", "--agent", "codex", "--include-real-agents"], { context: f.context, campaignRuntime: runtime }));
    expect(r.code).toBe(1); expect(f.shim.invocationKeys()).toEqual([`${f.task.id}.raw-full-file`]); const cp = await latestCheckpoint(f.outputRoot); expect(cp.units[1]!.epochs[0]!.terminal!.evidence.realAgent!.providerInvoked).toBe(false); expect(cp.finalization).toBeNull();
  }, 120000);
  it("RSP-017 bound real adapter repairs reuse the existing bounded evaluator", async () => {
    const f = await cliFixture(); f.shim.respond(f.task.id, "raw-full-file", f.response.replace("+  return normalized.trim();", "+  return title;"));
    const original = codexAdapter.runPrompt; let calls = 0;
    vi.spyOn(codexAdapter, "runPrompt").mockImplementation(async request => {
      const cp = await latestCheckpoint(f.outputRoot); expect(cp.units.find(u => u.state === "in-progress")!.epochs.at(-1)!.phase).toBe("invocation-authorized");
      const result = await original.call(codexAdapter, request); if (++calls === 1) f.shim.respond(f.task.id, "raw-full-file", f.response); return result;
    });
    const r = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "new", "--agent", "codex", "--include-real-agents", "--repair-attempts", "1"], { context: f.context, campaignRuntime: f.runtime }));
    expect(r.code).toBe(0); expect(calls).toBe(3); const cp = await latestCheckpoint(f.outputRoot); expect(cp.identity.config.repairAttempts).toBe(1); const attempts = cp.units[0]!.completion!.evidence.attempts!; expect(attempts).toHaveLength(2); expect(attempts.map(a => a.taskSuccess)).toEqual([false, true]); expect(cp.units[0]!.epochs).toHaveLength(1);
  }, 180000);
  it("RSP-009 missing or changed real proof rejects resume before another task", async () => {
    const f = await cliFixture(); const vector = [...f.base, "--agent", "codex", "--include-real-agents"];
    expect((await captureCommand(() => runExperimentRunCommandFromArgs([...vector, "--agent-campaign", "new"], { context: f.context, campaignRuntime: f.runtime }))).code).toBe(0);
    const bin = f.shim.env.PATH!.split(path.delimiter)[0]!; const entry = path.join(bin, process.platform === "win32" ? "shim.js" : "codex"); await writeFile(entry, (await readFile(entry, "utf8")) + "\n// build drift\n");
    const r = await captureCommand(() => runExperimentRunCommandFromArgs([...vector, "--agent-campaign", "resume"], { context: f.context, campaignRuntime: f.runtime })); expect(r.code).toBe(1); expect(r.stderr).toContain("IDENTITY_MISMATCH"); expect(f.shim.invocationKeys()).toHaveLength(2);
    const missing = await captureCommand(() => runExperimentRunCommandFromArgs([...vector, "--agent-campaign", "resume"], { context: f.context, campaignRuntime: { ...f.runtime, env: { PATH: "", Path: "" } } })); expect(missing.code).toBe(1); expect(missing.stderr).toContain("UNVERIFIABLE");
  }, 180000);
});
