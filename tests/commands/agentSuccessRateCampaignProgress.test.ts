import { describe, it, expect, vi, afterEach } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import * as progressWriter from "../../src/report/experiments/writeAgentSuccessCampaignProgressReport.js";
import { captureCommand, cliFixture, latestCheckpoint, useCampaignCleanup } from "../experiments/agentSuccessRate/realProviderCampaignTestHelpers.js";
useCampaignCleanup(); afterEach(() => vi.restoreAllMocks());
describe("campaign CLI progress is validated and published before success", () => {
  it("CLI-SUMMARY matches exact committed revision and counters", async () => {
    const f = await cliFixture();
    const result = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "new"], { context: f.context }));
    expect(result.code).toBe(0); const cp = await latestCheckpoint(f.outputRoot);
    expect(result.stdout).toContain(`Progress checkpoint revision: ${cp.generation} (${cp.integrity})`); expect(result.stdout).toContain("Completed evaluations: 2/2"); expect(result.stdout).toContain("Completed cases: 1/1");
    const jsonPath = /^Progress JSON: (.+)$/m.exec(result.stdout)![1]!;
    const model = JSON.parse(await readFile(jsonPath, "utf8")); expect(model.checkpointRevision).toBe(cp.integrity); expect(model.unitCounts.completed).toBe(2);
    await writeFile(jsonPath, "USER OWNED REPORT");
    const resume = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "resume"], { context: f.context }));
    expect(resume.code).toBe(1); expect(resume.stdout).toContain("Status: already-complete"); expect(resume.stdout).toContain("Progress persistence: failed"); expect(resume.stdout).not.toContain("Progress JSON:"); expect(await readFile(jsonPath, "utf8")).toBe("USER OWNED REPORT"); expect((await latestCheckpoint(f.outputRoot)).integrity).toBe(cp.integrity);
  }, 180000);
  it("CLI-FAILURE separates report persistence failure from completed scientific execution", async () => {
    const f = await cliFixture(); const spy = vi.spyOn(progressWriter, "writeAgentSuccessCampaignProgressReport").mockRejectedValueOnce(new Error("INJECTED_PROGRESS_WRITE_FAILURE"));
    const result = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "new"], { context: f.context }));
    expect(result.code).toBe(1); expect(result.stdout).toContain("Status: completed"); expect(result.stdout).toContain("Final scientific artifacts: written"); expect(result.stdout).toContain("Progress persistence: failed"); expect(result.stdout).not.toContain("Progress JSON:");
    const cp = await latestCheckpoint(f.outputRoot); expect(cp.units.every(u => u.state === "completed")).toBe(true); expect(JSON.parse(await readFile(path.join(f.outputRoot, "agent-success-rate-analysis.json"), "utf8")).schemaVersion).toContain("analysis-v1"); spy.mockRestore();
    const resumed = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "resume"], { context: f.context })); expect(resumed.code).toBe(0); expect(resumed.stdout).toContain("Status: already-complete"); expect((await latestCheckpoint(f.outputRoot)).integrity).toBe(cp.integrity);
    const file = path.join(f.outputRoot, "campaign-checkpoints-v2", cp.identity.digest, `generation-${String(cp.generation).padStart(10, "0")}.json`); await writeFile(file, "BROKEN");
    const corrupt = await captureCommand(() => runExperimentRunCommandFromArgs([...f.base, "--agent-campaign", "resume"], { context: f.context })); expect(corrupt.code).toBe(1); expect(corrupt.stdout).not.toContain("Progress JSON:"); expect(corrupt.stderr).toContain("CORRUPTION");
  }, 180000);
});
