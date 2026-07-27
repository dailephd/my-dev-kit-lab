import { describe, expect, it } from "vitest";
import { calculateOwnerMetrics } from "../../../src/evaluation/stageContextMetrics/calculateOwnerMetrics.js";
import type { SelectedOwnerEvidenceV1 } from "../../../src/evaluation/stageContextMetrics/producerReadinessMetricTypes.js";
import type { ProducerReadinessOwnerExpectationV1 } from "../../../src/evaluation/stageContextExpectations/index.js";

function owner(ownerId: string): SelectedOwnerEvidenceV1 {
  return { ownerId, sourceArtifact: "context-capsule", sourceInstance: "instance", itemKind: "file", path: ownerId, symbolId: null, sourceFieldPath: "instance.selectedOwners" };
}

function expectation(overrides: Partial<ProducerReadinessOwnerExpectationV1>): ProducerReadinessOwnerExpectationV1 {
  return { expectationId: "OWNER-REQ-001", inclusion: "required", sourceArtifact: "context-capsule", ownerId: "src/a.ts", notes: [], ...overrides };
}

describe("calculateOwnerMetrics", () => {
  // TST-B2-007
  it("expected owner present", () => {
    const result = calculateOwnerMetrics([owner("src/a.ts")], [expectation({ inclusion: "required", ownerId: "src/a.ts" })]);
    expect(result.expectedOwnerPresent).toMatchObject({ availability: "available", numerator: 1, denominator: 1, rate: 1 });
  });

  // TST-B2-008
  it("expected owner is missing and produces one false negative", () => {
    const result = calculateOwnerMetrics([owner("src/other.ts")], [expectation({ inclusion: "required", ownerId: "src/a.ts" })]);
    expect(result.expectedOwnerPresent).toMatchObject({ availability: "available", numerator: 0, denominator: 1 });
    expect(result.falseNegativeCount).toMatchObject({ availability: "available", count: 1, evidenceKeys: ["src/a.ts"] });
  });

  // TST-B2-009
  it("forbidden owner is present and produces one false positive", () => {
    const result = calculateOwnerMetrics([owner("src/bad.ts")], [expectation({ inclusion: "forbidden", ownerId: "src/bad.ts" })]);
    expect(result.forbiddenOwnerPresent).toMatchObject({ availability: "available", numerator: 1, denominator: 1 });
    expect(result.falsePositiveCount).toMatchObject({ availability: "available", count: 1, evidenceKeys: ["src/bad.ts"] });
  });

  // TST-B2-010
  it("a valid zero false-positive count is available zero", () => {
    const result = calculateOwnerMetrics(
      [owner("src/a.ts")],
      [expectation({ inclusion: "required", ownerId: "src/a.ts" }), expectation({ expectationId: "OWNER-FORBID-001", inclusion: "forbidden", ownerId: "src/bad.ts" })]
    );
    expect(result.falsePositiveCount).toEqual({ availability: "available", count: 0, evidenceKeys: [], reason: null });
  });

  // TST-B2-011
  it("a valid zero false-negative count is available zero", () => {
    const result = calculateOwnerMetrics([owner("src/a.ts")], [expectation({ inclusion: "required", ownerId: "src/a.ts" })]);
    expect(result.falseNegativeCount).toEqual({ availability: "available", count: 0, evidenceKeys: [], reason: null });
  });

  // TST-B2-012
  it("missing selected-owner evidence reports unavailable", () => {
    const result = calculateOwnerMetrics(undefined, [expectation({ inclusion: "required", ownerId: "src/a.ts" })]);
    expect(result.expectedOwnerPresent.availability).toBe("unavailable");
    expect(result.falsePositiveCount.availability).toBe("unavailable");
    expect(result.falseNegativeCount.availability).toBe("unavailable");
  });

  // TST-B2-013
  it("no owner expectations reports not applicable", () => {
    const result = calculateOwnerMetrics([owner("src/a.ts")], undefined);
    expect(result.expectedOwnerPresent.availability).toBe("not-applicable");
    expect(result.forbiddenOwnerPresent.availability).toBe("not-applicable");
    expect(result.falsePositiveCount.availability).toBe("not-applicable");
    expect(result.falseNegativeCount.availability).toBe("not-applicable");
  });

  // TST-B2-014
  it("an allowed owner does not count as a false positive", () => {
    const result = calculateOwnerMetrics(
      [owner("src/allowed.ts")],
      [expectation({ inclusion: "required", ownerId: "src/a.ts" }), expectation({ expectationId: "OWNER-ALLOW-001", inclusion: "allowed", ownerId: "src/allowed.ts" })]
    );
    expect(result.falsePositiveCount).toEqual({ availability: "available", count: 0, evidenceKeys: [], reason: null });
  });

  it("exposes selected owner evidence verbatim", () => {
    const evidence = [owner("src/a.ts"), owner("src/b.ts")];
    const result = calculateOwnerMetrics(evidence, undefined);
    expect(result.selectedOwnerEvidence).toEqual(evidence);
  });
});
