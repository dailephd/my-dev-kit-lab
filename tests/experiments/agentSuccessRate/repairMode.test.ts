import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultAgentSuccessRateDependencies } from "../../../src/experiments/plugins/agentSuccessRate/index.js";
import { useSandboxTestCleanup } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";
import { makeTask, runAgentSuccess } from "./agentSuccessRateTestHelpers.js";
import {
  DECOY_REFERENCE_PATCH,
  GOOD_ANSWER,
  MALFORMED_ANSWER,
  MODES,
  NOOP_ANSWER,
  REFERENCE_MARKER,
  analysisTreatmentOf,
  makeScriptedProvider,
  readJson,
  runRepair,
  treatmentOf,
  type Json
} from "./repairTestHelpers.js";

useSandboxTestCleanup();

const taskNamed = (id: string, overrides: Record<string, unknown> = {}) => makeTask({ id, ...overrides }, DECOY_REFERENCE_PATCH);
const METRIC = (treatment: Json, id: string): Json => treatment.metrics[id];

describe("RPR repair campaign (scripted provider, repairAttempts=2)", () => {
  const tasks = ["case-a", "case-b", "case-c", "case-d", "case-e"].map((id) => taskNamed(id));

  async function campaign() {
    const provider = makeScriptedProvider(({ caseId, mode, attempt }) => {
      switch (caseId) {
        case "case-a":
          return { answer: GOOD_ANSWER };
        case "case-b":
          return attempt === 1 ? { answer: NOOP_ANSWER } : { answer: GOOD_ANSWER, tokens: 150 };
        case "case-c":
          if (attempt === 1) return { answer: MALFORMED_ANSWER };
          if (attempt === 2) return { answer: NOOP_ANSWER, tokens: mode === "raw-full-file" ? null : 100 };
          return { answer: GOOD_ANSWER };
        case "case-d":
          return { answer: NOOP_ANSWER };
        default:
          return { outcome: "unavailable" };
      }
    });
    const result = await runRepair({ tasks, provider, repairAttempts: 2 });
    return { provider, ...result };
  }

  it("RPR-004..017/026: bounded attempts, fresh sandboxes, complete replacement patches and preserved evidence", async () => {
    const { provider, run, outDir, execution } = await campaign();
    // case-e's provider was unavailable, so the run is partial; the other cases completed
    expect(run.status).toBe("partial");
    expect(execution.realAgent).toMatchObject({ providerId: "codex", attemptsPerTreatment: 3, repairAttempts: 2 });

    const callsFor = (caseId: string, mode: string) => provider.facts.filter((fact) => fact.caseId === caseId && fact.mode === mode);
    const expectedAttempts: Record<string, number> = { "case-a": 1, "case-b": 2, "case-c": 3, "case-d": 3, "case-e": 1 };
    for (const [caseId, count] of Object.entries(expectedAttempts)) {
      for (const mode of MODES) {
        // RPR-004 initial success prevents repair; RPR-015 never more than three attempts; RPR-014 contiguous numbering
        expect(callsFor(caseId, mode).map((fact) => fact.attempt), `${caseId}/${mode}`).toEqual(Array.from({ length: count }, (_, index) => index + 1));
        const treatment = treatmentOf(execution, caseId, mode);
        expect(treatment.attempts.map((attempt: Json) => attempt.attemptNumber)).toEqual(Array.from({ length: count }, (_, index) => index + 1));
        // RPR-012 each attempt has its own sandbox; the top-level evidence is the final attempt
        const sandboxes = treatment.attempts.map((attempt: Json) => attempt.evidence.sandboxId);
        expect(new Set(sandboxes).size).toBe(count);
        expect(treatment.sandboxId).toBe(sandboxes[count - 1]);
        expect(treatment.attempts[0].evidence.attempts).toBeUndefined();
        expect(existsSync(path.join(outDir, "agents", "fixture", caseId, mode, "attempt-4"))).toBe(false);
      }
    }
    // every sandbox was removed
    expect(existsSync(path.join(outDir, "sandboxes"))).toBe(false);
    for (const treatment of execution.cases.flatMap((entry: Json) => entry.treatments)) {
      for (const attempt of treatment.attempts) expect(attempt.cleanupResult).toMatchObject({ attempted: true, removed: true });
    }

    // failure categories in execution order (RPR-005/006/007)
    const categories = (caseId: string) => treatmentOf(execution, caseId, "raw-full-file").attempts.map((attempt: Json) => attempt.failureCategory);
    expect(categories("case-a")).toEqual(["none"]);
    expect(categories("case-b")).toEqual(["task-check-failed", "none"]);
    expect(categories("case-c")).toEqual(["patch-malformed", "task-check-failed", "none"]);
    expect(categories("case-d")).toEqual(["task-check-failed", "task-check-failed", "task-check-failed"]);
    expect(categories("case-e")).toEqual(["provider-unavailable"]);
    expect(treatmentOf(execution, "case-e", "raw-full-file").attempts[0]).toMatchObject({ repairEligible: false, taskSuccess: null, providerStatus: "agent-unavailable" });

    // RPR-013/016/017: complete replacement patches; earlier artifacts and verification are preserved
    const b = treatmentOf(execution, "case-b", "raw-full-file");
    const proposed = (n: number) => readFileSync(path.join(outDir, `diffs/fixture/case-b/raw-full-file/attempt-${n}-proposed.patch`), "utf8");
    const applied = (n: number) => readFileSync(path.join(outDir, `diffs/fixture/case-b/raw-full-file/attempt-${n}-applied.patch`), "utf8");
    expect(proposed(1)).toContain("harmless comment");
    expect(proposed(2)).not.toContain("harmless comment");
    expect(applied(1)).toContain("harmless comment");
    expect(applied(2)).toContain("src/math.cjs");
    expect(applied(2)).not.toContain("harmless comment");
    expect(b.attempts[0].evidence.change.changedFiles.map((file: Json) => file.relativePath)).toEqual(["src/other.cjs"]);
    expect(b.attempts[1].evidence.change.changedFiles.map((file: Json) => file.relativePath)).toEqual(["src/math.cjs"]);
    expect(b.attempts[0].postEditVerification.taskResults[0]).toMatchObject({ checkId: "task-add", status: "failed" });
    expect(b.attempts[1].postEditVerification.taskResults[0]).toMatchObject({ checkId: "task-add", status: "passed" });
    expect(b.attempts[0]).toMatchObject({ taskSuccess: false, proposedPatchAvailability: "available", patchApplicationOutcome: "success", changeEvidenceAvailability: "available" });
    expect(b.attempts[1]).toMatchObject({ taskSuccess: true, failureCategory: "none" });
    for (const attempt of b.attempts) {
      expect(attempt.evidence.realAgent.agentArtifactDirectory).toBe(`agents/fixture/case-b/raw-full-file/attempt-${attempt.attemptNumber}`);
      expect(existsSync(path.join(outDir, attempt.evidence.realAgent.agentArtifactDirectory, "prompt.txt"))).toBe(true);
    }

    // a malformed first attempt keeps its proposal but fabricates no applied diff
    expect(existsSync(path.join(outDir, "diffs/fixture/case-c/raw-full-file/attempt-1-proposed.patch"))).toBe(true);
    expect(existsSync(path.join(outDir, "diffs/fixture/case-c/raw-full-file/attempt-1-applied.patch"))).toBe(false);
    expect(treatmentOf(execution, "case-c", "raw-full-file").attempts[0]).toMatchObject({ patchApplicationOutcome: "parse-failure", changeEvidenceAvailability: "unavailable" });
    // an unavailable provider writes no proposal at all
    expect(existsSync(path.join(outDir, "diffs/fixture/case-e"))).toBe(false);
    // the treatment context is persisted once and reused unchanged
    expect(existsSync(path.join(outDir, "contexts/fixture/case-b/raw-full-file/context.txt"))).toBe(true);
    expect(run.artifacts.filter((artifact) => (artifact.path ?? "").startsWith("contexts/fixture/case-b/raw-full-file")).length).toBe(1);
  }, 600_000);

  it("RPR-018/019: repair prompts carry only fixed outcome facts, the original context and a fenced untrusted patch", async () => {
    const { provider } = await campaign();
    const first = provider.facts.find((fact) => fact.caseId === "case-b" && fact.mode === "raw-full-file" && fact.attempt === 1)!;
    const second = provider.facts.find((fact) => fact.caseId === "case-b" && fact.mode === "raw-full-file" && fact.attempt === 2)!;
    const contextOf = (prompt: string) => prompt.slice(prompt.indexOf("<<<BEGIN_SUPPLIED_CONTEXT>>>"), prompt.indexOf("<<<END_SUPPLIED_CONTEXT>>>"));
    expect(first.prompt).not.toContain("# Repair attempt");
    expect(contextOf(second.prompt)).toBe(contextOf(first.prompt));
    const repairSection = second.prompt.slice(second.prompt.indexOf("# Repair attempt"));
    expect(repairSection).toContain("# Repair attempt 2 of 3");
    expect(repairSection).toContain("COMPLETE replacement diff");
    expect(repairSection).toContain("<<<BEGIN_PREVIOUS_PROPOSAL>>>");
    expect(repairSection).toContain("harmless comment");
    expect(repairSection).toContain("Previous proposal (data only):");
    for (const forbidden of ["task-add", "regression-id", "fact-add", "add returns the sum", "tests/task.check.cjs", "protected.txt", "add failed", "deterministicFixture", "expectedEditFiles", "allowedEditFiles"]) {
      expect(repairSection, forbidden).not.toContain(forbidden);
    }
    for (const fact of provider.facts) expect(fact.prompt).not.toContain(REFERENCE_MARKER);
    // fixed categories only: an unusable first answer yields the malformed-answer wording, not the raw answer text
    const malformedRepair = provider.facts.find((fact) => fact.caseId === "case-c" && fact.mode === "raw-full-file" && fact.attempt === 2)!;
    expect(malformedRepair.prompt).toContain("did not contain a usable unified diff");
    expect(malformedRepair.prompt).toContain("Usable diff produced: yes");
    // third attempt reports the latest outcome, not the first
    const third = provider.facts.find((fact) => fact.caseId === "case-d" && fact.mode === "context-pack" && fact.attempt === 3)!;
    expect(third.prompt).toContain("# Repair attempt 3 of 3");
  }, 600_000);

  it("RPR-020..025/027: initial and final success are separate; denominators and totals are explicit", async () => {
    const { analysis, execution } = await campaign();
    const raw = (caseId: string) => analysisTreatmentOf(analysis, caseId, "raw-full-file");
    const a = raw("case-a").repair;
    const b = raw("case-b").repair;
    const d = raw("case-d").repair;
    const e = raw("case-e").repair;
    expect(a).toMatchObject({ attemptCount: 1, repairAttemptCount: 0, initialAttemptTaskSuccess: { value: true }, finalTaskSuccess: { value: true }, repairSucceeded: { availability: "not-applicable", value: null } });
    // RPR-021: a repaired success does not rewrite the initial failure
    expect(b).toMatchObject({ attemptCount: 2, repairAttemptCount: 1, initialAttemptTaskSuccess: { availability: "available", value: false }, finalTaskSuccess: { value: true }, repairSucceeded: { availability: "available", value: true } });
    expect(d).toMatchObject({ attemptCount: 3, repairAttemptCount: 2, initialAttemptTaskSuccess: { value: false }, finalTaskSuccess: { value: false }, repairSucceeded: { availability: "available", value: false } });
    // unavailable evidence is not false
    expect(e.initialAttemptTaskSuccess).toMatchObject({ availability: "unavailable", value: null });
    expect(e.repairSucceeded.availability).toBe("not-applicable");
    // RPR-024: top-level edit quality is the final patch; the failed first attempt keeps its own values
    expect(METRIC(raw("case-b"), "expectedEditCoverage").value).toBe(1);
    expect(b.attempts[0].metrics.expectedEditCoverage.value).toBe(0);
    expect(b.attempts[1].metrics.expectedEditCoverage.value).toBe(1);
    expect(METRIC(raw("case-b"), "changedFileCount").value).toBe(1);
    // RPR-025: cumulative provider cost is separate from the final attempt
    expect(METRIC(raw("case-b"), "agentTotalTokens").value).toBe(150);
    expect(b.totalProviderTokens).toMatchObject({ availability: "available", value: 250 });
    expect(b.firstAttemptProviderTokens.value).toBe(100);
    expect(b.finalAttemptProviderTokens.value).toBe(150);
    // RPR-023: a missing attempt measurement makes the total unavailable instead of silently shorter
    const cRaw = raw("case-c").repair;
    expect(cRaw.providerAttemptCount).toBe(3);
    expect(cRaw.providerTokenMeasuredAttemptCount).toBe(2);
    expect(cRaw.totalProviderTokens).toMatchObject({ availability: "unavailable", value: null });
    expect(cRaw.totalProviderTokens.reason).toContain("1 of 3");
    expect(analysisTreatmentOf(analysis, "case-c", "context-pack").repair.totalProviderTokens).toMatchObject({ availability: "available", value: 300 });

    // RPR-022: aggregate denominators
    const [rawAggregate, packAggregate] = analysis.analysis.aggregates;
    for (const aggregate of [rawAggregate, packAggregate]) {
      expect(aggregate.repair).toMatchObject({
        initialAttemptEvaluableCount: 4,
        initialAttemptSuccessfulCount: 1,
        finalEvaluableCount: 4,
        finalSuccessfulCount: 3,
        repairEligibleCaseCount: 3,
        repairAttemptedCaseCount: 3,
        repairAttemptedEvaluableCaseCount: 3,
        repairedCaseCount: 2,
        totalAttemptCount: 10,
        totalRepairAttemptCount: 5
      });
      expect(aggregate.repair.initialAttemptSuccessRate.value).toBeCloseTo(0.25);
      expect(aggregate.repair.finalTaskSuccessRate.value).toBeCloseTo(0.75);
      expect(aggregate.repair.repairSuccessRate.value).toBeCloseTo(2 / 3);
      expect(aggregate.repair.meanAttemptsPerEvaluableCase.value).toBeCloseTo(2.25);
      // the established rate is the final rate; the initial rate is the attempt-1 rate
      expect(aggregate.taskSuccessRate.value).toBeCloseTo(0.75);
      expect(aggregate.initialAttemptSuccessRate.value).toBeCloseTo(0.25);
    }
    const rawTokens = rawAggregate.repair.providerTokens.find((entry: Json) => entry.basis === "total-across-attempts");
    expect(rawTokens).toMatchObject({ contributingCaseCount: 5, availableCaseCount: 3, unavailableCaseCount: 2, sumOfAvailable: 650 });
    expect(rawTokens.total).toMatchObject({ availability: "unavailable", value: null });
    expect(packAggregate.repair.providerTokens.find((entry: Json) => entry.basis === "total-across-attempts")).toMatchObject({ availableCaseCount: 4, unavailableCaseCount: 1, sumOfAvailable: 950 });
    expect(rawAggregate.repair.providerTokens.map((entry: Json) => entry.basis)).toEqual(["first-attempt", "final-attempt", "total-across-attempts"]);

    // matched comparison: descriptive only
    const repairComparison = analysis.analysis.repairComparison;
    expect(repairComparison.initialAttempt.matchedCaseIds).toEqual(["case-a", "case-b", "case-c", "case-d"]);
    expect(repairComparison.initialAttempt.incompleteCases).toEqual([{ caseId: "case-e", unavailableTreatmentIds: ["raw-full-file", "context-pack"] }]);
    expect(repairComparison.interpretation).toEqual({ evaluable: true, observedOutcomeDifference: "not-observed", statisticalEffect: "not-assessed" });
    expect(repairComparison.pairedDifferences.map((entry: Json) => entry.id)).toEqual([
      "initialAttemptSuccess", "finalSuccess", "repairAttempts", "editScopePrecision", "expectedEditCoverage", "unexpectedChangedFiles", "totalChurn", "providerDurationMs", "providerTokens"
    ]);
    const tokensDifference = repairComparison.pairedDifferences.find((entry: Json) => entry.id === "providerTokens");
    expect(tokensDifference.matchedCaseIds).toEqual(["case-a", "case-b", "case-d"]);
    expect(analysis.analysis.comparison.pairedOutcomes).toEqual({ bothSucceeded: 3, onlyRawFullFileSucceeded: 0, onlyContextPackSucceeded: 0, neitherSucceeded: 1 });

    // RPR-026/027: execution and analysis describe the same attempts
    for (const entry of execution.cases) {
      entry.treatments.forEach((treatment: Json) => {
        const analyzed = analysisTreatmentOf(analysis, entry.caseId, treatment.treatmentId).repair;
        expect(analyzed.attempts.map((attempt: Json) => attempt.attemptNumber)).toEqual(treatment.attempts.map((attempt: Json) => attempt.attemptNumber));
        analyzed.attempts.forEach((attempt: Json, index: number) => {
          const verdict = attempt.metrics.taskSuccess;
          expect(verdict.availability === "available" ? verdict.value : null).toBe(treatment.attempts[index].taskSuccess);
        });
      });
    }
    expect(execution.runId).toBe(analysis.runId);
    // no ranking, winner or significance anywhere
    expect(JSON.stringify(analysis)).not.toMatch(/"(winner|ranking|pValue|significance|compositeScore|weightedScore|best)"/);
  }, 600_000);
});

describe("RPR non-repairable outcomes", () => {
  it("RPR-007..011: provider health, infrastructure and invalid baselines never trigger a repair", async () => {
    const baselineInvalid = taskNamed("case-k", {
      taskChecks: [{ id: "task-pass", executable: "node", args: ["tests/regression.check.cjs"], timeoutMs: 20000 }],
      behaviorFacts: [{ id: "fact-pass", text: "already works", required: true, verificationCheckIds: ["task-pass"] }]
    });
    const tasks = [taskNamed("case-f"), taskNamed("case-g"), taskNamed("case-h"), taskNamed("case-i"), taskNamed("case-j"), baselineInvalid];
    const provider = makeScriptedProvider(({ caseId }) => {
      switch (caseId) {
        case "case-f":
          return { outcome: "timeout" };
        case "case-g":
          return { outcome: "limit" };
        case "case-h":
          return { outcome: "empty" };
        default:
          return { answer: GOOD_ANSWER };
      }
    });
    const dependencies = {
      ...defaultAgentSuccessRateDependencies,
      runChecks: async (options: Parameters<typeof defaultAgentSuccessRateDependencies.runChecks>[0]) => {
        const result = await defaultAgentSuccessRateDependencies.runChecks(options);
        if (options.phase !== "post-edit") return result;
        if (options.task.id === "case-i") throw new Error("verifier exploded SECRET_VERIFIER_TEXT");
        if (options.task.id === "case-j") {
          return { ...result, taskResults: result.taskResults.map((check) => ({ ...check, status: "timeout" as const, exitCode: null, timedOut: true })) };
        }
        return result;
      }
    };
    const { run, execution, outDir } = await runRepair({ tasks, provider, repairAttempts: 2, extraInputs: { agentSuccessDependencies: dependencies } });
    const categories: Record<string, string> = {
      "case-f": "provider-timeout",
      "case-g": "provider-limit-reached",
      "case-h": "provider-empty-answer",
      "case-i": "infrastructure-failure",
      "case-j": "evidence-incomplete",
      "case-k": "baseline-invalid"
    };
    for (const [caseId, category] of Object.entries(categories)) {
      for (const mode of MODES) {
        const treatment = treatmentOf(execution, caseId, mode);
        expect(treatment.attempts, `${caseId}/${mode}`).toHaveLength(1);
        expect(treatment.attempts[0], `${caseId}/${mode}`).toMatchObject({ attemptNumber: 1, failureCategory: category, repairEligible: false });
        expect(provider.facts.filter((fact) => fact.caseId === caseId && fact.mode === mode && fact.attempt > 1)).toHaveLength(0);
      }
    }
    // the invalid baseline never reaches the provider
    expect(provider.facts.filter((fact) => fact.caseId === "case-k")).toHaveLength(0);
    expect(treatmentOf(execution, "case-k", "raw-full-file").attempts[0]).toMatchObject({ providerStatus: "not-invoked" });
    // the infrastructure failure is recorded as such (bounded), and no prompt ever carried the verifier text
    expect(treatmentOf(execution, "case-i", "raw-full-file").errors.map((error: Json) => error.code)).toContain("EXECUTION_FAILED");
    for (const fact of provider.facts) expect(fact.prompt).not.toContain("SECRET_VERIFIER_TEXT");
    expect(run.status).not.toBe("completed");
    expect(existsSync(path.join(outDir, "sandboxes"))).toBe(false);
  }, 600_000);

  it("RPR-019: raw Git output and exception text never enter a repair prompt", async () => {
    const stale = ["diff --git a/src/math.cjs b/src/math.cjs", "--- a/src/math.cjs", "+++ b/src/math.cjs", "@@ -1 +1 @@", "-module.exports.add = (a, b) => a * b;", "+module.exports.add = (a, b) => a + b;", ""].join("\n");
    const provider = makeScriptedProvider(({ attempt }) => ({ answer: attempt === 1 ? `\`\`\`diff\n${stale}\`\`\`\n` : GOOD_ANSWER }));
    const { execution } = await runRepair({ tasks: [taskNamed("case-a")], provider, repairAttempts: 1 });
    const first = treatmentOf(execution, "case-a", "raw-full-file").attempts[0];
    expect(first.failureCategory).toMatch(/^patch-(check|apply)-failed$/);
    expect(first.repairEligible).toBe(true);
    const gitText = first.evidence.patch.message as string;
    expect(gitText.length).toBeGreaterThan(0);
    const repairPrompt = provider.facts.find((fact) => fact.attempt === 2)!.prompt;
    expect(repairPrompt).toContain("did not apply");
    for (const fragment of gitText.split(/\s+/).filter((word) => word.length > 8)) expect(repairPrompt, fragment).not.toContain(fragment);
    expect(treatmentOf(execution, "case-a", "raw-full-file").attempts[1].taskSuccess).toBe(true);
  }, 300_000);

  it("RPR-001/028: repairAttempts defaults to zero and deterministic mode is unchanged", async () => {
    const provider = makeScriptedProvider(() => ({ answer: NOOP_ANSWER }));
    const { execution, analysis } = await runRepair({ tasks: [taskNamed("case-a")], provider });
    expect(provider.facts.map((fact) => fact.attempt)).toEqual([1, 1]);
    expect(execution.realAgent).toMatchObject({ attemptsPerTreatment: 1, repairAttempts: 0 });
    expect(treatmentOf(execution, "case-a", "raw-full-file").attempts).toHaveLength(1);
    // a repair-eligible failure is recorded, but the allowance is zero
    expect(treatmentOf(execution, "case-a", "raw-full-file").attempts[0]).toMatchObject({ failureCategory: "task-check-failed", repairEligible: true });
    expect(analysisTreatmentOf(analysis, "case-a", "raw-full-file").repair).toMatchObject({ attemptCount: 1, repairAttemptCount: 0 });

    const toolRoot = (await import("./agentSuccessRateTestHelpers.js")).makeToolRoot();
    const deterministic = await runAgentSuccess({ toolRoot, tasks: [makeTask()] });
    const detExecution = readJson(deterministic.outDir, "agent-success-rate-execution.json");
    const detAnalysis = readJson(deterministic.outDir, "agent-success-rate-analysis.json");
    expect(detExecution.realAgent).toBeUndefined();
    for (const treatment of detExecution.cases[0].treatments) expect(treatment.attempts).toBeUndefined();
    for (const treatment of detAnalysis.analysis.cases[0].treatments) expect(treatment.repair).toBeUndefined();
    for (const aggregate of detAnalysis.analysis.aggregates) expect(aggregate.repair).toBeUndefined();
    expect(detAnalysis.analysis.repairComparison).toBeUndefined();
    expect(detAnalysis.analysis.contextEffectEvaluated).toBe(false);
  }, 600_000);

  it("RPR-052/051: a failed provider-directory cleanup is recorded and cannot read as a fully successful attempt", async () => {
    const removed: string[] = [];
    const provider = makeScriptedProvider(() => ({ answer: GOOD_ANSWER }));
    // fault injection: the removal seam fails deterministically on every platform and leaves the directory in place
    const removeDirectory = async (directory: string) => {
      removed.push(directory);
      throw new Error(`cleanup refused for ${directory}`);
    };
    const { execution, outDir } = await runRepair({ tasks: [taskNamed("case-a")], provider, repairAttempts: 2, extraInputs: { agentSuccessRemoveDirectory: removeDirectory } });
    try {
      for (const mode of MODES) {
        const treatment = treatmentOf(execution, "case-a", mode);
        const attempt = treatment.attempts[0];
        expect(attempt.evidence.realAgent.cwdCleanup).toMatchObject({ attempted: true, removed: false });
        expect(attempt.evidence.realAgent.cwdCleanup.reason).toContain("cleanup refused");
        expect(attempt.evidence.realAgent.cwdCleanup.reason).not.toContain(outDir);
        expect(treatment.status).toBe("partial");
        expect(treatment.availability).toBe("incomplete");
        expect(attempt.failureCategory).toBe("cleanup-failed");
        expect(attempt.repairEligible).toBe(false);
        expect(treatment.errors.map((error: Json) => error.code)).toContain("AGENT_CWD_CLEANUP_FAILED");
      }
      expect(removed).toHaveLength(2);
      expect(new Set(removed).size).toBe(2);
    } finally {
      const { rm } = await import("node:fs/promises");
      for (const directory of removed) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
    // a later independent run is unaffected by the earlier failure
    const later = await runRepair({ tasks: [taskNamed("case-a")], provider: makeScriptedProvider(() => ({ answer: GOOD_ANSWER })) });
    expect(treatmentOf(later.execution, "case-a", "raw-full-file").status).toBe("completed");
  }, 600_000);

  it("RPR-051/052: a cleanup failure blocks repair, touches nothing else and leaves later attempts possible", async () => {
    const { mkdirSync, mkdtempSync, writeFileSync } = await import("node:fs");
    const { rm } = await import("node:fs/promises");
    const os = await import("node:os");
    const { snapshotProjectTree } = await import("../../../src/evaluation/benchmarkSandbox/index.js");
    // an unrelated sibling of the provider working directories, which cleanup must never remove or alter
    const sibling = mkdtempSync(path.join(os.tmpdir(), "my-dev-kit-lab-asr-sibling-"));
    mkdirSync(path.join(sibling, "nested"));
    writeFileSync(path.join(sibling, "nested", "keep.txt"), "precious");
    const { makeToolRoot } = await import("./agentSuccessRateTestHelpers.js");
    const toolRoot = makeToolRoot();
    const canonical = path.join(toolRoot, "benchmarks", "projects", "fixture");
    const canonicalBefore = await snapshotProjectTree(canonical, { excludedNames: [".git"] });
    const siblingBefore = await snapshotProjectTree(sibling, { excludedNames: [] });

    const attempted: string[] = [];
    const leftovers: string[] = [];
    // The first removal fails on every platform (no permissions, no timing); later removals are real.
    const removeDirectory = async (directory: string) => {
      attempted.push(directory);
      if (attempted.length === 1) {
        leftovers.push(directory);
        throw new Error("cleanup refused");
      }
      await rm(directory, { recursive: true, force: true });
    };
    const provider = makeScriptedProvider(() => ({ answer: NOOP_ANSWER }));
    try {
      const { execution } = await runRepair({ tasks: [taskNamed("case-a")], provider, repairAttempts: 2, toolRoot, extraInputs: { agentSuccessRemoveDirectory: removeDirectory } });
      const raw = treatmentOf(execution, "case-a", "raw-full-file");
      const pack = treatmentOf(execution, "case-a", "context-pack");
      // the raw treatment's first attempt failed the task but its cleanup failed, so it is neither repaired nor fully successful
      expect(raw.attempts).toHaveLength(1);
      expect(raw.attempts[0]).toMatchObject({ failureCategory: "cleanup-failed", repairEligible: false, taskSuccess: false });
      expect(raw.status).toBe("partial");
      expect(raw.availability).toBe("incomplete");
      expect(raw.attempts[0].evidence.realAgent.cwdCleanup).toMatchObject({ attempted: true, removed: false });
      // the later, independent treatment still ran, was cleaned up and is eligible for its own repairs
      expect(pack.attempts).toHaveLength(3);
      expect(pack.attempts[0].evidence.realAgent.cwdCleanup).toMatchObject({ attempted: true, removed: true });
      expect(pack.attempts[0]).toMatchObject({ failureCategory: "task-check-failed", repairEligible: true });
      // every removal was attempted exactly for a directory the Lab created; no other directory was named
      expect(attempted).toHaveLength(4);
      expect(new Set(attempted).size).toBe(4);
      for (const directory of attempted) expect(path.basename(directory).startsWith("my-dev-kit-lab-asr-agent-")).toBe(true);
      // canonical benchmark content and the unrelated sibling are untouched
      expect(await snapshotProjectTree(canonical, { excludedNames: [".git"] })).toEqual(canonicalBefore);
      expect(await snapshotProjectTree(sibling, { excludedNames: [] })).toEqual(siblingBefore);
      expect(existsSync(leftovers[0]!)).toBe(true);
    } finally {
      for (const directory of leftovers) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      await rm(sibling, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 600_000);
});
