import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CAMPAIGN_DEPENDENCY_FILES, CAMPAIGN_SOURCE_FILES, campaignHash, createCampaignIdentity, compareCampaignIdentity } from "../../../src/experiments/plugins/agentSuccessRate/campaignIdentity.js";
import { createCampaignCheckpoint, projectCampaignTreatmentEvidence, requiredCampaignArtifacts, validateCampaignCheckpoint } from "../../../src/experiments/plugins/agentSuccessRate/campaignCheckpoint.js";
import { createCampaignCheckpointV2, campaignEpochNamespace, mapCampaignEpochEvidence, sealCampaignCheckpointV2, transitionCampaignCheckpointV2, validateCampaignCheckpointV2, validateCampaignHistoryV2 } from "../../../src/experiments/plugins/agentSuccessRate/campaignRecovery.js";
import { makeTask, makeTreatmentEvidence } from "./agentSuccessRateTestHelpers.js";

const task = makeTask(); const at = "2026-10-10T00:00:00.000Z";
function input() { return { tasks: [task], corpusBytes: Buffer.from("corpus"), projects: [{ projectId: "fixture", files: [{ path: "src/math.cjs", bytes: Buffer.from("source") }] }], sourceFiles: [...new Set([...CAMPAIGN_SOURCE_FILES, ...CAMPAIGN_DEPENDENCY_FILES])].map(path => ({ path, bytes: Buffer.from(path) })), config: { providerId: "deterministic-fixture" as const, timeoutMs: 1000, repairAttempts: 0 as const }, contextConfiguration: {}, retrievalConfiguration: {}, verifiedProviderObservation: null }; }
function initial() { return createCampaignCheckpointV2(createCampaignIdentity(input()), [task], "unit-run", at); }
function evaluated() {
  const a = initial(); const b = transitionCampaignCheckpointV2(a, [task], { kind: "reserve", index: 0, epochId: randomUUID() }, at);
  const c = transitionCampaignCheckpointV2(b, [task], { kind: "authorize", index: 0 }, at);
  const epoch = c.units[0]!.epochs[0]!; const evidence = projectCampaignTreatmentEvidence(makeTreatmentEvidence());
  const artifacts = requiredCampaignArtifacts(evidence, task).map(r => ({ ...r, path: `${epoch.namespace}/${r.path}`, sha256: campaignHash("fixture"), bytes: 7 }));
  const d = transitionCampaignCheckpointV2(c, [task], { kind: "terminal", index: 0, terminal: { outcome: "not-invoked", reason: "evaluated", evidence: mapCampaignEpochEvidence(evidence, epoch.namespace, "prefix"), artifacts } }, at);
  return { a, b, c, d };
}
describe("version two recovery contract", () => {
  it("RSP-001 closed versioned schema rejects unknown fields and oversized/deep content", () => {
    const cp = initial(); expect(cp.schemaVersion).toBe("my-dev-kit-lab-agent-success-rate-campaign-checkpoint-v2");
    expect(() => validateCampaignCheckpointV2(cp, [task])).not.toThrow();
    for (const mutated of [{ ...cp, schemaVersion: "unknown" }, { ...cp, stdout: "private" }, { ...cp, runId: "../unsafe" }, { ...cp, updatedAt: "invalid" }]) expect(() => validateCampaignCheckpointV2(mutated, [task])).toThrow();
    let nested: unknown = null; for (let i = 0; i < 30; i++) nested = { nested }; expect(() => validateCampaignCheckpointV2({ ...cp, nested }, [task])).toThrow();
  });
  it("RSP-002 historical version one stays separately valid and cannot decode as version two", () => {
    const cp = createCampaignCheckpoint(createCampaignIdentity(input()), [task], at); const before = JSON.stringify(cp);
    expect(() => validateCampaignCheckpoint(cp, [task])).not.toThrow(); expect(() => validateCampaignCheckpointV2(cp, [task])).toThrow(); expect(JSON.stringify(cp)).toBe(before);
  });
  it("RSP-004 identity is deterministic, proof-sensitive and never certifies absent source/provider bytes", () => {
    const a = createCampaignIdentity(input()); expect(a).toEqual(createCampaignIdentity(input()));
    const b = input(); b.sourceFiles[0]!.bytes = Buffer.from("same HEAD changed source"); expect(compareCampaignIdentity(a, createCampaignIdentity(b))).toBe("MISMATCH");
    expect(compareCampaignIdentity(a, createCampaignIdentity({ ...input(), corpusBytes: null }))).toBe("UNVERIFIABLE");
    const real = createCampaignIdentity({ ...input(), config: { providerId: "codex", timeoutMs: 1000, repairAttempts: 0 } }); expect(compareCampaignIdentity(real, real)).toBe("UNVERIFIABLE");
  });
  it("RSP-005 epoch identity and parent are immutable, ordered, bounded, and unique", () => {
    const { a, b, c, d } = evaluated(); expect(new Set([randomUUID(), randomUUID()]).size).toBe(2); expect(b.units[0]!.epochs[0]!.parentRevision).toBe(a.integrity);
    for (const [before, next] of [[a, b], [b, c], [c, d]] as const) expect(() => validateCampaignHistoryV2(before, next, [task])).not.toThrow();
    const bad = structuredClone(c); bad.units[0]!.epochs[0]!.id = randomUUID(); const { integrity: _i, ...body } = bad; expect(() => validateCampaignHistoryV2(b, sealCampaignCheckpointV2(body), [task])).toThrow();
  });
  it("RSP-006/RSP-007 reserved and authorized phases are separate exact revisions", () => {
    const { a, b, c } = evaluated(); expect(b.units[0]!.epochs[0]).toMatchObject({ phase: "reserved", authorizedAt: null, terminal: null }); expect(c.units[0]!.epochs[0]!.phase).toBe("invocation-authorized"); expect(c.parentIntegrity).toBe(b.integrity);
    expect(() => transitionCampaignCheckpointV2(a, [task], { kind: "authorize", index: 0 }, at)).toThrow(); expect(() => transitionCampaignCheckpointV2(c, [task], { kind: "authorize", index: 0 }, at)).toThrow();
  });
  it("RSP-009/RSP-019 uncertainty cannot be reserved again even with duplicate-risk acknowledgement", () => {
    const { c } = evaluated(); const uncertain = transitionCampaignCheckpointV2(c, [task], { kind: "uncertain", index: 0 }, at);
    expect(uncertain.units[0]!.state).toBe("uncertain"); expect(() => transitionCampaignCheckpointV2(uncertain, [task], { kind: "reserve", index: 0, epochId: randomUUID() }, at)).toThrow();
    expect(() => transitionCampaignCheckpointV2(uncertain, [task], { kind: "reserve", index: 0, epochId: randomUUID(), authorization: { identityDigest: uncertain.identity.digest, generation: uncertain.generation, revision: uncertain.integrity, caseId: task.id, treatmentId: "raw-full-file", acknowledgeInvocation: true, acknowledgeExternalLimit: true } }, at)).toThrow();
  });
  it("RSP-010/RSP-011 attempt paths are scoped to unique epochs and cannot escape", () => {
    const { c } = evaluated(); const first = c.units[0]!.epochs[0]!;
    const other = campaignEpochNamespace(task.id, "raw-full-file", 2, randomUUID());
    const e = makeTreatmentEvidence(); const a = mapCampaignEpochEvidence(e, first.namespace, "prefix"), b = mapCampaignEpochEvidence(e, other, "prefix");
    expect(a.proposedPatchPath).not.toBe(b.proposedPatchPath); expect(mapCampaignEpochEvidence(a, first.namespace, "strip")).toEqual(e);
    expect(() => mapCampaignEpochEvidence(a, other, "strip")).toThrow("EPOCH_ARTIFACT_SCOPE"); expect(() => campaignEpochNamespace("../bad", "raw-full-file", 1, randomUUID())).toThrow(); expect(() => campaignEpochNamespace(task.id, "raw-full-file", 3, randomUUID())).toThrow();
  });
  it("RSP-013 completed evaluation is immutable and cannot be replaced with favorable evidence", () => {
    const { c, d } = evaluated(); expect(() => transitionCampaignCheckpointV2(d, [task], { kind: "reserve", index: 0, epochId: randomUUID() }, at)).toThrow("COMPLETED_IMMUTABLE");
    const next = structuredClone(d); next.units[0]!.completion!.taskSuccess = false; const { integrity: _i, ...body } = next; expect(() => validateCampaignHistoryV2(c, sealCampaignCheckpointV2(body), [task])).toThrow();
  });
  it("RSP-026 rejects altered parent, generation, unit ordering and private terminal fields", () => {
    const { b, c, d } = evaluated(); for (const delta of [{ parentIntegrity: "0".repeat(64) }, { generation: 99 }, { runId: "replacement" }]) { const { integrity: _i, ...body } = { ...c, ...delta }; expect(() => validateCampaignHistoryV2(b, sealCampaignCheckpointV2(body), [task])).toThrow(); }
    const mutated = structuredClone(d); Object.assign(mutated.units[0]!.epochs[0]!.terminal!.evidence, { stdout: "secret" }); const { integrity: _i, ...body } = mutated; expect(() => validateCampaignCheckpointV2(sealCampaignCheckpointV2(body), [task])).toThrow();
  });
});
