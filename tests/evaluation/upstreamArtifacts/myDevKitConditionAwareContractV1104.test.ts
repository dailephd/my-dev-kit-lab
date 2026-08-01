import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readMyDevKitContextCapsuleV1 } from "../../../src/evaluation/upstreamArtifacts/readMyDevKitContextCapsuleV1.js";
import { readMyDevKitRetrievalAuditRecordV1 } from "../../../src/evaluation/upstreamArtifacts/readMyDevKitRetrievalAuditRecordV1.js";
import { validateMyDevKitContextCapsuleV1 } from "../../../src/evaluation/upstreamArtifacts/validateMyDevKitContextCapsuleV1.js";
import { validateMyDevKitRetrievalAuditRecordV1 } from "../../../src/evaluation/upstreamArtifacts/validateMyDevKitRetrievalAuditRecordV1.js";
import { checkMyDevKitContextArtifactConsistency } from "../../../src/evaluation/stageContextSelectors/contextArtifactConsistency.js";
import type { JsonObject } from "../../../src/evaluation/upstreamArtifacts/jsonTypes.js";
import { deleteFieldAtPath, setFieldAtPath, type EnumCase } from "./schemaCases.js";

const CAPSULE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.4/context-capsule/complete-v1.0.0.json";
const AUDIT_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.4/retrieval-audit-record/complete-v1.0.0.json";
const LEGACY_CAPSULE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";
const LEGACY_AUDIT_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/retrieval-audit-record/complete-v1.0.0.json";
const CAPSULE_SOURCE = "fixture-context-capsule-v1104.json";
const AUDIT_SOURCE = "fixture-retrieval-audit-record-v1104.json";

function loadFixture(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

const ROLE_CONDITION_ENUM_CASES: EnumCase[] = [
  { fieldPath: "roleConditionCoverage[0].conditionId", invalidValue: "not-a-real-condition" },
  { fieldPath: "roleConditionCoverage[0].role", invalidValue: "not-a-real-role" },
  { fieldPath: "roleConditionCoverage[0].witnessPolicy", invalidValue: "not-a-real-policy" },
  { fieldPath: "roleConditionCoverage[0].lossReason", invalidValue: "not-a-real-loss-reason" }
];

describe("v1.10.4 condition-aware context capsule contract", () => {
  const fixture = loadFixture(CAPSULE_PATH);

  it("parses the v1.10.4 fixture without field loss", async () => {
    const result = await readMyDevKitContextCapsuleV1(CAPSULE_PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.roleConditionCoverage).toEqual(fixture.roleConditionCoverage);
    expect(result.artifact.groupTruncation).toEqual(fixture.groupTruncation);
  });

  it("preserves the exact allocation-evidence fields on groupTruncation entries", async () => {
    const result = await readMyDevKitContextCapsuleV1(CAPSULE_PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.artifact.groupTruncation[0];
    expect(entry.required).toBe(true);
    expect(entry.reservation).toBe(2);
    expect(entry.initiallySelectedCount).toBe(1);
    expect(entry.unusedReservationContributed).toBe(1);
    expect(entry.borrowedCapacity).toBe(0);
    expect(entry.requiredOmittedCount).toBe(0);
    expect(entry.optionalOmittedCount).toBe(0);
    expect(entry.adequacyAffected).toBe(false);
    expect(entry.governingHardBound).toBe(4);
    expect(entry.aggregateCapacityUsed).toBe(1);
    expect(entry.aggregateCapacityRemaining).toBe(3);
    expect(entry.droppedEvidenceIds).toEqual([]);
  });

  it("keeps a satisfied required condition distinct from an unsatisfied-but-not-lost condition", async () => {
    const result = await readMyDevKitContextCapsuleV1(CAPSULE_PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [ownerCondition, contractCondition] = result.artifact.roleConditionCoverage!;
    expect(ownerCondition.conditionSatisfied).toBe(true);
    expect(ownerCondition.lostRequiredCondition).toBe(false);
    // No evidence was ever available (availableWitnessCount 0 < requiredWitnessCount 1), so this
    // is an ordinary missing-evidence gap, never classified as a bounded-allocation loss.
    expect(contractCondition.conditionSatisfied).toBe(false);
    expect(contractCondition.availableWitnessCount).toBeLessThan(contractCondition.requiredWitnessCount);
    expect(contractCondition.lostRequiredCondition).toBe(false);
    expect(contractCondition.lossReason).toBeNull();
  });

  it("keeps a bounded-allocation last-adequate-witness loss distinct from a missing-evidence gap", () => {
    // Evidence was available at/above the required minimum, but bounded allocation retained
    // none of it: this is the genuine "lost" case, never independently recomputed here.
    const lostCondition = {
      ...(fixture.roleConditionCoverage as unknown[])[1] as JsonObject,
      availableWitnessCount: 2,
      retainedWitnessCount: 0,
      retainedWitnessIds: [],
      conditionSatisfied: false,
      lostRequiredCondition: true,
      lossReason: "bounded-allocation-omitted-required-witnesses"
    };
    const mutated = setFieldAtPath(fixture, "roleConditionCoverage[1]", lostCondition);
    const result = validateMyDevKitContextCapsuleV1(mutated, CAPSULE_SOURCE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const condition = result.artifact.roleConditionCoverage![1];
    expect(condition.lostRequiredCondition).toBe(true);
    expect(condition.lossReason).toBe("bounded-allocation-omitted-required-witnesses");
  });

  it("keeps requiredOmittedCount and optionalOmittedCount distinct rather than collapsing them into one truncated boolean", () => {
    const mutated = setFieldAtPath(fixture, "groupTruncation[0]", {
      ...(fixture.groupTruncation as unknown[])[0] as JsonObject,
      droppedCount: 3,
      requiredOmittedCount: 1,
      optionalOmittedCount: 2,
      adequacyAffected: true
    });
    const result = validateMyDevKitContextCapsuleV1(mutated, CAPSULE_SOURCE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.artifact.groupTruncation[0];
    expect(entry.requiredOmittedCount).toBe(1);
    expect(entry.optionalOmittedCount).toBe(2);
    expect(entry.adequacyAffected).toBe(true);
    expect(entry.droppedCount).toBe(3);
  });

  it("succeeds when the optional roleConditionCoverage field is removed", () => {
    const mutated = deleteFieldAtPath(fixture, "roleConditionCoverage");
    const result = validateMyDevKitContextCapsuleV1(mutated, CAPSULE_SOURCE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.roleConditionCoverage).toBeUndefined();
  });

  it("succeeds when the optional groupTruncation allocation fields are removed", () => {
    const mutated = deleteFieldAtPath(fixture, "groupTruncation[0].reservation");
    const result = validateMyDevKitContextCapsuleV1(mutated, CAPSULE_SOURCE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.groupTruncation[0].reservation).toBeUndefined();
  });

  it("fails when roleConditionCoverage is present but set to null (optional, not nullable)", () => {
    const mutated = setFieldAtPath(fixture, "roleConditionCoverage", null);
    const result = validateMyDevKitContextCapsuleV1(mutated, CAPSULE_SOURCE);
    expect(result.ok).toBe(false);
  });

  it.each(ROLE_CONDITION_ENUM_CASES)("fails when $fieldPath has an invalid enum value", ({ fieldPath, invalidValue }) => {
    const mutated = setFieldAtPath(fixture, fieldPath, invalidValue);
    const result = validateMyDevKitContextCapsuleV1(mutated, CAPSULE_SOURCE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LITERAL_VALUE");
  });

  it("fails when retainedWitnessIds is not an array of strings", () => {
    const mutated = setFieldAtPath(fixture, "roleConditionCoverage[0].retainedWitnessIds", "not-an-array");
    const result = validateMyDevKitContextCapsuleV1(mutated, CAPSULE_SOURCE);
    expect(result.ok).toBe(false);
  });

  it("produces deterministic output across repeated parses of the same fixture", () => {
    const first = validateMyDevKitContextCapsuleV1(loadFixture(CAPSULE_PATH), CAPSULE_SOURCE);
    const second = validateMyDevKitContextCapsuleV1(loadFixture(CAPSULE_PATH), CAPSULE_SOURCE);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.artifact).toEqual(second.artifact);
  });
});

describe("v1.10.4 condition-aware retrieval audit record contract", () => {
  const fixture = loadFixture(AUDIT_PATH);

  it("parses the v1.10.4 fixture without field loss", async () => {
    const result = await readMyDevKitRetrievalAuditRecordV1(AUDIT_PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.roleConditionCoverage).toEqual(fixture.roleConditionCoverage);
  });

  it("succeeds when the optional roleConditionCoverage field is removed", () => {
    const mutated = deleteFieldAtPath(fixture, "roleConditionCoverage");
    const result = validateMyDevKitRetrievalAuditRecordV1(mutated, AUDIT_SOURCE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.roleConditionCoverage).toBeUndefined();
  });

  it.each(ROLE_CONDITION_ENUM_CASES)("fails when $fieldPath has an invalid enum value", ({ fieldPath, invalidValue }) => {
    const mutated = setFieldAtPath(fixture, fieldPath, invalidValue);
    const result = validateMyDevKitRetrievalAuditRecordV1(mutated, AUDIT_SOURCE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LITERAL_VALUE");
  });
});

describe("v1.10.4 legacy schema-major-1 compatibility", () => {
  it("keeps roleConditionCoverage unavailable rather than fabricated for legacy capsules", async () => {
    const result = await readMyDevKitContextCapsuleV1(LEGACY_CAPSULE_PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.roleConditionCoverage).toBeUndefined();
    expect(result.artifact.groupTruncation[0].reservation).toBeUndefined();
    expect(result.artifact.groupTruncation[0].requiredOmittedCount).toBeUndefined();
  });

  it("keeps roleConditionCoverage unavailable rather than fabricated for legacy audits", async () => {
    const result = await readMyDevKitRetrievalAuditRecordV1(LEGACY_AUDIT_PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.roleConditionCoverage).toBeUndefined();
  });
});

describe("v1.10.4 capsule/audit condition-aware parity", () => {
  it("a matching v1.10.4 pair with identical roleConditionCoverage passes parity", async () => {
    const capsuleResult = await readMyDevKitContextCapsuleV1(CAPSULE_PATH);
    const auditResult = await readMyDevKitRetrievalAuditRecordV1(AUDIT_PATH);
    expect(capsuleResult.ok).toBe(true);
    expect(auditResult.ok).toBe(true);
    if (!capsuleResult.ok || !auditResult.ok) return;
    const result = checkMyDevKitContextArtifactConsistency(capsuleResult.artifact, auditResult.artifact);
    expect(result.consistent).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("a contradictory roleConditionCoverage between capsule and audit fails parity", async () => {
    const capsuleResult = await readMyDevKitContextCapsuleV1(CAPSULE_PATH);
    const auditResult = await readMyDevKitRetrievalAuditRecordV1(AUDIT_PATH);
    expect(capsuleResult.ok).toBe(true);
    expect(auditResult.ok).toBe(true);
    if (!capsuleResult.ok || !auditResult.ok) return;
    const audit = structuredClone(auditResult.artifact);
    audit.roleConditionCoverage = [{ ...audit.roleConditionCoverage![0], conditionSatisfied: false, lostRequiredCondition: true }];
    const result = checkMyDevKitContextArtifactConsistency(capsuleResult.artifact, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues.map((issue) => issue.fieldPath)).toEqual(["roleConditionCoverage"]);
  });

  it("one-sided roleConditionCoverage absence is a contradiction, never normalized to a match", async () => {
    const capsuleResult = await readMyDevKitContextCapsuleV1(CAPSULE_PATH);
    const auditResult = await readMyDevKitRetrievalAuditRecordV1(AUDIT_PATH);
    expect(capsuleResult.ok).toBe(true);
    expect(auditResult.ok).toBe(true);
    if (!capsuleResult.ok || !auditResult.ok) return;
    const audit = structuredClone(auditResult.artifact);
    delete (audit as { roleConditionCoverage?: unknown }).roleConditionCoverage;
    const result = checkMyDevKitContextArtifactConsistency(capsuleResult.artifact, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues.map((issue) => issue.fieldPath)).toEqual(["roleConditionCoverage"]);
  });

  it("both-absent roleConditionCoverage (legacy pair) is a compatible match, not a contradiction", async () => {
    const capsuleResult = await readMyDevKitContextCapsuleV1(LEGACY_CAPSULE_PATH);
    const auditResult = await readMyDevKitRetrievalAuditRecordV1(LEGACY_AUDIT_PATH);
    expect(capsuleResult.ok).toBe(true);
    expect(auditResult.ok).toBe(true);
    if (!capsuleResult.ok || !auditResult.ok) return;
    const audit = structuredClone(auditResult.artifact);
    const capsule = capsuleResult.artifact;
    // Sync the other shared fields so only roleConditionCoverage (both absent) is under test.
    audit.contextAdequacy = structuredClone(capsule.contextAdequacy);
    audit.roleContext = structuredClone(capsule.roleContext);
    audit.responsibilityMappings = structuredClone(capsule.responsibilityMappings);
    audit.roleAdequacy = structuredClone(capsule.roleAdequacy);
    audit.freshness = structuredClone(capsule.freshness);
    audit.truncation = structuredClone(capsule.truncation);
    audit.fullFileFallback = structuredClone(capsule.fullFileFallback);
    audit.provenance = structuredClone(capsule.provenance);
    (audit as unknown as Record<string, unknown>).schemaVersion = capsule.schemaVersion;
    audit.tool = structuredClone(capsule.tool);
    audit.request = structuredClone(capsule.request);
    audit.index.indexPath = capsule.index.indexPath;
    audit.index.manifestPath = capsule.index.manifestPath;
    audit.index.manifestSchemaVersion = capsule.index.manifestSchemaVersion;
    audit.index.projectRoot = capsule.index.projectRoot;
    audit.budget = structuredClone(capsule.budget);
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
