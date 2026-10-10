import { describe, expect, it } from "vitest";
import {
  AgentSuccessTaskValidationError,
  assertAgentSuccessTask,
  validateAgentSuccessTask,
  type AgentSuccessTaskIssueCode
} from "../../../src/evaluation/agentSuccess/index.js";
import { baseTaskInput } from "../benchmarkSandbox/sandboxTestHelpers.js";

function issuesOf(input: unknown): Array<{ code: AgentSuccessTaskIssueCode; path: string }> {
  const result = validateAgentSuccessTask(input);
  if (result.ok) return [];
  return result.issues.map((issue) => ({ code: issue.code, path: issue.path }));
}

describe("AgentSuccessTaskV1 validation", () => {
  it("RSP-001 accepts a valid minimal task and returns it normalized and sorted", () => {
    const input = {
      ...baseTaskInput(),
      sourceRoots: ["./src"],
      allowedEditFiles: ["src\\other.cjs", "./src/math.cjs"],
      expectedEditFiles: ["src\\math.cjs"],
      protectedFiles: ["tests/task.check.cjs", "protected.txt"]
    };
    const result = validateAgentSuccessTask(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.schemaVersion).toBe("my-dev-kit-lab-agent-success-task-v1");
    expect(result.task.expectedEditFiles).toEqual(["src/math.cjs"]);
    expect(result.task.allowedEditFiles).toEqual(["src/math.cjs", "src/other.cjs"]);
    expect(result.task.protectedFiles).toEqual(["protected.txt", "tests/task.check.cjs"]);
    expect(result.task.taskChecks[0]).toEqual({ id: "task-add", executable: "node", args: ["tests/task.check.cjs"], timeoutMs: 20000 });
    expect(assertAgentSuccessTask(baseTaskInput()).id).toBe("fixture-add-fix");
  });

  it("RSP-001 accepts an optional deterministic fixture and rejects unknown fields and a wrong schema version", () => {
    const withFixture = { ...baseTaskInput(), deterministicFixture: { id: "fx", patch: "diff --git a/x b/x\n", notes: "n" } };
    expect(validateAgentSuccessTask(withFixture).ok).toBe(true);
    expect(issuesOf({ ...baseTaskInput(), surprise: 1 })).toContainEqual({ code: "UNKNOWN_FIELD", path: "surprise" });
    expect(issuesOf({ ...baseTaskInput(), schemaVersion: "v0" })).toContainEqual({ code: "INVALID_SCHEMA_VERSION", path: "schemaVersion" });
    expect(issuesOf({ ...baseTaskInput(), taskLocality: "everywhere" })).toContainEqual({ code: "INVALID_VALUE", path: "taskLocality" });
    expect(issuesOf(null)).toEqual([{ code: "NOT_OBJECT", path: "" }]);
  });

  it.each([
    ["", "PATH_EMPTY"],
    ["   ", "PATH_EMPTY"],
    ["/etc/passwd", "PATH_ABSOLUTE"],
    ["\\\\server\\share\\x", "PATH_ABSOLUTE"],
    ["C:/x/y.ts", "PATH_DRIVE"],
    ["C:\\x\\y.ts", "PATH_DRIVE"],
    ["a\0b", "PATH_NUL"],
    [".", "PATH_DOT"],
    ["./", "PATH_TRAILING_SLASH"],
    ["../x", "PATH_TRAVERSAL"],
    ["a/../../x", "PATH_TRAVERSAL"],
    ["a/../b", "PATH_TRAVERSAL"],
    [".git/config", "PATH_GIT_SEGMENT"],
    ["sub/.GIT/hooks/x", "PATH_GIT_SEGMENT"],
    ["dir/", "PATH_TRAILING_SLASH"],
    [42, "PATH_NOT_STRING"]
  ] as const)("RSP-002 rejects the unsafe path %j with %s", (unsafe, code) => {
    for (const field of ["allowedEditFiles", "protectedFiles", "sourceRoots"] as const) {
      const input = { ...baseTaskInput(), expectedEditFiles: [], allowedEditFiles: ["src/other.cjs"], protectedFiles: [], sourceRoots: ["src"] } as Record<string, unknown>;
      input[field] = [unsafe];
      expect(issuesOf(input)).toContainEqual({ code, path: `${field}[0]` });
    }
  });

  it("RSP-002 rejects duplicates after normalization and rejects unsafe glob entries", () => {
    expect(issuesOf({ ...baseTaskInput(), allowedEditFiles: ["src/math.cjs", "./src\\math.cjs"] })).toContainEqual({ code: "DUPLICATE_PATH", path: "allowedEditFiles[1]" });
    expect(issuesOf({ ...baseTaskInput(), rawIncludeGlobs: ["../**/*"] }).map((issue) => issue.path)).toContain("rawIncludeGlobs[0]");
    expect(issuesOf({ ...baseTaskInput(), rawIncludeGlobs: [] }).map((issue) => issue.path)).toContain("rawIncludeGlobs");
  });

  it("RSP-003 requires expectedEditFiles to be a subset of allowedEditFiles", () => {
    expect(issuesOf({ ...baseTaskInput(), expectedEditFiles: ["src/math.cjs", "docs/readme.md"] })).toContainEqual({ code: "EXPECTED_NOT_ALLOWED", path: "expectedEditFiles" });
    expect(validateAgentSuccessTask({ ...baseTaskInput(), expectedEditFiles: [] }).ok).toBe(true);
  });

  it("RSP-004 rejects protected files that overlap expected or allowed files and tolerates unlisted unprotected files", () => {
    expect(issuesOf({ ...baseTaskInput(), protectedFiles: ["src/math.cjs"] })).toContainEqual({ code: "PROTECTED_OVERLAP", path: "protectedFiles" });
    expect(issuesOf({ ...baseTaskInput(), protectedFiles: ["src/other.cjs"] })).toContainEqual({ code: "PROTECTED_OVERLAP", path: "protectedFiles" });
    // docs/readme.md is neither allowed nor protected: not automatically protected.
    expect(validateAgentSuccessTask({ ...baseTaskInput(), protectedFiles: ["protected.txt"] }).ok).toBe(true);
  });

  it("RSP-005 rejects duplicate check ids, missing checks, and invalid behavior-fact mappings", () => {
    const base = baseTaskInput() as { taskChecks: Array<Record<string, unknown>>; regressionChecks: Array<Record<string, unknown>> };
    expect(issuesOf({ ...base, regressionChecks: [{ ...base.regressionChecks[0], id: "task-add" }] })).toContainEqual({ code: "DUPLICATE_CHECK_ID", path: "taskChecks" });
    expect(issuesOf({ ...base, taskChecks: [] })).toContainEqual({ code: "TOO_FEW_CHECKS", path: "taskChecks" });
    expect(issuesOf({ ...base, regressionChecks: [] })).toContainEqual({ code: "TOO_FEW_CHECKS", path: "regressionChecks" });
    const facts = (entries: unknown[]) => ({ ...base, behaviorFacts: entries });
    expect(issuesOf(facts([{ id: "f", text: "t", required: true, verificationCheckIds: ["missing-check"] }]))).toContainEqual({ code: "UNRESOLVED_CHECK_ID", path: "behaviorFacts[0].verificationCheckIds[0]" });
    expect(issuesOf(facts([{ id: "f", text: "t", required: true, verificationCheckIds: [] }]))).toContainEqual({ code: "REQUIRED_FACT_UNMAPPED", path: "behaviorFacts[0].verificationCheckIds" });
    expect(issuesOf(facts([{ id: "f", text: "t", required: false, verificationCheckIds: ["task-add"] }, { id: "f", text: "u", required: false, verificationCheckIds: [] }]))).toContainEqual({ code: "DUPLICATE_FACT_ID", path: "behaviorFacts[1].id" });
    expect(validateAgentSuccessTask(facts([{ id: "optional", text: "t", required: false, verificationCheckIds: [] }])).ok).toBe(true);
  });

  it("RSP-006 rejects non-node executables and invalid timeouts, accepting the 300000 ms boundary", () => {
    const withCheck = (patch: Record<string, unknown>) => ({
      ...baseTaskInput(),
      taskChecks: [{ id: "task-add", executable: "node", args: ["tests/task.check.cjs"], timeoutMs: 1000, ...patch }]
    });
    expect(issuesOf(withCheck({ executable: "bash" }))).toContainEqual({ code: "INVALID_EXECUTABLE", path: "taskChecks[0].executable" });
    expect(issuesOf(withCheck({ executable: "node && echo hi" }))).toContainEqual({ code: "INVALID_EXECUTABLE", path: "taskChecks[0].executable" });
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 300_001, "5000"]) {
      expect(issuesOf(withCheck({ timeoutMs }))).toContainEqual({ code: "INVALID_TIMEOUT", path: "taskChecks[0].timeoutMs" });
    }
    expect(validateAgentSuccessTask(withCheck({ timeoutMs: 300_000 })).ok).toBe(true);
    expect(issuesOf(withCheck({ args: "tests/task.check.cjs" })).map((issue) => issue.path)).toContain("taskChecks[0].args");
    expect(issuesOf(withCheck({ args: ["ok", "a\0b"] })).map((issue) => issue.path)).toContain("taskChecks[0].args");
  });

  it("throws a typed error from assertAgentSuccessTask carrying the issues", () => {
    try {
      assertAgentSuccessTask({ ...baseTaskInput(), taskChecks: [] });
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentSuccessTaskValidationError);
      expect((error as AgentSuccessTaskValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});
