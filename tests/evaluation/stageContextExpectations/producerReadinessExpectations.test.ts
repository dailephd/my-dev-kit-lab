import { describe, expect, it } from "vitest";
import { validateStageContextExpectationFixtureV1 } from "../../../src/evaluation/stageContextExpectations/index.js";
import type { JsonObject } from "../../../src/evaluation/upstreamArtifacts/index.js";

function baseFixture(overrides: Record<string, unknown> = {}): JsonObject {
  return {
    schemaVersion: "1.0.0",
    caseId: "CASE-B2-001",
    title: "t",
    description: "d",
    expectedEvidence: [
      {
        expectationId: "REQ-FILE-001",
        inclusion: "required",
        sourceArtifact: "context-capsule",
        category: "file",
        match: { path: "src/a.ts" },
        notes: []
      }
    ],
    expectedStates: {},
    warnings: [],
    ...overrides
  } as unknown as JsonObject;
}

describe("StageContextExpectationFixtureV1 compatibility", () => {
  // TST-B2-001
  it("an existing v0.4.3 fixture (no producerReadinessExpectations) remains valid unchanged", () => {
    const result = validateStageContextExpectationFixtureV1(baseFixture(), "fixture.json");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixture.producerReadinessExpectations).toBeUndefined();
  });
});

describe("producerReadinessExpectations validation", () => {
  // TST-B2-002
  it("required/allowed/forbidden owner expectations validate deterministically", () => {
    const fixture = baseFixture({
      producerReadinessExpectations: {
        ownerExpectations: [
          { expectationId: "OWNER-REQ-001", inclusion: "required", sourceArtifact: "context-capsule", ownerId: "src/a.ts", notes: [] },
          { expectationId: "OWNER-ALLOW-001", inclusion: "allowed", sourceArtifact: "context-capsule", ownerId: "src/b.ts", notes: [] },
          { expectationId: "OWNER-FORBID-001", inclusion: "forbidden", sourceArtifact: "context-capsule", ownerId: "src/c.ts", notes: [] }
        ]
      }
    });
    const result = validateStageContextExpectationFixtureV1(fixture, "fixture.json");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fixture.producerReadinessExpectations?.ownerExpectations).toHaveLength(3);
  });

  // TST-B2-003
  it("readiness decision and issue-code expectations validate", () => {
    const fixture = baseFixture({
      producerReadinessExpectations: {
        readinessExpectations: [
          {
            expectationId: "READY-001",
            kind: "implementation",
            allowedDecisions: ["ready"],
            expectedClassification: "ready",
            expectedIssueCodes: [],
            notes: []
          }
        ]
      }
    });
    const result = validateStageContextExpectationFixtureV1(fixture, "fixture.json");
    expect(result.ok).toBe(true);
  });

  it("fails explicitly on an invalid readiness decision value", () => {
    const fixture = baseFixture({
      producerReadinessExpectations: {
        readinessExpectations: [{ expectationId: "READY-001", kind: "implementation", allowedDecisions: ["approved"], notes: [] }]
      }
    });
    const result = validateStageContextExpectationFixtureV1(fixture, "fixture.json");
    expect(result.ok).toBe(false);
  });

  // TST-B2-004
  it("criticality expectations validate", () => {
    const fixture = baseFixture({
      producerReadinessExpectations: {
        criticalityExpectations: [
          {
            expectationId: "CRIT-001",
            responsibilityId: "resp.001",
            expectedCriticality: "critical",
            applicable: true,
            requiresFullMapping: true,
            notes: []
          }
        ]
      }
    });
    const result = validateStageContextExpectationFixtureV1(fixture, "fixture.json");
    expect(result.ok).toBe(true);
  });

  // TST-B2-005
  it("fails explicitly on duplicate producer-readiness expectation IDs", () => {
    const fixture = baseFixture({
      producerReadinessExpectations: {
        ownerExpectations: [
          { expectationId: "DUP-001", inclusion: "required", sourceArtifact: "context-capsule", ownerId: "src/a.ts", notes: [] }
        ],
        allocationExpectations: [{ expectationId: "DUP-001", groupId: "g1", notes: [] }]
      }
    });
    const result = validateStageContextExpectationFixtureV1(fixture, "fixture.json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("DUPLICATE_PRODUCER_READINESS_EXPECTATION_ID");
  });

  it("fails explicitly on a malformed allocation expectation", () => {
    const fixture = baseFixture({
      producerReadinessExpectations: { allocationExpectations: [{ expectationId: "ALLOC-001", groupId: "g1", expectedCapacity: -1, notes: [] }] }
    });
    const result = validateStageContextExpectationFixtureV1(fixture, "fixture.json");
    expect(result.ok).toBe(false);
  });

  // TST-B2-006
  it("a fixture with an empty producerReadinessExpectations object remains representable (no-applicable-denominator case)", () => {
    const fixture = baseFixture({ producerReadinessExpectations: {} });
    const result = validateStageContextExpectationFixtureV1(fixture, "fixture.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixture.producerReadinessExpectations?.ownerExpectations).toBeUndefined();
    }
  });
});
