import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readMyDevKitContextCapsuleV1 } from "../../../src/evaluation/upstreamArtifacts/readMyDevKitContextCapsuleV1.js";
import { validateMyDevKitContextCapsuleV1 } from "../../../src/evaluation/upstreamArtifacts/validateMyDevKitContextCapsuleV1.js";
import type { JsonObject } from "../../../src/evaluation/upstreamArtifacts/jsonTypes.js";
import {
  CONTEXT_CAPSULE_ENUM_CASES,
  CONTEXT_CAPSULE_NULLABLE_FIELD_PATHS,
  CONTEXT_CAPSULE_OPTIONAL_FIELD_PATHS,
  CONTEXT_CAPSULE_REQUIRED_FIELD_PATHS,
  deleteFieldAtPath,
  setFieldAtPath
} from "./schemaCases.js";

const COMPLETE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";
const FUTURE_MINOR_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/future-minor-v1.1.0-additive.json";
const SOURCE_PATH = "fixture-context-capsule.json";

function loadFixture(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

describe("readMyDevKitContextCapsuleV1", () => {
  it("succeeds for the complete fixture", async () => {
    const result = await readMyDevKitContextCapsuleV1(COMPLETE_PATH);
    expect(result.ok).toBe(true);
  });

  it("returns the same object reference for artifact and rawArtifact", async () => {
    const result = await readMyDevKitContextCapsuleV1(COMPLETE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact).toBe(result.rawArtifact);
  });

  it("succeeds for the future-minor additive fixture", async () => {
    const result = await readMyDevKitContextCapsuleV1(FUTURE_MINOR_PATH);
    expect(result.ok).toBe(true);
  });

  it("preserves unknown root and nested additive fields", async () => {
    const result = await readMyDevKitContextCapsuleV1(FUTURE_MINOR_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.artifact as unknown as Record<string, unknown>).futureMinorRootField).toBe("preserved");
      expect((result.artifact.tool as unknown as Record<string, unknown>).futureNestedField).toBe("preserved");
    }
  });
});

describe("validateMyDevKitContextCapsuleV1 field requirements", () => {
  const fixture = loadFixture(COMPLETE_PATH);

  it.each(CONTEXT_CAPSULE_REQUIRED_FIELD_PATHS)("fails when required field %s is removed", (fieldPath) => {
    const mutated = deleteFieldAtPath(fixture, fieldPath);
    const result = validateMyDevKitContextCapsuleV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(false);
  });

  it.each(CONTEXT_CAPSULE_OPTIONAL_FIELD_PATHS)("succeeds when optional field %s is removed", (fieldPath) => {
    const mutated = deleteFieldAtPath(fixture, fieldPath);
    const result = validateMyDevKitContextCapsuleV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(true);
  });

  it.each(CONTEXT_CAPSULE_NULLABLE_FIELD_PATHS)("succeeds when nullable field %s is set to null", (fieldPath) => {
    const mutated = setFieldAtPath(fixture, fieldPath, null);
    const result = validateMyDevKitContextCapsuleV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(true);
  });

  it.each(CONTEXT_CAPSULE_ENUM_CASES)("fails when $fieldPath has an invalid enum value", ({ fieldPath, invalidValue }) => {
    const mutated = setFieldAtPath(fixture, fieldPath, invalidValue);
    const result = validateMyDevKitContextCapsuleV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LITERAL_VALUE");
  });
});

describe("validateMyDevKitContextCapsuleV1 exact-mirror behavior", () => {
  const fixture = loadFixture(COMPLETE_PATH);

  it("accepts an open string union value not in the closed literal list", () => {
    const mutated = setFieldAtPath(fixture, "candidateFiles[0].classificationRoles[0].role", "brand-new-classification-role");
    const result = validateMyDevKitContextCapsuleV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(true);
  });

  it("preserves array order", () => {
    const result = validateMyDevKitContextCapsuleV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.selectedGraph.nodes.map((n) => n.nodeId)).toEqual([
        "symbol:src/example.ts#Example",
        "file:src/example.ts"
      ]);
    }
  });

  it("preserves Record keys and values", () => {
    const result = validateMyDevKitContextCapsuleV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.semanticSummary.summariesByNode).toHaveProperty("symbol:src/example.ts#Example");
      expect(result.artifact.candidateNodes[0].androidMetadata).toEqual({
        packageName: "com.fixture.app",
        minSdk: 21,
        usesCleartextTraffic: false,
        notes: null
      });
    }
  });

  it("preserves a null freshness compared-identity value rather than dropping the entry", () => {
    const result = validateMyDevKitContextCapsuleV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.freshness.comparedIdentities).toEqual([
        { label: "index-manifest-hash", value: "fixture-hash-001" },
        { label: "before-index-manifest-hash", value: null }
      ]);
    }
  });

  it("keeps freshness.reason as a singular string and comparedIdentities as an array (not a Record)", () => {
    const result = validateMyDevKitContextCapsuleV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.artifact.freshness.reason).toBe("string");
      expect(Array.isArray(result.artifact.freshness.comparedIdentities)).toBe(true);
    }
  });

  it("keeps contextAdequacy and roleAdequacy as separate objects", () => {
    const result = validateMyDevKitContextCapsuleV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.contextAdequacy).not.toBe(result.artifact.roleAdequacy as unknown);
      expect(result.artifact.contextAdequacy.status).toBeDefined();
      expect(result.artifact.roleAdequacy.status).toBeDefined();
    }
  });

  it("keeps contextAdequacy.gaps named gaps, not reasons", () => {
    const result = validateMyDevKitContextCapsuleV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.contextAdequacy.gaps).toEqual(["Fixture gap."]);
      expect((result.artifact.contextAdequacy as unknown as Record<string, unknown>).reasons).toBeUndefined();
    }
  });

  it("keeps roleContext.changedSurface nested under roleContext, not promoted to root", () => {
    const result = validateMyDevKitContextCapsuleV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.roleContext.changedSurface.available).toBe(true);
      expect((result.artifact as unknown as Record<string, unknown>).changedSurface).toBeUndefined();
    }
  });

  it("preserves duplicate my-dev-kit candidate-node IDs rather than rejecting them", () => {
    const withDuplicate: JsonObject = JSON.parse(JSON.stringify(fixture));
    (withDuplicate.candidateNodes as unknown[]).push((withDuplicate.candidateNodes as unknown[])[0]);
    const result = validateMyDevKitContextCapsuleV1(withDuplicate, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.candidateNodes).toHaveLength(2);
  });

  it("does not normalize any path (backslashes and leading ./ survive untouched)", () => {
    const mutated = setFieldAtPath(fixture, "candidateFiles[0].path", ".\\src\\example.ts");
    const result = validateMyDevKitContextCapsuleV1(mutated, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.candidateFiles[0].path).toBe(".\\src\\example.ts");
  });

  it("does not add or rename fields relative to the raw parsed object", () => {
    const result = validateMyDevKitContextCapsuleV1(fixture, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact).toEqual(fixture);
  });
});
