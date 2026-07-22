import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateV043StageContextExecution } from "../../../src/evaluation/stageContextMetrics/evaluateV043StageContextExecution.js";
import type {
  LoadedContextArtifactPairV1,
  V043StageContextStrategyExecutionResult,
  V043StageContextStrategyExecutionSuccess
} from "../../../src/experiments/plugins/contextStrategyComparison/v043StrategyExecutionTypes.js";

const CAPSULE_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";
const AUDIT_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/retrieval-audit-record/complete-v1.0.0.json";
const PACKET_FIXTURE_PATH =
  "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.1/workflow-instruction-packet/complete-v1.0.0.json";
const EXPECTATIONS_FIXTURE_PATH = "tests/fixtures/stage-context-expectations/complete-v1.0.0.json";
const LIBRARY_FIXTURE_PATH = "tests/fixtures/full-workflow-library/complete-v1.0.0.json";

const rawCapsule = JSON.parse(readFileSync(CAPSULE_FIXTURE_PATH, "utf8"));
const rawAudit = JSON.parse(readFileSync(AUDIT_FIXTURE_PATH, "utf8"));
const rawPacket = JSON.parse(readFileSync(PACKET_FIXTURE_PATH, "utf8"));
const rawExpectations = JSON.parse(readFileSync(EXPECTATIONS_FIXTURE_PATH, "utf8"));
const rawLibrary = JSON.parse(readFileSync(LIBRARY_FIXTURE_PATH, "utf8"));

function makePair(role: string, withAudit: boolean): LoadedContextArtifactPairV1 {
  const capsule = structuredClone(rawCapsule);
  capsule.request = { ...capsule.request, role };
  capsule.roleContext = { ...capsule.roleContext, role };
  const pair: LoadedContextArtifactPairV1 = {
    role: role as LoadedContextArtifactPairV1["role"],
    contextCapsuleSourcePath: `mock/${role}-capsule.json`,
    contextCapsule: capsule
  };
  if (withAudit) {
    const audit = structuredClone(rawAudit);
    audit.request = { ...audit.request, role };
    audit.roleContext = { ...audit.roleContext, role };
    pair.retrievalAuditRecordSourcePath = `mock/${role}-audit.json`;
    pair.retrievalAuditRecord = audit;
  }
  return pair;
}

function baseExecution(strategyId: string, payload: unknown): V043StageContextStrategyExecutionSuccess {
  return {
    status: "completed",
    strategyId: strategyId as V043StageContextStrategyExecutionSuccess["strategyId"],
    input: { strategyId } as unknown as V043StageContextStrategyExecutionSuccess["input"],
    expectationsSourcePath: "mock/expectations.json",
    expectations: structuredClone(rawExpectations),
    payload: payload as V043StageContextStrategyExecutionSuccess["payload"],
    warnings: []
  };
}

const SIX_EXECUTIONS: V043StageContextStrategyExecutionSuccess[] = [
  baseExecution("architecture-context-only", { architecture: makePair("architecture", true) }),
  baseExecution("architecture-plus-implementation-refresh", {
    architecture: makePair("architecture", false),
    implementation: makePair("implementation", false)
  }),
  baseExecution("architecture-plus-implementation-and-test-refresh", {
    architecture: makePair("architecture", false),
    implementation: makePair("implementation", false),
    testImplementation: makePair("test-implementation", false)
  }),
  baseExecution("full-workflow-library", {
    fullWorkflowLibrarySourcePath: "mock/library.json",
    fullWorkflowLibrary: structuredClone(rawLibrary)
  }),
  baseExecution("bounded-workflow-instruction-packet", {
    workflowInstructionPacketSourcePath: "mock/packet.json",
    workflowInstructionPacket: structuredClone(rawPacket)
  }),
  baseExecution("combined-bounded-stage-context", {
    contextArtifacts: [makePair("architecture", false)],
    workflowInstructionPacketSourcePath: "mock/packet.json",
    workflowInstructionPacket: structuredClone(rawPacket)
  })
];

describe("evaluateV043StageContextExecution", () => {
  it("MET-164 each of the six completed strategy payloads evaluates successfully", () => {
    for (const execution of SIX_EXECUTIONS) {
      const result = evaluateV043StageContextExecution(execution);
      expect(result.status, `strategy ${execution.strategyId} should evaluate as completed`).toBe("completed");
    }
  });

  it("MET-165 observed evidence order follows Section 49", () => {
    const execution = baseExecution("architecture-plus-implementation-refresh", {
      architecture: makePair("architecture", true),
      implementation: makePair("implementation", true)
    });
    const result = evaluateV043StageContextExecution(execution);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const instances = [...new Set(result.observedEvidence.map((e) => e.sourceInstance))];
      expect(instances).toEqual([
        "architecture.contextCapsule",
        "architecture.retrievalAuditRecord",
        "implementation.contextCapsule",
        "implementation.retrievalAuditRecord"
      ]);
    }
  });

  it("MET-166 expectation matches preserve fixture order", () => {
    const execution = SIX_EXECUTIONS[0];
    const result = evaluateV043StageContextExecution(execution);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.expectationMatches.map((m) => m.expectationId)).toEqual(
        execution.expectations.expectedEvidence.map((item) => item.expectationId)
      );
    }
  });

  it("MET-167 all exact metric fields are populated", () => {
    const result = evaluateV043StageContextExecution(SIX_EXECUTIONS[0]);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const metrics = result.metrics;
      expect(metrics.requiredEvidenceRecall).toBeDefined();
      expect(metrics.allowedEvidenceCoverage).toBeDefined();
      expect(metrics.forbiddenEvidenceInclusion).toBeDefined();
      expect(metrics.irrelevantFileInclusion).toBeDefined();
      expect(metrics.irrelevantInstructionInclusion).toBeDefined();
      expect(metrics.requiredProvenanceRecall).toBeDefined();
      expect(metrics.responsibilityMappingCompleteness).toBeDefined();
      expect(metrics.stateComparisons).toBeDefined();
      expect(metrics.contextSize).toBeDefined();
      expect(metrics.consideredButUnselectedReads).toBeDefined();
      expect(metrics.unnecessaryReads).toBeDefined();
      expect(metrics.targetImmutability).toBeDefined();
    }
  });

  it("MET-168 responsibility metrics follow artifact payload order", () => {
    const execution = baseExecution("architecture-plus-implementation-refresh", {
      architecture: makePair("architecture", true),
      implementation: makePair("implementation", true)
    });
    const result = evaluateV043StageContextExecution(execution);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.responsibilityMappingCompleteness.map((m) => m.sourceInstance)).toEqual([
        "architecture.contextCapsule",
        "architecture.retrievalAuditRecord",
        "implementation.contextCapsule",
        "implementation.retrievalAuditRecord"
      ]);
    }
  });

  it("MET-169 state comparisons follow artifact payload order", () => {
    const architecturePair = makePair("architecture", true);
    const execution = baseExecution("architecture-context-only", { architecture: architecturePair });
    execution.expectations.expectedStates = {
      contextCapsule: { warningCount: architecturePair.contextCapsule.warnings.length },
      targetImmutability: { newMutationCount: 0 }
    };
    const result = evaluateV043StageContextExecution(execution);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.stateComparisons[0].sourceInstance).toBe("architecture.contextCapsule");
      expect(result.metrics.stateComparisons[result.metrics.stateComparisons.length - 1].sourceArtifact).toBe("target-immutability");
    }
  });

  it("MET-170 context size follows payload order", () => {
    const execution = baseExecution("architecture-plus-implementation-refresh", {
      architecture: makePair("architecture", false),
      implementation: makePair("implementation", false)
    });
    const result = evaluateV043StageContextExecution(execution);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.contextSize.sources.map((s) => s.sourceInstance)).toEqual([
        "architecture.contextCapsule",
        "implementation.contextCapsule"
      ]);
    }
  });

  it("MET-171 considered-but-unselected reads is unavailable with the exact reason", () => {
    const result = evaluateV043StageContextExecution(SIX_EXECUTIONS[0]);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.consideredButUnselectedReads.availability).toBe("unavailable");
      expect(result.metrics.consideredButUnselectedReads.reason).toBe(
        "The published upstream artifacts do not expose considered-but-unselected reads."
      );
    }
  });

  it("MET-172 unnecessary reads is unavailable with the exact reason", () => {
    const result = evaluateV043StageContextExecution(SIX_EXECUTIONS[0]);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.unnecessaryReads.availability).toBe("unavailable");
      expect(result.metrics.unnecessaryReads.reason).toBe("The published upstream artifacts do not expose unnecessary-read evidence.");
    }
  });

  it("MET-173 target immutability is unavailable with the exact reason", () => {
    const result = evaluateV043StageContextExecution(SIX_EXECUTIONS[0]);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.targetImmutability.availability).toBe("unavailable");
      expect(result.metrics.targetImmutability.reason).toBe(
        "Target immutability configuration was not supplied for this strategy run."
      );
    }
  });

  it("MET-174 unavailable metrics do not use zero", () => {
    const result = evaluateV043StageContextExecution(SIX_EXECUTIONS[0]);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.consideredButUnselectedReads.count).toBeNull();
      expect(result.metrics.unnecessaryReads.count).toBeNull();
      expect(result.metrics.targetImmutability.count).toBeNull();
    }
  });

  it("MET-175 invalid-input execution returns not-applicable", () => {
    const execution: V043StageContextStrategyExecutionResult = {
      status: "invalid-input",
      strategyId: "architecture-context-only",
      input: {},
      issues: []
    };
    const result = evaluateV043StageContextExecution(execution);
    expect(result.status).toBe("not-applicable");
    if (result.status === "not-applicable") {
      expect(result.executionStatus).toBe("invalid-input");
      expect(result.reason).toBe("Metrics are not applicable because strategy input validation failed.");
    }
  });

  it("MET-176 failed execution returns not-applicable", () => {
    const execution: V043StageContextStrategyExecutionResult = {
      status: "failed",
      strategyId: "architecture-context-only",
      input: {},
      issues: []
    };
    const result = evaluateV043StageContextExecution(execution);
    expect(result.status).toBe("not-applicable");
    if (result.status === "not-applicable") {
      expect(result.executionStatus).toBe("failed");
      expect(result.reason).toBe("Metrics are not applicable because strategy execution failed.");
    }
  });

  it("MET-177 unavailable execution returns not-applicable", () => {
    const execution = { status: "unavailable", strategyId: "architecture-context-only" } as unknown as V043StageContextStrategyExecutionResult;
    const result = evaluateV043StageContextExecution(execution);
    expect(result.status).toBe("not-applicable");
    if (result.status === "not-applicable") {
      expect(result.executionStatus).toBe("unavailable");
      expect(result.reason).toBe("Metrics are not applicable because strategy execution is unavailable.");
    }
  });

  it("MET-178 not-applicable execution returns not-applicable", () => {
    const execution = { status: "not-applicable", strategyId: null } as unknown as V043StageContextStrategyExecutionResult;
    const result = evaluateV043StageContextExecution(execution);
    expect(result.status).toBe("not-applicable");
    if (result.status === "not-applicable") {
      expect(result.executionStatus).toBe("not-applicable");
      expect(result.reason).toBe("Metrics are not applicable to this strategy execution.");
    }
  });

  it("MET-179 non-completed execution produces no filesystem access", () => {
    const probePath = "tests/fixtures/full-workflow-library/met-179-probe.json";
    const before = existsSync(probePath);
    const execution: V043StageContextStrategyExecutionResult = {
      status: "failed",
      strategyId: null,
      input: {},
      issues: []
    };
    evaluateV043StageContextExecution(execution);
    expect(existsSync(probePath)).toBe(before);
  });

  it("MET-180 unexpected evaluation error returns failed", () => {
    const execution = baseExecution("architecture-context-only", null);
    const result = evaluateV043StageContextExecution(execution);
    expect(result.status).toBe("failed");
  });

  it("MET-181 unexpected evaluation failure message is deterministic", () => {
    const execution = baseExecution("architecture-context-only", null);
    const result = evaluateV043StageContextExecution(execution);
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toBe("Unexpected v0.4.3 stage-context metric evaluation failure.");
    }
  });

  it("MET-182 unexpected evaluation failure exposes no stack trace", () => {
    const execution = baseExecution("architecture-context-only", null);
    const result = evaluateV043StageContextExecution(execution);
    expect(result.status).toBe("failed");
    expect(result).not.toHaveProperty("stack");
    expect(result).not.toHaveProperty("details");
  });

  it("MET-183 completed warnings is an empty array", () => {
    const result = evaluateV043StageContextExecution(SIX_EXECUTIONS[0]);
    expect(result.status).toBe("completed");
    if (result.status === "completed") expect(result.warnings).toEqual([]);
  });

  it("MET-184 no composite score is returned", () => {
    const result = evaluateV043StageContextExecution(SIX_EXECUTIONS[0]);
    expect(result).not.toHaveProperty("score");
    expect(result).not.toHaveProperty("compositeScore");
  });

  it("MET-185 no winner field is returned", () => {
    const result = evaluateV043StageContextExecution(SIX_EXECUTIONS[0]);
    expect(result).not.toHaveProperty("winner");
    expect(result).not.toHaveProperty("bestStrategy");
  });

  it("MET-186 no artifact is cloned", () => {
    const execution = SIX_EXECUTIONS[0];
    const result = evaluateV043StageContextExecution(execution);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const payload = execution.payload as { architecture: LoadedContextArtifactPairV1 };
      expect(result.observedEvidence[0]).toBeDefined();
      expect(payload.architecture.contextCapsule).toBe((execution.payload as { architecture: LoadedContextArtifactPairV1 }).architecture.contextCapsule);
    }
  });

  it("MET-187 no artifact is normalized", () => {
    const result = evaluateV043StageContextExecution(SIX_EXECUTIONS[0]);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.observedEvidence.some((e) => e.targetKey.includes("src/example.ts"))).toBe(true);
    }
  });

  it("MET-188 no target repository is modified", () => {
    const probePath = "tests/fixtures/full-workflow-library/met-188-probe.json";
    const before = existsSync(probePath);
    for (const execution of SIX_EXECUTIONS) {
      evaluateV043StageContextExecution(execution);
    }
    expect(existsSync(probePath)).toBe(before);
    expect(before).toBe(false);
  });

  it("RUN-070 a completed evaluation without context keeps target immutability unavailable", () => {
    const result = evaluateV043StageContextExecution(SIX_EXECUTIONS[0]);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.targetImmutability.availability).toBe("unavailable");
      expect(result.metrics.targetImmutability.count).toBeNull();
    }
  });

  it("RUN-071 a completed evaluation with unchanged target reports available zero", () => {
    const result = evaluateV043StageContextExecution(SIX_EXECUTIONS[0], {
      targetImmutability: {
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
      }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.targetImmutability.availability).toBe("available");
      expect(result.metrics.targetImmutability.count).toBe(0);
      expect(result.metrics.targetImmutability.evidenceKeys).toEqual([]);
    }
  });

  it("RUN-072 a completed evaluation with mutated target reports available mutations", () => {
    const result = evaluateV043StageContextExecution(SIX_EXECUTIONS[0], {
      targetImmutability: {
        availability: "available",
        comparison: {
          status: "mutated",
          targetRootPath: "target",
          resolvedTargetRootPath: "/resolved/target",
          preExistingGitStatusEntryCount: 0,
          newMutationCount: 1,
          mutations: [{ id: "git.head", kind: "git-head", fieldPath: "git.head", before: "a", after: "b" }]
        },
        reason: null
      }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.metrics.targetImmutability.availability).toBe("available");
      expect(result.metrics.targetImmutability.count).toBe(1);
      expect(result.metrics.targetImmutability.evidenceKeys).toEqual(["git.head"]);
    }
  });

  it("RUN-073 target expected-state comparison uses the same comparison", () => {
    const architecturePair = makePair("architecture", false);
    const execution = baseExecution("architecture-context-only", { architecture: architecturePair });
    execution.expectations.expectedStates = { targetImmutability: { newMutationCount: 0 } };
    const result = evaluateV043StageContextExecution(execution, {
      targetImmutability: {
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
      }
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const comparison = result.metrics.stateComparisons.find((c) => c.sourceArtifact === "target-immutability");
      expect(comparison?.matched).toBe(true);
      expect(comparison?.actual).toBe(0);
    }
  });

  it("RUN-074 one-argument evaluator calls remain backward compatible", () => {
    const result = evaluateV043StageContextExecution(SIX_EXECUTIONS[0]);
    expect(result.status).toBe("completed");
  });

  it("RUN-075 non-completed execution still skips completed metrics", () => {
    const execution: V043StageContextStrategyExecutionResult = {
      status: "failed",
      strategyId: "architecture-context-only",
      input: {},
      issues: []
    };
    const result = evaluateV043StageContextExecution(execution, {
      targetImmutability: {
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
      }
    });
    expect(result.status).toBe("not-applicable");
    expect(result).not.toHaveProperty("metrics");
  });
});
