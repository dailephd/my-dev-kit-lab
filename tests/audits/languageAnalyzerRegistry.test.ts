import { describe, expect, it } from "vitest";
import {
  createLanguageAnalyzerRegistry,
  selectLanguageAnalyzer,
  DEFAULT_LANGUAGE_ANALYZER_REGISTRY,
  type LanguageAnalyzer,
} from "../../src/audits/core/languageAnalyzerRegistry.js";
import type { SourceFileFacts } from "../../src/audits/core/sourceFacts.js";
import { TYPESCRIPT_JAVASCRIPT_ANALYZER_ID } from "../../src/audits/core/typescriptJavaScriptAnalyzer.js";
import { PYTHON_ANALYZER_ID } from "../../src/audits/core/pythonAnalyzer.js";

function makeAnalyzer(overrides: Partial<LanguageAnalyzer> = {}): LanguageAnalyzer {
  return {
    id: "fixture-analyzer",
    supportedLanguages: ["typescript"],
    analyzeFile: (): SourceFileFacts => ({
      relativePath: "fixture.ts",
      language: "typescript",
      role: "source",
      parseStatus: "parsed",
      analyzerId: "fixture-analyzer",
      imports: [],
      exports: [],
      declarations: [],
      references: [],
      diagnostics: [],
    }),
    ...overrides,
  };
}

describe("DEFAULT_LANGUAGE_ANALYZER_REGISTRY", () => {
  // v0.3.1 Batch 3 -- registers the TypeScript/JavaScript analyzer (see
  // typescriptJavaScriptAnalyzer.ts). v0.3.2 Batch 1 adds the Python
  // analyzer (see pythonAnalyzer.ts) alongside it. Java/Kotlin remain
  // unregistered (fallback-only) -- see collectSourceFacts.ts's fallback
  // policy, exercised with an explicit empty registry in sourceFacts.test.ts.
  it("includes the TypeScript/JavaScript and Python analyzers", () => {
    expect(DEFAULT_LANGUAGE_ANALYZER_REGISTRY.map((a) => a.id)).toEqual([
      TYPESCRIPT_JAVASCRIPT_ANALYZER_ID,
      PYTHON_ANALYZER_ID,
    ]);
  });

  it("selects the TypeScript/JavaScript analyzer for typescript and javascript", () => {
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "typescript", ".ts")?.id).toBe(
      TYPESCRIPT_JAVASCRIPT_ANALYZER_ID
    );
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "javascript", ".js")?.id).toBe(
      TYPESCRIPT_JAVASCRIPT_ANALYZER_ID
    );
  });

  it("selects the Python analyzer for python", () => {
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "python", ".py")?.id).toBe(PYTHON_ANALYZER_ID);
  });

  it("still returns no analyzer for java/kotlin (fallback-only languages)", () => {
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "java", ".java")).toBeNull();
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "kotlin", ".kt")).toBeNull();
  });
});

describe("createLanguageAnalyzerRegistry", () => {
  it("accepts a list of analyzers with unique ids", () => {
    const registry = createLanguageAnalyzerRegistry([
      makeAnalyzer({ id: "a" }),
      makeAnalyzer({ id: "b", supportedLanguages: ["javascript"] }),
    ]);
    expect(registry.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("rejects a duplicate analyzer id", () => {
    expect(() =>
      createLanguageAnalyzerRegistry([makeAnalyzer({ id: "dup" }), makeAnalyzer({ id: "dup" })])
    ).toThrow(/Duplicate language analyzer id/);
  });

  it("preserves deterministic input ordering", () => {
    const registry = createLanguageAnalyzerRegistry([
      makeAnalyzer({ id: "z" }),
      makeAnalyzer({ id: "a" }),
      makeAnalyzer({ id: "m" }),
    ]);
    expect(registry.map((a) => a.id)).toEqual(["z", "a", "m"]);
  });
});

describe("selectLanguageAnalyzer", () => {
  it("selects the first analyzer supporting the requested language", () => {
    const registry = createLanguageAnalyzerRegistry([
      makeAnalyzer({ id: "ts-analyzer", supportedLanguages: ["typescript"] }),
      makeAnalyzer({ id: "js-analyzer", supportedLanguages: ["javascript"] }),
    ]);
    expect(selectLanguageAnalyzer(registry, "typescript", ".ts")?.id).toBe("ts-analyzer");
    expect(selectLanguageAnalyzer(registry, "javascript", ".js")?.id).toBe("js-analyzer");
  });

  it("returns null when no analyzer supports the language", () => {
    const registry = createLanguageAnalyzerRegistry([makeAnalyzer({ id: "ts-analyzer" })]);
    expect(selectLanguageAnalyzer(registry, "python", ".py")).toBeNull();
  });

  it("returns null against an empty registry", () => {
    expect(selectLanguageAnalyzer(createLanguageAnalyzerRegistry([]), "typescript", ".ts")).toBeNull();
  });

  it("respects supportedExtensions when present", () => {
    const registry = createLanguageAnalyzerRegistry([
      makeAnalyzer({ id: "ts-only", supportedLanguages: ["typescript"], supportedExtensions: [".ts"] }),
    ]);
    expect(selectLanguageAnalyzer(registry, "typescript", ".ts")?.id).toBe("ts-only");
    expect(selectLanguageAnalyzer(registry, "typescript", ".tsx")).toBeNull();
  });
});
