import { describe, expect, it } from "vitest";
import { buildStageContextExpectationTargetKey } from "../../../src/evaluation/stageContextMetrics/targetKeys.js";
import type { StageContextExpectationItemV1 } from "../../../src/evaluation/stageContextExpectations/index.js";

function item(overrides: Record<string, unknown>): StageContextExpectationItemV1 {
  return {
    expectationId: "REQ-FILE-001",
    inclusion: "required",
    sourceArtifact: "context-capsule",
    category: "file",
    match: { path: "src/example.ts" },
    notes: [],
    ...overrides
  } as unknown as StageContextExpectationItemV1;
}

describe("buildStageContextExpectationTargetKey", () => {
  it("MET-001 every path category uses the exact path-key format", () => {
    const categories = ["file", "test-file", "fixture", "factory", "mock", "setup-file", "test-configuration"];
    for (const category of categories) {
      const key = buildStageContextExpectationTargetKey(item({ category, match: { path: "src/a.ts" } }));
      expect(key).toBe(`context-capsule|${category}|path:src/a.ts`);
    }
  });

  it("MET-002 every symbol category uses the exact symbolId-key format", () => {
    const categories = ["symbol", "contract", "validator", "constant", "error", "schema-or-serializer"];
    for (const category of categories) {
      const key = buildStageContextExpectationTargetKey(item({ category, match: { symbolId: "symbol:a" } }));
      expect(key).toBe(`context-capsule|${category}|symbolId:symbol:a`);
    }
  });

  it("MET-003 source range uses exact filePath/startLine/endLine order", () => {
    const key = buildStageContextExpectationTargetKey(
      item({ category: "source-range", match: { filePath: "src/a.ts", startLine: 1, endLine: 10 } })
    );
    expect(key).toBe("context-capsule|source-range|filePath:src/a.ts|startLine:1|endLine:10");
  });

  it("MET-004 production responsibility uses exact responsibilityId format", () => {
    const key = buildStageContextExpectationTargetKey(
      item({ category: "production-responsibility", sourceArtifact: "retrieval-audit-record", match: { responsibilityId: "resp.001" } })
    );
    expect(key).toBe("retrieval-audit-record|production-responsibility|responsibilityId:resp.001");
  });

  it("MET-005 package script uses exact name format", () => {
    const key = buildStageContextExpectationTargetKey(item({ category: "package-script", match: { name: "test" } }));
    expect(key).toBe("context-capsule|package-script|name:test");
  });

  it("MET-006 test command uses exact commandText format", () => {
    const key = buildStageContextExpectationTargetKey(
      item({ category: "test-command", match: { commandText: "vitest run" } })
    );
    expect(key).toBe("context-capsule|test-command|commandText:vitest run");
  });

  it("MET-007 workflow stable-ID categories use exact id format", () => {
    const categories = ["workflow", "stage", "command", "rule", "report-contract"];
    for (const category of categories) {
      const key = buildStageContextExpectationTargetKey(
        item({ category, sourceArtifact: "workflow-instruction-packet", match: { id: "stable.id" } })
      );
      expect(key).toBe(`workflow-instruction-packet|${category}|id:stable.id`);
    }
  });

  it("MET-008 provenance uses exact evidenceId format", () => {
    const key = buildStageContextExpectationTargetKey(
      item({ category: "provenance", sourceArtifact: "workflow-instruction-packet", match: { evidenceId: "symbol:a" } })
    );
    expect(key).toBe("workflow-instruction-packet|provenance|evidenceId:symbol:a");
  });

  it("MET-009 path separators are not normalized", () => {
    const key = buildStageContextExpectationTargetKey(item({ category: "file", match: { path: "src\\windows\\path.ts" } }));
    expect(key).toBe("context-capsule|file|path:src\\windows\\path.ts");
  });

  it("MET-010 case is not changed", () => {
    const key = buildStageContextExpectationTargetKey(item({ category: "file", match: { path: "SRC/Example.TS" } }));
    expect(key).toBe("context-capsule|file|path:SRC/Example.TS");
  });

  it("MET-011 whitespace is not normalized", () => {
    const key = buildStageContextExpectationTargetKey(
      item({ category: "test-command", match: { commandText: "  vitest   run  " } })
    );
    expect(key).toBe("context-capsule|test-command|commandText:  vitest   run  ");
  });

  it("MET-012 stable IDs are not parsed", () => {
    const key = buildStageContextExpectationTargetKey(
      item({ category: "workflow", sourceArtifact: "workflow-instruction-packet", match: { id: "workflow.feature.sub.part" } })
    );
    expect(key).toBe("workflow-instruction-packet|workflow|id:workflow.feature.sub.part");
  });
});
