import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateV043ExecutionContextSize } from "../../../src/evaluation/stageContextMetrics/calculateContextSizeMetrics.js";
import type {
  LoadedContextArtifactPairV1,
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

function makePair(withAudit: boolean): LoadedContextArtifactPairV1 {
  const capsule = structuredClone(rawCapsule);
  const pair: LoadedContextArtifactPairV1 = {
    role: "architecture",
    contextCapsuleSourcePath: "mock/capsule.json",
    contextCapsule: capsule
  };
  if (withAudit) {
    pair.retrievalAuditRecordSourcePath = "mock/audit.json";
    pair.retrievalAuditRecord = structuredClone(rawAudit);
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

describe("calculateV043ExecutionContextSize", () => {
  it("MET-149 capsule size uses JSON.stringify artifact length", () => {
    const pair = makePair(false);
    const execution = baseExecution("architecture-context-only", { architecture: pair });
    const result = calculateV043ExecutionContextSize(execution);
    const expectedLength = JSON.stringify(pair.contextCapsule).length;
    expect(result.sources[0].characterCount).toBe(expectedLength);
  });

  it("MET-150 audit size uses JSON.stringify artifact length", () => {
    const pair = makePair(true);
    const execution = baseExecution("architecture-context-only", { architecture: pair });
    const result = calculateV043ExecutionContextSize(execution);
    const auditSource = result.sources.find((s) => s.sourceKind === "retrieval-audit-record");
    expect(auditSource?.characterCount).toBe(JSON.stringify(pair.retrievalAuditRecord).length);
  });

  it("MET-151 packet size uses JSON.stringify artifact length", () => {
    const packet = structuredClone(rawPacket);
    const execution = baseExecution("bounded-workflow-instruction-packet", {
      workflowInstructionPacketSourcePath: "mock/packet.json",
      workflowInstructionPacket: packet
    });
    const result = calculateV043ExecutionContextSize(execution);
    expect(result.sources[0].characterCount).toBe(JSON.stringify(packet).length);
  });

  it("MET-152 full library size uses rawText length only", () => {
    const library = structuredClone(rawLibrary);
    const execution = baseExecution("full-workflow-library", {
      fullWorkflowLibrarySourcePath: "mock/library.json",
      fullWorkflowLibrary: library
    });
    const result = calculateV043ExecutionContextSize(execution);
    expect(result.sources[0].characterCount).toBe(library.rawText.length);
  });

  it("MET-153 expectations are excluded from size", () => {
    const pair = makePair(false);
    const execution = baseExecution("architecture-context-only", { architecture: pair });
    const result = calculateV043ExecutionContextSize(execution);
    const expectationsLength = JSON.stringify(execution.expectations).length;
    expect(result.totalCharacterCount).not.toBe(expectationsLength + JSON.stringify(pair.contextCapsule).length);
    expect(result.totalCharacterCount).toBe(JSON.stringify(pair.contextCapsule).length);
  });

  it("MET-154 source paths are excluded from size", () => {
    const pair = makePair(false);
    pair.contextCapsuleSourcePath = "a".repeat(10000);
    const execution = baseExecution("architecture-context-only", { architecture: pair });
    const result = calculateV043ExecutionContextSize(execution);
    expect(result.sources[0].characterCount).toBe(JSON.stringify(pair.contextCapsule).length);
  });

  it("MET-155 each token estimate uses Math.ceil(characters / 4)", () => {
    const pair = makePair(false);
    const execution = baseExecution("architecture-context-only", { architecture: pair });
    const result = calculateV043ExecutionContextSize(execution);
    expect(result.sources[0].estimatedTokenCount).toBe(Math.ceil(result.sources[0].characterCount / 4));
  });

  it("MET-156 total tokens sum per-source token estimates", () => {
    const pair = makePair(true);
    const execution = baseExecution("architecture-context-only", { architecture: pair });
    const result = calculateV043ExecutionContextSize(execution);
    const sum = result.sources.reduce((acc, s) => acc + s.estimatedTokenCount, 0);
    expect(result.totalEstimatedTokenCount).toBe(sum);
  });

  it("MET-157 architecture source order is exact", () => {
    const pair = makePair(true);
    const execution = baseExecution("architecture-context-only", { architecture: pair });
    const result = calculateV043ExecutionContextSize(execution);
    expect(result.sources.map((s) => s.sourceInstance)).toEqual(["architecture.contextCapsule", "architecture.retrievalAuditRecord"]);
  });

  it("MET-158 architecture-plus-implementation source order is exact", () => {
    const execution = baseExecution("architecture-plus-implementation-refresh", {
      architecture: makePair(true),
      implementation: makePair(true)
    });
    const result = calculateV043ExecutionContextSize(execution);
    expect(result.sources.map((s) => s.sourceInstance)).toEqual([
      "architecture.contextCapsule",
      "architecture.retrievalAuditRecord",
      "implementation.contextCapsule",
      "implementation.retrievalAuditRecord"
    ]);
  });

  it("MET-159 architecture-plus-implementation-and-test source order is exact", () => {
    const execution = baseExecution("architecture-plus-implementation-and-test-refresh", {
      architecture: makePair(false),
      implementation: makePair(false),
      testImplementation: makePair(false)
    });
    const result = calculateV043ExecutionContextSize(execution);
    expect(result.sources.map((s) => s.sourceInstance)).toEqual([
      "architecture.contextCapsule",
      "implementation.contextCapsule",
      "testImplementation.contextCapsule"
    ]);
  });

  it("MET-160 combined context artifact order follows caller order", () => {
    const execution = baseExecution("combined-bounded-stage-context", {
      contextArtifacts: [makePair(false), makePair(false), makePair(false)],
      workflowInstructionPacketSourcePath: "mock/packet.json",
      workflowInstructionPacket: structuredClone(rawPacket)
    });
    const result = calculateV043ExecutionContextSize(execution);
    expect(result.sources.slice(0, 3).map((s) => s.sourceInstance)).toEqual([
      "contextArtifacts[0].contextCapsule",
      "contextArtifacts[1].contextCapsule",
      "contextArtifacts[2].contextCapsule"
    ]);
  });

  it("MET-161 packet follows combined context artifacts", () => {
    const execution = baseExecution("combined-bounded-stage-context", {
      contextArtifacts: [makePair(false)],
      workflowInstructionPacketSourcePath: "mock/packet.json",
      workflowInstructionPacket: structuredClone(rawPacket)
    });
    const result = calculateV043ExecutionContextSize(execution);
    expect(result.sources[result.sources.length - 1].sourceInstance).toBe("workflowInstructionPacket");
  });

  it("MET-162 no external tokenizer is used", () => {
    const source = readFileSync(
      "src/evaluation/stageContextMetrics/calculateContextSizeMetrics.ts",
      "utf8"
    );
    expect(source.toLowerCase()).not.toContain("tiktoken");
    expect(source.toLowerCase()).not.toContain("gpt-tokenizer");
  });

  it("MET-163 execution objects are not mutated", () => {
    const pair = makePair(true);
    const execution = baseExecution("architecture-context-only", { architecture: pair });
    const before = JSON.stringify(execution);
    calculateV043ExecutionContextSize(execution);
    expect(JSON.stringify(execution)).toBe(before);
  });
});
