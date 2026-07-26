import { describe, expect, it } from "vitest";
import { readMyDevKitContextCapsuleV1 } from "../../../src/evaluation/upstreamArtifacts/readMyDevKitContextCapsuleV1.js";
import { readMyDevKitRetrievalAuditRecordV1 } from "../../../src/evaluation/upstreamArtifacts/readMyDevKitRetrievalAuditRecordV1.js";
import { checkMyDevKitContextArtifactConsistency } from "../../../src/evaluation/stageContextSelectors/contextArtifactConsistency.js";

const FIXTURE_ROOT = "tests/fixtures/upstream-artifacts/my-dev-kit-1.10.2-identity";

async function readPair() {
  const capsule = await readMyDevKitContextCapsuleV1(`${FIXTURE_ROOT}/context-capsule.json`);
  const audit = await readMyDevKitRetrievalAuditRecordV1(`${FIXTURE_ROOT}/retrieval-audit-record.json`);
  if (!capsule.ok || !audit.ok) throw new Error("copied real producer fixture failed to parse");
  return { capsule: capsule.artifact, audit: audit.artifact };
}

describe("copied real my-dev-kit identity pair", () => {
  it("retains matching repository, active-index, and before/after identities", async () => {
    const { capsule, audit } = await readPair();
    expect(audit.index.projectRoot).toBe(capsule.index.projectRoot);
    expect(audit.index.indexPath).toBe(capsule.index.indexPath);
    expect(audit.index.manifestPath).toBe(capsule.index.manifestPath);
    expect(audit.index.manifestSchemaVersion).toBe(capsule.index.manifestSchemaVersion);
    expect(audit.freshness.comparedIdentities).toEqual(capsule.freshness.comparedIdentities);
    expect(checkMyDevKitContextArtifactConsistency(capsule, audit)).toEqual({
      consistent: true,
      issues: []
    });
  });

  it("is deterministic across repeated exact reads", async () => {
    expect(await readPair()).toEqual(await readPair());
  });

  it("detects copied wrong-repository and wrong-active-index pairs", async () => {
    const { capsule, audit } = await readPair();
    const wrongRepository = structuredClone(audit);
    wrongRepository.index.projectRoot = "Z:/Users/newuser/Projects/other";
    expect(checkMyDevKitContextArtifactConsistency(capsule, wrongRepository).issues.map((issue) => issue.fieldPath)).toEqual([
      "index.projectRoot"
    ]);

    const wrongIndex = structuredClone(audit);
    wrongIndex.index.indexPath = "Z:/Users/newuser/Projects/other/.my-dev-kit";
    expect(checkMyDevKitContextArtifactConsistency(capsule, wrongIndex).issues.map((issue) => issue.fieldPath)).toEqual([
      "index.indexPath"
    ]);
  });
});
