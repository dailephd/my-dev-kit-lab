import { describe, expect, it } from "vitest";
import { readMyDevKitContextCapsuleV1 } from "../../../src/evaluation/upstreamArtifacts/readMyDevKitContextCapsuleV1.js";
import { readMyDevKitRetrievalAuditRecordV1 } from "../../../src/evaluation/upstreamArtifacts/readMyDevKitRetrievalAuditRecordV1.js";
import type { ContextCapsule, RetrievalAuditRecord } from "../../../src/evaluation/upstreamArtifacts/index.js";
import {
  checkMyDevKitContextArtifactConsistency,
  type MyDevKitContextArtifactConsistencyFieldPath
} from "../../../src/evaluation/stageContextSelectors/contextArtifactConsistency.js";

const CAPSULE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";
const AUDIT_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/retrieval-audit-record/complete-v1.0.0.json";

const EXPECTED_FIELD_ORDER: MyDevKitContextArtifactConsistencyFieldPath[] = [
  "schemaVersion",
  "tool",
  "request",
  "index.indexPath",
  "index.manifestPath",
  "contextAdequacy",
  "roleContext",
  "responsibilityMappings",
  "roleAdequacy",
  "freshness",
  "budget",
  "truncation",
  "fullFileFallback",
  "provenance"
];

async function loadMatchingArtifacts(): Promise<{ capsule: ContextCapsule; audit: RetrievalAuditRecord }> {
  const capsuleResult = await readMyDevKitContextCapsuleV1(CAPSULE_PATH);
  const auditResult = await readMyDevKitRetrievalAuditRecordV1(AUDIT_PATH);
  if (!capsuleResult.ok || !auditResult.ok) throw new Error("fixture read failed unexpectedly");
  const capsule = capsuleResult.artifact;
  const audit = structuredClone(auditResult.artifact);

  (audit as unknown as Record<string, unknown>).schemaVersion = capsule.schemaVersion;
  audit.tool = structuredClone(capsule.tool);
  audit.request = structuredClone(capsule.request);
  audit.index.indexPath = capsule.index.indexPath;
  audit.index.manifestPath = capsule.index.manifestPath;
  audit.contextAdequacy = structuredClone(capsule.contextAdequacy);
  audit.roleContext = structuredClone(capsule.roleContext);
  audit.responsibilityMappings = structuredClone(capsule.responsibilityMappings);
  audit.roleAdequacy = structuredClone(capsule.roleAdequacy);
  audit.freshness = structuredClone(capsule.freshness);
  audit.budget = structuredClone(capsule.budget);
  audit.truncation = structuredClone(capsule.truncation);
  audit.fullFileFallback = structuredClone(capsule.fullFileFallback);
  audit.provenance = structuredClone(capsule.provenance);

  return { capsule, audit };
}

describe("checkMyDevKitContextArtifactConsistency", () => {
  it("SEL-001 matching shared fields return consistent: true and no issues", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("SEL-002 a schemaVersion mismatch produces one issue with fieldPath schemaVersion", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    (audit as unknown as Record<string, unknown>).schemaVersion = "9.9.9";
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].fieldPath).toBe("schemaVersion");
  });

  it("SEL-003 a tool mismatch produces one issue with fieldPath tool", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.tool = { name: "other-tool", version: "9.9.9" };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].fieldPath).toBe("tool");
  });

  it("SEL-004 a request mismatch produces one issue with fieldPath request", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.request = { ...audit.request, originalQuery: "a different query" };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].fieldPath).toBe("request");
  });

  it("SEL-005 an index.indexPath mismatch produces one issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.index.indexPath = "Z:/fixture/different/.my-dev-kit";
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].fieldPath).toBe("index.indexPath");
  });

  it("SEL-006 an index.manifestPath mismatch produces one issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.index.manifestPath = "Z:/fixture/different/.my-dev-kit/manifest.json";
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].fieldPath).toBe("index.manifestPath");
  });

  it("SEL-007 a contextAdequacy mismatch produces one issue without merging or renaming adequacy fields", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.contextAdequacy = { ...audit.contextAdequacy, summary: "a different summary" };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].fieldPath).toBe("contextAdequacy");
    expect(result.issues[0].capsuleValue).toHaveProperty("status");
    expect(result.issues[0].capsuleValue).toHaveProperty("summary");
    expect(result.issues[0].capsuleValue).not.toHaveProperty("requiredConditions");
  });

  it("SEL-008 a roleContext mismatch produces one issue while changedSurface remains nested", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.roleContext = {
      ...audit.roleContext,
      changedSurface: { ...audit.roleContext.changedSurface, warnings: ["a different warning"] }
    };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].fieldPath).toBe("roleContext");
    expect(result.issues[0].capsuleValue).toHaveProperty("changedSurface");
    expect((result.issues[0].capsuleValue as unknown as { changedSurface: { files: unknown[] } }).changedSurface.files).toBeDefined();
  });

  it("SEL-009 a responsibilityMappings mismatch produces one issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.responsibilityMappings = { ...audit.responsibilityMappings, warnings: ["a different warning"] };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].fieldPath).toBe("responsibilityMappings");
  });

  it("SEL-010 a roleAdequacy mismatch produces one issue separate from contextAdequacy", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.roleAdequacy = { ...audit.roleAdequacy, warnings: ["a different warning"] };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].fieldPath).toBe("roleAdequacy");
  });

  it("SEL-011 a freshness mismatch produces one issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.freshness = { ...audit.freshness, relevantChangedPaths: ["src/different.ts"] };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].fieldPath).toBe("freshness");
  });

  it("SEL-012 changing freshness.state produces a freshness issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.freshness = { ...audit.freshness, state: "stale" };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.issues.map((issue) => issue.fieldPath)).toEqual(["freshness"]);
  });

  it("SEL-013 changing freshness.reason produces a freshness issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.freshness = { ...audit.freshness, reason: "a different reason" };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.issues.map((issue) => issue.fieldPath)).toEqual(["freshness"]);
  });

  it("SEL-014 changing comparedIdentities array order produces a freshness issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.freshness = {
      ...audit.freshness,
      comparedIdentities: [...audit.freshness.comparedIdentities].reverse()
    };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.issues.map((issue) => issue.fieldPath)).toEqual(["freshness"]);
  });

  it("SEL-015 changing a compared identity from null to a string produces a freshness issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.freshness = {
      ...audit.freshness,
      comparedIdentities: audit.freshness.comparedIdentities.map((identity) =>
        identity.value === null ? { ...identity, value: "no-longer-null" } : identity
      )
    };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.issues.map((issue) => issue.fieldPath)).toEqual(["freshness"]);
  });

  it("SEL-016 a budget mismatch produces one issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.budget = { ...audit.budget, warnings: ["a different warning"] };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.issues.map((issue) => issue.fieldPath)).toEqual(["budget"]);
  });

  it("SEL-017 a truncation mismatch produces one issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.truncation = { ...audit.truncation, warnings: ["a different warning"] };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.issues.map((issue) => issue.fieldPath)).toEqual(["truncation"]);
  });

  it("SEL-018 a fullFileFallback mismatch produces one issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.fullFileFallback = { ...audit.fullFileFallback, used: 999 };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.issues.map((issue) => issue.fieldPath)).toEqual(["fullFileFallback"]);
  });

  it("SEL-019 a provenance mismatch produces one issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.provenance = [...audit.provenance, { ...audit.provenance[0], id: "different.provenance.id" }];
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.issues.map((issue) => issue.fieldPath)).toEqual(["provenance"]);
  });

  it("SEL-020 multiple mismatches return every issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    (audit as unknown as Record<string, unknown>).schemaVersion = "9.9.9";
    audit.tool = { name: "other-tool", version: "9.9.9" };
    audit.freshness = { ...audit.freshness, state: "stale" };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(false);
    expect(result.issues).toHaveLength(3);
  });

  it("SEL-021 multiple issue order follows the exact order in Section 15", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.provenance = [{ ...audit.provenance[0], id: "different.provenance.id" }];
    audit.freshness = { ...audit.freshness, state: "stale" };
    (audit as unknown as Record<string, unknown>).schemaVersion = "9.9.9";
    audit.roleAdequacy = { ...audit.roleAdequacy, warnings: ["a different warning"] };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    const observedOrder = result.issues.map((issue) => issue.fieldPath);
    const expectedOrder = EXPECTED_FIELD_ORDER.filter((fieldPath) => observedOrder.includes(fieldPath));
    expect(observedOrder).toEqual(expectedOrder);
  });

  it("SEL-022 the exact deterministic issue message is used", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.budget = { ...audit.budget, warnings: ["a different warning"] };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.issues[0].message).toBe('ContextCapsule and RetrievalAuditRecord differ at "budget".');
  });

  it("SEL-023 generatedAt differences do not produce an issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.generatedAt = "2099-01-01T00:00:00.000Z";
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("SEL-024 warnings differences do not produce an issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.warnings = ["an unrelated audit-only warning"];
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("SEL-025 capsule-only field differences do not produce an issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    capsule.candidateFiles = [];
    capsule.selectedGraph = { ...capsule.selectedGraph, omittedNodeCount: 999 };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("SEL-026 audit steps, fallbacks, and recommendations do not produce an issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.steps = [];
    audit.fallbacks = ["an unrelated fallback"];
    audit.fullFileReadRecommendations = [];
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("SEL-027 object key insertion-order differences with equal values do not produce an issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.tool = { version: capsule.tool.version, name: capsule.tool.name };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.consistent).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("SEL-028 array element-order differences do produce an issue", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.provenance = [...audit.provenance].reverse();
    audit.provenance = [
      ...audit.provenance,
      { ...audit.provenance[0], id: "extra.provenance.id" },
      { ...audit.provenance[0], id: "extra.provenance.id.2" }
    ].reverse();
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.issues.map((issue) => issue.fieldPath)).toEqual(["provenance"]);
  });

  it("SEL-029 the function does not mutate the capsule", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    const before = JSON.stringify(capsule);
    audit.freshness = { ...audit.freshness, state: "stale" };
    checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(JSON.stringify(capsule)).toBe(before);
  });

  it("SEL-030 the function does not mutate the audit", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.freshness = { ...audit.freshness, state: "stale" };
    const before = JSON.stringify(audit);
    checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(JSON.stringify(audit)).toBe(before);
  });

  it("SEL-031 capsuleValue is the exact source value or reference", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.freshness = { ...audit.freshness, state: "stale" };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.issues[0].capsuleValue).toBe(capsule.freshness);
  });

  it("SEL-032 auditValue is the exact source value or reference", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    audit.freshness = { ...audit.freshness, state: "stale" };
    const result = checkMyDevKitContextArtifactConsistency(capsule, audit);
    expect(result.issues[0].auditValue).toBe(audit.freshness);
  });

  it("SEL-033 consistency diagnostics do not change reader success results", async () => {
    const { capsule, audit } = await loadMatchingArtifacts();
    checkMyDevKitContextArtifactConsistency(capsule, audit);
    const capsuleResult = await readMyDevKitContextCapsuleV1(CAPSULE_PATH);
    const auditResult = await readMyDevKitRetrievalAuditRecordV1(AUDIT_PATH);
    expect(capsuleResult.ok).toBe(true);
    expect(auditResult.ok).toBe(true);
  });
});
