import { describe, expect, it } from "vitest";
import {
  AGENT_SUCCESS_METRIC_IDS,
  analyzeAgentSuccessRate,
  availableMetric,
  notApplicableMetric,
  unavailableMetric,
  validateAgentSuccessMetric,
  type AgentSuccessMetricId,
  type AgentSuccessTreatmentEvidenceV1
} from "../../../src/experiments/plugins/agentSuccessRate/index.js";
import { analyzeAgentSuccessTreatment } from "../../../src/experiments/plugins/agentSuccessRate/analysis.js";
import { makeCaseEvidence, makeCheckEvidence, makeTask, makeTreatmentEvidence } from "./agentSuccessRateTestHelpers.js";

const changed = (relativePath: string, status: "added" | "modified" | "deleted", additions: number | null, deletions: number | null) => ({
  relativePath,
  status,
  beforeSha256: status === "added" ? null : "1".repeat(64),
  afterSha256: status === "deleted" ? null : "2".repeat(64),
  additions,
  deletions
});

function changeOf(files: ReturnType<typeof changed>[]): NonNullable<AgentSuccessTreatmentEvidenceV1["change"]> {
  return {
    baselineCommit: "a".repeat(40),
    changedFiles: files,
    addedCount: files.filter((f) => f.status === "added").length,
    modifiedCount: files.filter((f) => f.status === "modified").length,
    deletedCount: files.filter((f) => f.status === "deleted").length,
    changedCount: files.length,
    totalAdditions: files.reduce((s, f) => s + (f.additions ?? 0), 0),
    totalDeletions: files.reduce((s, f) => s + (f.deletions ?? 0), 0)
  };
}

const metricsFor = (task: ReturnType<typeof makeTask>, evidence: Partial<AgentSuccessTreatmentEvidenceV1>) => analyzeAgentSuccessTreatment(task, makeTreatmentEvidence(evidence)).metrics;

const twoCheckTask = () =>
  makeTask({
    taskChecks: [
      { id: "task-add", executable: "node", args: ["tests/task.check.cjs"], timeoutMs: 20000 },
      { id: "task-two", executable: "node", args: ["tests/task.check.cjs"], timeoutMs: 20000 }
    ],
    behaviorFacts: [
      { id: "fact-add", text: "prose that lies", required: true, verificationCheckIds: ["task-add"] },
      { id: "fact-both", text: "both", required: true, verificationCheckIds: ["task-add", "task-two"] },
      { id: "fact-optional", text: "optional", required: false, verificationCheckIds: ["regression-id"] }
    ]
  });

const twoCheckBaseline = {
  baselineVerification: {
    phase: "baseline" as const,
    taskResults: [makeCheckEvidence("task-add", "task", "failed"), makeCheckEvidence("task-two", "task", "failed")],
    regressionResults: [makeCheckEvidence("regression-id", "regression", "passed")]
  }
};

const post = (taskStatuses: Array<"passed" | "failed" | "timeout" | "error">, regression: "passed" | "failed" | "timeout" | "error" | null = "passed") => ({
  postEditVerification: {
    phase: "post-edit" as const,
    taskResults: taskStatuses.map((status, index) => makeCheckEvidence(index === 0 ? "task-add" : "task-two", "task", status)),
    regressionResults: regression === null ? [] : [makeCheckEvidence("regression-id", "regression", regression)]
  }
});

describe("agent-success-rate scoring", () => {
  it("ASR-023 requires every task check to pass for taskResolved", () => {
    const task = twoCheckTask();
    const allPass = metricsFor(task, { ...twoCheckBaseline, ...post(["passed", "passed"]) });
    expect(allPass.taskChecksPassed.value).toBe(true);
    expect(allPass.taskResolved.value).toBe(true);
    expect(allPass.taskSuccess.value).toBe(true);
    const onePasses = metricsFor(task, { ...twoCheckBaseline, ...post(["passed", "failed"]) });
    expect(onePasses.taskChecksPassed.value).toBe(false);
    expect(onePasses.taskResolved.value).toBe(false);
    expect(onePasses.taskCheckPassedCount.value).toBe(1);
    expect(onePasses.taskCheckTotalCount.value).toBe(2);
    expect(onePasses.taskCheckPassRate.value).toBe(0.5);
  });

  it("ASR-024 a failed task check prevents taskSuccess", () => {
    const metrics = metricsFor(makeTask(), { postEditVerification: { phase: "post-edit", taskResults: [makeCheckEvidence("task-add", "task", "failed")], regressionResults: [makeCheckEvidence("regression-id", "regression", "passed")] } });
    expect(metrics.taskSuccess).toMatchObject({ availability: "available", value: false });
    expect(metrics.regressionSafe.value).toBe(true);
  });

  it("ASR-025 a regression failure prevents taskSuccess while taskResolved stays true", () => {
    const metrics = metricsFor(makeTask(), { postEditVerification: { phase: "post-edit", taskResults: [makeCheckEvidence("task-add", "task", "passed")], regressionResults: [makeCheckEvidence("regression-id", "regression", "failed")] } });
    expect(metrics.taskResolved.value).toBe(true);
    expect(metrics.regressionSafe.value).toBe(false);
    expect(metrics.regressionFailureCount.value).toBe(1);
    expect(metrics.regressionCheckPassedCount.value).toBe(0);
    expect(metrics.regressionCheckPassRate.value).toBe(0);
    expect(metrics.taskSuccess.value).toBe(false);
  });

  it("ASR-026 fact satisfaction is derived from check IDs, never from prose", () => {
    const task = twoCheckTask();
    // The fixture notes and fact text claim success, but the trusted check says it failed.
    const metrics = metricsFor(task, { ...twoCheckBaseline, ...post(["failed", "passed"]) });
    expect(metrics.requiredFactsTotal.value).toBe(2);
    expect(metrics.requiredFactsSatisfiedCount.value).toBe(0);
    expect(metrics.requiredFactsSatisfied.value).toBe(false);
    expect(metrics.requiredFactCoverage.value).toBe(0);
    expect(metrics.optionalFactsTotal.value).toBe(1);
    expect(metrics.optionalFactsSatisfiedCount.value).toBe(1);
    // fact-both needs both referenced checks; one failing check fails it, fact-add alone passes.
    const partial = metricsFor(task, { ...twoCheckBaseline, ...post(["passed", "failed"]) });
    expect(partial.requiredFactsSatisfiedCount.value).toBe(1);
    expect(partial.requiredFactCoverage.value).toBe(0.5);
    expect(partial.factCoverage.value).toBeCloseTo(2 / 3, 10);
  });

  it("ASR-027 a missing required check result cannot count as satisfied", () => {
    const task = twoCheckTask();
    const missing = metricsFor(task, { ...twoCheckBaseline, ...post(["passed"]) }); // task-two has no result
    expect(missing.requiredFactsSatisfied).toMatchObject({ availability: "unavailable", value: null });
    expect(missing.requiredFactCoverage.availability).toBe("unavailable");
    expect(missing.requiredFactsSatisfiedCount.availability).toBe("unavailable");
    expect(missing.taskSuccess).toMatchObject({ availability: "unavailable", value: null });
    // A timed-out check is indeterminate, not a normal failure.
    const timedOut = metricsFor(makeTask(), { postEditVerification: { phase: "post-edit", taskResults: [makeCheckEvidence("task-add", "task", "timeout")], regressionResults: [makeCheckEvidence("regression-id", "regression", "passed")] } });
    expect(timedOut.taskChecksPassed.availability).toBe("unavailable");
    expect(timedOut.taskCheckPassRate.availability).toBe("unavailable");
    expect(timedOut.taskSuccess.availability).toBe("unavailable");
    // A definite failure elsewhere still decides the verdict.
    const failedAndMissing = metricsFor(task, { ...twoCheckBaseline, ...post(["failed"]) });
    expect(failedAndMissing.taskSuccess).toMatchObject({ availability: "available", value: false });
  });

  it("ASR-028 a proven protected mutation prevents taskSuccess and unproven integrity cannot be success", () => {
    const mutated = metricsFor(makeTask(), { protectedIntegrity: { status: "mutated", mutatedPaths: ["protected.txt"] }, patch: { ...makeTreatmentEvidence().patch, attemptedProtectedPaths: [] } });
    expect(mutated.taskResolved.value).toBe(true);
    expect(mutated.protectedIntegrity.value).toBe(false);
    expect(mutated.protectedMutationCount.value).toBe(1);
    expect(mutated.taskSuccess).toMatchObject({ availability: "available", value: false });
    const unproven = metricsFor(makeTask(), { protectedIntegrity: { status: "unproven", mutatedPaths: [] } });
    expect(unproven.protectedIntegrity.availability).toBe("unavailable");
    expect(unproven.protectedMutationCount.availability).toBe("unavailable");
    expect(unproven.taskSuccess.availability).toBe("unavailable");
    expect(unproven.taskSuccess.value).not.toBe(true);
    // An attempted (rejected) protected edit is separate from an actual mutation.
    const attempted = metricsFor(makeTask(), {
      patch: { ...makeTreatmentEvidence().patch, outcome: "policy-rejection", appliedFiles: [], rejections: [{ code: "PROTECTED_PATH", path: "protected.txt" }], attemptedProtectedPaths: ["protected.txt"] },
      postEditVerification: null,
      change: null
    });
    expect(attempted.attemptedProtectedEditCount.value).toBe(1);
    expect(attempted.protectedMutationCount.value).toBe(0);
    expect(attempted.taskSuccess).toMatchObject({ availability: "available", value: false });
  });
});

describe("agent-success-rate edit quality", () => {
  const task = () => makeTask({ expectedEditFiles: ["src/math.cjs", "src/other.cjs"], allowedEditFiles: ["src/math.cjs", "src/other.cjs", "docs/readme.md"] });

  it("ASR-030 expected-edit coverage uses actual changed-file evidence", () => {
    const metrics = metricsFor(task(), { change: changeOf([changed("src/math.cjs", "modified", 1, 1)]) });
    expect(metrics.expectedEditFileCount.value).toBe(2);
    expect(metrics.expectedEditFilesChangedCount.value).toBe(1);
    expect(metrics.expectedEditCoverage.value).toBe(0.5);
    // Claims in the patch evidence do not count; only the change set does.
    const claimed = metricsFor(task(), { patch: { ...makeTreatmentEvidence().patch, appliedFiles: [{ path: "src/other.cjs", status: "modified" }] }, change: changeOf([changed("src/math.cjs", "modified", 1, 1)]) });
    expect(claimed.expectedEditFilesChangedCount.value).toBe(1);
  });

  it("ASR-031 edit-scope precision is allowed changed files over all changed files", () => {
    const metrics = metricsFor(task(), { change: changeOf([changed("src/math.cjs", "modified", 1, 1), changed("docs/readme.md", "modified", 1, 0), changed("unrelated/x.txt", "added", 2, 0)]) });
    expect(metrics.allowedEditChangedFileCount.value).toBe(2);
    expect(metrics.editScopePrecision.value).toBeCloseTo(2 / 3, 10);
  });

  it("ASR-032 unexpected changed files outside the allowed list are counted", () => {
    const metrics = metricsFor(task(), { change: changeOf([changed("src/math.cjs", "modified", 1, 1), changed("a.txt", "added", 1, 0), changed("b.txt", "deleted", 0, 3)]) });
    expect(metrics.unexpectedChangedFileCount.value).toBe(2);
  });

  it("ASR-033 zero denominators are not-applicable, not a fabricated zero or one", () => {
    const noExpectation = analyzeAgentSuccessTreatment({ ...task(), expectedEditFiles: [] }, makeTreatmentEvidence());
    expect(noExpectation.metrics.expectedEditCoverage).toMatchObject({ availability: "not-applicable", value: null });
    expect(noExpectation.metrics.expectedEditCoverage.reason).toMatch(/\S/);
    const noChanges = metricsFor(task(), { change: changeOf([]) });
    expect(noChanges.editScopePrecision).toMatchObject({ availability: "not-applicable", value: null });
    expect(noChanges.expectedEditCoverage).toMatchObject({ availability: "available", value: 0 });
    expect(noChanges.changedFileCount.value).toBe(0);
  });

  it("ASR-034 missing change evidence makes dependent metrics unavailable, never zero", () => {
    const metrics = metricsFor(task(), { change: null });
    for (const id of ["expectedEditFilesChangedCount", "expectedEditCoverage", "allowedEditChangedFileCount", "unexpectedChangedFileCount", "editScopePrecision", "changedFileCount", "totalChurn", "relativeChurn"] as const) {
      expect(metrics[id], id).toMatchObject({ availability: "unavailable", value: null });
    }
  });
});

describe("agent-success-rate blast radius", () => {
  const files = [changed("a.ts", "added", 5, 0), changed("b.ts", "modified", 3, 2), changed("c.ts", "deleted", 0, 4), changed("d.ts", "modified", 1, 1)];

  it("ASR-035 changed/added/modified/deleted counts agree with the change set", () => {
    const evidence = makeTreatmentEvidence({ change: changeOf(files) });
    const metrics = analyzeAgentSuccessTreatment(makeTask(), evidence).metrics;
    expect(metrics.changedFileCount.value).toBe(evidence.change!.changedCount);
    expect(metrics.addedFileCount.value).toBe(evidence.change!.addedCount);
    expect(metrics.modifiedFileCount.value).toBe(evidence.change!.modifiedCount);
    expect(metrics.deletedFileCount.value).toBe(evidence.change!.deletedCount);
    expect([metrics.addedFileCount.value, metrics.modifiedFileCount.value, metrics.deletedFileCount.value]).toEqual([1, 2, 1]);
  });

  it("ASR-036 total churn equals additions plus deletions", () => {
    const metrics = metricsFor(makeTask(), { change: changeOf(files) });
    expect(metrics.linesAdded.value).toBe(9);
    expect(metrics.linesDeleted.value).toBe(7);
    expect(metrics.totalChurn.value).toBe(16);
  });

  it("ASR-037 relative churn divides by the baseline text-line count", () => {
    const metrics = metricsFor(makeTask(), { change: changeOf(files), baselineTextLineCount: 32 });
    expect(metrics.baselineTextLineCount.value).toBe(32);
    expect(metrics.relativeChurn.value).toBe(0.5);
  });

  it("ASR-038 a missing, zero or binary denominator follows the declared availability semantics", () => {
    expect(metricsFor(makeTask(), { change: changeOf(files), baselineTextLineCount: null }).relativeChurn).toMatchObject({ availability: "unavailable", value: null });
    expect(metricsFor(makeTask(), { change: changeOf(files), baselineTextLineCount: 0 }).relativeChurn).toMatchObject({ availability: "not-applicable", value: null });
    const binary = metricsFor(makeTask(), { change: changeOf([changed("img.png", "modified", null, null), changed("a.ts", "modified", 1, 1)]) });
    expect(binary.linesAdded).toMatchObject({ availability: "unavailable", value: null });
    expect(binary.totalChurn.availability).toBe("unavailable");
    expect(binary.relativeChurn.availability).toBe("unavailable");
    expect(binary.changedFileCount.value).toBe(2);
  });
});

describe("agent-success-rate time and token evidence", () => {
  it("ASR-039 deterministic mode never claims agent time", () => {
    const metrics = metricsFor(makeTask(), {});
    expect(metrics.agentDurationMs).toMatchObject({ availability: "unavailable", value: null });
    expect(metrics.agentDurationMs.reason).toContain("no agent");
  });

  it("ASR-040 deterministic mode never invents provider tokens", () => {
    const analysis = analyzeAgentSuccessRate([makeTask()], [makeCaseEvidence(makeTask())]);
    for (const entry of analysis.cases[0]!.treatments) expect(entry.metrics.agentTotalTokens).toMatchObject({ availability: "unavailable", value: null });
    for (const aggregate of analysis.aggregates) {
      expect(aggregate.agentTokenMeasurementsAvailable).toBe(0);
      expect(aggregate.agentTokenMeasurementsUnavailable).toBe(1);
    }
  });

  it("ASR-041 measured Lab-side durations are finite and nonnegative, and bad values are unavailable", () => {
    const ok = metricsFor(makeTask(), {});
    for (const id of ["baselineVerificationDurationMs", "patchPipelineDurationMs", "postEditVerificationDurationMs", "evaluationDurationMs"] as const) {
      expect(ok[id].availability).toBe("available");
      expect(Number.isFinite(ok[id].value as number)).toBe(true);
      expect(ok[id].value as number).toBeGreaterThanOrEqual(0);
    }
    const bad = metricsFor(makeTask(), { timing: { agentDurationMs: null, baselineVerificationDurationMs: -1, patchPipelineDurationMs: Number.NaN, postEditVerificationDurationMs: null, evaluationDurationMs: Number.POSITIVE_INFINITY } });
    for (const id of ["baselineVerificationDurationMs", "patchPipelineDurationMs", "postEditVerificationDurationMs", "evaluationDurationMs"] as const) {
      expect(bad[id], id).toMatchObject({ availability: "unavailable", value: null });
    }
  });
});

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

describe("agent-success-rate aggregation", () => {
  const taskA = () => makeTask({ id: "case-a" });
  const taskB = () => makeTask({ id: "case-b" });
  const taskC = () => makeTask({ id: "case-c" });

  it("ASR-042 unweighted means use only available values over matched cases", () => {
    const a = makeCaseEvidence(taskA(), [{ change: changeOf([changed("src/math.cjs", "modified", 1, 1)]) }, { change: changeOf([changed("src/math.cjs", "modified", 1, 1)]) }]);
    const b = makeCaseEvidence(taskB(), [
      { change: changeOf([changed("src/math.cjs", "modified", 4, 2), changed("src/other.cjs", "modified", 1, 1)]) },
      { change: changeOf([changed("src/math.cjs", "modified", 4, 2), changed("src/other.cjs", "modified", 1, 1)]) }
    ]);
    const analysis = analyzeAgentSuccessRate([taskA(), taskB()], [a, b]);
    for (const aggregate of analysis.aggregates) {
      expect(aggregate.means.meanChangedFileCount).toMatchObject({ matchedCaseIds: ["case-a", "case-b"], metric: { availability: "available", value: 1.5 } });
      expect(aggregate.means.meanTotalChurn.metric.value).toBe((2 + 8) / 2);
      expect(aggregate.evaluableCaseCount).toBe(2);
      expect(aggregate.successfulCaseCount).toBe(2);
      expect(aggregate.taskSuccessRate.value).toBe(1);
      expect(aggregate.initialAttemptSuccessRate.value).toBe(1);
    }
  });

  it("ASR-043 matched comparison requires available evidence from both treatments", () => {
    const invalid = { status: "skipped" as const, availability: "baseline-invalid" as const, baselineAssessment: { evaluable: false, reasons: ["ALL_TASK_CHECKS_PASSED" as const] }, patch: makeTreatmentEvidence().patch, change: null, postEditVerification: null };
    const a = makeCaseEvidence(taskA());
    const b = makeCaseEvidence(taskB(), [{}, invalid]); // context-pack cannot be evaluated for case B
    const analysis = analyzeAgentSuccessRate([taskA(), taskB()], [a, b]);
    for (const aggregate of analysis.aggregates) {
      expect(aggregate.means.meanChangedFileCount.matchedCaseIds).toEqual(["case-a"]);
      expect(aggregate.means.meanTaskCheckPassRate.matchedCaseIds).toEqual(["case-a"]);
    }
    // Per-treatment rates still use each treatment's own evaluable cases, with explicit denominators.
    expect(analysis.aggregates[0]).toMatchObject({ evaluableCaseCount: 2, successfulCaseCount: 2 });
    expect(analysis.aggregates[1]).toMatchObject({ evaluableCaseCount: 1, successfulCaseCount: 1 });
  });

  it("ASR-044 missing measurements are not converted to zero", () => {
    const invalid = { status: "skipped" as const, availability: "baseline-invalid" as const, baselineAssessment: { evaluable: false, reasons: ["ALL_TASK_CHECKS_PASSED" as const] }, change: null, postEditVerification: null };
    const analysis = analyzeAgentSuccessRate([taskA(), taskB()], [makeCaseEvidence(taskA(), [invalid, invalid]), makeCaseEvidence(taskB(), [invalid, invalid])]);
    for (const aggregate of analysis.aggregates) {
      expect(aggregate.evaluableCaseCount).toBe(0);
      expect(aggregate.taskSuccessRate).toMatchObject({ availability: "unavailable", value: null });
      expect(aggregate.means.meanChangedFileCount.metric).toMatchObject({ availability: "unavailable", value: null });
      expect(aggregate.means.meanChangedFileCount.matchedCaseIds).toEqual([]);
    }
    // Not-applicable values are excluded from a mean rather than counted as zero.
    const noChange = makeCaseEvidence(taskC(), [{ change: changeOf([]) }, { change: changeOf([]) }]);
    const withChange = makeCaseEvidence(taskA());
    const mixed = analyzeAgentSuccessRate([taskA(), taskC()], [withChange, noChange]);
    expect(mixed.aggregates[0]!.means.meanEditScopePrecision.matchedCaseIds).toEqual(["case-a"]);
    expect(mixed.aggregates[0]!.means.meanEditScopePrecision.metric.value).toBe(1);
  });

  it("ASR-045 generates no composite score, ranking or winner", () => {
    const analysis = analyzeAgentSuccessRate([taskA(), taskB()], [makeCaseEvidence(taskA()), makeCaseEvidence(taskB(), [{}, { patch: { ...makeTreatmentEvidence().patch, outcome: "git-check-failure", message: "x", appliedFiles: [] }, change: null, postEditVerification: null }])]);
    const keys = [...collectKeys(analysis)].map((key) => key.toLowerCase());
    for (const banned of ["winner", "rank", "ranking", "score", "composite", "weighted", "pareto", "significance", "pvalue"]) {
      expect(keys.filter((key) => key.includes(banned)), banned).toEqual([]);
    }
    expect(analysis.aggregates.map((a) => a.treatmentId)).toEqual(["raw-full-file", "context-pack"]);
  });

  it("ASR-046 deterministic-fixture analysis cannot claim context-strategy efficacy", () => {
    const analysis = analyzeAgentSuccessRate([taskA()], [makeCaseEvidence(taskA())]);
    expect(analysis.executionMode).toBe("deterministic-fixture");
    expect(analysis.contextEffectEvaluated).toBe(false);
    expect(analysis.limitations.join(" ")).toMatch(/same fixture patch/);
    expect(analysis.limitations.join(" ")).toMatch(/not performance evidence/);
  });

  it("rejects case evidence that is out of order or lacks a treatment", () => {
    expect(() => analyzeAgentSuccessRate([taskA(), taskB()], [makeCaseEvidence(taskB()), makeCaseEvidence(taskA())])).toThrow(/same order/);
    const broken = makeCaseEvidence(taskA());
    broken.treatments.pop();
    expect(() => analyzeAgentSuccessRate([taskA()], [broken])).toThrow(/both treatments/);
  });

  it("ASR-057 identical input produces identical scientific values and ordering", () => {
    const run = () => analyzeAgentSuccessRate([taskA(), taskB()], [makeCaseEvidence(taskA()), makeCaseEvidence(taskB())]);
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
    expect(Object.keys(run().cases[0]!.treatments[0]!.metrics)).toEqual([...AGENT_SUCCESS_METRIC_IDS]);
  });
});

describe("agent-success-rate metric availability contract", () => {
  it("represents availability explicitly and validates the invariants", () => {
    expect(availableMetric("m", 0, "count")).toEqual({ id: "m", availability: "available", value: 0, unit: "count", reason: null });
    expect(availableMetric("m", Number.NaN, "count")).toMatchObject({ availability: "unavailable", value: null });
    expect(unavailableMetric("m", "ratio", "")).toMatchObject({ availability: "unavailable", reason: expect.stringMatching(/\S/) });
    expect(notApplicableMetric("m", "ratio", "  ")).toMatchObject({ availability: "not-applicable", reason: expect.stringMatching(/\S/) });
    expect(validateAgentSuccessMetric({ id: "m", availability: "unavailable", value: 0, unit: "count", reason: "x" })).not.toEqual([]);
    expect(validateAgentSuccessMetric({ id: "m", availability: "not-applicable", value: null, unit: "count", reason: null })).not.toEqual([]);
    expect(validateAgentSuccessMetric({ id: "m", availability: "available", value: Number.POSITIVE_INFINITY, unit: "count", reason: null })).not.toEqual([]);
  });

  it("every produced metric satisfies the contract across evidence states", () => {
    const task = makeTask();
    const states: Partial<AgentSuccessTreatmentEvidenceV1>[] = [
      {},
      { availability: "baseline-invalid", status: "skipped", baselineAssessment: { evaluable: false, reasons: ["NO_CHECKS"] }, change: null, postEditVerification: null },
      { availability: "infrastructure-failure", status: "failed", baselineAssessment: null, baselineVerification: null, change: null, postEditVerification: null },
      { change: null, protectedIntegrity: { status: "unproven", mutatedPaths: [] } }
    ];
    for (const state of states) {
      const metrics = metricsFor(task, state);
      for (const id of AGENT_SUCCESS_METRIC_IDS as readonly AgentSuccessMetricId[]) expect(validateAgentSuccessMetric(metrics[id]), id).toEqual([]);
    }
  });
});
