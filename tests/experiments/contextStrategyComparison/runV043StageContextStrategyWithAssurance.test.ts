import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { V043StageContextStrategyInputV1 } from "../../../src/experiments/plugins/contextStrategyComparison/v043StrategyInputContracts.js";
import type { ResolvedV043RunAssuranceConfigV1 } from "../../../src/experiments/plugins/contextStrategyComparison/v043RunAssuranceTypes.js";
import type { V043TargetSnapshotV1 } from "../../../src/evaluation/targetImmutability/types.js";

const EXECUTE_MODULE = "../../../src/experiments/plugins/contextStrategyComparison/executeV043StageContextStrategy.js";
const METRICS_MODULE = "../../../src/evaluation/stageContextMetrics/index.js";
const TARGET_MODULE = "../../../src/evaluation/targetImmutability/index.js";
const DETERMINISM_MODULE = "../../../src/evaluation/stageContextDeterminism/index.js";
const RUNNER_MODULE = "../../../src/experiments/plugins/contextStrategyComparison/runV043StageContextStrategyWithAssurance.js";

function inputFor(strategyId = "architecture-context-only"): V043StageContextStrategyInputV1 {
  return {
    strategyId: strategyId as V043StageContextStrategyInputV1["strategyId"],
    expectationsPath: "mock/expectations.json",
    architectureContextCapsulePath: "mock/architecture-capsule.json"
  } as V043StageContextStrategyInputV1;
}

function completedExecution(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "completed",
    strategyId: "architecture-context-only",
    input: {},
    expectationsSourcePath: "x",
    expectations: {},
    payload: {},
    warnings: [],
    ...overrides
  };
}

function failedExecution(): Record<string, unknown> {
  return { status: "failed", strategyId: "architecture-context-only", input: {}, issues: [] };
}

function completedEvaluation(strategyId = "architecture-context-only"): Record<string, unknown> {
  return {
    status: "completed",
    strategyId,
    executionStatus: "completed",
    expectationMatches: [],
    observedEvidence: [],
    metrics: {},
    warnings: []
  };
}

function notApplicableEvaluation(strategyId = "architecture-context-only", executionStatus = "failed"): Record<string, unknown> {
  return { status: "not-applicable", strategyId, executionStatus, reason: "mock reason" };
}

function defaultSnapshot(
  gitOverrides: Partial<V043TargetSnapshotV1["git"]> = {}
): { ok: true; snapshot: V043TargetSnapshotV1 } {
  return {
    ok: true,
    snapshot: {
      targetRootPath: "Z:/fixture/target",
      resolvedTargetRootPath: "Z:/fixture/target",
      configuredFiles: [],
      git: {
        availability: "not-repository",
        branch: null,
        head: null,
        statusEntries: [],
        worktreeDiffSha256: null,
        stagedDiffSha256: null,
        untrackedFiles: [],
        ...gitOverrides
      }
    }
  };
}

function snapshotFailure(): { ok: false; code: string; targetRootPath: string; message: string } {
  return { ok: false, code: "TARGET_ROOT_NOT_FOUND", targetRootPath: "Z:/fixture/target", message: "mock snapshot failure" };
}

interface LoadOptions {
  executeQueue: unknown[];
  captureQueue?: unknown[];
  evaluateImpl?: (execution: unknown, context: unknown) => unknown;
  determinismThrows?: boolean;
}

interface RunnerHandle {
  run: (input: V043StageContextStrategyInputV1, config: ResolvedV043RunAssuranceConfigV1) => Promise<unknown>;
  calls: {
    execute: unknown[];
    evaluate: unknown[];
    capture: unknown[];
    order: string[];
    determinismCandidates: unknown[];
  };
}

async function loadRunner(options: LoadOptions): Promise<RunnerHandle> {
  vi.resetModules();
  const calls: RunnerHandle["calls"] = { execute: [], evaluate: [], capture: [], order: [], determinismCandidates: [] };
  const executeQueue = [...options.executeQueue];
  const captureQueue = options.captureQueue ? [...options.captureQueue] : undefined;

  vi.doMock(EXECUTE_MODULE, () => ({
    executeV043StageContextStrategy: vi.fn(async (input: unknown) => {
      calls.execute.push(input);
      calls.order.push("execute");
      return executeQueue.shift();
    })
  }));

  vi.doMock(METRICS_MODULE, () => ({
    evaluateV043StageContextExecution: vi.fn((execution: Record<string, unknown>, context: unknown) => {
      calls.evaluate.push({ execution, context });
      calls.order.push("evaluate");
      if (options.evaluateImpl) return options.evaluateImpl(execution, context);
      if (execution.status === "completed") return completedEvaluation(execution.strategyId as string);
      return notApplicableEvaluation(execution.strategyId as string, execution.status as string);
    })
  }));

  const { compareTargetSnapshots } = await import(
    "../../../src/evaluation/targetImmutability/compareTargetSnapshots.js"
  );
  vi.doMock(TARGET_MODULE, () => ({
    captureTargetSnapshot: vi.fn(async (config: unknown) => {
      calls.capture.push(config);
      calls.order.push("capture");
      return captureQueue?.shift() ?? defaultSnapshot();
    }),
    compareTargetSnapshots
  }));

  const { calculateStageContextDeterminism: realCalculateDeterminism } = await import(
    "../../../src/evaluation/stageContextDeterminism/calculateStageContextDeterminism.js"
  );
  vi.doMock(DETERMINISM_MODULE, () => ({
    calculateStageContextDeterminism: vi.fn((candidates: unknown[]) => {
      if (options.determinismThrows) throw new Error("boom");
      calls.determinismCandidates = candidates;
      return realCalculateDeterminism(candidates as never);
    })
  }));

  const mod = await import(RUNNER_MODULE);
  return { run: mod.runV043StageContextStrategyWithAssurance, calls };
}

async function unloadRunner(): Promise<void> {
  vi.doUnmock(EXECUTE_MODULE);
  vi.doUnmock(METRICS_MODULE);
  vi.doUnmock(TARGET_MODULE);
  vi.doUnmock(DETERMINISM_MODULE);
  vi.resetModules();
}

afterEach(async () => {
  await unloadRunner();
});

describe("runV043StageContextStrategyWithAssurance", () => {
  it("RUN-015 one run with no target config returns not-applicable assurance", async () => {
    const { run } = await loadRunner({ executeQueue: [completedExecution()] });
    const result = (await run(inputFor(), { repeatCount: 1 })) as { status: string };
    expect(result.status).toBe("not-applicable");
  });

  it("RUN-016 one run with unchanged target returns passed assurance", async () => {
    const snap = defaultSnapshot();
    const { run } = await loadRunner({ executeQueue: [completedExecution()], captureQueue: [snap, structuredClone(snap)] });
    const result = (await run(inputFor(), {
      repeatCount: 1,
      targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] }
    })) as { status: string };
    expect(result.status).toBe("passed");
  });

  it("RUN-017 one run with a mutation returns failed assurance", async () => {
    const before = defaultSnapshot({ head: "abc" });
    const after = defaultSnapshot({ head: "def" });
    const { run } = await loadRunner({ executeQueue: [completedExecution()], captureQueue: [before, after] });
    const result = (await run(inputFor(), {
      repeatCount: 1,
      targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] }
    })) as { status: string };
    expect(result.status).toBe("failed");
  });

  it("RUN-018 one issue is created for every target mutation", async () => {
    const before = defaultSnapshot({ head: "abc", branch: "main" });
    const after = defaultSnapshot({ head: "def", branch: "other" });
    const { run } = await loadRunner({ executeQueue: [completedExecution()], captureQueue: [before, after] });
    const result = (await run(inputFor(), {
      repeatCount: 1,
      targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] }
    })) as { issues: Array<{ code: string }> };
    expect(result.issues.filter((i) => i.code === "TARGET_MUTATION_DETECTED")).toHaveLength(2);
  });

  it("RUN-019 a missing target config produces the exact unavailable reason", async () => {
    const { run } = await loadRunner({ executeQueue: [completedExecution()] });
    const result = (await run(inputFor(), { repeatCount: 1 })) as {
      runRecords: Array<{ targetImmutability: { reason: string } }>;
    };
    expect(result.runRecords[0].targetImmutability.reason).toBe(
      "Target immutability configuration was not supplied for this strategy run."
    );
  });

  it("RUN-020 a before-snapshot failure still executes the strategy", async () => {
    const { run, calls } = await loadRunner({
      executeQueue: [completedExecution()],
      captureQueue: [snapshotFailure(), defaultSnapshot()]
    });
    await run(inputFor(), { repeatCount: 1, targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] } });
    expect(calls.execute).toHaveLength(1);
  });

  it("RUN-021 a before-snapshot failure still attempts the after snapshot", async () => {
    const { run, calls } = await loadRunner({
      executeQueue: [completedExecution()],
      captureQueue: [snapshotFailure(), defaultSnapshot()]
    });
    await run(inputFor(), { repeatCount: 1, targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] } });
    expect(calls.capture).toHaveLength(2);
  });

  it("RUN-022 an after-snapshot failure produces unavailable immutability", async () => {
    const { run } = await loadRunner({
      executeQueue: [completedExecution()],
      captureQueue: [defaultSnapshot(), snapshotFailure()]
    });
    const result = (await run(inputFor(), {
      repeatCount: 1,
      targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] }
    })) as { runRecords: Array<{ targetImmutability: { availability: string; reason: string } }> };
    expect(result.runRecords[0].targetImmutability.availability).toBe("unavailable");
    expect(result.runRecords[0].targetImmutability.reason).toBe(
      "Target immutability could not be evaluated because a target snapshot failed."
    );
  });

  it("RUN-023 a requested unavailable snapshot fails assurance", async () => {
    const { run } = await loadRunner({
      executeQueue: [completedExecution()],
      captureQueue: [defaultSnapshot(), snapshotFailure()]
    });
    const result = (await run(inputFor(), {
      repeatCount: 1,
      targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] }
    })) as { status: string; issues: Array<{ code: string }> };
    expect(result.status).toBe("failed");
    expect(result.issues.some((i) => i.code === "TARGET_SNAPSHOT_UNAVAILABLE")).toBe(true);
  });

  it("RUN-024 two identical runs pass determinism", async () => {
    const { run } = await loadRunner({ executeQueue: [completedExecution(), completedExecution()] });
    const result = (await run(inputFor(), { repeatCount: 2 })) as { status: string };
    expect(result.status).toBe("passed");
  });

  it("RUN-025 two different runs fail determinism", async () => {
    const { run } = await loadRunner({
      executeQueue: [completedExecution({ payload: { a: 1 } }), completedExecution({ payload: { a: 2 } })]
    });
    const result = (await run(inputFor(), { repeatCount: 2 })) as { status: string };
    expect(result.status).toBe("failed");
  });

  it("RUN-026 three runs execute exactly three times", async () => {
    const { run, calls } = await loadRunner({
      executeQueue: [completedExecution(), completedExecution(), completedExecution()]
    });
    await run(inputFor(), { repeatCount: 3 });
    expect(calls.execute).toHaveLength(3);
  });

  it("RUN-027 run execution order is sequential", async () => {
    const { run, calls } = await loadRunner({
      executeQueue: [completedExecution(), completedExecution()]
    });
    await run(inputFor(), { repeatCount: 2 });
    const executeIndexes = calls.order.reduce<number[]>((acc, entry, index) => {
      if (entry === "execute") acc.push(index);
      return acc;
    }, []);
    expect(executeIndexes[0]).toBeLessThan(executeIndexes[1]);
  });

  it("RUN-028 each run captures before snapshot before execution", async () => {
    const { run, calls } = await loadRunner({
      executeQueue: [completedExecution()],
      captureQueue: [defaultSnapshot(), defaultSnapshot()]
    });
    await run(inputFor(), { repeatCount: 1, targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] } });
    expect(calls.order.slice(0, 2)).toEqual(["capture", "execute"]);
  });

  it("RUN-029 each run captures after snapshot after execution", async () => {
    const { run, calls } = await loadRunner({
      executeQueue: [completedExecution()],
      captureQueue: [defaultSnapshot(), defaultSnapshot()]
    });
    await run(inputFor(), { repeatCount: 1, targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] } });
    expect(calls.order.slice(1, 3)).toEqual(["execute", "capture"]);
  });

  it("RUN-030 each run evaluates after after-snapshot capture", async () => {
    const { run, calls } = await loadRunner({
      executeQueue: [completedExecution()],
      captureQueue: [defaultSnapshot(), defaultSnapshot()]
    });
    await run(inputFor(), { repeatCount: 1, targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] } });
    expect(calls.order).toEqual(["capture", "execute", "capture", "evaluate"]);
  });

  it("RUN-031 the determinism candidate excludes runNumber", async () => {
    const { run, calls } = await loadRunner({ executeQueue: [completedExecution(), completedExecution()] });
    await run(inputFor(), { repeatCount: 2 });
    const candidate = calls.determinismCandidates[0] as { value: Record<string, unknown> };
    expect(candidate.value).not.toHaveProperty("runNumber");
  });

  it("RUN-032 the determinism candidate includes execution", async () => {
    const execution = completedExecution();
    const { run, calls } = await loadRunner({ executeQueue: [execution, completedExecution()] });
    await run(inputFor(), { repeatCount: 2 });
    const candidate = calls.determinismCandidates[0] as { value: Record<string, unknown> };
    expect(candidate.value.execution).toBe(execution);
  });

  it("RUN-033 the determinism candidate includes evaluation", async () => {
    const evaluation = completedEvaluation();
    const { run, calls } = await loadRunner({
      executeQueue: [completedExecution(), completedExecution()],
      evaluateImpl: () => evaluation
    });
    await run(inputFor(), { repeatCount: 2 });
    const candidate = calls.determinismCandidates[0] as { value: Record<string, unknown> };
    expect(candidate.value.evaluation).toBe(evaluation);
  });

  it("RUN-034 the determinism candidate includes target immutability", async () => {
    const { run, calls } = await loadRunner({
      executeQueue: [completedExecution(), completedExecution()],
      captureQueue: [defaultSnapshot(), defaultSnapshot(), defaultSnapshot(), defaultSnapshot()]
    });
    await run(inputFor(), {
      repeatCount: 2,
      targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] }
    });
    const candidate = calls.determinismCandidates[0] as { value: Record<string, unknown> };
    expect(candidate.value).toHaveProperty("targetImmutability");
  });

  it("RUN-035 the first execution is primaryExecution", async () => {
    const first = completedExecution();
    const second = completedExecution();
    const { run } = await loadRunner({ executeQueue: [first, second] });
    const result = (await run(inputFor(), { repeatCount: 2 })) as { primaryExecution: unknown };
    expect(result.primaryExecution).toBe(first);
  });

  it("RUN-036 the first evaluation is primaryEvaluation", async () => {
    const firstEvaluation = completedEvaluation();
    let call = 0;
    const { run } = await loadRunner({
      executeQueue: [completedExecution(), completedExecution()],
      evaluateImpl: () => {
        call += 1;
        return call === 1 ? firstEvaluation : completedEvaluation();
      }
    });
    const result = (await run(inputFor(), { repeatCount: 2 })) as { primaryEvaluation: unknown };
    expect(result.primaryEvaluation).toBe(firstEvaluation);
  });

  it("RUN-037 primary objects preserve exact identity", async () => {
    const execution = completedExecution();
    const evaluation = completedEvaluation();
    const { run } = await loadRunner({ executeQueue: [execution], evaluateImpl: () => evaluation });
    const result = (await run(inputFor(), { repeatCount: 1 })) as { primaryExecution: unknown; primaryEvaluation: unknown };
    expect(result.primaryExecution).toBe(execution);
    expect(result.primaryEvaluation).toBe(evaluation);
  });

  it("RUN-038 run records preserve run order", async () => {
    const { run } = await loadRunner({
      executeQueue: [completedExecution(), completedExecution(), completedExecution()]
    });
    const result = (await run(inputFor(), { repeatCount: 3 })) as { runRecords: Array<{ runNumber: number }> };
    expect(result.runRecords.map((r) => r.runNumber)).toEqual([1, 2, 3]);
  });

  it("RUN-039 execution failure creates an assurance issue", async () => {
    const { run } = await loadRunner({ executeQueue: [failedExecution()] });
    const result = (await run(inputFor(), { repeatCount: 1 })) as { issues: Array<{ code: string }> };
    expect(result.issues.some((i) => i.code === "EXECUTION_NOT_COMPLETED")).toBe(true);
  });

  it("RUN-040 evaluation failure creates an assurance issue", async () => {
    const { run } = await loadRunner({
      executeQueue: [completedExecution()],
      evaluateImpl: () => notApplicableEvaluation("architecture-context-only", "completed")
    });
    const result = (await run(inputFor(), { repeatCount: 1 })) as { issues: Array<{ code: string }> };
    expect(result.issues.some((i) => i.code === "EVALUATION_NOT_COMPLETED")).toBe(true);
  });

  it("RUN-041 execution failure does not prevent later repeats", async () => {
    const { run, calls } = await loadRunner({ executeQueue: [failedExecution(), completedExecution()] });
    await run(inputFor(), { repeatCount: 2 });
    expect(calls.execute).toHaveLength(2);
  });

  it("RUN-042 evaluation failure does not prevent later repeats", async () => {
    let call = 0;
    const { run, calls } = await loadRunner({
      executeQueue: [completedExecution(), completedExecution()],
      evaluateImpl: (execution) => {
        call += 1;
        if (call === 1) return notApplicableEvaluation("architecture-context-only", "completed");
        return completedEvaluation((execution as Record<string, unknown>).strategyId as string);
      }
    });
    await run(inputFor(), { repeatCount: 2 });
    expect(calls.execute).toHaveLength(2);
  });

  it("RUN-043 run-level issue order follows Section 42", async () => {
    const before = defaultSnapshot({ head: "abc" });
    const after = defaultSnapshot({ head: "def" });
    const { run } = await loadRunner({
      executeQueue: [failedExecution()],
      captureQueue: [before, after],
      evaluateImpl: () => notApplicableEvaluation("architecture-context-only", "failed")
    });
    const result = (await run(inputFor(), {
      repeatCount: 1,
      targetImmutability: { targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/a.ts"] }
    })) as { issues: Array<{ code: string }> };
    expect(result.issues.map((i) => i.code)).toEqual(["EXECUTION_NOT_COMPLETED", "EVALUATION_NOT_COMPLETED", "TARGET_MUTATION_DETECTED"]);
  });

  it("RUN-044 determinism issues follow run-level issues", async () => {
    const { run } = await loadRunner({
      executeQueue: [failedExecution(), completedExecution({ payload: { a: 2 } })]
    });
    const result = (await run(inputFor(), { repeatCount: 2 })) as { issues: Array<{ code: string }> };
    const executionIssueIndex = result.issues.findIndex((i) => i.code === "EXECUTION_NOT_COMPLETED");
    const determinismIssueIndex = result.issues.findIndex(
      (i) => i.code === "NONDETERMINISTIC_RESULT" || i.code === "DETERMINISM_UNAVAILABLE"
    );
    expect(executionIssueIndex).toBeGreaterThanOrEqual(0);
    expect(determinismIssueIndex).toBeGreaterThan(executionIssueIndex);
  });

  it("RUN-045 a nondeterministic mismatch creates one issue per mismatched run", async () => {
    const { run } = await loadRunner({
      executeQueue: [
        completedExecution({ payload: { a: 1 } }),
        completedExecution({ payload: { a: 2 } }),
        completedExecution({ payload: { a: 3 } })
      ]
    });
    const result = (await run(inputFor(), { repeatCount: 3 })) as { issues: Array<{ code: string }> };
    expect(result.issues.filter((i) => i.code === "NONDETERMINISTIC_RESULT")).toHaveLength(2);
  });

  it("RUN-046 a failed assurance result does not rewrite execution status", async () => {
    const execution = failedExecution();
    const { run } = await loadRunner({ executeQueue: [execution] });
    const result = (await run(inputFor(), { repeatCount: 1 })) as { status: string; primaryExecution: { status: string } };
    expect(result.status).toBe("failed");
    expect(result.primaryExecution.status).toBe("failed");
  });

  it("RUN-047 a failed assurance result does not rewrite evaluation status", async () => {
    const { run } = await loadRunner({ executeQueue: [failedExecution()] });
    const result = (await run(inputFor(), { repeatCount: 1 })) as { primaryEvaluation: { status: string } };
    expect(result.primaryEvaluation.status).toBe("not-applicable");
  });

  it("RUN-048 no target repair command is called", () => {
    const source = readFileSync(
      "src/experiments/plugins/contextStrategyComparison/runV043StageContextStrategyWithAssurance.ts",
      "utf8"
    );
    for (const verb of ["reset", "restore", "clean", "stash", "checkout", "add", "commit", "merge", "rebase", "pull", "push"]) {
      expect(source).not.toContain(`"${verb}"`);
    }
  });

  it("RUN-049 no target file is modified", () => {
    const source = readFileSync(
      "src/experiments/plugins/contextStrategyComparison/runV043StageContextStrategyWithAssurance.ts",
      "utf8"
    );
    expect(source).not.toContain("node:fs");
    expect(source).not.toContain("writeFile");
  });

  it("RUN-050 no report file is generated", () => {
    const source = readFileSync(
      "src/experiments/plugins/contextStrategyComparison/runV043StageContextStrategyWithAssurance.ts",
      "utf8"
    );
    expect(source).not.toContain(".json");
    expect(source).not.toContain(".html");
  });

  it("RUN-051 unexpected assurance errors return failed", async () => {
    const { run } = await loadRunner({ executeQueue: [completedExecution(), completedExecution()], determinismThrows: true });
    const result = (await run(inputFor(), { repeatCount: 2 })) as { status: string };
    expect(result.status).toBe("failed");
  });

  it("RUN-052 unexpected error message is deterministic", async () => {
    const { run } = await loadRunner({ executeQueue: [completedExecution(), completedExecution()], determinismThrows: true });
    const result = (await run(inputFor(), { repeatCount: 2 })) as { issues: Array<{ code: string; message: string }> };
    const issue = result.issues.find((i) => i.code === "UNEXPECTED_ASSURANCE_ERROR");
    expect(issue?.message).toBe("Unexpected v0.4.3 stage-context run-assurance failure.");
  });

  it("RUN-053 unexpected failure exposes no stack trace", async () => {
    const { run } = await loadRunner({ executeQueue: [completedExecution(), completedExecution()], determinismThrows: true });
    const result = (await run(inputFor(), { repeatCount: 2 })) as { issues: Array<Record<string, unknown>> };
    const issue = result.issues.find((i) => i.code === "UNEXPECTED_ASSURANCE_ERROR");
    expect(issue).not.toHaveProperty("stack");
    expect(issue?.details).toBeUndefined();
  });
});
