import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildContextStrategyComparisonV043Report } from "../../../src/report/experiments/buildContextStrategyComparisonV043Report.js";
import { buildPluginExperimentReport } from "../../../src/report/experiments/buildPluginExperimentReport.js";
import { contextStrategyComparisonMetadata } from "../../../src/experiments/plugins/contextStrategyComparison/index.js";
import type { ExperimentRun, ExperimentTarget } from "../../../src/experiments/index.js";
import type {
  ArchitectureContextOnlyExecutionPayloadV1,
  ArchitecturePlusImplementationAndTestRefreshExecutionPayloadV1,
  ArchitecturePlusImplementationRefreshExecutionPayloadV1,
  BoundedWorkflowInstructionPacketExecutionPayloadV1,
  CombinedBoundedStageContextExecutionPayloadV1,
  FullWorkflowLibraryExecutionPayloadV1,
  LoadedContextArtifactPairV1,
  V043StageContextStrategyExecutionFailed,
  V043StageContextStrategyExecutionInvalidInput,
  V043StageContextStrategyExecutionResult,
  V043StageContextStrategyExecutionSuccess,
} from "../../../src/experiments/plugins/contextStrategyComparison/v043StrategyExecutionTypes.js";
import type { StageContextDeterminismResultV1 } from "../../../src/evaluation/stageContextDeterminism/index.js";
import type {
  V043StageContextEvaluationCompletedV1,
  V043StageContextEvaluationFailedV1,
  V043StageContextEvaluationMetricsV1,
  V043StageContextEvaluationNotApplicableV1,
  V043StageContextEvaluationResultV1,
} from "../../../src/evaluation/stageContextMetrics/index.js";
import type {
  StageContextCountMetricV1,
  StageContextRatioMetricV1,
  StageContextResponsibilityMappingMetricV1,
  StageContextSizeMetricV1,
  StageContextStateComparisonV1,
} from "../../../src/evaluation/stageContextMetrics/index.js";
import type {
  V043StageContextAssuranceRunRecordV1,
  V043StageContextRunAssuranceResultV1,
} from "../../../src/experiments/plugins/contextStrategyComparison/v043RunAssuranceTypes.js";

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

function withRole<T extends Record<string, unknown>>(artifact: T, role: string): T {
  const clone = structuredClone(artifact) as Record<string, unknown>;
  clone.request = { ...(clone.request as Record<string, unknown>), role };
  clone.roleContext = { ...(clone.roleContext as Record<string, unknown>), role };
  return clone as T;
}

function alignAuditToCapsule(auditArtifact: Record<string, unknown>, capsuleArtifact: Record<string, unknown>): Record<string, unknown> {
  auditArtifact.schemaVersion = capsuleArtifact.schemaVersion;
  auditArtifact.tool = structuredClone(capsuleArtifact.tool);
  auditArtifact.request = structuredClone(capsuleArtifact.request);
  const capsuleIndex = capsuleArtifact.index as { indexPath: string; manifestPath: string };
  auditArtifact.index = { indexPath: capsuleIndex.indexPath, manifestPath: capsuleIndex.manifestPath };
  return auditArtifact;
}

function makePair(role: "architecture" | "implementation" | "test-implementation", withAudit: boolean): LoadedContextArtifactPairV1 {
  const capsule = withRole(rawCapsule, role);
  const pair: LoadedContextArtifactPairV1 = {
    role,
    contextCapsuleSourcePath: `mock/${role}-capsule.json`,
    contextCapsule: capsule,
  };
  if (withAudit) {
    const audit = alignAuditToCapsule(withRole(structuredClone(rawAudit), role), capsule);
    pair.retrievalAuditRecordSourcePath = `mock/${role}-audit.json`;
    pair.retrievalAuditRecord = audit as never;
  }
  return pair;
}

function makeExpectations() {
  return structuredClone(rawExpectations);
}

function ratioMetric(overrides: Partial<StageContextRatioMetricV1> = {}): StageContextRatioMetricV1 {
  return {
    availability: "available",
    numerator: 1,
    denominator: 3,
    rate: 1 / 3,
    matchedExpectationIds: ["exp-1"],
    missingExpectationIds: [],
    reason: null,
    ...overrides,
  };
}

function countMetric(overrides: Partial<StageContextCountMetricV1> = {}): StageContextCountMetricV1 {
  return { availability: "available", count: 0, evidenceKeys: [], reason: null, ...overrides };
}

function responsibilityMapping(overrides: Partial<StageContextResponsibilityMappingMetricV1> = {}): StageContextResponsibilityMappingMetricV1 {
  return {
    sourceArtifact: "context-capsule",
    sourceInstance: "architecture.contextCapsule",
    requested: true,
    operational: true,
    mappedCount: 1,
    partiallyMappedCount: 0,
    unmappedCount: 0,
    notApplicableCount: 0,
    denominator: 1,
    mappedRate: 1,
    ...overrides,
  };
}

function stateComparison(overrides: Partial<StageContextStateComparisonV1> = {}): StageContextStateComparisonV1 {
  return {
    sourceArtifact: "context-capsule",
    sourceInstance: "architecture.contextCapsule",
    expectationFieldPath: "expectedStates.contextCapsule.freshnessState",
    artifactFieldPath: "freshness.state",
    availability: "available",
    expected: "fresh",
    actual: "fresh",
    matched: true,
    reason: null,
    ...overrides,
  };
}

function contextSizeMetric(overrides: Partial<StageContextSizeMetricV1> = {}): StageContextSizeMetricV1 {
  return {
    availability: "available",
    sources: [
      { sourceInstance: "architecture.contextCapsule", sourceKind: "context-capsule", characterCount: 400, estimatedTokenCount: 100 },
    ],
    totalCharacterCount: 400,
    totalEstimatedTokenCount: 100,
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<V043StageContextEvaluationMetricsV1> = {}): V043StageContextEvaluationMetricsV1 {
  return {
    requiredEvidenceRecall: ratioMetric(),
    allowedEvidenceCoverage: ratioMetric(),
    forbiddenEvidenceInclusion: ratioMetric({
      availability: "not-applicable",
      numerator: null,
      denominator: null,
      rate: null,
      reason: "No forbidden evidence was expected.",
    }),
    irrelevantFileInclusion: countMetric(),
    irrelevantInstructionInclusion: countMetric(),
    requiredProvenanceRecall: ratioMetric(),
    responsibilityMappingCompleteness: [responsibilityMapping()],
    stateComparisons: [stateComparison()],
    contextSize: contextSizeMetric(),
    consideredButUnselectedReads: countMetric({
      availability: "unavailable",
      count: null,
      reason: "The published upstream artifacts do not expose considered-but-unselected reads.",
    }),
    unnecessaryReads: countMetric({
      availability: "unavailable",
      count: null,
      reason: "The published upstream artifacts do not expose unnecessary-read evidence.",
    }),
    targetImmutability: countMetric({
      availability: "unavailable",
      count: null,
      reason: "Target immutability configuration was not supplied for this strategy run.",
    }),
    ...overrides,
  };
}

function executionSuccess(
  strategyId: V043StageContextStrategyExecutionSuccess["strategyId"],
  payload: V043StageContextStrategyExecutionSuccess["payload"],
  overrides: Partial<V043StageContextStrategyExecutionSuccess> = {}
): V043StageContextStrategyExecutionSuccess {
  return {
    status: "completed",
    strategyId,
    input: {} as unknown as V043StageContextStrategyExecutionSuccess["input"],
    expectationsSourcePath: "mock/expectations.json",
    expectations: makeExpectations(),
    payload,
    warnings: [],
    ...overrides,
  };
}

function executionInvalidInput(
  issues: V043StageContextStrategyExecutionInvalidInput["issues"]
): V043StageContextStrategyExecutionInvalidInput {
  return { status: "invalid-input", strategyId: null, input: { bogus: true, secretPath: "C:/secret" }, issues };
}

function executionFailed(
  strategyId: V043StageContextStrategyExecutionFailed["strategyId"],
  issues: V043StageContextStrategyExecutionFailed["issues"]
): V043StageContextStrategyExecutionFailed {
  return { status: "failed", strategyId, input: { rawInput: "should-not-leak" }, issues };
}

function evaluationCompleted(
  strategyId: V043StageContextEvaluationCompletedV1["strategyId"],
  overrides: Partial<V043StageContextEvaluationCompletedV1> = {}
): V043StageContextEvaluationCompletedV1 {
  return {
    status: "completed",
    strategyId,
    executionStatus: "completed",
    expectationMatches: [
      {
        expectationId: "exp-1",
        inclusion: "required",
        sourceArtifact: "context-capsule",
        category: "file",
        targetKey: "src/a.ts",
        outcome: "matched",
        matchedSourceInstances: ["architecture.contextCapsule"],
        matchedSourceFieldPaths: ["requiredContext[0].path"],
      },
    ],
    observedEvidence: [
      {
        sourceArtifact: "context-capsule",
        sourceInstance: "architecture.contextCapsule",
        category: "file",
        targetKey: "src/a.ts",
        sourceFieldPath: "requiredContext[0].path",
      },
    ],
    metrics: makeMetrics(),
    warnings: [],
    ...overrides,
  };
}

function evaluationNotApplicable(
  strategyId: V043StageContextEvaluationNotApplicableV1["strategyId"],
  executionStatus: V043StageContextEvaluationNotApplicableV1["executionStatus"],
  reason: string
): V043StageContextEvaluationNotApplicableV1 {
  return { status: "not-applicable", strategyId, executionStatus, reason };
}

function evaluationFailed(
  strategyId: V043StageContextEvaluationFailedV1["strategyId"],
  executionStatus: V043StageContextEvaluationFailedV1["executionStatus"],
  reason: string
): V043StageContextEvaluationFailedV1 {
  return { status: "failed", strategyId, executionStatus, reason };
}

function makeRunRecord(overrides: Partial<V043StageContextAssuranceRunRecordV1> = {}): V043StageContextAssuranceRunRecordV1 {
  return {
    runNumber: 1,
    executionStatus: "completed",
    evaluationStatus: "completed",
    targetImmutability: {
      availability: "unavailable",
      comparison: null,
      reason: "Target immutability configuration was not supplied for this strategy run.",
    },
    ...overrides,
  };
}

function makeDeterminism(overrides: Partial<StageContextDeterminismResultV1> = {}): StageContextDeterminismResultV1 {
  return {
    availability: "not-applicable",
    repeatCount: 1,
    deterministic: null,
    baselineSha256: null,
    runDigests: [],
    mismatchRunNumbers: [],
    reason: "Repeated-run determinism requires at least two runs.",
    ...overrides,
  };
}

function makeAssurance(
  strategyId: V043StageContextRunAssuranceResultV1["strategyId"],
  overrides: Partial<V043StageContextRunAssuranceResultV1> = {}
): V043StageContextRunAssuranceResultV1 {
  return {
    strategyId,
    status: "not-applicable",
    repeatCount: 1,
    primaryExecution: executionSuccess(strategyId, { architecture: makePair("architecture", false) }),
    primaryEvaluation: evaluationCompleted(strategyId),
    runRecords: [makeRunRecord()],
    determinism: makeDeterminism(),
    issues: [],
    ...overrides,
  };
}

function makeTarget(): ExperimentTarget {
  return {
    kind: "external-local",
    targetRoot: "Z:\\Projects\\one",
    toolRoot: "Z:\\Users\\newuser\\Projects\\my-dev-kit-lab",
    packageName: "@dailephd/my-dev-kit",
    packageVersion: "1.10.2",
    hasPackageJson: true,
    hasLockfile: true,
    branch: "main",
    commit: "abc1234",
    hasGit: true,
    isSelf: false,
  };
}

function makeRun(args: {
  pluginId?: string;
  executions?: V043StageContextStrategyExecutionResult[];
  evaluations?: V043StageContextEvaluationResultV1[];
  assurances?: V043StageContextRunAssuranceResultV1[];
  legacy?: boolean;
}): ExperimentRun {
  const run: Record<string, unknown> = {
    runId: "context-run",
    pluginId: args.pluginId ?? "context-strategy-comparison",
    startedAt: "2026-06-23T00:00:00.000Z",
    completedAt: "2026-06-23T00:00:01.000Z",
    status: "completed",
    target: makeTarget(),
    variants: [],
    cases: [],
    metrics: [],
    artifacts: [],
    warnings: [],
    failures: [],
    metadata: { legacySummaryPath: "lab-output/context-run/summary.json" },
  };
  if (args.legacy) {
    run.legacyArtifacts = { runs: [], summary: { totalRuns: 0 }, warnings: [], artifactPaths: {} };
  }
  if (args.executions !== undefined) run.v043StageContextExecutions = args.executions;
  if (args.evaluations !== undefined) run.v043StageContextEvaluations = args.evaluations;
  if (args.assurances !== undefined) run.v043StageContextRunAssurance = args.assurances;
  return run as unknown as ExperimentRun;
}

describe("buildContextStrategyComparisonV043Report", () => {
  it("RPT-017 a non-context-strategy plugin returns null", () => {
    const run = makeRun({ pluginId: "other-plugin" });
    expect(buildContextStrategyComparisonV043Report(run)).toBeNull();
  });

  it("RPT-018 a context-strategy run without v0.4.3 arrays returns null", () => {
    const run = makeRun({ legacy: true });
    expect(buildContextStrategyComparisonV043Report(run)).toBeNull();
  });

  it("RPT-019 three present empty arrays produce a non-null zero-strategy report", () => {
    const run = makeRun({ executions: [], evaluations: [], assurances: [] });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report).not.toBeNull();
    expect(report?.summary.strategyCount).toBe(0);
    expect(report?.strategies).toEqual([]);
  });

  it("RPT-020 unequal array lengths fail with the exact error", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [],
      assurances: [makeAssurance("architecture-context-only")],
    });
    expect(() => buildContextStrategyComparisonV043Report(run)).toThrow(
      "Invalid v0.4.3 report source: execution, evaluation, and assurance arrays are inconsistent."
    );
  });

  it("RPT-021 mismatched strategy IDs fail with the exact error", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("bounded-workflow-instruction-packet")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    expect(() => buildContextStrategyComparisonV043Report(run)).toThrow(
      "Invalid v0.4.3 report source: execution, evaluation, and assurance arrays are inconsistent."
    );
  });

  it("RPT-022 strategy order follows execution-array order", () => {
    const architecturePayload: ArchitectureContextOnlyExecutionPayloadV1 = { architecture: makePair("architecture", false) };
    const packetPayload: BoundedWorkflowInstructionPacketExecutionPayloadV1 = {
      workflowInstructionPacketSourcePath: "mock/packet.json",
      workflowInstructionPacket: structuredClone(rawPacket),
    };
    const run = makeRun({
      executions: [
        executionSuccess("bounded-workflow-instruction-packet", packetPayload),
        executionSuccess("architecture-context-only", architecturePayload),
      ],
      evaluations: [evaluationCompleted("bounded-workflow-instruction-packet"), evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("bounded-workflow-instruction-packet"), makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies.map((s) => s.strategyId)).toEqual([
      "bounded-workflow-instruction-packet",
      "architecture-context-only",
    ]);
  });

  it("RPT-023 summary counts use exact source statuses", () => {
    const run = makeRun({
      executions: [
        executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) }),
        executionInvalidInput([{ code: "INVALID_STRATEGY_INPUT", fieldPath: "input", message: "bad", details: { x: 1 } }]),
        executionFailed("full-workflow-library", [{ code: "UNEXPECTED_EXECUTION_ERROR", fieldPath: "", message: "boom" }]),
      ],
      evaluations: [
        evaluationCompleted("architecture-context-only"),
        evaluationNotApplicable(null, "invalid-input", "Execution did not complete."),
        evaluationFailed("full-workflow-library", "failed", "Execution failed."),
      ],
      assurances: [
        makeAssurance("architecture-context-only", { status: "passed" }),
        makeAssurance("architecture-context-only", { status: "failed" }),
        makeAssurance("full-workflow-library", { status: "not-applicable" }),
      ],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.summary).toEqual({
      strategyCount: 3,
      completedExecutionCount: 1,
      invalidInputExecutionCount: 1,
      failedExecutionCount: 1,
      completedEvaluationCount: 1,
      notApplicableEvaluationCount: 1,
      failedEvaluationCount: 1,
      passedAssuranceCount: 1,
      failedAssuranceCount: 1,
      notApplicableAssuranceCount: 1,
    });
  });

  it("RPT-024 expectation metadata is first for a completed execution", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    const first = report?.strategies[0].artifacts.items[0];
    expect(first?.artifactKind).toBe("expectation-fixture");
    expect(first?.sourceInstance).toBe("expectations");
    expect(first?.sourcePath).toBe("mock/expectations.json");
  });

  it("RPT-025 architecture capsule metadata is exact", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    const capsuleEntry = report?.strategies[0].artifacts.items[1];
    expect(capsuleEntry?.sourceInstance).toBe("architecture.contextCapsule");
    expect(capsuleEntry?.artifactKind).toBe("context-capsule");
    expect(capsuleEntry?.sourcePath).toBe("mock/architecture-capsule.json");
    expect(capsuleEntry?.schemaVersion).toBe("1.0.0");
    expect(capsuleEntry?.role).toBe("architecture");
  });

  it("RPT-026 architecture audit metadata follows its capsule", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", true) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    const items = report?.strategies[0].artifacts.items ?? [];
    expect(items[1].sourceInstance).toBe("architecture.contextCapsule");
    expect(items[2].sourceInstance).toBe("architecture.retrievalAuditRecord");
    expect(items[2].artifactKind).toBe("retrieval-audit-record");
  });

  it("RPT-027 implementation metadata order is exact", () => {
    const payload: ArchitecturePlusImplementationRefreshExecutionPayloadV1 = {
      architecture: makePair("architecture", false),
      implementation: makePair("implementation", false),
    };
    const run = makeRun({
      executions: [executionSuccess("architecture-plus-implementation-refresh", payload)],
      evaluations: [evaluationCompleted("architecture-plus-implementation-refresh")],
      assurances: [makeAssurance("architecture-plus-implementation-refresh")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    const items = report?.strategies[0].artifacts.items ?? [];
    expect(items.map((i) => i.sourceInstance)).toEqual([
      "expectations",
      "architecture.contextCapsule",
      "implementation.contextCapsule",
    ]);
  });

  it("RPT-028 test-implementation metadata order is exact", () => {
    const payload: ArchitecturePlusImplementationAndTestRefreshExecutionPayloadV1 = {
      architecture: makePair("architecture", false),
      implementation: makePair("implementation", false),
      testImplementation: makePair("test-implementation", false),
    };
    const run = makeRun({
      executions: [executionSuccess("architecture-plus-implementation-and-test-refresh", payload)],
      evaluations: [evaluationCompleted("architecture-plus-implementation-and-test-refresh")],
      assurances: [makeAssurance("architecture-plus-implementation-and-test-refresh")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    const items = report?.strategies[0].artifacts.items ?? [];
    expect(items.map((i) => i.sourceInstance)).toEqual([
      "expectations",
      "architecture.contextCapsule",
      "implementation.contextCapsule",
      "testImplementation.contextCapsule",
    ]);
  });

  it("RPT-029 combined contextArtifacts order follows caller order", () => {
    const payload: CombinedBoundedStageContextExecutionPayloadV1 = {
      contextArtifacts: [makePair("implementation", false), makePair("architecture", false)],
      workflowInstructionPacketSourcePath: "mock/packet.json",
      workflowInstructionPacket: structuredClone(rawPacket),
    };
    const run = makeRun({
      executions: [executionSuccess("combined-bounded-stage-context", payload)],
      evaluations: [evaluationCompleted("combined-bounded-stage-context")],
      assurances: [makeAssurance("combined-bounded-stage-context")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    const items = report?.strategies[0].artifacts.items ?? [];
    expect(items.map((i) => i.sourceInstance)).toEqual([
      "expectations",
      "contextArtifacts[0].contextCapsule",
      "contextArtifacts[1].contextCapsule",
      "workflowInstructionPacket",
    ]);
  });

  it("RPT-030 combined packet metadata follows all context artifacts", () => {
    const payload: CombinedBoundedStageContextExecutionPayloadV1 = {
      contextArtifacts: [makePair("architecture", false)],
      workflowInstructionPacketSourcePath: "mock/packet.json",
      workflowInstructionPacket: structuredClone(rawPacket),
    };
    const run = makeRun({
      executions: [executionSuccess("combined-bounded-stage-context", payload)],
      evaluations: [evaluationCompleted("combined-bounded-stage-context")],
      assurances: [makeAssurance("combined-bounded-stage-context")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    const items = report?.strategies[0].artifacts.items ?? [];
    expect(items[items.length - 1].sourceInstance).toBe("workflowInstructionPacket");
  });

  it("RPT-031 workflow packet schema and catalog metadata are exact", () => {
    const payload: BoundedWorkflowInstructionPacketExecutionPayloadV1 = {
      workflowInstructionPacketSourcePath: "mock/packet.json",
      workflowInstructionPacket: structuredClone(rawPacket),
    };
    const run = makeRun({
      executions: [executionSuccess("bounded-workflow-instruction-packet", payload)],
      evaluations: [evaluationCompleted("bounded-workflow-instruction-packet")],
      assurances: [makeAssurance("bounded-workflow-instruction-packet")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    const entry = report?.strategies[0].artifacts.items[1];
    expect(entry?.artifactKind).toBe("workflow-instruction-packet");
    expect(entry?.schemaVersion).toBe(rawPacket.schemaVersion);
    expect(entry?.workflowId).toBe(rawPacket.workflowId);
    expect(entry?.stageId).toBe(rawPacket.stageId);
    expect(entry?.catalogSchemaVersion).toBe(rawPacket.catalogSchemaVersion);
    expect(entry?.catalogVersion).toBe(rawPacket.catalogVersion);
  });

  it("RPT-032 full-workflow-library metadata is exact", () => {
    const payload: FullWorkflowLibraryExecutionPayloadV1 = {
      fullWorkflowLibrarySourcePath: "mock/library.json",
      fullWorkflowLibrary: structuredClone(rawLibrary),
    };
    const run = makeRun({
      executions: [executionSuccess("full-workflow-library", payload)],
      evaluations: [evaluationCompleted("full-workflow-library")],
      assurances: [makeAssurance("full-workflow-library")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    const entry = report?.strategies[0].artifacts.items[1];
    expect(entry?.artifactKind).toBe("full-workflow-library");
    expect(entry?.schemaVersion).toBe(rawLibrary.schemaVersion);
    expect(entry?.fixtureId).toBe(rawLibrary.fixtureId);
    expect(entry?.title).toBe(rawLibrary.title);
  });

  it("RPT-033 invalid-input execution exposes no arbitrary input paths", () => {
    const run = makeRun({
      executions: [executionInvalidInput([{ code: "INVALID_STRATEGY_INPUT", fieldPath: "input", message: "bad" }])],
      evaluations: [evaluationNotApplicable(null, "invalid-input", "Execution did not complete.")],
      assurances: [makeAssurance("architecture-context-only", { status: "not-applicable" })],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].artifacts.totalCount).toBe(0);
    expect(JSON.stringify(report?.strategies[0])).not.toContain("secretPath");
  });

  it("RPT-034 failed execution exposes no arbitrary input object", () => {
    const run = makeRun({
      executions: [executionFailed("full-workflow-library", [{ code: "UNEXPECTED_EXECUTION_ERROR", fieldPath: "", message: "boom" }])],
      evaluations: [evaluationFailed("full-workflow-library", "failed", "Execution failed.")],
      assurances: [makeAssurance("full-workflow-library", { status: "failed" })],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].artifacts.totalCount).toBe(0);
    expect(JSON.stringify(report?.strategies[0])).not.toContain("rawInput");
  });

  it("RPT-035 execution issues preserve source order", () => {
    const run = makeRun({
      executions: [
        executionFailed("full-workflow-library", [
          { code: "UNEXPECTED_EXECUTION_ERROR", fieldPath: "a", message: "first" },
          { code: "FULL_WORKFLOW_LIBRARY_READ_FAILED", fieldPath: "b", message: "second" },
        ]),
      ],
      evaluations: [evaluationFailed("full-workflow-library", "failed", "Execution failed.")],
      assurances: [makeAssurance("full-workflow-library", { status: "failed" })],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].execution.issues.items.map((i) => i.message)).toEqual(["first", "second"]);
  });

  it("RPT-036 execution issue details are excluded", () => {
    const run = makeRun({
      executions: [
        executionFailed("full-workflow-library", [
          { code: "UNEXPECTED_EXECUTION_ERROR", fieldPath: "a", message: "first", details: { secret: "leak" } },
        ]),
      ],
      evaluations: [evaluationFailed("full-workflow-library", "failed", "Execution failed.")],
      assurances: [makeAssurance("full-workflow-library", { status: "failed" })],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].execution.issues.items[0]).not.toHaveProperty("details");
    expect(JSON.stringify(report?.strategies[0])).not.toContain("leak");
  });

  it("RPT-037 completed evaluation metrics are copied exactly", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    const metrics = report?.strategies[0].evaluation.metrics;
    expect(metrics?.requiredEvidenceRecall.numerator).toBe(1);
    expect(metrics?.requiredEvidenceRecall.denominator).toBe(3);
  });

  it("RPT-038 ratio rates are not rounded", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].evaluation.metrics?.requiredEvidenceRecall.rate).toBe(1 / 3);
  });

  it("RPT-039 unavailable ratio numeric fields remain null", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [
        evaluationCompleted("architecture-context-only", {
          metrics: makeMetrics({
            requiredProvenanceRecall: ratioMetric({
              availability: "unavailable",
              numerator: null,
              denominator: null,
              rate: null,
              reason: "Provenance unavailable.",
            }),
          }),
        }),
      ],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    const metric = report?.strategies[0].evaluation.metrics?.requiredProvenanceRecall;
    expect(metric?.numerator).toBeNull();
    expect(metric?.denominator).toBeNull();
    expect(metric?.rate).toBeNull();
  });

  it("RPT-040 not-applicable ratio numeric fields remain null", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    const metric = report?.strategies[0].evaluation.metrics?.forbiddenEvidenceInclusion;
    expect(metric?.availability).toBe("not-applicable");
    expect(metric?.numerator).toBeNull();
    expect(metric?.denominator).toBeNull();
    expect(metric?.rate).toBeNull();
  });

  it("RPT-041 available count zero remains zero", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].evaluation.metrics?.irrelevantFileInclusion.count).toBe(0);
    expect(report?.strategies[0].evaluation.metrics?.irrelevantFileInclusion.availability).toBe("available");
  });

  it("RPT-042 unavailable count remains null", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].evaluation.metrics?.unnecessaryReads.count).toBeNull();
  });

  it("RPT-043 not-applicable count remains null", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [
        evaluationCompleted("architecture-context-only", {
          metrics: makeMetrics({
            irrelevantInstructionInclusion: countMetric({
              availability: "not-applicable",
              count: null,
              reason: "No instructions were supplied.",
            }),
          }),
        }),
      ],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].evaluation.metrics?.irrelevantInstructionInclusion.count).toBeNull();
  });

  it("RPT-044 responsibility mappings preserve source order", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [
        evaluationCompleted("architecture-context-only", {
          metrics: makeMetrics({
            responsibilityMappingCompleteness: [
              responsibilityMapping({ sourceInstance: "first" }),
              responsibilityMapping({ sourceInstance: "second" }),
            ],
          }),
        }),
      ],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].evaluation.metrics?.responsibilityMappingCompleteness.items.map((m) => m.sourceInstance)).toEqual([
      "first",
      "second",
    ]);
  });

  it("RPT-045 state comparisons preserve source order", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [
        evaluationCompleted("architecture-context-only", {
          metrics: makeMetrics({
            stateComparisons: [stateComparison({ sourceInstance: "first" }), stateComparison({ sourceInstance: "second" })],
          }),
        }),
      ],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].evaluation.metrics?.stateComparisons.items.map((c) => c.sourceInstance)).toEqual([
      "first",
      "second",
    ]);
  });

  it("RPT-046 context-size sources preserve source order", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [
        evaluationCompleted("architecture-context-only", {
          metrics: makeMetrics({
            contextSize: contextSizeMetric({
              sources: [
                { sourceInstance: "first", sourceKind: "context-capsule", characterCount: 1, estimatedTokenCount: 1 },
                { sourceInstance: "second", sourceKind: "context-capsule", characterCount: 2, estimatedTokenCount: 1 },
              ],
            }),
          }),
        }),
      ],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].evaluation.metrics?.contextSize.sources.items.map((s) => s.sourceInstance)).toEqual([
      "first",
      "second",
    ]);
  });

  it("RPT-047 observed evidence preserves source order", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [
        evaluationCompleted("architecture-context-only", {
          observedEvidence: [
            { sourceArtifact: "context-capsule", sourceInstance: "first", category: "file", targetKey: "a", sourceFieldPath: "p1" },
            { sourceArtifact: "context-capsule", sourceInstance: "second", category: "file", targetKey: "b", sourceFieldPath: "p2" },
          ],
        }),
      ],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].evaluation.observedEvidence.items.map((e) => e.sourceInstance)).toEqual(["first", "second"]);
  });

  it("RPT-048 expectation matches preserve source order", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [
        evaluationCompleted("architecture-context-only", {
          expectationMatches: [
            {
              expectationId: "first",
              inclusion: "required",
              sourceArtifact: "context-capsule",
              category: "file",
              targetKey: "a",
              outcome: "matched",
              matchedSourceInstances: [],
              matchedSourceFieldPaths: [],
            },
            {
              expectationId: "second",
              inclusion: "required",
              sourceArtifact: "context-capsule",
              category: "file",
              targetKey: "b",
              outcome: "matched",
              matchedSourceInstances: [],
              matchedSourceFieldPaths: [],
            },
          ],
        }),
      ],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].evaluation.expectationMatches.items.map((m) => m.expectationId)).toEqual(["first", "second"]);
  });

  it("RPT-049 a 101-item detail list displays the first 100", () => {
    const warnings = Array.from({ length: 101 }, (_, i) => `warning-${i}`);
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only", { warnings })],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    const list = report?.strategies[0].evaluation.warnings;
    expect(list?.displayedCount).toBe(100);
    expect(list?.items).toEqual(warnings.slice(0, 100));
  });

  it("RPT-050 a 101-item detail list reports omittedCount 1", () => {
    const warnings = Array.from({ length: 101 }, (_, i) => `warning-${i}`);
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only", { warnings })],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].evaluation.warnings.omittedCount).toBe(1);
    expect(report?.strategies[0].evaluation.warnings.totalCount).toBe(101);
  });

  it("RPT-051 bounded-list building does not sort", () => {
    const warnings = ["c", "a", "b"];
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only", { warnings })],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].evaluation.warnings.items).toEqual(["c", "a", "b"]);
  });

  it("RPT-052 bounded-list building does not mutate the source", () => {
    const warnings = ["c", "a", "b"];
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only", { warnings })],
      assurances: [makeAssurance("architecture-context-only")],
    });
    buildContextStrategyComparisonV043Report(run);
    expect(warnings).toEqual(["c", "a", "b"]);
  });

  it("RPT-053 target mutations preserve source order", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [
        makeAssurance("architecture-context-only", {
          runRecords: [
            makeRunRecord({
              targetImmutability: {
                availability: "available",
                reason: null,
                comparison: {
                  status: "mutated",
                  targetRootPath: "target",
                  resolvedTargetRootPath: "/resolved/target",
                  preExistingGitStatusEntryCount: 0,
                  newMutationCount: 2,
                  mutations: [
                    { id: "git.head", kind: "git-head", fieldPath: "git.head", before: "a", after: "b" },
                    { id: "file:src/a.ts", kind: "configured-file", fieldPath: "configuredFiles.src/a.ts", before: "x", after: "y" },
                  ],
                },
              },
            }),
          ],
        }),
      ],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].assurance.runRecords.items[0].mutations.items.map((m) => m.id)).toEqual([
      "git.head",
      "file:src/a.ts",
    ]);
  });

  it("RPT-054 target mutation before and after values remain exact", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [
        makeAssurance("architecture-context-only", {
          runRecords: [
            makeRunRecord({
              targetImmutability: {
                availability: "available",
                reason: null,
                comparison: {
                  status: "mutated",
                  targetRootPath: "target",
                  resolvedTargetRootPath: "/resolved/target",
                  preExistingGitStatusEntryCount: 0,
                  newMutationCount: 1,
                  mutations: [{ id: "git.head", kind: "git-head", fieldPath: "git.head", before: "abc123", after: "def456" }],
                },
              },
            }),
          ],
        }),
      ],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    const mutation = report?.strategies[0].assurance.runRecords.items[0].mutations.items[0];
    expect(mutation?.before).toBe("abc123");
    expect(mutation?.after).toBe("def456");
  });

  it("RPT-055 run records preserve run order", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [
        makeAssurance("architecture-context-only", {
          runRecords: [makeRunRecord({ runNumber: 2 }), makeRunRecord({ runNumber: 1 })],
        }),
      ],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].assurance.runRecords.items.map((r) => r.runNumber)).toEqual([2, 1]);
  });

  it("RPT-056 determinism digests preserve run order", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [
        makeAssurance("architecture-context-only", {
          determinism: makeDeterminism({
            availability: "available",
            deterministic: true,
            baselineSha256: "deadbeef",
            runDigests: [
              { runNumber: 2, sha256: "deadbeef" },
              { runNumber: 1, sha256: "deadbeef" },
            ],
          }),
        }),
      ],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].assurance.determinism.runDigests.items.map((d) => d.runNumber)).toEqual([2, 1]);
  });

  it("RPT-057 determinism is not recalculated", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [
        makeAssurance("architecture-context-only", {
          determinism: makeDeterminism({
            availability: "available",
            deterministic: false,
            baselineSha256: "not-a-real-hash",
            runDigests: [{ runNumber: 1, sha256: "not-a-real-hash" }],
          }),
        }),
      ],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].assurance.determinism.baselineSha256).toBe("not-a-real-hash");
  });

  it("RPT-058 assurance issues preserve source order", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [
        makeAssurance("architecture-context-only", {
          issues: [
            { code: "TARGET_MUTATION_DETECTED", runNumber: 1, fieldPath: "a", message: "first" },
            { code: "NONDETERMINISTIC_RESULT", runNumber: 2, fieldPath: "b", message: "second" },
          ],
        }),
      ],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].assurance.issues.items.map((i) => i.message)).toEqual(["first", "second"]);
  });

  it("RPT-059 issue details are excluded", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [
        makeAssurance("architecture-context-only", {
          issues: [{ code: "TARGET_MUTATION_DETECTED", runNumber: 1, fieldPath: "a", message: "first", details: { leak: "secret" } }],
        }),
      ],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies[0].assurance.issues.items[0]).not.toHaveProperty("details");
    expect(JSON.stringify(report?.strategies[0])).not.toContain("secret");
  });

  it("RPT-060 the interpretation summary is exact", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.interpretation.summary).toBe(
      "Stage-context strategies are reported independently using direct evidence, explicit availability states, target-immutability evidence, and repeated-run determinism. No composite ranking or winning strategy is calculated."
    );
  });

  it("RPT-061 the four limitations are exact and ordered", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.interpretation.limitations).toEqual([
      "The published upstream artifacts do not expose considered-but-unselected reads.",
      "The published upstream artifacts do not expose unnecessary-read evidence.",
      "Estimated token counts use ceil(characterCount / 4) per source and are not provider telemetry.",
      "Unavailable and not-applicable values are distinct from zero.",
    ]);
  });

  it("RPT-062 no score is calculated", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(JSON.stringify(report)).not.toMatch(/"score"/i);
  });

  it("RPT-063 no grade is calculated", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(JSON.stringify(report)).not.toMatch(/"grade"/i);
  });

  it("RPT-064 no strategy ranking is calculated", () => {
    const run = makeRun({
      executions: [
        executionSuccess("bounded-workflow-instruction-packet", {
          workflowInstructionPacketSourcePath: "mock/packet.json",
          workflowInstructionPacket: structuredClone(rawPacket),
        }),
        executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) }),
      ],
      evaluations: [evaluationCompleted("bounded-workflow-instruction-packet"), evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("bounded-workflow-instruction-packet"), makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(report?.strategies.map((s) => s.strategyId)).toEqual([
      "bounded-workflow-instruction-packet",
      "architecture-context-only",
    ]);
    expect(JSON.stringify(report)).not.toMatch(/"rank"/i);
  });

  it("RPT-065 no winner is selected", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildContextStrategyComparisonV043Report(run);
    expect(JSON.stringify(report)).not.toMatch(/"winner"/i);
  });

  it("RPT-066 the source run is not mutated", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const before = JSON.stringify(run);
    buildContextStrategyComparisonV043Report(run);
    expect(JSON.stringify(run)).toBe(before);
  });

  it("RPT-067 execution objects are not mutated", () => {
    const execution = executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) });
    const run = makeRun({
      executions: [execution],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const before = JSON.stringify(execution);
    buildContextStrategyComparisonV043Report(run);
    expect(JSON.stringify(execution)).toBe(before);
  });

  it("RPT-068 evaluation objects are not mutated", () => {
    const evaluation = evaluationCompleted("architecture-context-only");
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluation],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const before = JSON.stringify(evaluation);
    buildContextStrategyComparisonV043Report(run);
    expect(JSON.stringify(evaluation)).toBe(before);
  });

  it("RPT-069 assurance objects are not mutated", () => {
    const assurance = makeAssurance("architecture-context-only");
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [assurance],
    });
    const before = JSON.stringify(assurance);
    buildContextStrategyComparisonV043Report(run);
    expect(JSON.stringify(assurance)).toBe(before);
  });

  it("RPT-070 artifact objects are not mutated", () => {
    const pair = makePair("architecture", false);
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: pair })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const before = JSON.stringify(pair.contextCapsule);
    buildContextStrategyComparisonV043Report(run);
    expect(JSON.stringify(pair.contextCapsule)).toBe(before);
  });

  it("RPT-071 PluginExperimentReport includes contextStrategyComparisonV043 immediately before interpretation in serialized key order", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildPluginExperimentReport({ run, plugin: contextStrategyComparisonMetadata });
    const keys = Object.keys(report);
    const v043Index = keys.indexOf("contextStrategyComparisonV043");
    const interpretationIndex = keys.indexOf("interpretation");
    expect(v043Index).toBeGreaterThanOrEqual(0);
    expect(interpretationIndex).toBe(v043Index + 1);
  });

  it("RPT-072 a v0.4.3 run receives the neutral interpretation", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildPluginExperimentReport({ run, plugin: contextStrategyComparisonMetadata });
    expect(report.interpretation.summary).toContain("Stage-context evidence was recorded for");
  });

  it("RPT-073 the neutral interpretation includes the exact strategy count", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildPluginExperimentReport({ run, plugin: contextStrategyComparisonMetadata });
    expect(report.interpretation.summary).toContain("recorded for 1 strategy executions");
  });

  it("RPT-074 the neutral interpretation contains no best-supported strategy", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildPluginExperimentReport({ run, plugin: contextStrategyComparisonMetadata });
    expect(report.interpretation.summary).not.toContain("Best-supported strategy");
  });

  it("RPT-075 a legacy-only context-strategy run preserves its existing interpretation", () => {
    const run = makeRun({ legacy: true });
    (run as unknown as Record<string, unknown>).metrics = [
      { id: "average-token-savings-percent", name: "Average token savings", value: 42, unit: "percent" },
      { id: "average-correctness-delta", name: "Average correctness delta", value: 0 },
    ];
    const report = buildPluginExperimentReport({ run, plugin: contextStrategyComparisonMetadata });
    expect(report.interpretation.summary).toContain("raw-full-file vs my-dev-kit-guided");
  });

  it("RPT-076 a non-context plugin preserves its existing interpretation", () => {
    const run = makeRun({ pluginId: "other-plugin" });
    const report = buildPluginExperimentReport({
      run,
      plugin: { ...contextStrategyComparisonMetadata, id: "other-plugin" },
    });
    expect(report.interpretation.summary).toBe("Experiment other-plugin finished with status completed.");
  });

  it("RPT-077 report rawRun excludes v043StageContextExecutions", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildPluginExperimentReport({ run, plugin: contextStrategyComparisonMetadata });
    expect(report.rawRun).not.toHaveProperty("v043StageContextExecutions");
  });

  it("RPT-078 report rawRun excludes v043StageContextEvaluations", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildPluginExperimentReport({ run, plugin: contextStrategyComparisonMetadata });
    expect(report.rawRun).not.toHaveProperty("v043StageContextEvaluations");
  });

  it("RPT-079 report rawRun excludes v043StageContextRunAssurance", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildPluginExperimentReport({ run, plugin: contextStrategyComparisonMetadata });
    expect(report.rawRun).not.toHaveProperty("v043StageContextRunAssurance");
  });

  it("RPT-080 the original run retains all three arrays", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    buildPluginExperimentReport({ run, plugin: contextStrategyComparisonMetadata });
    expect(run).toHaveProperty("v043StageContextExecutions");
    expect(run).toHaveProperty("v043StageContextEvaluations");
    expect(run).toHaveProperty("v043StageContextRunAssurance");
  });

  it("RPT-081 no other rawRun field is removed", () => {
    const run = makeRun({
      executions: [executionSuccess("architecture-context-only", { architecture: makePair("architecture", false) })],
      evaluations: [evaluationCompleted("architecture-context-only")],
      assurances: [makeAssurance("architecture-context-only")],
    });
    const report = buildPluginExperimentReport({ run, plugin: contextStrategyComparisonMetadata });
    expect(report.rawRun).toHaveProperty("metadata");
    expect(report.rawRun.runId).toBe("context-run");
  });
});
