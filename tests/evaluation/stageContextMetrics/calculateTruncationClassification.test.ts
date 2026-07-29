import { describe, expect, it } from "vitest";
import { classifyTruncationRecord, classifyTruncationRecords } from "../../../src/evaluation/stageContextMetrics/calculateTruncationClassification.js";
import type { TruncationRecord } from "../../../src/evaluation/upstreamArtifacts/index.js";

function record(overrides: Partial<TruncationRecord>): TruncationRecord {
  return {
    id: "trunc.001",
    affectedGroup: "implementation-owners",
    limit: 10,
    used: 5,
    available: 5,
    droppedCount: 0,
    droppedEvidenceIds: [],
    requiredEvidenceLost: false,
    adequacyImpact: null,
    reason: "within declared limit",
    ...overrides
  };
}

describe("classifyTruncationRecord", () => {
  // TST-B2-022
  it("detects avoidable required truncation when used remains below the declared limit", () => {
    const result = classifyTruncationRecord(
      record({ requiredEvidenceLost: true, limit: 10, used: 6, droppedEvidenceIds: ["req.1"] }),
      "context-capsule",
      "instance"
    );
    expect(result).toMatchObject({ cause: "avoidable", availability: "available", omittedRequiredEvidenceIds: ["req.1"] });
  });

  // TST-B2-023 (borrowable capacity is not exposed by the frozen contract; avoidability is
  // proven here purely from headroom under the declared limit, the only authoritative signal
  // my-dev-kit exposes)
  it("still classifies avoidable when headroom exists even without separate borrow evidence", () => {
    const result = classifyTruncationRecord(record({ requiredEvidenceLost: true, limit: 20, used: 1 }), "context-capsule", "instance");
    expect(result.cause).toBe("avoidable");
  });

  // TST-B2-024
  it("detects genuine hard-limit truncation when the limit is exhausted", () => {
    const result = classifyTruncationRecord(record({ requiredEvidenceLost: true, limit: 10, used: 10 }), "context-capsule", "instance");
    expect(result).toMatchObject({ cause: "genuine-hard-limit", availability: "available" });
  });

  it("treats used exceeding the limit as genuine hard-limit exhaustion too", () => {
    const result = classifyTruncationRecord(record({ requiredEvidenceLost: true, limit: 10, used: 11 }), "context-capsule", "instance");
    expect(result.cause).toBe("genuine-hard-limit");
  });

  // TST-B2-025
  it("missing required evidence alone (no requiredEvidenceLost signal) does not prove avoidable truncation", () => {
    const result = classifyTruncationRecord(record({ requiredEvidenceLost: false, limit: 10, used: 3 }), "context-capsule", "instance");
    expect(result.cause).toBe("none");
  });

  // TST-B2-026
  it("insufficient allocation evidence (no declared limit) produces unresolved truncation cause", () => {
    const result = classifyTruncationRecord(record({ requiredEvidenceLost: true, limit: null }), "context-capsule", "instance");
    expect(result).toMatchObject({ cause: "unresolved", availability: "available" });
  });

  // TST-B2-027
  it("no truncation produces an available, non-blocking result", () => {
    const result = classifyTruncationRecord(record({ requiredEvidenceLost: false }), "context-capsule", "instance");
    expect(result).toMatchObject({ cause: "none", availability: "available" });
    expect(result.omittedRequiredEvidenceIds).toEqual([]);
  });

  // TST-B2-028
  it("a strategy with no truncation records at all produces an empty (not-applicable) classification set", () => {
    expect(classifyTruncationRecords([], "context-capsule", "instance")).toEqual([]);
  });
});
