import { describe, expect, it } from "vitest";
import {
  LocalRepositorySubjectConfigError,
  canonicalizeRepositoryRelativePath,
  parseLocalRepositorySubjectConfig,
  validateLocalRepositorySubjectConfig,
} from "../../../src/evaluation/localRepositorySubject/index.js";
import { minimalCase, minimalConfig } from "./fixtureRepository.js";

function errorsFor(input: unknown): string[] {
  const result = validateLocalRepositorySubjectConfig(input);
  expect(result.ok).toBe(false);
  return result.errors;
}

describe("RSP-001 local subject config contract", () => {
  it("accepts a valid minimal config and returns it canonicalized", () => {
    const result = validateLocalRepositorySubjectConfig(minimalConfig());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toEqual({
      schemaVersion: "1.0.0",
      subjectId: "fixture-subject",
      cases: [minimalCase()],
    });
  });

  it("rejects a non-object root", () => {
    for (const input of [null, "text", 3, []]) {
      expect(errorsFor(input)).toEqual([expect.stringContaining("config: must be an object")]);
    }
  });

  it("rejects a wrong or missing schemaVersion", () => {
    expect(errorsFor(minimalConfig({ schemaVersion: "2.0.0" }))).toContain(
      'config.schemaVersion: must be "1.0.0" (received "2.0.0").'
    );
    const { schemaVersion: _omitted, ...withoutVersion } = minimalConfig();
    expect(errorsFor(withoutVersion)).toContain("config: missing required field schemaVersion.");
  });

  it("requires a bounded portable subjectId", () => {
    const { subjectId: _omitted, ...withoutId } = minimalConfig();
    expect(errorsFor(withoutId)).toContain("config: missing required field subjectId.");
    for (const bad of ["", "-leading", ".leading", "has space", "C:\\repo", "/abs/path", "a/b", "é", "x".repeat(129), 7]) {
      expect(errorsFor(minimalConfig({ subjectId: bad })).some((error) => error.startsWith("config.subjectId:"))).toBe(true);
    }
    expect(validateLocalRepositorySubjectConfig(minimalConfig({ subjectId: "x".repeat(128) })).ok).toBe(true);
    expect(validateLocalRepositorySubjectConfig(minimalConfig({ subjectId: "A1._-z" })).ok).toBe(true);
  });

  it("rejects unknown fields at config and case level, including physical-path fields", () => {
    expect(errorsFor(minimalConfig({ outputRoot: "x" }))).toContain('config: unknown field "outputRoot".');
    expect(errorsFor(minimalConfig({ cases: [minimalCase({ targetRoot: "elsewhere" })] }))).toContain(
      'config.cases[0]: unknown field "targetRoot".'
    );
    expect(errorsFor(minimalConfig({ cases: [minimalCase({ absoluteTargetRoot: "/x" })] }))).toContain(
      'config.cases[0]: unknown field "absoluteTargetRoot".'
    );
  });

  it("requires a non-empty cases array of objects with all required fields", () => {
    expect(errorsFor(minimalConfig({ cases: [] }))).toContain("config.cases: must not be empty.");
    expect(errorsFor(minimalConfig({ cases: "no" }))[0]).toContain("config.cases: must be an array");
    expect(errorsFor(minimalConfig({ cases: ["no"] }))).toContain('config.cases[0]: must be an object (received "no").');
    for (const field of ["id", "title", "sourceRoots", "query", "expectedFiles", "expectedSymbols", "rawIncludeGlobs"]) {
      const { [field]: _omitted, ...rest } = minimalCase();
      expect(errorsFor(minimalConfig({ cases: [rest] }))).toContain(`config.cases[0]: missing required field ${field}.`);
    }
  });

  it("rejects duplicate case IDs", () => {
    const errors = errorsFor(minimalConfig({ cases: [minimalCase(), minimalCase({ expectedFiles: ["src/other.ts"] })] }));
    expect(errors).toContain('config.cases[1].id: duplicate case id "case-one".');
  });

  it("rejects malformed arrays and empty required strings", () => {
    expect(errorsFor(minimalConfig({ cases: [minimalCase({ sourceRoots: "src" })] })).join("\n")).toContain("sourceRoots: must be an array");
    expect(errorsFor(minimalConfig({ cases: [minimalCase({ sourceRoots: [] })] }))).toContain("config.cases[0].sourceRoots: must not be empty.");
    expect(errorsFor(minimalConfig({ cases: [minimalCase({ expectedFiles: [] })] }))).toContain("config.cases[0].expectedFiles: must not be empty.");
    expect(errorsFor(minimalConfig({ cases: [minimalCase({ expectedSymbols: [3] })] })).join("\n")).toContain("expectedSymbols[0]: must be a non-empty string");
    expect(errorsFor(minimalConfig({ cases: [minimalCase({ title: "  " })] })).join("\n")).toContain("config.cases[0].title: must be a non-empty string");
    expect(errorsFor(minimalConfig({ cases: [minimalCase({ query: "" })] })).join("\n")).toContain("config.cases[0].query: must be a non-empty string");
  });

  it("is deterministic across repeated calls and accumulates all errors", () => {
    const input = minimalConfig({ schemaVersion: "9", subjectId: "", extra: 1, cases: [] });
    const first = errorsFor(input);
    expect(first.length).toBeGreaterThanOrEqual(4);
    expect(errorsFor(input)).toEqual(first);
  });

  it("parseLocalRepositorySubjectConfig throws the typed error carrying every label", () => {
    expect.assertions(3);
    try {
      parseLocalRepositorySubjectConfig(minimalConfig({ schemaVersion: "9", subjectId: "" }));
    } catch (error) {
      expect(error).toBeInstanceOf(LocalRepositorySubjectConfigError);
      expect((error as LocalRepositorySubjectConfigError).name).toBe("LocalRepositorySubjectConfigError");
      expect((error as LocalRepositorySubjectConfigError).errors.length).toBe(2);
    }
  });
});

describe("RSP-002 optional evaluation metadata reuses existing validation", () => {
  const answerKey = {
    expectedFiles: ["src/main.ts"],
    expectedSymbols: ["value"],
    expectedFacts: [{ id: "f1", text: "value is one", weight: 1, required: true }],
    minimumCorrectFacts: 1,
  };

  it("preserves valid optional fields", () => {
    const optional = {
      answerKey,
      expectedFacts: answerKey.expectedFacts,
      taskLocality: "localized",
      promptComplexityHint: "low",
      projectComplexityRelevance: "none",
      notes: "n",
    };
    const result = validateLocalRepositorySubjectConfig(minimalConfig({ cases: [minimalCase(optional)] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.cases[0]).toMatchObject(optional);
  });

  it("rejects an invalid taskLocality using the shared validator wording", () => {
    const errors = errorsFor(minimalConfig({ cases: [minimalCase({ taskLocality: "everywhere" })] }));
    expect(errors).toEqual([expect.stringContaining("taskLocality must be one of localized, cross-module, broad-change")]);
  });

  it("rejects an invalid answerKey using the shared validator wording", () => {
    expect(errorsFor(minimalConfig({ cases: [minimalCase({ answerKey: "nope" })] }))).toEqual([
      "config.cases[0]: answerKey must be an object.",
    ]);
    const bad = { ...answerKey, minimumCorrectFacts: -1 };
    expect(errorsFor(minimalConfig({ cases: [minimalCase({ answerKey: bad })] })).join("\n")).toContain("minimumCorrectFacts must be a nonnegative integer");
  });

  it("rejects malformed optional string and facts fields", () => {
    expect(errorsFor(minimalConfig({ cases: [minimalCase({ notes: 3 })] })).join("\n")).toContain("config.cases[0].notes: must be a string");
    expect(errorsFor(minimalConfig({ cases: [minimalCase({ expectedFacts: "x" })] })).join("\n")).toContain("expectedFacts: must be an array");
  });
});

describe("RSP-003 repository-relative canonical path contract", () => {
  const canonical = (value: unknown, allowDot = false): { path: string | null; errors: string[] } => {
    const errors: string[] = [];
    return { path: canonicalizeRepositoryRelativePath(value, "p", errors, { allowDot }), errors };
  };

  it("canonicalizes safe forms to forward-slash", () => {
    expect(canonical("src/app").path).toBe("src/app");
    expect(canonical("./src/app/").path).toBe("src/app");
    expect(canonical("src/./app").path).toBe("src/app");
    expect(canonical("src/**/*.ts").path).toBe("src/**/*.ts");
    expect(canonical("my folder/with spaces").path).toBe("my folder/with spaces");
  });

  it('accepts "." only where allowed', () => {
    expect(canonical(".", true).path).toBe(".");
    expect(canonical("./", true).path).toBe(".");
    expect(canonical(".").path).toBeNull();
  });

  it("rejects unsafe forms with a labelled error", () => {
    const unsafe: [unknown, string][] = [
      ["/etc/passwd", "absolute"],
      ["C:/Users/x", "drive-qualified"],
      ["c:relative", "drive-qualified"],
      ["//server/share/x", "absolute"],
      ["\\\\server\\share", "backslashes"],
      ["src\\main.ts", "backslashes"],
      ["../outside", "parent traversal"],
      ["src/../../outside", "parent traversal"],
      ["src//main.ts", "empty path segments"],
      ["", "must not be empty"],
      ["   ", "must not be empty"],
      ["src/\u0000x", "control characters"],
      [42, "must be a string"],
    ];
    for (const [value, fragment] of unsafe) {
      const result = canonical(value, true);
      expect(result.path, JSON.stringify(value)).toBeNull();
      expect(result.errors[0], JSON.stringify(value)).toContain(fragment);
      expect(result.errors[0].startsWith("p:")).toBe(true);
    }
  });

  it("applies the path contract to sourceRoots, expectedFiles and rawIncludeGlobs", () => {
    for (const field of ["sourceRoots", "expectedFiles", "rawIncludeGlobs"]) {
      const errors = errorsFor(minimalConfig({ cases: [minimalCase({ [field]: ["../escape"] })] }));
      expect(errors.join("\n")).toContain(`config.cases[0].${field}[0]: must not contain parent traversal`);
    }
  });
});
