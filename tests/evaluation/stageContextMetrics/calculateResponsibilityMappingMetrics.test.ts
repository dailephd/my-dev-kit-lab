import { describe, expect, it } from "vitest";
import { readMyDevKitContextCapsuleV1, readMyDevKitRetrievalAuditRecordV1 } from "../../../src/evaluation/upstreamArtifacts/index.js";
import {
  calculateContextCapsuleResponsibilityMappingMetric,
  calculateRetrievalAuditResponsibilityMappingMetric
} from "../../../src/evaluation/stageContextMetrics/calculateResponsibilityMappingMetrics.js";
import type { ContextCapsule, RetrievalAuditRecord } from "../../../src/evaluation/upstreamArtifacts/index.js";

const CAPSULE_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";
const AUDIT_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/retrieval-audit-record/complete-v1.0.0.json";

async function loadCapsule(): Promise<ContextCapsule> {
  const result = await readMyDevKitContextCapsuleV1(CAPSULE_FIXTURE_PATH);
  if (!result.ok) throw new Error("fixture read failed unexpectedly");
  return result.artifact;
}

async function loadAudit(): Promise<RetrievalAuditRecord> {
  const result = await readMyDevKitRetrievalAuditRecordV1(AUDIT_FIXTURE_PATH);
  if (!result.ok) throw new Error("fixture read failed unexpectedly");
  return result.artifact;
}

function withMappingStatuses(base: ContextCapsule, statuses: string[]): ContextCapsule {
  const clone = structuredClone(base);
  clone.responsibilityMappings.mappings = statuses.map((status, index) => ({
    ...clone.responsibilityMappings.mappings[0],
    responsibilityId: `resp.${index}`,
    mappingStatus: status as ContextCapsule["responsibilityMappings"]["mappings"][number]["mappingStatus"]
  }));
  return clone;
}

describe("calculateContextCapsuleResponsibilityMappingMetric", () => {
  it("MET-138 mapped count is exact", async () => {
    const artifact = withMappingStatuses(await loadCapsule(), ["mapped", "mapped", "unmapped"]);
    const metric = calculateContextCapsuleResponsibilityMappingMetric(artifact, "instance");
    expect(metric.mappedCount).toBe(2);
  });

  it("MET-139 partially mapped count is exact", async () => {
    const artifact = withMappingStatuses(await loadCapsule(), ["partially-mapped", "partially-mapped"]);
    const metric = calculateContextCapsuleResponsibilityMappingMetric(artifact, "instance");
    expect(metric.partiallyMappedCount).toBe(2);
  });

  it("MET-140 unmapped count is exact", async () => {
    const artifact = withMappingStatuses(await loadCapsule(), ["unmapped", "unmapped", "unmapped"]);
    const metric = calculateContextCapsuleResponsibilityMappingMetric(artifact, "instance");
    expect(metric.unmappedCount).toBe(3);
  });

  it("MET-141 not-applicable count is exact", async () => {
    const artifact = withMappingStatuses(await loadCapsule(), ["not-applicable"]);
    const metric = calculateContextCapsuleResponsibilityMappingMetric(artifact, "instance");
    expect(metric.notApplicableCount).toBe(1);
  });

  it("MET-142 denominator excludes not-applicable", async () => {
    const artifact = withMappingStatuses(await loadCapsule(), ["mapped", "not-applicable", "unmapped"]);
    const metric = calculateContextCapsuleResponsibilityMappingMetric(artifact, "instance");
    expect(metric.denominator).toBe(2);
  });

  it("MET-143 mapped rate assigns no partial credit", async () => {
    const artifact = withMappingStatuses(await loadCapsule(), ["mapped", "partially-mapped"]);
    const metric = calculateContextCapsuleResponsibilityMappingMetric(artifact, "instance");
    expect(metric.mappedRate).toBe(0.5);
  });

  it("MET-144 zero denominator produces mappedRate null", async () => {
    const artifact = withMappingStatuses(await loadCapsule(), ["not-applicable"]);
    const metric = calculateContextCapsuleResponsibilityMappingMetric(artifact, "instance");
    expect(metric.mappedRate).toBeNull();
  });

  it("MET-145 requested and operational are preserved", async () => {
    const artifact = await loadCapsule();
    artifact.responsibilityMappings.requested = true;
    artifact.responsibilityMappings.operational = false;
    const metric = calculateContextCapsuleResponsibilityMappingMetric(artifact, "instance");
    expect(metric.requested).toBe(true);
    expect(metric.operational).toBe(false);
  });

  it("MET-146 mappings are not deduplicated", async () => {
    const artifact = withMappingStatuses(await loadCapsule(), ["mapped", "mapped"]);
    artifact.responsibilityMappings.mappings[1].responsibilityId = artifact.responsibilityMappings.mappings[0].responsibilityId;
    const metric = calculateContextCapsuleResponsibilityMappingMetric(artifact, "instance");
    expect(metric.mappedCount).toBe(2);
  });

  it("MET-148a artifacts are not mutated", async () => {
    const artifact = await loadCapsule();
    const before = JSON.stringify(artifact);
    calculateContextCapsuleResponsibilityMappingMetric(artifact, "instance");
    expect(JSON.stringify(artifact)).toBe(before);
  });
});

describe("calculateRetrievalAuditResponsibilityMappingMetric", () => {
  it("MET-147 capsule and audit metrics remain separate", async () => {
    const capsule = await loadCapsule();
    const audit = await loadAudit();
    const capsuleMetric = calculateContextCapsuleResponsibilityMappingMetric(capsule, "capsule-instance");
    const auditMetric = calculateRetrievalAuditResponsibilityMappingMetric(audit, "audit-instance");
    expect(capsuleMetric.sourceArtifact).toBe("context-capsule");
    expect(auditMetric.sourceArtifact).toBe("retrieval-audit-record");
    expect(capsuleMetric).not.toBe(auditMetric);
  });

  it("MET-148 artifacts are not mutated", async () => {
    const audit = await loadAudit();
    const before = JSON.stringify(audit);
    calculateRetrievalAuditResponsibilityMappingMetric(audit, "instance");
    expect(JSON.stringify(audit)).toBe(before);
  });
});
