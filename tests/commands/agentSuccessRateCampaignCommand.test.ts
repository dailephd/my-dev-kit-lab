import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseRunExperimentArgs, runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import { runExperimentDescribeCommandFromArgs, AGENT_CAMPAIGN_OPTION_HELP } from "../../src/commands/runExperimentDescribeCommand.js";
import { renderExperimentRunHelp } from "../../src/cli/help.js";
import { AGENT_TIMEOUT_PRESETS } from "../../src/experiments/plugins/agentSuccessRate/timeoutPresets.js";
import { codexAdapter } from "../../src/agents/adapters/codexAdapter.js";
import * as observation from "../../src/agents/providerBuildObservation.js";
import { captureCommand, cliFixture, latestCheckpoint, useCampaignCleanup } from "../experiments/agentSuccessRate/realProviderCampaignTestHelpers.js";

useCampaignCleanup();
const asr = (...rest: string[]) => ["--experiment", "agent-success-rate", ...rest];
const epoch = "12345678-1234-4123-8123-123456789012";
describe("closed public campaign CLI contract", () => {
  it.each(["new", "resume", "continue-limit"])("RSP-029 exact mode %s has command-owned operational state", mode => {
    const parsed = parseRunExperimentArgs(asr("--agent-campaign", mode, "--out", "output", ...(mode === "continue-limit" ? ["--expected-checkpoint-revision", "4", "--limit-case", "case", "--limit-treatment", "raw-full-file", "--limit-epoch", epoch, "--authorize-additional-invocation"] : [])));
    expect(parsed.agentCampaign?.mode).toBe(mode); expect(parsed.config).not.toHaveProperty("agentCampaign"); expect(parsed.config).not.toHaveProperty("authorize");
  });
  it.each([
    ["--agent-campaign", "other", "--out", "o"], ["--agent-campaign"], ["--agent-campaign", "new"], ["--one-case"], ["--campaign-source-root", "source"],
    ["--agent-campaign", "new", "--out", "o", "--expected-checkpoint-revision", "1"], ["--agent-campaign", "resume", "--out", "o", "--authorize-additional-invocation"],
    ["--agent-campaign", "continue-limit", "--out", "o"], ["--agent-campaign", "new", "--out", "o", "--one-case", "true"],
    ["--agent-campaign", "new", "--agent-campaign", "resume", "--out", "o"], ["--agent-campaign", "new", "--out", "o", "--out", "again"],
    ["--timeout-preset", "standard"], ["--agent", "codex"], ["--include-real-agents"], ["--agent", "codex", "--agent", "claude", "--include-real-agents"],
    ["--agent", "other", "--include-real-agents"], ["--agent", "codex", "--include-real-agents", "--timeout-preset", "unknown"],
    ["--agent", "codex", "--include-real-agents", "--timeout-preset", "standard", "--timeout-ms", "240000"],
    ["--agent", "codex", "--include-real-agents", "--timeout-preset", "standard", "--timeout-preset", "extended"],
    ["--campaign", "codex-full"], ["--agents", "codex"], ["--strategies", "raw-full-file"], ["--complexities", "short"], ["--provider-matrix", "all"],
    ["--force-resume"], ["--force-replay"], ["--ignore-lock"], ["--clear-lock"], ["--retry-uncertain"], ["--reset-checkpoint"], ["--retry-until-success"], ["--automatic-provider-switching"],
    ["--out"], ["--timeout-ms", "-1"], ["--agent", "codex", "--include-real-agents", "--timeout-ms", "1800001"]
  ].map(vector => [vector] as const))("RSP-010/RSP-024/RSP-029/RSP-031/RSP-035 malformed vector rejects %j", vector => {
    expect(() => parseRunExperimentArgs(asr(...vector))).toThrow();
  });
  it.each(["--expected-checkpoint-revision", "--limit-case", "--limit-treatment", "--limit-epoch", "--authorize-additional-invocation"])("RSP-024 every continuation scope field is required: %s", flag => {
    const fields = ["--expected-checkpoint-revision", "4", "--limit-case", "case", "--limit-treatment", "raw-full-file", "--limit-epoch", epoch, "--authorize-additional-invocation"];
    const index = fields.indexOf(flag); fields.splice(index, flag === "--authorize-additional-invocation" ? 1 : 2);
    expect(() => parseRunExperimentArgs(asr("--agent-campaign", "continue-limit", "--out", "o", ...fields))).toThrow();
  });
  it.each(["0", "-1", "1.5", "1e2", "1000001"])("RSP-024 revision syntax/bound rejects %s", revision => {
    expect(() => parseRunExperimentArgs(asr("--agent-campaign", "continue-limit", "--out", "o", "--expected-checkpoint-revision", revision, "--limit-case", "case", "--limit-treatment", "raw-full-file", "--limit-epoch", epoch, "--authorize-additional-invocation"))).toThrow();
  });
  it("RSP-030 warm-index keeps campaign and unrelated plugins reject agent-specific flags", () => {
    expect(parseRunExperimentArgs(["--experiment", "warm-index-reuse", "--campaign", "codex-full", "--include-real-agents"]).config.campaignPreset).toBe("codex-full");
    for (const plugin of ["warm-index-reuse", "context-strategy-comparison", "context-pack-generation"]) for (const flags of [["--agent-campaign", "new", "--out", "o"], ["--one-case"], ["--campaign-source-root", "s"], ["--timeout-preset", "standard"]]) expect(() => parseRunExperimentArgs(["--experiment", plugin, ...flags])).toThrow();
  });
  it.each(["codex", "claude"] as const)("RSP-034/RSP-035 frozen %s provider preset values and numeric equivalence", provider => {
    expect(AGENT_TIMEOUT_PRESETS[provider]).toEqual({ standard: 240000, extended: 900000, maximum: 1800000 });
    for (const [preset, value] of Object.entries(AGENT_TIMEOUT_PRESETS[provider])) expect(parseRunExperimentArgs(asr("--agent", provider, "--include-real-agents", "--timeout-preset", preset)).config.timeoutMs).toBe(value);
    expect(parseRunExperimentArgs(asr("--agent", provider, "--include-real-agents")).config.timeoutMs).toBeUndefined();
    expect(parseRunExperimentArgs(asr("--agent", provider, "--include-real-agents", "--timeout-ms", "1234")).config.timeoutMs).toBe(1234);
  });
  it("RSP-010/RSP-031 invalid input has no provider observation or campaign state", async () => {
    const f = await cliFixture(); const observed = vi.spyOn(observation, "observeProviderBuild");
    const r = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "new", "--agent", "codex"], { context: f.context, campaignRuntime: f.runtime }));
    expect(r.code).toBe(2); expect(observed).not.toHaveBeenCalled(); expect(f.shim.invocationKeys()).toEqual([]); await expect(readdir(f.outputRoot)).rejects.toThrow();
  });
  it("RSP-004 missing local build proof prevents new checkpoint creation", async () => {
    const f = await cliFixture(); const r = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "new", "--agent", "codex", "--include-real-agents"], { context: f.context, campaignRuntime: { ...f.runtime, env: { PATH: "", Path: "" } } }));
    expect(r.code).toBe(1); expect(r.stderr).toContain("UNVERIFIABLE"); await expect(readdir(f.outputRoot)).rejects.toThrow(); expect(f.shim.invocationKeys()).toEqual([]);
  });
  it("RSP-019/RSP-022/RSP-027/RSP-036 new/resume one-case persists partial state then completes without repeating first case", async () => {
    const f = await cliFixture(); const base = [...f.base.slice(0, -2), "--case", `${f.tasks[0]!.id},${f.tasks[1]!.id}`, "--one-case"];
    const first = await captureCommand(() => runExperimentRunCommandFromArgs([...base, "--agent-campaign", "new"], { context: f.context }));
    expect(first.code).toBe(0); expect(first.stdout).toContain("Status: partial"); const cp = await latestCheckpoint(f.outputRoot); expect(cp.schemaVersion).toContain("checkpoint-v2"); expect(cp.units.map(u => u.state)).toEqual(["completed", "completed", "pending", "pending"]); expect(await readdir(f.outputRoot)).not.toContain("agent-success-rate-execution.json");
    const old = JSON.stringify(cp.units.slice(0, 2));
    const continued = await captureCommand(() => runExperimentRunCommandFromArgs([...base, "--agent-campaign", "resume"], { context: f.context })); expect(continued.code).toBe(0); expect(continued.stdout).toContain("Status: completed"); const final = await latestCheckpoint(f.outputRoot); expect(JSON.stringify(final.units.slice(0, 2))).toBe(old); expect(final.finalization).not.toBeNull();
  }, 120000);
  it("RSP-020 configuration or corpus drift fails resume and never creates a new identity store", async () => {
    const f = await cliFixture(); expect((await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "new"], { context: f.context }))).code).toBe(0);
    const store = path.join(f.outputRoot, "campaign-checkpoints-v2"); const before = await readdir(store);
    const changed = [...f.base.slice(0, -2), "--case", f.tasks[1]!.id, "--agent-campaign", "resume"];
    expect((await captureCommand(() => runExperimentRunCommandFromArgs(changed, { context: f.context }))).stderr).toContain("IDENTITY_MISMATCH");
    const corpus = path.join(f.toolRoot, "benchmarks/contracts/agent-success-rate-tasks.json"); await writeFile(corpus, (await readFile(corpus, "utf8")) + "\n");
    expect((await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "resume"], { context: f.context }))).stderr).toContain("IDENTITY_MISMATCH"); expect(await readdir(store)).toEqual(before);
  }, 120000);
  it("RSP-021 completed real task failures are skipped without new adapter calls", async () => {
    const f = await cliFixture(); const bad = f.response.replace("+  return normalized.trim();", "+  return title;"); f.shim.respond(f.task.id, "raw-full-file", bad); f.shim.respond(f.task.id, "context-pack", bad);
    const called = vi.spyOn(codexAdapter, "runPrompt"); const vector = [...f.base, "--agent", "codex", "--include-real-agents"];
    expect((await captureCommand(() => runExperimentRunCommandFromArgs([...vector, "--agent-campaign", "new"], { context: f.context, campaignRuntime: f.runtime }))).code).toBe(0);
    const cp = await latestCheckpoint(f.outputRoot); expect(cp.units.every(u => u.state === "completed" && u.completion!.taskSuccess === false)).toBe(true);
    expect((await captureCommand(() => runExperimentRunCommandFromArgs([...vector, "--agent-campaign", "resume"], { context: f.context, campaignRuntime: f.runtime }))).code).toBe(0); expect(called).toHaveBeenCalledTimes(2);
  }, 180000);
  it("RSP-024/RSP-036 paused real work only continues with exact revision/unit/epoch authorization", async () => {
    const f = await cliFixture(); const called = vi.spyOn(codexAdapter, "runPrompt"); const vector = [...f.base, "--agent", "codex", "--include-real-agents"];
    f.shim.behave(f.task.id, "raw-full-file", { exitCode: 1, stderr: "Rate limit exceeded. Please try again later." });
    const first = await captureCommand(() => runExperimentRunCommandFromArgs([...vector, "--agent-campaign", "new"], { context: f.context, campaignRuntime: f.runtime })); expect(first.code).toBe(1); expect(first.stdout).toContain("paused-provider-limit"); const cp = await latestCheckpoint(f.outputRoot);
    const scope = ["--agent-campaign", "continue-limit", "--expected-checkpoint-revision", String(cp.generation), "--limit-case", f.task.id, "--limit-treatment", "raw-full-file", "--limit-epoch", cp.units[0]!.epochs[0]!.id, "--authorize-additional-invocation"];
    expect((await captureCommand(() => runExperimentRunCommandFromArgs([...vector, "--agent-campaign", "resume"], { context: f.context, campaignRuntime: f.runtime }))).code).toBe(1);
    for (const [flag, value] of [["--expected-checkpoint-revision", String(cp.generation - 1)], ["--limit-case", "other-case"], ["--limit-treatment", "context-pack"], ["--limit-epoch", epoch]]) {
      const wrong = [...scope]; wrong[wrong.indexOf(flag!) + 1] = value!; expect((await captureCommand(() => runExperimentRunCommandFromArgs([...vector, ...wrong], { context: f.context, campaignRuntime: f.runtime }))).code).toBe(1);
    }
    expect(called).toHaveBeenCalledTimes(1); f.shim.behave(f.task.id, "raw-full-file", {});
    const result = await captureCommand(() => runExperimentRunCommandFromArgs([...vector, ...scope], { context: f.context, campaignRuntime: f.runtime })); expect(result.code).toBe(0); expect(called).toHaveBeenCalledTimes(3); const final = await latestCheckpoint(f.outputRoot); expect(final.units[0]!.epochs).toHaveLength(2); expect(final.units[0]!.epochs[0]).toEqual(cp.units[0]!.epochs[0]);
  }, 240000);
  it("RSP-025 a repeated provider limit cannot authorize a third epoch", async () => {
    const f = await cliFixture(); const called = vi.spyOn(codexAdapter, "runPrompt"); const vector = [...f.base, "--agent", "codex", "--include-real-agents"];
    f.shim.behave(f.task.id, "raw-full-file", { exitCode: 1, stderr: "Rate limit exceeded." });
    await captureCommand(() => runExperimentRunCommandFromArgs([...vector, "--agent-campaign", "new"], { context: f.context, campaignRuntime: f.runtime }));
    for (let n = 0; n < 2; n++) {
      const cp = await latestCheckpoint(f.outputRoot); const scope = ["--agent-campaign", "continue-limit", "--expected-checkpoint-revision", String(cp.generation), "--limit-case", f.task.id, "--limit-treatment", "raw-full-file", "--limit-epoch", cp.units[0]!.epochs.at(-1)!.id, "--authorize-additional-invocation"];
      const r = await captureCommand(() => runExperimentRunCommandFromArgs([...vector, ...scope], { context: f.context, campaignRuntime: f.runtime })); expect(r.code).toBe(1); if (n === 1) expect(r.stderr).toContain("NOT_ELIGIBLE");
    }
    expect(called).toHaveBeenCalledTimes(2); expect((await latestCheckpoint(f.outputRoot)).units[0]!.epochs).toHaveLength(2);
  }, 180000);
  it("RSP-023 uncertainty and unknown markers remain blocked and untouched through CLI", async () => {
    const f = await cliFixture(); await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "new"], { context: f.context }));
    const marker = path.join(f.outputRoot, "campaign-dispatch.json"); await writeFile(marker, "unknown-owner");
    const r = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "resume"], { context: f.context })); expect(r.code).toBe(1); expect(await readFile(marker, "utf8")).toBe("unknown-owner");
    const g = await cliFixture(); const uncertain = await captureCommand(() => runExperimentRunCommandFromArgs([...g.base, "--agent-campaign", "new"], { context: g.context, campaignRuntime: { hooks: { publication: (generation, phase) => { if (generation === 3 && phase === "published") throw new Error("UNCERTAIN_PUBLICATION"); } } } })); expect(uncertain.code).toBe(1);
    const checkpoint = await latestCheckpoint(g.outputRoot); expect(checkpoint.units[0]!.epochs[0]!.phase).toBe("invocation-authorized");
    const identityDir = path.join(g.outputRoot, "campaign-checkpoints-v2", checkpoint.identity.digest); const writer = await readFile(path.join(identityDir, "writer.json"));
    expect((await captureCommand(() => runExperimentRunCommandFromArgs([...g.base, "--agent-campaign", "resume"], { context: g.context }))).code).toBe(1); expect(await readFile(path.join(identityDir, "writer.json"))).toEqual(writer);
  }, 120000);
  it("RSP-032/RSP-033 unsafe output and unavailable source proof reject before version preflight", async () => {
    const f = await cliFixture(); const observed = vi.spyOn(observation, "observeProviderBuild");
    const invoke = (out: string, source = process.cwd(), mode = "new") => captureCommand(() => runExperimentRunCommandFromArgs(asr("--agent-campaign", mode, "--out", out, "--campaign-source-root", source, "--agent", "codex", "--include-real-agents"), { context: f.context, campaignRuntime: f.runtime }));
    expect((await invoke(path.join(f.toolRoot, "benchmarks"))).code).toBe(1);
    await mkdir(f.outputRoot); await writeFile(path.join(f.outputRoot, "unrelated"), "keep"); expect((await invoke(f.outputRoot)).code).toBe(1); expect(await readFile(path.join(f.outputRoot, "unrelated"), "utf8")).toBe("keep");
    const alias = path.join(f.root, "alias"); await symlink(f.outputRoot, alias, process.platform === "win32" ? "junction" : "dir"); expect((await invoke(alias)).code).toBe(1);
    expect((await invoke(path.join(f.root, "missing"), process.cwd(), "resume")).code).toBe(1); expect((await invoke(path.join(f.root, "new-out"), f.toolRoot)).stderr).toContain("SOURCE_UNVERIFIABLE");
    const noSource = await captureCommand(() => runExperimentRunCommandFromArgs(asr("--agent-campaign", "new", "--out", path.join(f.root, "installed-out")), { context: f.context })); expect(noSource.code).toBe(1); expect(noSource.stderr).toContain("--campaign-source-root");
    expect(observed).not.toHaveBeenCalled(); expect(f.shim.invocationKeys()).toEqual([]);
  });
  it("RSP-037 help and human/JSON describe share all frozen options and limits", async () => {
    const help = renderExperimentRunHelp(); for (const line of AGENT_CAMPAIGN_OPTION_HELP) expect(help).toContain(line);
    const json = await captureCommand(() => runExperimentDescribeCommandFromArgs(["--experiment", "agent-success-rate", "--json"]));
    const value = JSON.parse(json.stdout); expect(value.agentSuccessRate.campaign.options).toEqual([...AGENT_CAMPAIGN_OPTION_HELP]); expect(value.agentSuccessRate.timeoutPresets).toEqual(AGENT_TIMEOUT_PRESETS);
    const human = await captureCommand(() => runExperimentDescribeCommandFromArgs(["--experiment", "agent-success-rate"])); for (const line of AGENT_CAMPAIGN_OPTION_HELP) expect(human.stdout).toContain(line);
  });
});
