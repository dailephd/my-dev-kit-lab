import { describe, expect, it } from "vitest";
import { readMyDevKitRetrievalAuditRecordV1 } from "../../../src/evaluation/upstreamArtifacts/index.js";
import { collectRetrievalAuditEvidence } from "../../../src/evaluation/stageContextMetrics/collectRetrievalAuditEvidence.js";
import type { RetrievalAuditRecord } from "../../../src/evaluation/upstreamArtifacts/index.js";

const AUDIT_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/retrieval-audit-record/complete-v1.0.0.json";

async function loadAudit(): Promise<RetrievalAuditRecord> {
  const result = await readMyDevKitRetrievalAuditRecordV1(AUDIT_FIXTURE_PATH);
  if (!result.ok) throw new Error("fixture read failed unexpectedly");
  return result.artifact;
}

describe("collectRetrievalAuditEvidence", () => {
  it("MET-050 responsibility IDs produce production-responsibility evidence", async () => {
    const artifact = await loadAudit();
    const evidence = collectRetrievalAuditEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) =>
          e.category === "production-responsibility" &&
          e.targetKey === "retrieval-audit-record|production-responsibility|responsibilityId:fixture.responsibility.001"
      )
    ).toBe(true);
  });

  it("MET-051 provenance evidence IDs produce provenance evidence", async () => {
    const artifact = await loadAudit();
    const evidence = collectRetrievalAuditEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) =>
          e.category === "provenance" &&
          e.targetKey === "retrieval-audit-record|provenance|evidenceId:symbol:src/example.ts#Example"
      )
    ).toBe(true);
  });

  it("MET-052 no file evidence is produced", async () => {
    const artifact = await loadAudit();
    const evidence = collectRetrievalAuditEvidence(artifact, "instance");
    expect(evidence.some((e) => e.category === "file")).toBe(false);
  });

  it("MET-053 no symbol evidence is produced", async () => {
    const artifact = await loadAudit();
    const evidence = collectRetrievalAuditEvidence(artifact, "instance");
    expect(evidence.some((e) => e.category === "symbol")).toBe(false);
  });

  it("MET-054 no source-range evidence is produced", async () => {
    const artifact = await loadAudit();
    const evidence = collectRetrievalAuditEvidence(artifact, "instance");
    expect(evidence.some((e) => e.category === "source-range")).toBe(false);
  });

  it("MET-055 no unnecessary-read evidence is produced", async () => {
    const artifact = await loadAudit();
    const evidence = collectRetrievalAuditEvidence(artifact, "instance");
    expect(evidence.every((e) => !e.targetKey.toLowerCase().includes("unnecessary"))).toBe(true);
  });

  it("MET-056 no considered-but-unselected-read evidence is produced", async () => {
    const artifact = await loadAudit();
    const evidence = collectRetrievalAuditEvidence(artifact, "instance");
    expect(evidence.every((e) => !e.targetKey.toLowerCase().includes("considered"))).toBe(true);
  });

  it("MET-057 array order is preserved", async () => {
    const artifact = await loadAudit();
    artifact.responsibilityMappings.mappings = [
      { ...artifact.responsibilityMappings.mappings[0], responsibilityId: "resp.a" },
      { ...artifact.responsibilityMappings.mappings[0], responsibilityId: "resp.b" }
    ];
    const evidence = collectRetrievalAuditEvidence(artifact, "instance");
    const responsibilityEvidence = evidence.filter((e) => e.category === "production-responsibility");
    expect(responsibilityEvidence.map((e) => e.targetKey)).toEqual([
      "retrieval-audit-record|production-responsibility|responsibilityId:resp.a",
      "retrieval-audit-record|production-responsibility|responsibilityId:resp.b"
    ]);
  });

  it("MET-058 the artifact is not mutated", async () => {
    const artifact = await loadAudit();
    const before = JSON.stringify(artifact);
    collectRetrievalAuditEvidence(artifact, "instance");
    expect(JSON.stringify(artifact)).toBe(before);
  });
});
