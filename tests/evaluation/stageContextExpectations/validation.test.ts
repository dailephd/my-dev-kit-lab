import { describe, expect, it } from "vitest";
import { validateStageContextExpectationFixtureV1 } from "../../../src/evaluation/stageContextExpectations/validation.js";
import type { JsonObject } from "../../../src/evaluation/upstreamArtifacts/index.js";

const SOURCE_PATH = "in-memory-expectation-fixture.json";

function makeItem(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    expectationId: "REQ-FILE-001",
    inclusion: "required",
    sourceArtifact: "context-capsule",
    category: "file",
    match: { path: "src/example.ts" },
    notes: [],
    ...overrides
  };
}

function makeFixture(items: Record<string, unknown>[], rootOverrides: Record<string, unknown> = {}): JsonObject {
  return {
    schemaVersion: "1.0.0",
    caseId: "CASE-STAGE-CONTEXT-100",
    title: "Validation test fixture",
    description: "Synthetic fixture used for validation unit tests.",
    expectedEvidence: items as unknown as JsonObject[],
    expectedStates: {},
    warnings: [],
    ...rootOverrides
  } as unknown as JsonObject;
}

function validate(items: Record<string, unknown>[], rootOverrides: Record<string, unknown> = {}) {
  return validateStageContextExpectationFixtureV1(makeFixture(items, rootOverrides), SOURCE_PATH);
}

const VALID_CATEGORY_ITEMS: Record<string, Record<string, unknown>> = {
  file: makeItem({ expectationId: "REQ-FILE-001", category: "file", sourceArtifact: "context-capsule", match: { path: "src/example.ts" } }),
  symbol: makeItem({ expectationId: "REQ-SYMBOL-001", category: "symbol", sourceArtifact: "context-capsule", match: { symbolId: "symbol:src/example.ts#Example" } }),
  "source-range": makeItem({
    expectationId: "REQ-SOURCE-RANGE-001",
    category: "source-range",
    sourceArtifact: "context-capsule",
    match: { filePath: "src/example.ts", startLine: 1, endLine: 10 }
  }),
  contract: makeItem({ expectationId: "REQ-CONTRACT-001", category: "contract", sourceArtifact: "context-capsule", match: { symbolId: "contract:src/example.ts#Example" } }),
  validator: makeItem({ expectationId: "REQ-VALIDATOR-001", category: "validator", sourceArtifact: "context-capsule", match: { symbolId: "validator:src/example.ts#Example" } }),
  constant: makeItem({ expectationId: "REQ-CONSTANT-001", category: "constant", sourceArtifact: "context-capsule", match: { symbolId: "constant:src/example.ts#EXAMPLE" } }),
  error: makeItem({ expectationId: "REQ-ERROR-001", category: "error", sourceArtifact: "context-capsule", match: { symbolId: "error:src/example.ts#Example" } }),
  "schema-or-serializer": makeItem({
    expectationId: "REQ-SCHEMA-001",
    category: "schema-or-serializer",
    sourceArtifact: "context-capsule",
    match: { symbolId: "schema:src/example.ts#Example" }
  }),
  "production-responsibility": makeItem({
    expectationId: "REQ-RESPONSIBILITY-001",
    category: "production-responsibility",
    sourceArtifact: "context-capsule",
    match: { responsibilityId: "fixture.responsibility.001" }
  }),
  "test-file": makeItem({ expectationId: "REQ-TEST-FILE-001", category: "test-file", sourceArtifact: "context-capsule", match: { path: "tests/example.spec.ts" } }),
  fixture: makeItem({ expectationId: "REQ-FIXTURE-001", category: "fixture", sourceArtifact: "context-capsule", match: { path: "tests/fixtures/example.json" } }),
  factory: makeItem({ expectationId: "REQ-FACTORY-001", category: "factory", sourceArtifact: "context-capsule", match: { path: "tests/factories/example.ts" } }),
  mock: makeItem({ expectationId: "REQ-MOCK-001", category: "mock", sourceArtifact: "context-capsule", match: { path: "tests/mocks/example.ts" } }),
  "setup-file": makeItem({ expectationId: "REQ-SETUP-FILE-001", category: "setup-file", sourceArtifact: "context-capsule", match: { path: "tests/setup.ts" } }),
  "test-configuration": makeItem({
    expectationId: "REQ-TEST-CONFIGURATION-001",
    category: "test-configuration",
    sourceArtifact: "context-capsule",
    match: { path: "vitest.config.ts" }
  }),
  "package-script": makeItem({ expectationId: "REQ-PACKAGE-SCRIPT-001", category: "package-script", sourceArtifact: "context-capsule", match: { name: "test" } }),
  "test-command": makeItem({
    expectationId: "REQ-TEST-COMMAND-001",
    category: "test-command",
    sourceArtifact: "context-capsule",
    match: { commandText: "vitest run" }
  }),
  workflow: makeItem({ expectationId: "REQ-WORKFLOW-001", category: "workflow", sourceArtifact: "workflow-instruction-packet", match: { id: "workflow.feature" } }),
  stage: makeItem({ expectationId: "REQ-STAGE-001", category: "stage", sourceArtifact: "workflow-instruction-packet", match: { id: "stage.feature.implementation" } }),
  command: makeItem({ expectationId: "REQ-COMMAND-001", category: "command", sourceArtifact: "workflow-instruction-packet", match: { id: "command.repo.build" } }),
  rule: makeItem({ expectationId: "REQ-RULE-001", category: "rule", sourceArtifact: "workflow-instruction-packet", match: { id: "rule.quality.no-dead-code" } }),
  "report-contract": makeItem({
    expectationId: "REQ-REPORT-CONTRACT-001",
    category: "report-contract",
    sourceArtifact: "workflow-instruction-packet",
    match: { id: "report.implementation-summary" }
  }),
  provenance: makeItem({ expectationId: "REQ-PROVENANCE-001", category: "provenance", sourceArtifact: "workflow-instruction-packet", match: { evidenceId: "symbol:src/example.ts#Example" } })
};

describe("validateStageContextExpectationFixtureV1", () => {
  it("EXP-017 every category accepts one valid item", () => {
    for (const [category, item] of Object.entries(VALID_CATEGORY_ITEMS)) {
      const result = validate([item]);
      expect(result.ok, `category ${category} should validate`).toBe(true);
    }
  });

  it("EXP-018 every sourceArtifact literal accepts its valid categories", () => {
    expect(validate([VALID_CATEGORY_ITEMS.file]).ok).toBe(true);
    expect(
      validate([
        makeItem({
          expectationId: "ALLOW-RESPONSIBILITY-001",
          inclusion: "allowed",
          category: "production-responsibility",
          sourceArtifact: "retrieval-audit-record",
          match: { responsibilityId: "fixture.responsibility.002" }
        })
      ]).ok
    ).toBe(true);
    expect(validate([VALID_CATEGORY_ITEMS.workflow]).ok).toBe(true);
    expect(
      validate([
        makeItem({
          expectationId: "REQ-RULE-002",
          category: "rule",
          sourceArtifact: "full-workflow-library",
          match: { id: "rule.quality.prefer-tests" }
        })
      ]).ok
    ).toBe(true);
  });

  it("EXP-019 an invalid sourceArtifact fails", () => {
    const result = validate([makeItem({ sourceArtifact: "not-a-real-source" })]);
    expect(result.ok).toBe(false);
  });

  it("EXP-020 an invalid category fails", () => {
    const result = validate([makeItem({ category: "not-a-real-category" })]);
    expect(result.ok).toBe(false);
  });

  it("EXP-021 an invalid inclusion fails", () => {
    const result = validate([makeItem({ inclusion: "sometimes" })]);
    expect(result.ok).toBe(false);
  });

  it("EXP-022 an empty expectedEvidence array fails with EMPTY_EXPECTATION_SET", () => {
    const result = validate([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMPTY_EXPECTATION_SET");
  });

  it("EXP-023 an invalid caseId fails", () => {
    const result = validate([makeItem({})], { caseId: "invalid-case-id" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CASE_ID");
  });

  it("EXP-024 a required item without REQ prefix fails", () => {
    const result = validate([makeItem({ expectationId: "ALLOW-FILE-001", inclusion: "required" })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EXPECTATION_ID_PREFIX_MISMATCH");
  });

  it("EXP-025 an allowed item without ALLOW prefix fails", () => {
    const result = validate([makeItem({ expectationId: "REQ-FILE-001", inclusion: "allowed" })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EXPECTATION_ID_PREFIX_MISMATCH");
  });

  it("EXP-026 a forbidden item without FORBID prefix fails", () => {
    const result = validate([makeItem({ expectationId: "REQ-FILE-001", inclusion: "forbidden" })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EXPECTATION_ID_PREFIX_MISMATCH");
  });

  it("EXP-027 an invalid expectation ID syntax fails", () => {
    const result = validate([makeItem({ expectationId: "req-file-001" })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_EXPECTATION_ID");
  });

  it("EXP-028 duplicate expectationId fails", () => {
    const result = validate([
      makeItem({ expectationId: "REQ-FILE-001", match: { path: "src/example.ts" } }),
      makeItem({ expectationId: "REQ-FILE-001", match: { path: "src/other.ts" } })
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_EXPECTATION_ID");
  });

  it("EXP-029 duplicate target with the same inclusion fails", () => {
    const result = validate([
      makeItem({ expectationId: "REQ-FILE-001", inclusion: "required", match: { path: "src/example.ts" } }),
      makeItem({ expectationId: "REQ-FILE-002", inclusion: "required", match: { path: "src/example.ts" } })
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_EXPECTATION_TARGET");
  });

  it("EXP-030 the same target with different inclusion fails", () => {
    const result = validate([
      makeItem({ expectationId: "REQ-FILE-001", inclusion: "required", match: { path: "src/example.ts" } }),
      makeItem({ expectationId: "FORBID-FILE-001", inclusion: "forbidden", match: { path: "src/example.ts" } })
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICTING_EXPECTATION_INCLUSION");
  });

  it("EXP-031 path category with a non-context-capsule source fails", () => {
    const result = validate([makeItem({ category: "file", sourceArtifact: "workflow-instruction-packet" })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CATEGORY_SOURCE_PAIR");
  });

  it("EXP-032 symbol category with a non-context-capsule source fails", () => {
    const result = validate([
      makeItem({ category: "symbol", sourceArtifact: "retrieval-audit-record", match: { symbolId: "symbol:src/example.ts#Example" } })
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CATEGORY_SOURCE_PAIR");
  });

  it("EXP-033 production responsibility accepts context-capsule", () => {
    expect(validate([VALID_CATEGORY_ITEMS["production-responsibility"]]).ok).toBe(true);
  });

  it("EXP-034 production responsibility accepts retrieval-audit-record", () => {
    const result = validate([
      makeItem({
        expectationId: "ALLOW-RESPONSIBILITY-002",
        inclusion: "allowed",
        category: "production-responsibility",
        sourceArtifact: "retrieval-audit-record",
        match: { responsibilityId: "fixture.responsibility.003" }
      })
    ]);
    expect(result.ok).toBe(true);
  });

  it("EXP-035 production responsibility rejects packet sources", () => {
    const result = validate([
      makeItem({
        category: "production-responsibility",
        sourceArtifact: "workflow-instruction-packet",
        match: { responsibilityId: "fixture.responsibility.004" }
      })
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CATEGORY_SOURCE_PAIR");
  });

  it("EXP-036 workflow stable-id categories accept workflow-instruction-packet", () => {
    expect(validate([VALID_CATEGORY_ITEMS.workflow]).ok).toBe(true);
  });

  it("EXP-037 workflow stable-id categories accept full-workflow-library", () => {
    const result = validate([
      makeItem({ expectationId: "REQ-STAGE-002", category: "stage", sourceArtifact: "full-workflow-library", match: { id: "stage.feature.implementation" } })
    ]);
    expect(result.ok).toBe(true);
  });

  it("EXP-038 workflow stable-id categories reject my-dev-kit artifact sources", () => {
    const result = validate([makeItem({ category: "workflow", sourceArtifact: "context-capsule", match: { id: "workflow.feature" } })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CATEGORY_SOURCE_PAIR");
  });

  it("EXP-039 provenance accepts all four sourceArtifact values", () => {
    const sourceArtifacts = ["context-capsule", "retrieval-audit-record", "workflow-instruction-packet", "full-workflow-library"];
    for (const sourceArtifact of sourceArtifacts) {
      const result = validate([
        makeItem({
          expectationId: "REQ-PROVENANCE-002",
          category: "provenance",
          sourceArtifact,
          match: { evidenceId: "symbol:src/example.ts#Example" }
        })
      ]);
      expect(result.ok, `provenance should accept ${sourceArtifact}`).toBe(true);
    }
  });

  it("EXP-040 a missing category-specific match field fails", () => {
    const result = validate([makeItem({ match: {} })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MISSING_REQUIRED_FIELD");
  });

  it("EXP-041 an empty category-specific match string fails", () => {
    const result = validate([makeItem({ match: { path: "" } })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_FIELD_TYPE");
  });

  it("EXP-042 source range startLine zero fails", () => {
    const result = validate([VALID_CATEGORY_ITEMS["source-range"]].map((item) => ({
      ...item,
      match: { ...(item.match as Record<string, unknown>), startLine: 0 }
    })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_SOURCE_RANGE");
  });

  it("EXP-043 source range noninteger line fails", () => {
    const result = validate([VALID_CATEGORY_ITEMS["source-range"]].map((item) => ({
      ...item,
      match: { ...(item.match as Record<string, unknown>), startLine: 1.5 }
    })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_SOURCE_RANGE");
  });

  it("EXP-044 source range endLine before startLine fails", () => {
    const result = validate([VALID_CATEGORY_ITEMS["source-range"]].map((item) => ({
      ...item,
      match: { ...(item.match as Record<string, unknown>), startLine: 10, endLine: 5 }
    })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_SOURCE_RANGE");
  });

  it("EXP-045 valid source range succeeds", () => {
    const result = validate([VALID_CATEGORY_ITEMS["source-range"]]);
    expect(result.ok).toBe(true);
  });

  it("EXP-046 negative fullFileFallbackUsed fails", () => {
    const result = validate([makeItem({})], {
      expectedStates: { contextCapsule: { fullFileFallbackUsed: -1 } }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_FIELD_TYPE");
  });

  it("EXP-047 noninteger fullFileFallbackUsed fails", () => {
    const result = validate([makeItem({})], {
      expectedStates: { contextCapsule: { fullFileFallbackUsed: 1.5 } }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_FIELD_TYPE");
  });

  it("EXP-048 negative warningCount fails", () => {
    const result = validate([makeItem({})], {
      expectedStates: { contextCapsule: { warningCount: -1 } }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_FIELD_TYPE");
  });

  it("EXP-049 duplicate unresolvedItemIds fail", () => {
    const result = validate([makeItem({})], {
      expectedStates: { contextCapsule: { unresolvedItemIds: ["fixture.a", "fixture.a"] } }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_EXPECTED_VALUE");
  });

  it("EXP-050 duplicate unresolvedReferences fail", () => {
    const result = validate([makeItem({})], {
      expectedStates: { workflowInstructionPacket: { unresolvedReferences: ["command.a", "command.a"] } }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_EXPECTED_VALUE");
  });

  it("EXP-051 invalid contextAdequacyStatus fails", () => {
    const result = validate([makeItem({})], {
      expectedStates: { contextCapsule: { contextAdequacyStatus: "not-a-status" } }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LITERAL_VALUE");
  });

  it("EXP-052 invalid roleAdequacyStatus fails", () => {
    const result = validate([makeItem({})], {
      expectedStates: { contextCapsule: { roleAdequacyStatus: "not-a-status" } }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LITERAL_VALUE");
  });

  it("EXP-053 invalid freshnessState fails", () => {
    const result = validate([makeItem({})], {
      expectedStates: { contextCapsule: { freshnessState: "not-a-state" } }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LITERAL_VALUE");
  });

  it("EXP-054 invalid packet adequacyStatus fails", () => {
    const result = validate([makeItem({})], {
      expectedStates: { workflowInstructionPacket: { adequacyStatus: "not-adequate" } }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LITERAL_VALUE");
  });

  it("EXP-055 negative target mutation count fails", () => {
    const result = validate([makeItem({})], {
      expectedStates: { targetImmutability: { newMutationCount: -1 } }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_FIELD_TYPE");
  });

  it("EXP-056 unknown additive fields are accepted", () => {
    const result = validate(
      [makeItem({ futureNestedField: "preserved" })],
      { futureRootField: "preserved" }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.fixture as unknown as Record<string, unknown>).futureRootField).toBe("preserved");
      expect((result.fixture.expectedEvidence[0] as unknown as Record<string, unknown>).futureNestedField).toBe("preserved");
    }
  });

  it("EXP-057 validation does not clone the fixture", () => {
    const input = makeFixture([makeItem({})]);
    const result = validateStageContextExpectationFixtureV1(input, SOURCE_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixture).toBe(input);
      expect(result.rawFixture).toBe(input);
    }
  });

  it("EXP-058 validation does not mutate the fixture", () => {
    const input = makeFixture([makeItem({})]);
    const before = JSON.stringify(input);
    validateStageContextExpectationFixtureV1(input, SOURCE_PATH);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("EXP-059 expectation item order is preserved", () => {
    const items = [
      makeItem({ expectationId: "REQ-FILE-001", match: { path: "src/a.ts" } }),
      makeItem({ expectationId: "REQ-FILE-002", match: { path: "src/b.ts" } }),
      makeItem({ expectationId: "REQ-FILE-003", match: { path: "src/c.ts" } })
    ];
    const result = validate(items);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixture.expectedEvidence.map((item) => item.expectationId)).toEqual([
        "REQ-FILE-001",
        "REQ-FILE-002",
        "REQ-FILE-003"
      ]);
    }
  });

  it("EXP-060 match-object values remain unchanged", () => {
    const item = makeItem({ match: { path: "src/example.ts" } });
    const result = validate([item]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const returnedItem = result.fixture.expectedEvidence[0] as unknown as { match: { path: string } };
      expect(returnedItem.match.path).toBe("src/example.ts");
      expect(returnedItem.match).toBe(item.match);
    }
  });
});
