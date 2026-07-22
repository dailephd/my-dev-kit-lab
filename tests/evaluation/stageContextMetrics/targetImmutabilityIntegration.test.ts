import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateV043StageContextExecution } from "../../../src/evaluation/stageContextMetrics/evaluateV043StageContextExecution.js";
import { compareExpectedTargetImmutabilityState } from "../../../src/evaluation/stageContextMetrics/calculateArtifactStateMetrics.js";
import type { LoadedContextArtifactPairV1, V043StageContextStrategyExecutionSuccess } from "../../../src/experiments/plugins/contextStrategyComparison/v043StrategyExecutionTypes.js";
import type { V043TargetImmutabilityRunResultV1 } from "../../../src/evaluation/targetImmutability/types.js";

const CAPSULE_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";
const EXPECTATIONS_FIXTURE_PATH = "tests/fixtures/stage-context-expectations/complete-v1.0.0.json";

const rawCapsule = JSON.parse(readFileSync(CAPSULE_FIXTURE_PATH, "utf8"));
const rawExpectations = JSON.parse(readFileSync(EXPECTATIONS_FIXTURE_PATH, "utf8"));

function makePair(role: string): LoadedContextArtifactPairV1 {
  const capsule = structuredClone(rawCapsule);
  capsule.request = { ...capsule.request, role };
  capsule.roleContext = { ...capsule.roleContext, role };
  return { role: role as LoadedContextArtifactPairV1["role"], contextCapsuleSourcePath: `mock/${role}-capsule.json`, contextCapsule: capsule };
}

function buildExecution(): V043StageContextStrategyExecutionSuccess {
  return {
    status: "completed",
    strategyId: "architecture-context-only",
    input: {} as unknown as V043StageContextStrategyExecutionSuccess["input"],
    expectationsSourcePath: "mock/expectations.json",
    expectations: structuredClone(rawExpectations),
    payload: { architecture: makePair("architecture") },
    warnings: []
  };
}

function unchangedResult(): V043TargetImmutabilityRunResultV1 {
  return {
    availability: "available",
    comparison: {
      status: "unchanged",
      targetRootPath: "target",
      resolvedTargetRootPath: "/resolved/target",
      preExistingGitStatusEntryCount: 0,
      newMutationCount: 0,
      mutations: []
    },
    reason: null
  };
}

function mutatedResult(): V043TargetImmutabilityRunResultV1 {
  return {
    availability: "available",
    comparison: {
      status: "mutated",
      targetRootPath: "target",
      resolvedTargetRootPath: "/resolved/target",
      preExistingGitStatusEntryCount: 0,
      newMutationCount: 2,
      mutations: [
        { id: "git.head", kind: "git-head", fieldPath: "git.head", before: "a", after: "b" },
        { id: "file:src/a.ts", kind: "configured-file", fieldPath: "configuredFiles.src/a.ts", before: "x", after: "y" }
      ]
    },
    reason: null
  };
}

describe("target-immutability metric integration", () => {
  it("RUN-054 no target context produces unavailable metric", () => {
    const result = evaluateV043StageContextExecution(buildExecution());
    expect(result.status).toBe("completed");
    if (result.status === "completed") expect(result.metrics.targetImmutability.availability).toBe("unavailable");
  });

  it("RUN-055 no-target reason is exact", () => {
    const result = evaluateV043StageContextExecution(buildExecution());
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.targetImmutability.reason).toBe(
        "Target immutability configuration was not supplied for this strategy run."
      );
    }
  });

  it("RUN-056 unavailable snapshot result produces unavailable metric", () => {
    const result = evaluateV043StageContextExecution(buildExecution(), {
      targetImmutability: { availability: "unavailable", comparison: null, reason: "snapshot failed" }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.targetImmutability.availability).toBe("unavailable");
      expect(result.metrics.targetImmutability.reason).toBe("snapshot failed");
    }
  });

  it("RUN-057 unavailable metric uses null count", () => {
    const result = evaluateV043StageContextExecution(buildExecution(), {
      targetImmutability: { availability: "unavailable", comparison: null, reason: "snapshot failed" }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") expect(result.metrics.targetImmutability.count).toBeNull();
  });

  it("RUN-058 unchanged target produces available count zero", () => {
    const result = evaluateV043StageContextExecution(buildExecution(), { targetImmutability: unchangedResult() });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.targetImmutability.availability).toBe("available");
      expect(result.metrics.targetImmutability.count).toBe(0);
    }
  });

  it("RUN-059 mutated target produces available positive count", () => {
    const result = evaluateV043StageContextExecution(buildExecution(), { targetImmutability: mutatedResult() });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.targetImmutability.availability).toBe("available");
      expect(result.metrics.targetImmutability.count).toBe(2);
    }
  });

  it("RUN-060 mutation IDs become evidenceKeys in order", () => {
    const result = evaluateV043StageContextExecution(buildExecution(), { targetImmutability: mutatedResult() });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.targetImmutability.evidenceKeys).toEqual(["git.head", "file:src/a.ts"]);
    }
  });

  it("RUN-061 a mutated result is not converted to unavailable", () => {
    const result = evaluateV043StageContextExecution(buildExecution(), { targetImmutability: mutatedResult() });
    expect(result.status).toBe("completed");
    if (result.status === "completed") expect(result.metrics.targetImmutability.availability).not.toBe("unavailable");
  });

  it("RUN-062 expected zero mutations matches unchanged target", () => {
    const comparisons = compareExpectedTargetImmutabilityState({ newMutationCount: 0 }, unchangedResult());
    expect(comparisons[0].matched).toBe(true);
  });

  it("RUN-063 expected zero mutations fails against mutated target", () => {
    const comparisons = compareExpectedTargetImmutabilityState({ newMutationCount: 0 }, mutatedResult());
    expect(comparisons[0].matched).toBe(false);
  });

  it("RUN-064 expected positive mutation count compares exactly", () => {
    const comparisons = compareExpectedTargetImmutabilityState({ newMutationCount: 2 }, mutatedResult());
    expect(comparisons[0].matched).toBe(true);
    expect(comparisons[0].actual).toBe(2);
  });

  it("RUN-065 no expected target state produces no comparison", () => {
    expect(compareExpectedTargetImmutabilityState(undefined, unchangedResult())).toEqual([]);
  });

  it("RUN-066 unavailable target state uses exact reason", () => {
    const comparisons = compareExpectedTargetImmutabilityState(
      { newMutationCount: 0 },
      { availability: "unavailable", comparison: null, reason: "custom reason" }
    );
    expect(comparisons[0].availability).toBe("unavailable");
    expect(comparisons[0].reason).toBe("custom reason");
  });

  it("RUN-067 target metric does not alter another Batch 5 metric", () => {
    const withoutContext = evaluateV043StageContextExecution(buildExecution());
    const withContext = evaluateV043StageContextExecution(buildExecution(), { targetImmutability: mutatedResult() });
    expect(withoutContext.status).toBe("completed");
    expect(withContext.status).toBe("completed");
    if (withoutContext.status === "completed" && withContext.status === "completed") {
      expect(withContext.metrics.requiredEvidenceRecall).toEqual(withoutContext.metrics.requiredEvidenceRecall);
      expect(withContext.metrics.contextSize).toEqual(withoutContext.metrics.contextSize);
    }
  });

  it("RUN-068 evaluation context is not mutated", () => {
    const context = { targetImmutability: mutatedResult() };
    const before = JSON.stringify(context);
    evaluateV043StageContextExecution(buildExecution(), context);
    expect(JSON.stringify(context)).toBe(before);
  });

  it("RUN-069 target comparison object is not mutated", () => {
    const targetImmutability = mutatedResult();
    const before = JSON.stringify(targetImmutability);
    evaluateV043StageContextExecution(buildExecution(), { targetImmutability });
    expect(JSON.stringify(targetImmutability)).toBe(before);
  });
});
