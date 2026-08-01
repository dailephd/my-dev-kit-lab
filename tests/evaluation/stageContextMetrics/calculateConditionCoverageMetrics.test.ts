import { describe, expect, it } from "vitest";
import { calculateConditionCoverageMetrics } from "../../../src/evaluation/stageContextMetrics/calculateConditionCoverageMetrics.js";
import type { RoleConditionCoverage } from "../../../src/evaluation/upstreamArtifacts/index.js";

function satisfiedCondition(overrides: Partial<RoleConditionCoverage> = {}): RoleConditionCoverage {
  return {
    conditionId: "implementation.selected-owner",
    role: "implementation",
    required: true,
    evidenceGroupIds: ["implementation-owners"],
    witnessPolicy: "at-least-one",
    requiredWitnessCount: 1,
    availableWitnessCount: 1,
    retainedWitnessCount: 1,
    retainedWitnessIds: ["src/example.ts"],
    conditionSatisfied: true,
    lostRequiredCondition: false,
    lossReason: null,
    evaluationOrder: 10,
    ...overrides
  };
}

describe("calculateConditionCoverageMetrics: availability", () => {
  it("reports unavailable, not zero, when roleConditionCoverage is absent (legacy artifact)", () => {
    const result = calculateConditionCoverageMetrics(undefined, undefined);
    expect(result.availability).toBe("unavailable");
    expect(result.requiredConditionsTotal.availability).toBe("unavailable");
    expect(result.requiredConditionsTotal.count).toBeNull();
  });

  it("reports available zero when the producer explicitly evaluated an empty condition set", () => {
    const result = calculateConditionCoverageMetrics([], undefined);
    expect(result.availability).toBe("available");
    expect(result.requiredConditionsTotal).toMatchObject({ availability: "available", count: 0 });
  });
});

describe("calculateConditionCoverageMetrics: required/optional/lost counts", () => {
  it("distinguishes satisfied, missing-evidence, and lost required conditions", () => {
    const missing = satisfiedCondition({
      conditionId: "implementation.required-contract",
      availableWitnessCount: 0,
      retainedWitnessCount: 0,
      retainedWitnessIds: [],
      conditionSatisfied: false,
      lostRequiredCondition: false
    });
    const lost = satisfiedCondition({
      conditionId: "implementation.required-contract",
      availableWitnessCount: 2,
      retainedWitnessCount: 0,
      retainedWitnessIds: [],
      conditionSatisfied: false,
      lostRequiredCondition: true,
      lossReason: "bounded-allocation-omitted-required-witnesses"
    });
    const result = calculateConditionCoverageMetrics([satisfiedCondition(), missing, lost], undefined);
    expect(result.requiredConditionsTotal.count).toBe(3);
    expect(result.requiredConditionsSatisfied.evidenceKeys).toEqual(["implementation.selected-owner"]);
    expect(result.requiredConditionsMissing.evidenceKeys).toEqual(["implementation.required-contract"]);
    expect(result.requiredConditionsLost.evidenceKeys).toEqual(["implementation.required-contract"]);
    expect(result.lastWitnessLoss.count).toBe(1);
  });

  it("counts optional conditions separately and never labels an optional failure as required loss", () => {
    const optionalMissing = satisfiedCondition({
      conditionId: "implementation.required-contract",
      required: false,
      conditionSatisfied: false,
      lostRequiredCondition: false
    });
    const result = calculateConditionCoverageMetrics([optionalMissing], undefined);
    expect(result.requiredConditionsTotal.count).toBe(0);
    expect(result.optionalConditionsTotal.count).toBe(1);
    expect(result.optionalConditionsMissing.evidenceKeys).toEqual(["implementation.required-contract"]);
    expect(result.requiredConditionsLost.count).toBe(0);
  });
});

describe("calculateConditionCoverageMetrics: witness evidence", () => {
  it("retains witness identifiers and coverage state without fabrication", () => {
    const result = calculateConditionCoverageMetrics([satisfiedCondition()], undefined);
    expect(result.witnessEvidence[0]).toMatchObject({
      conditionId: "implementation.selected-owner",
      retainedWitnessIds: ["src/example.ts"],
      adequateWitnessRemains: true,
      coverageState: "satisfied"
    });
  });

  it("classifies lost-to-allocation distinctly from missing-evidence", () => {
    const lost = satisfiedCondition({ conditionSatisfied: false, lostRequiredCondition: true, retainedWitnessIds: [] });
    const missing = satisfiedCondition({ availableWitnessCount: 0, conditionSatisfied: false, lostRequiredCondition: false, retainedWitnessIds: [] });
    const result = calculateConditionCoverageMetrics([lost, missing], undefined);
    expect(result.witnessEvidence[0].coverageState).toBe("lost-to-allocation");
    expect(result.witnessEvidence[1].coverageState).toBe("missing-evidence");
  });
});

describe("calculateConditionCoverageMetrics: condition-to-group mapping", () => {
  it("marks a condition mapped when it references at least one evidence group", () => {
    const result = calculateConditionCoverageMetrics([satisfiedCondition()], ["implementation-owners"]);
    expect(result.conditionToGroupMapping[0]).toMatchObject({ mapped: true, unknownGroupIds: [] });
  });

  it("flags a condition referencing a group absent from the known evidence-group list", () => {
    const result = calculateConditionCoverageMetrics(
      [satisfiedCondition({ evidenceGroupIds: ["implementation-contracts"] })],
      ["implementation-owners"]
    );
    expect(result.conditionToGroupMapping[0]).toMatchObject({ mapped: true, unknownGroupIds: ["implementation-contracts"] });
  });

  it("does not report unknown groups when the available evidence-group list itself is unavailable", () => {
    const result = calculateConditionCoverageMetrics([satisfiedCondition({ evidenceGroupIds: ["anything"] })], undefined);
    expect(result.conditionToGroupMapping[0].unknownGroupIds).toEqual([]);
  });
});
