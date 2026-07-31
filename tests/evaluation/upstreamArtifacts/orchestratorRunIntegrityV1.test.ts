import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readOrchestratorRunIntegrityEvidenceV1 } from "../../../src/evaluation/upstreamArtifacts/readOrchestratorRunIntegrityV1.js";
import { validateOrchestratorRunIntegrityEvidenceV1 } from "../../../src/evaluation/upstreamArtifacts/validateOrchestratorRunIntegrityV1.js";
import type { JsonObject } from "../../../src/evaluation/upstreamArtifacts/jsonTypes.js";

const READY_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.3/run-integrity/ready-pass-final-pass.json";
const REFRESH_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit-orchestrator/1.2.3/run-integrity/refresh-required-need-context.json";
const SOURCE_PATH = "fixture-run-integrity.json";

function loadFixture(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function setPath(fixture: JsonObject, path: string, value: unknown): JsonObject {
  const clone = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
  const segments = path.split(".");
  let cursor: unknown = clone;
  for (let i = 0; i < segments.length - 1; i++) cursor = (cursor as Record<string, unknown>)[segments[i]];
  (cursor as Record<string, unknown>)[segments[segments.length - 1]] = value;
  return clone as JsonObject;
}

function deletePath(fixture: JsonObject, path: string): JsonObject {
  const clone = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
  const segments = path.split(".");
  let cursor: unknown = clone;
  for (let i = 0; i < segments.length - 1; i++) cursor = (cursor as Record<string, unknown>)[segments[i]];
  delete (cursor as Record<string, unknown>)[segments[segments.length - 1]];
  return clone as JsonObject;
}

describe("readOrchestratorRunIntegrityEvidenceV1", () => {
  it("parses the ready/PASS/final-PASS fixture without field loss", async () => {
    const result = await readOrchestratorRunIntegrityEvidenceV1(READY_PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.gate.expectedJudgeVerdict).toBe("PASS");
    expect(result.artifact.judgeIntegrity?.authoredJudgeVerdict).toBe("PASS");
    expect(result.artifact.finalReportEligibility?.eligible).toBe(true);
    expect(result.artifact.lifecycle).toHaveLength(5);
  });

  it("returns the same object reference for artifact and rawArtifact", async () => {
    const result = await readOrchestratorRunIntegrityEvidenceV1(READY_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact).toBe(result.rawArtifact);
  });

  it("parses the refresh-required/NEED_CONTEXT fixture without field loss", async () => {
    const result = await readOrchestratorRunIntegrityEvidenceV1(REFRESH_PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.gate.readinessClassification).toBe("refresh-required");
    expect(result.artifact.gate.blockedStageNames).toEqual(["implementation"]);
    expect(result.artifact.judgeIntegrity?.acceptedCorrectionStage).toBe("implementation");
    expect(result.artifact.finalReportEligibility?.eligible).toBe(false);
    expect(result.artifact.finalArtifactPresent).toBe(false);
  });

  it("nested implementationContext/testContext reuse the exact Batch 1 readiness shape", async () => {
    const result = await readOrchestratorRunIntegrityEvidenceV1(READY_PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.gate.implementationContext?.decision).toBe("ready");
    expect(result.artifact.gate.testContext?.decision).toBe("ready");
  });
});

describe("validateOrchestratorRunIntegrityEvidenceV1 field requirements", () => {
  const fixture = loadFixture(READY_PATH);

  it("fails when the schema version is unsupported", () => {
    const mutated = setPath(fixture, "schemaVersion", "2.0.0");
    const result = validateOrchestratorRunIntegrityEvidenceV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_SCHEMA_MAJOR");
  });

  it("fails when gate is removed (required)", () => {
    const mutated = deletePath(fixture, "gate");
    const result = validateOrchestratorRunIntegrityEvidenceV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(false);
  });

  it("fails when lifecycle is removed (required)", () => {
    const mutated = deletePath(fixture, "lifecycle");
    const result = validateOrchestratorRunIntegrityEvidenceV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(false);
  });

  it("succeeds when judgeIntegrity is removed (optional -- earlier lifecycle stage)", () => {
    const mutated = deletePath(fixture, "judgeIntegrity");
    const result = validateOrchestratorRunIntegrityEvidenceV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.judgeIntegrity).toBeUndefined();
  });

  it("succeeds when finalReportEligibility is removed (optional)", () => {
    const mutated = deletePath(fixture, "finalReportEligibility");
    const result = validateOrchestratorRunIntegrityEvidenceV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.finalReportEligibility).toBeUndefined();
  });

  it("fails when authoredJudgeVerdict has an invalid enum value", () => {
    const mutated = setPath(fixture, "judgeIntegrity.authoredJudgeVerdict", "NOT_A_REAL_VERDICT");
    const result = validateOrchestratorRunIntegrityEvidenceV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LITERAL_VALUE");
  });

  it("fails when resolvedState has an invalid enum value", () => {
    const mutated = setPath(fixture, "lifecycle.0.resolvedState", "not-a-real-state");
    const result = validateOrchestratorRunIntegrityEvidenceV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(false);
  });

  it("fails when readinessClassification has an invalid enum value", () => {
    const mutated = setPath(fixture, "gate.readinessClassification", "not-a-real-classification");
    const result = validateOrchestratorRunIntegrityEvidenceV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(false);
  });

  it("does not fabricate a manual record: null stays null, never an empty object", () => {
    const result = validateOrchestratorRunIntegrityEvidenceV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.lifecycle[0].manualRecord).toBeNull();
  });

  it("does not add or rename fields relative to the raw parsed object", () => {
    const result = validateOrchestratorRunIntegrityEvidenceV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact).toEqual(fixture);
  });
});
