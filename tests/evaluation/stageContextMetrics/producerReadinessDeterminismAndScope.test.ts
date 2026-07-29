import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateOwnerMetrics } from "../../../src/evaluation/stageContextMetrics/calculateOwnerMetrics.js";
import { calculateCriticalityMetrics } from "../../../src/evaluation/stageContextMetrics/calculateCriticalityMetrics.js";
import type { SelectedOwnerEvidenceV1 } from "../../../src/evaluation/stageContextMetrics/producerReadinessMetricTypes.js";
import type { ProducerReadinessOwnerExpectationV1 } from "../../../src/evaluation/stageContextExpectations/index.js";

function owner(ownerId: string): SelectedOwnerEvidenceV1 {
  return { ownerId, sourceArtifact: "context-capsule", sourceInstance: "instance", itemKind: "file", path: ownerId, symbolId: null, sourceFieldPath: "instance.selectedOwners" };
}

describe("determinism", () => {
  // TST-B2-056 / TST-B2-057
  it("owner metric ordering and evidence-key references are deterministic across repeated calls", () => {
    const expectations: ProducerReadinessOwnerExpectationV1[] = [
      { expectationId: "OWNER-REQ-001", inclusion: "required", sourceArtifact: "context-capsule", ownerId: "src/a.ts", notes: [] },
      { expectationId: "OWNER-REQ-002", inclusion: "required", sourceArtifact: "context-capsule", ownerId: "src/b.ts", notes: [] }
    ];
    const evidence = [owner("src/b.ts")];
    const first = calculateOwnerMetrics(evidence, expectations);
    const second = calculateOwnerMetrics(evidence, expectations);
    expect(first.expectedOwnerPresent.matchedExpectationIds).toEqual(["src/a.ts", "src/b.ts"].filter((id) => evidence.some((e) => e.ownerId === id)));
    expect(first).toEqual(second);
  });

  // TST-B2-058
  it("repeated calculation over identical criticality inputs produces deeply equal output", () => {
    const mappings = [
      {
        responsibilityId: "resp.001",
        behavior: null,
        invariant: null,
        criticality: "critical" as const,
        productionSymbols: [],
        contracts: [],
        validators: [],
        constants: [],
        errors: [],
        sideEffectEvidence: [],
        proposedOrExistingTestFiles: [],
        reusableHelpers: [],
        oracleEvidence: [],
        testCommands: [],
        mappingStatus: "mapped" as const
      }
    ] as unknown as Parameters<typeof calculateCriticalityMetrics>[0];
    const expectations = [
      { expectationId: "CRIT-001", responsibilityId: "resp.001", expectedCriticality: "critical" as const, applicable: true, requiresFullMapping: true, notes: [] }
    ];
    const first = calculateCriticalityMetrics(mappings, expectations);
    const second = calculateCriticalityMetrics(mappings, expectations);
    expect(first).toEqual(second);
  });
});

describe("no composite score, grade, rank, or winner", () => {
  // TST-B2-059
  it("none of the Batch 2 metric-type or calculator source files declare a composite scoring field or function", () => {
    const files = [
      "src/evaluation/stageContextMetrics/producerReadinessMetricTypes.ts",
      "src/evaluation/stageContextMetrics/calculateOwnerMetrics.ts",
      "src/evaluation/stageContextMetrics/calculateAllocationMetrics.ts",
      "src/evaluation/stageContextMetrics/calculateTruncationClassification.ts",
      "src/evaluation/stageContextMetrics/calculateSupplementalRawAgreement.ts",
      "src/evaluation/stageContextMetrics/calculateReadinessAgreement.ts",
      "src/evaluation/stageContextMetrics/calculateCriticalityMetrics.ts"
    ];
    const forbiddenTerms = ["compositeScore", "overallScore", "grade", "ranking", "winner", "readinessVerdict", "aggregateScore"];
    for (const file of files) {
      const codeOnly = readFileSync(file, "utf8")
        .split(/\r\n|\n/)
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n")
        .toLowerCase();
      for (const term of forbiddenTerms) {
        expect(codeOnly).not.toContain(term.toLowerCase());
      }
    }
  });
});
