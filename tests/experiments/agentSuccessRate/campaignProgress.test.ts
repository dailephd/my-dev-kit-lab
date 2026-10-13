import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, symlink, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { prepareAgentSuccessCampaign, executeAgentSuccessCampaignV2, type CampaignProvider } from "../../../src/experiments/plugins/agentSuccessRate/campaignExecution.js";
import { readCampaignProgress, validateCampaignProgress, type ValidatedCampaignProgress } from "../../../src/experiments/plugins/agentSuccessRate/campaignProgress.js";
import { classifyCampaignEvidence, campaignAttemptTelemetry } from "../../../src/experiments/plugins/agentSuccessRate/campaignEvidenceQuality.js";
import { writeAgentSuccessCampaignProgressReport } from "../../../src/report/experiments/writeAgentSuccessCampaignProgressReport.js";
import { renderAgentSuccessCampaignProgressText } from "../../../src/report/experiments/renderAgentSuccessCampaignProgressText.js";
import { renderAgentSuccessCampaignProgressHtml } from "../../../src/report/experiments/renderAgentSuccessCampaignProgressHtml.js";
import { readCampaignCheckpointV2, writeCampaignCheckpointV2, acquireCampaignDispatch, releaseCampaignDispatch } from "../../../src/experiments/plugins/agentSuccessRate/campaignCheckpointStore.js";
import { createCampaignCheckpointV2 } from "../../../src/experiments/plugins/agentSuccessRate/campaignRecovery.js";
import { makeTask, FIXTURE_FILES, writeProjectFiles } from "./agentSuccessRateTestHelpers.js";
import { makeScriptedProvider, GOOD_ANSWER, MALFORMED_ANSWER, DECOY_REFERENCE_PATCH } from "./repairTestHelpers.js";
import { makeSourceBackedKit } from "./realAgentTestHelpers.js";
import { AGENT_SUCCESS_RATE_TREATMENT_IDS } from "../../../src/experiments/plugins/agentSuccessRate/metadata.js";
import type { CampaignCheckpointV2 } from "../../../src/experiments/plugins/agentSuccessRate/campaignRecovery.js";
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) { expect(path.resolve(d).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true); await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } });
async function fixture(provider: CampaignProvider = { kind: "deterministic-fixture" }, count = 1) {
  const root = await mkdtemp(path.join(os.tmpdir(), "progress-test-")); dirs.push(root);
  const toolRoot = path.join(root, "tool"), outputRoot = path.join(root, "out"); await mkdir(toolRoot); await mkdir(outputRoot);
  await writeFile(path.join(toolRoot, "package.json"), '{"name":"test-tool","version":"0.0.0"}');
  writeProjectFiles(path.join(toolRoot, "benchmarks/projects/fixture"), FIXTURE_FILES);
  const tasks = Array.from({ length: count }, (_, i) => makeTask({ id: i === 0 ? "z-first" : "a-later" }, provider.kind === "deterministic-fixture" ? undefined : DECOY_REFERENCE_PATCH));
  const corpusFile = path.join(root, "corpus.json"); await writeFile(corpusFile, JSON.stringify(tasks));
  const boundary = { toolRoot, outputRoot }, prepared = await prepareAgentSuccessCampaign({ boundary, tasks, corpusFile, corpusRoot: root, sourceRoot: process.cwd(), treatments: AGENT_SUCCESS_RATE_TREATMENT_IDS, provider });
  const progress = () => readCampaignProgress(boundary, prepared.identity, tasks);
  const run = (intent: "new-resumable" | "resume" = "new-resumable", oneCase = false, publication?: (g: number, phase: string) => Promise<void>) => executeAgentSuccessCampaignV2(prepared, { runId: "progress-run", intent: { kind: intent }, limit: oneCase ? "one-case" : "all-selected-cases", ...(publication ? { hooks: { publication } } : {}) });
  return { root, boundary, prepared, tasks, progress, run, publish: (snapshot: ValidatedCampaignProgress) => writeAgentSuccessCampaignProgressReport({ boundary, snapshot }) };
}
const simulated = (agent: ReturnType<typeof makeScriptedProvider>, repairAttempts: 0 | 1 | 2 = 0): CampaignProvider => ({ kind: "trusted-simulated-provider", simulationId: "progress-fixture", providerId: "codex", timeoutMs: 30000, repairAttempts, runAgent: agent.runAgent, contextDependencies: makeSourceBackedKit().dependencies });
const q = (cp: CampaignCheckpointV2, tasks: Awaited<ReturnType<typeof fixture>>["tasks"], quantity: string) => classifyCampaignEvidence(cp, tasks).find(q => q.quantity === quantity)!;
describe("validated campaign progress and immutable companion reports", () => {
  it("PROGRESS-INITIAL/ONE-TREATMENT/ONE-CASE/FINAL/REVISION REPORT-JSON/TEXT/HTML/CONSISTENCY/PARTIAL/COMPLETE/IMMUTABLE SECURITY-PRIVATE", async () => {
    const f = await fixture(undefined, 2); let half!: ValidatedCampaignProgress;
    await expect(f.progress()).rejects.toThrow("UNAVAILABLE");
    const owner = await acquireCampaignDispatch(f.boundary, f.prepared.identity);
    await writeCampaignCheckpointV2(f.boundary, createCampaignCheckpointV2(f.prepared.identity, f.tasks, "progress-run", new Date().toISOString()), f.tasks, undefined, owner);
    await releaseCampaignDispatch(f.boundary, f.prepared.identity, owner);
    const initial = await f.progress(); await f.publish(initial);
    const first = await f.run("resume", true, async (g, phase) => {
      if (phase === "published" && g === 4) half = await f.progress();
    });
    expect(first.errors).toEqual([]); expect(initial.model.state).toBe("pending"); expect(initial.model.unitCounts).toMatchObject({ pending: 4, completed: 0 });
    expect(initial.model.comparisons.every(q => q.quality === "unavailable" && q.meanDifference === null && q.matchedCaseIds.length === 0)).toBe(true);
    expect(half.model.caseCounts).toMatchObject({ completed: 0, partiallyCompleted: 1, pending: 1 }); expect(half.model.unitCounts.completed).toBe(1);
    const subset = await f.progress(); expect(subset.model.state).toBe("partial"); expect(subset.model.unitCounts.completed).toBe(2); expect(subset.model.caseCounts).toMatchObject({ completed: 1, pending: 1 });
    const marker = path.join(f.boundary.outputRoot, "campaign-dispatch.json"); await writeFile(marker, "PRIVATE_ORPHAN_CONTENT");
    const owned = await f.progress(); expect(owned.model.state).toBe("blocked-uncertain"); expect(owned.model.diagnostics).toContain("DISPATCH_OWNERSHIP_PRESENT"); expect(JSON.stringify(owned.model)).not.toContain("PRIVATE_ORPHAN_CONTENT"); await unlink(marker);
    const comparison = subset.model.comparisons.find(q => q.quantity === "finalTaskSuccess")!; expect(comparison.quality).toBe("partial"); expect(comparison.matchedCaseIds).toEqual(["z-first"]); expect(comparison.excludedCaseIds).toEqual(["a-later"]);
    const p = await f.publish(subset); expect(await readdir(f.boundary.outputRoot)).not.toContain("agent-success-rate-execution.json");
    expect(await readdir(p.outputPaths.outDir)).not.toContain("report.json");
    const json = JSON.parse(await readFile(p.outputPaths.jsonPath, "utf8")); validateCampaignProgress(json);
    expect(json).toEqual(subset.model); expect(await readFile(p.outputPaths.textPath, "utf8")).toBe(renderAgentSuccessCampaignProgressText(json)); expect(await readFile(p.outputPaths.htmlPath, "utf8")).toBe(renderAgentSuccessCampaignProgressHtml(json));
    for (const field of ["jsonPath", "textPath", "htmlPath"] as const) for (const secret of [f.root, DECOY_REFERENCE_PATCH, "PRIVATE_ORPHAN_CONTENT", "checkId", "api_key="]) expect(await readFile(p.outputPaths[field], "utf8")).not.toContain(secret);
    expect(JSON.stringify(json)).not.toContain(DECOY_REFERENCE_PATCH); expect(JSON.stringify(json)).not.toContain(f.root); expect(JSON.stringify(json)).not.toContain("checkId");
    const before = await readFile(p.outputPaths.jsonPath);
    expect((await f.run("resume")).status).toBe("completed"); const final = await f.progress(); expect(final.model.state).toBe("complete"); expect(final.model.unitCounts.completed).toBe(4); expect(final.model.caseCounts.completed).toBe(2); expect(final.model.finalScientificArtifactsAvailable).toBe(true);
    const complete = await f.publish(final); const report = JSON.parse(await readFile(path.join(complete.outputPaths.outDir, "report.json"), "utf8"));
    expect(report.report.agentSuccessRate.campaignEvidence.checkpointRevision).toBe(final.model.checkpointRevision); expect(report.report.agentSuccessRate.schemaVersion).toContain("report-v1");
    expect(await readFile(path.join(complete.outputPaths.outDir, "report.txt"), "utf8")).toContain("Campaign evidence: complete"); expect(await readFile(path.join(complete.outputPaths.outDir, "report.html"), "utf8")).toContain("Campaign evidence");
    for (const file of ["agent-success-rate-execution.json", "agent-success-rate-analysis.json"]) expect(JSON.parse(await readFile(path.join(f.boundary.outputRoot, file), "utf8")).schemaVersion).toMatch(/-(execution|analysis)-v1$/);
    await f.publish(subset); await f.publish(final); expect(await readFile(p.outputPaths.jsonPath)).toEqual(before); expect(subset.model.checkpointGeneration).toBeLessThan(final.model.checkpointGeneration);
    const writer = path.join(f.boundary.outputRoot, "campaign-checkpoints-v2", f.prepared.identity.digest, "writer.json"); await writeFile(writer, "PRIVATE_WRITER_MARKER"); const orphaned = await f.progress(); expect(orphaned.model.state).toBe("blocked-uncertain"); expect(orphaned.model.diagnostics).toContain("CHECKPOINT_PUBLICATION_UNRESOLVED"); const orphanReport = await f.publish(orphaned); expect(await readdir(orphanReport.outputPaths.outDir)).not.toContain("report.json"); await unlink(writer);
    await writeFile(p.outputPaths.textPath, "USER OWNED"); await expect(f.publish(subset)).rejects.toThrow("INTEGRITY"); expect(await readFile(p.outputPaths.textPath, "utf8")).toBe("USER OWNED");
    const forged = { model: structuredClone(final.model) }; await expect(f.publish(forged)).rejects.toThrow("UNVALIDATED");
    const unsafe = structuredClone(json); unsafe.cases[0].caseId = '<script>alert("secret")</script>'; expect(renderAgentSuccessCampaignProgressHtml(unsafe)).toContain("&lt;script&gt;"); expect(renderAgentSuccessCampaignProgressHtml(unsafe)).not.toContain("<script>"); expect(() => validateCampaignProgress(unsafe)).toThrow();
    const extra = { ...json, privatePrompt: "SECRET" }; expect(() => validateCampaignProgress(extra)).toThrow(); const badCount = structuredClone(json); badCount.unitCounts.completed++; expect(() => validateCampaignProgress(badCount)).toThrow();
  }, 180000);
  it("PROGRESS-TASK-FAILURE/REPAIR QUALITY-STRONG-TASK/TOKEN-MISSING/DURATION/ZERO/BASES/COMPARISON-DIRECTION/NO-WINNER/NO-PAIRS", async () => {
    const agent = makeScriptedProvider(() => ({ answer: MALFORMED_ANSWER, tokens: null })); const f = await fixture(simulated(agent, 2)); const r = await f.run(); expect(r.errors).toEqual([]); expect(r.status).toBe("completed");
    const p = (await f.progress()).model; expect(p.unitCounts.completed).toBe(2); expect(p.totalTreatmentUnits).toBe(2); expect(p.selectedCaseCount).toBe(1); expect(p.cases[0]!.treatments[0]!.attempts).toHaveLength(3);
    const final = p.comparisons.find(q => q.quantity === "finalTaskSuccess")!; expect(final.quality).toBe("strong"); expect(final.rawFullFileMean).toBe(0); expect(final.meanDifference).toBe(0);
    expect(p.comparisons.find(q => q.quantity === "totalTokens")).toMatchObject({ quality: "unavailable", meanDifference: null }); expect(p.comparisons.find(q => q.quantity === "totalDuration")).toMatchObject({ quality: "strong", measurementBasis: "lab-wall-clock", basis: "total-across-attempts" });
    const cp = structuredClone(r.checkpoint!); const e = cp.units[0]!.completion!.evidence;
    e.attempts!.forEach((a, i) => { a.evidence.timing.agentDurationMs = i === 0 ? 0 : 20; }); e.timing.agentDurationMs = 20;
    expect(q(cp, f.tasks, "firstDuration").rawFullFileMean).toBe(0); expect(q(cp, f.tasks, "finalDuration").rawFullFileMean).toBe(20); expect(q(cp, f.tasks, "totalDuration").rawFullFileMean).toBe(40);
    const diff = q(cp, f.tasks, "totalDuration"); expect(diff.meanDifference).toBe(diff.contextPackMean! - diff.rawFullFileMean!);
    const json = JSON.stringify(p); for (const key of ['"winner"', '"compositeScore"', '"pValue"', '"causalEffect"']) expect(json).not.toContain(key);
    e.attempts![0]!.evidence.timing.agentDurationMs = null; expect(q(cp, f.tasks, "totalDuration")).toMatchObject({ quality: "unavailable", rawFullFileMean: null }); expect(q(cp, f.tasks, "totalDuration").reasons).toContain("MISSING_ATTEMPT_MEASUREMENT");
  }, 180000);
  it("QUALITY-TOKEN-ESTIMATED/CLI-DERIVED/OTEL-UNKNOWN/REPAIR-MISSING preserves original channel without promoting fields", async () => {
    const f = await fixture(simulated(makeScriptedProvider(() => ({ answer: GOOD_ANSWER })))); const r = await f.run(); expect(r.status).toBe("completed");
    for (const source of ["estimated-from-text", "cli-json", "otel", "provider-reported"] as const) {
      const cp = structuredClone(r.checkpoint!);
      for (const u of cp.units) { const e = u.completion!.evidence; e.agentTokenUsage = { source, reliability: "high", totalTokens: 0, inputTokens: 0, outputTokens: 0 }; e.attempts?.forEach(a => { a.evidence.agentTokenUsage = e.agentTokenUsage; }); }
      const tokens = q(cp, f.tasks, "totalTokens"); expect(tokens.quality).toBe("partial"); expect(tokens.rawFullFileMean).toBe(0); expect(tokens.meanDifference).toBe(0); expect(tokens.reasons).toContain("TOKEN_FIELD_PROVENANCE_UNPROVEN");
      const telemetry = campaignAttemptTelemetry(cp.units[0]!.completion!.evidence)[0]!; expect(telemetry.tokens.source).toBe(source); expect(telemetry.tokens.reliability).toBe("high");
      if (source === "estimated-from-text") { expect(telemetry.tokenInterpretation).toBe("estimated"); expect(tokens.reasons).toContain("ESTIMATED_TOKENS"); }
      if (source === "otel") { expect(telemetry.tokens.evidenceLevel).toBe("unavailable"); expect(tokens.reasons).toContain("UNATTRIBUTED_TOKENS"); }
      if (source === "cli-json") expect(telemetry.tokens.evidenceLevel).toBe("cli-reported");
    }
  }, 90000);
  it("PROGRESS-PAUSED/EPOCHS keeps historical limits outside selected units and scientific attempt totals", async () => {
    let limit = true; const agent = makeScriptedProvider(() => limit ? { outcome: "limit" } : { answer: GOOD_ANSWER }); const f = await fixture(simulated(agent)); const first = await f.run(); expect(first.status).toBe("provider-limit");
    const paused = await f.progress(); expect(paused.model.state).toBe("paused-limit"); expect(paused.model.unitCounts.completed).toBe(0); await f.publish(paused);
    const cp = first.checkpoint!, u = cp.units[0]!; limit = false;
    const result = await executeAgentSuccessCampaignV2(f.prepared, { runId: "progress-run", limit: "all-selected-cases", intent: { kind: "authorize-limit-continuation", authorization: { identityDigest: cp.identity.digest, generation: cp.generation, revision: cp.integrity, caseId: u.caseId, treatmentId: u.treatmentId, acknowledgeInvocation: true, acknowledgeExternalLimit: true } } });
    expect(result.status).toBe("completed"); const final = (await f.progress()).model; expect(final.totalTreatmentUnits).toBe(2); expect(final.unitCounts.completed).toBe(2); expect(final.cases[0]!.treatments[0]).toMatchObject({ epochCount: 2, historicalProviderLimitCount: 1 }); expect(final.cases[0]!.treatments[0]!.attempts).toHaveLength(1);
  }, 120000);
  it("PROGRESS-UNCERTAIN blocks invocation-authorized work and does not rerun a provider", async () => {
    const agent = makeScriptedProvider(() => ({ answer: GOOD_ANSWER })); const f = await fixture(simulated(agent));
    await f.run("new-resumable", false, async (g, phase) => { if (g === 3 && phase === "published") throw new Error("STOP_AFTER_AUTHORIZATION"); });
    const p = await f.progress(); expect(p.model.state).toBe("blocked-uncertain"); expect(p.model.unitCounts.completed).toBe(0); expect(p.model.unitCounts["in-progress"]).toBe(1); expect(agent.requests).toHaveLength(0); await f.publish(p);
    expect(["failed", "recovery-required"]).toContain((await f.run("resume")).status); expect(agent.requests).toHaveLength(0);
  }, 90000);
  it("PROGRESS-CORRUPT/TAMPER REPORT-PERSISTENCE-FAILURE SECURITY-CONTAINMENT preserves checkpoint and earlier reports", async () => {
    const f = await fixture(undefined, 2); await f.run("new-resumable", true); const p = await f.progress(); const previous = await f.publish(p);
    await f.run("resume"); const final = await f.progress(); const checkpointBefore = await readCampaignCheckpointV2(f.boundary, f.prepared.identity, f.tasks);
    await expect(writeAgentSuccessCampaignProgressReport({ snapshot: final, boundary: f.boundary, failureHook: phase => { if (phase === "text-written") throw new Error("INJECTED_WRITE_FAILURE"); } })).rejects.toThrow("INJECTED_WRITE_FAILURE");
    expect((await readCampaignCheckpointV2(f.boundary, f.prepared.identity, f.tasks)).checkpoint).toEqual(checkpointBefore.checkpoint); await expect(f.publish(final)).rejects.toThrow(); expect(JSON.parse(await readFile(previous.outputPaths.jsonPath, "utf8"))).toEqual(p.model);
    const patch = checkpointBefore.checkpoint!.units[0]!.completion!.artifacts.find(a => a.kind === "patch")!; const patchFile = path.join(f.boundary.outputRoot, patch.path); const original = await readFile(patchFile); await writeFile(patchFile, "SECRET_TAMPER"); await expect(f.progress()).rejects.toThrow("ARTIFACT_INTEGRITY"); await writeFile(patchFile, original);
    const newest = path.join(f.boundary.outputRoot, "campaign-checkpoints-v2", f.prepared.identity.digest, `generation-${String(final.model.checkpointGeneration).padStart(10, "0")}.json`); await writeFile(newest, "{corrupt"); await expect(f.progress()).rejects.toThrow("CORRUPTION");
    const other = await fixture(); await other.run(); const snap = await other.progress(); const outside = path.join(other.root, "outside"); await mkdir(outside); await symlink(outside, path.join(other.boundary.outputRoot, "campaign-progress-v1"), process.platform === "win32" ? "junction" : "dir"); await expect(other.publish(snap)).rejects.toThrow("UNSAFE"); expect(await readdir(outside)).toEqual([]);
  }, 180000);
});
