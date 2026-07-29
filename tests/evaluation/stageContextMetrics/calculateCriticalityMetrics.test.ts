import { describe, expect, it } from "vitest";
import { calculateCriticalityMetrics } from "../../../src/evaluation/stageContextMetrics/calculateCriticalityMetrics.js";
import type { ResponsibilityMapping } from "../../../src/evaluation/upstreamArtifacts/index.js";
import type { ProducerReadinessCriticalityExpectationV1 } from "../../../src/evaluation/stageContextExpectations/index.js";

function mapping(overrides: Partial<ResponsibilityMapping>): ResponsibilityMapping {
  return {
    responsibilityId: "resp.001",
    behavior: null,
    invariant: null,
    criticality: "critical",
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
    mappingStatus: "mapped",
    ...overrides
  } as unknown as ResponsibilityMapping;
}

function exp(overrides: Partial<ProducerReadinessCriticalityExpectationV1>): ProducerReadinessCriticalityExpectationV1 {
  return {
    expectationId: "CRIT-001",
    responsibilityId: "resp.001",
    expectedCriticality: "critical",
    applicable: true,
    requiresFullMapping: true,
    notes: [],
    ...overrides
  };
}

describe("calculateCriticalityMetrics: overlay agreement", () => {
  // TST-B2-046
  it("matching criticality overlay agrees", () => {
    const result = calculateCriticalityMetrics([mapping({ criticality: "critical" })], [exp({})]);
    expect(result.overlayAgreement[0]).toMatchObject({ agreement: true, availability: "available" });
  });

  // TST-B2-047
  it("conflicting criticality is reported", () => {
    const result = calculateCriticalityMetrics([mapping({ criticality: "noncritical" })], [exp({ expectedCriticality: "critical" })]);
    expect(result.overlayAgreement[0].agreement).toBe(false);
    expect(result.conflictingCriticalityResponsibilityIds).toEqual(["resp.001"]);
  });

  // TST-B2-048
  it("missing required criticality is reported", () => {
    const result = calculateCriticalityMetrics([], [exp({})]);
    expect(result.overlayAgreement[0].availability).toBe("unavailable");
    expect(result.missingCriticalityResponsibilityIds).toEqual(["resp.001"]);
  });
});

describe("calculateCriticalityMetrics: mapped critical completeness", () => {
  // TST-B2-049
  it("fully mapped critical responsibility counts as complete", () => {
    const result = calculateCriticalityMetrics([mapping({ mappingStatus: "mapped" })], [exp({})]);
    expect(result.mappedCriticalCompleteness).toMatchObject({ availability: "available", numerator: 1, denominator: 1, rate: 1 });
    expect(result.fullyMappedCriticalIds).toEqual(["resp.001"]);
  });

  // TST-B2-050
  it("partially mapped critical responsibility does not count as complete", () => {
    const result = calculateCriticalityMetrics([mapping({ mappingStatus: "partially-mapped" })], [exp({})]);
    expect(result.mappedCriticalCompleteness).toMatchObject({ numerator: 0, denominator: 1, rate: 0 });
    expect(result.partiallyMappedCriticalIds).toEqual(["resp.001"]);
    expect(result.fullyMappedCriticalIds).toEqual([]);
  });

  // TST-B2-051
  it("unmapped critical responsibility does not count as complete", () => {
    const result = calculateCriticalityMetrics([mapping({ mappingStatus: "unmapped" })], [exp({})]);
    expect(result.mappedCriticalCompleteness).toMatchObject({ numerator: 0, denominator: 1 });
    expect(result.unmappedCriticalIds).toEqual(["resp.001"]);
  });

  // TST-B2-052
  it("not-applicable observed status is excluded from the denominator", () => {
    const result = calculateCriticalityMetrics([mapping({ mappingStatus: "not-applicable" })], [exp({})]);
    expect(result.mappedCriticalCompleteness.availability).toBe("not-applicable");
    expect(result.fullyMappedCriticalIds).toEqual([]);
    expect(result.partiallyMappedCriticalIds).toEqual([]);
    expect(result.unmappedCriticalIds).toEqual([]);
  });

  // TST-B2-053
  it("missing mapping evidence reports unavailable for the affected responsibility and is excluded from the denominator (not treated as unmapped)", () => {
    const result = calculateCriticalityMetrics([], [exp({})]);
    expect(result.missingMappingEvidenceCriticalIds).toEqual(["resp.001"]);
    expect(result.unmappedCriticalIds).toEqual([]);
    expect(result.mappedCriticalCompleteness.availability).toBe("not-applicable");
  });

  // TST-B2-054
  it("an available zero critical-responsibility failure count remains distinct from unavailable", () => {
    const zeroFailures = calculateCriticalityMetrics([mapping({ mappingStatus: "mapped" })], [exp({})]);
    expect(zeroFailures.mappedCriticalCompleteness.availability).toBe("available");
    expect(zeroFailures.unmappedCriticalIds).toEqual([]);

    const unavailable = calculateCriticalityMetrics(undefined, [exp({})]);
    expect(unavailable.mappedCriticalCompleteness.availability).toBe("not-applicable");
    expect(unavailable.missingCriticalityResponsibilityIds).toEqual(["resp.001"]);
  });

  it("a noncritical expectation is excluded from mapped-critical completeness entirely", () => {
    const result = calculateCriticalityMetrics([mapping({ criticality: "noncritical", mappingStatus: "unmapped" })], [
      exp({ expectedCriticality: "noncritical" })
    ]);
    expect(result.mappedCriticalCompleteness.availability).toBe("not-applicable");
  });

  it("unexpected criticality entries outside a closed expectation set are reported", () => {
    const result = calculateCriticalityMetrics([mapping({ responsibilityId: "resp.999" })], [exp({ responsibilityId: "resp.001" })]);
    expect(result.unexpectedCriticalityResponsibilityIds).toEqual(["resp.999"]);
  });
});
