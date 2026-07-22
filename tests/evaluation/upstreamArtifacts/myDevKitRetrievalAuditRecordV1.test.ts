import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readMyDevKitRetrievalAuditRecordV1 } from "../../../src/evaluation/upstreamArtifacts/readMyDevKitRetrievalAuditRecordV1.js";
import { validateMyDevKitRetrievalAuditRecordV1 } from "../../../src/evaluation/upstreamArtifacts/validateMyDevKitRetrievalAuditRecordV1.js";
import type { JsonObject } from "../../../src/evaluation/upstreamArtifacts/jsonTypes.js";
import {
  RETRIEVAL_AUDIT_RECORD_ENUM_CASES,
  RETRIEVAL_AUDIT_RECORD_NULLABLE_FIELD_PATHS,
  RETRIEVAL_AUDIT_RECORD_REQUIRED_FIELD_PATHS,
  deleteFieldAtPath,
  setFieldAtPath
} from "./schemaCases.js";

const COMPLETE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/retrieval-audit-record/complete-v1.0.0.json";
const FUTURE_MINOR_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/retrieval-audit-record/future-minor-v1.1.0-additive.json";
const SOURCE_PATH = "fixture-retrieval-audit-record.json";

function loadFixture(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

describe("readMyDevKitRetrievalAuditRecordV1", () => {
  it("succeeds for the complete fixture", async () => {
    const result = await readMyDevKitRetrievalAuditRecordV1(COMPLETE_PATH);
    expect(result.ok).toBe(true);
  });

  it("returns the same object reference for artifact and rawArtifact", async () => {
    const result = await readMyDevKitRetrievalAuditRecordV1(COMPLETE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact).toBe(result.rawArtifact);
  });

  it("succeeds for the future-minor additive fixture", async () => {
    const result = await readMyDevKitRetrievalAuditRecordV1(FUTURE_MINOR_PATH);
    expect(result.ok).toBe(true);
  });

  it("preserves unknown fields", async () => {
    const result = await readMyDevKitRetrievalAuditRecordV1(FUTURE_MINOR_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.artifact as unknown as Record<string, unknown>).futureMinorRootField).toBe("preserved");
    }
  });
});

describe("validateMyDevKitRetrievalAuditRecordV1 field requirements", () => {
  const fixture = loadFixture(COMPLETE_PATH);

  it.each(RETRIEVAL_AUDIT_RECORD_REQUIRED_FIELD_PATHS)("fails when required field %s is removed", (fieldPath) => {
    const mutated = deleteFieldAtPath(fixture, fieldPath);
    const result = validateMyDevKitRetrievalAuditRecordV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(false);
  });

  it.each(RETRIEVAL_AUDIT_RECORD_NULLABLE_FIELD_PATHS)("succeeds when nullable field %s is set to null", (fieldPath) => {
    const mutated = setFieldAtPath(fixture, fieldPath, null);
    const result = validateMyDevKitRetrievalAuditRecordV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(true);
  });

  it.each(RETRIEVAL_AUDIT_RECORD_ENUM_CASES)("fails when $fieldPath has an invalid enum value", ({ fieldPath, invalidValue }) => {
    const mutated = setFieldAtPath(fixture, fieldPath, invalidValue);
    const result = validateMyDevKitRetrievalAuditRecordV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LITERAL_VALUE");
  });
});

describe("validateMyDevKitRetrievalAuditRecordV1 exact-mirror behavior", () => {
  const fixture = loadFixture(COMPLETE_PATH);

  it("preserves primitive and null values in steps[].inputs and steps[].outputs", () => {
    const result = validateMyDevKitRetrievalAuditRecordV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.steps[0].inputs).toEqual({
        query: "Inspect task implementation and tests",
        mode: "feature-add",
        role: "implementation",
        notes: null
      });
      expect(result.artifact.steps[1].outputs).toEqual({ resultCount: 1, topScore: 12.5 });
    }
  });

  it("keeps fallbacks as an explicit empty array", () => {
    const result = validateMyDevKitRetrievalAuditRecordV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.fallbacks).toEqual([]);
  });

  it("keeps fullFileReadRecommendations as an array, including an 'unavailable' continuation marker", () => {
    const result = validateMyDevKitRetrievalAuditRecordV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.fullFileReadRecommendations).toHaveLength(2);
      expect(result.artifact.fullFileReadRecommendations[1].continuationOrExpansionAttempted).toBe("unavailable");
    }
  });

  it("keeps fullFileFallback.used as a number, not a boolean", () => {
    const result = validateMyDevKitRetrievalAuditRecordV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.fullFileFallback.used).toBe(1);
  });

  it("does not add a candidateFiles field", () => {
    const result = validateMyDevKitRetrievalAuditRecordV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.artifact as unknown as Record<string, unknown>).candidateFiles).toBeUndefined();
  });

  it("does not add a selectedSource field", () => {
    const result = validateMyDevKitRetrievalAuditRecordV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.artifact as unknown as Record<string, unknown>).selectedSource).toBeUndefined();
  });

  it("does not add an unnecessaryReads field", () => {
    const result = validateMyDevKitRetrievalAuditRecordV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.artifact as unknown as Record<string, unknown>).unnecessaryReads).toBeUndefined();
  });

  it("keeps contextAdequacy and roleAdequacy as separate objects", () => {
    const result = validateMyDevKitRetrievalAuditRecordV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.contextAdequacy).not.toBe(result.artifact.roleAdequacy as unknown);
    }
  });

  it("keeps freshness fields exact (state, singular reason, comparedIdentities array)", () => {
    const result = validateMyDevKitRetrievalAuditRecordV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.freshness.state).toBe("fresh");
      expect(typeof result.artifact.freshness.reason).toBe("string");
      expect(result.artifact.freshness.comparedIdentities).toEqual([
        { label: "index-manifest-hash", value: "fixture-hash-001" },
        { label: "before-index-manifest-hash", value: null }
      ]);
    }
  });

  it("preserves array order in steps", () => {
    const result = validateMyDevKitRetrievalAuditRecordV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.steps.map((s) => s.id)).toEqual(["fixture.step.001", "fixture.step.002", "fixture.step.003"]);
    }
  });

  it("preserves duplicate my-dev-kit provenance evidence IDs rather than rejecting them", () => {
    const withDuplicate: JsonObject = JSON.parse(JSON.stringify(fixture));
    (withDuplicate.provenance as unknown[]).push((withDuplicate.provenance as unknown[])[0]);
    const result = validateMyDevKitRetrievalAuditRecordV1(withDuplicate, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.provenance).toHaveLength(2);
  });
});
