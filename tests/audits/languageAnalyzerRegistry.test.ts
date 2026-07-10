import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createLanguageAnalyzerRegistry,
  selectLanguageAnalyzer,
  DEFAULT_LANGUAGE_ANALYZER_REGISTRY,
  type LanguageAnalyzer,
} from "../../src/audits/core/languageAnalyzerRegistry.js";
import type { SourceFileFacts } from "../../src/audits/core/sourceFacts.js";
import { TYPESCRIPT_JAVASCRIPT_ANALYZER_ID } from "../../src/audits/core/typescriptJavaScriptAnalyzer.js";
import { PYTHON_ANALYZER_ID } from "../../src/audits/core/pythonAnalyzer.js";
import { JAVA_ANALYZER_ID } from "../../src/audits/core/javaAnalyzer.js";
import { KOTLIN_ANALYZER_ID } from "../../src/audits/core/kotlinAnalyzer.js";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import { collectSourceFacts } from "../../src/audits/core/collectSourceFacts.js";

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
  // analyzer (see pythonAnalyzer.ts) alongside it. v0.3.3 Batch 1 adds Java
  // and Kotlin (see javaAnalyzer.ts/kotlinAnalyzer.ts) -- see
  // collectSourceFacts.ts's fallback policy for how a genuinely unsupported
  // language still degrades, exercised with an explicit empty registry in
  // sourceFacts.test.ts.
  it("includes the TypeScript/JavaScript, Python, Java, and Kotlin analyzers", () => {
    expect(DEFAULT_LANGUAGE_ANALYZER_REGISTRY.map((a) => a.id)).toEqual([
      TYPESCRIPT_JAVASCRIPT_ANALYZER_ID,
      PYTHON_ANALYZER_ID,
      JAVA_ANALYZER_ID,
      KOTLIN_ANALYZER_ID,
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

  it("selects the Java analyzer for java", () => {
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "java", ".java")?.id).toBe(JAVA_ANALYZER_ID);
  });

  it("selects the Kotlin analyzer for kotlin (.kt and .kts)", () => {
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "kotlin", ".kt")?.id).toBe(KOTLIN_ANALYZER_ID);
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "kotlin", ".kts")?.id).toBe(KOTLIN_ANALYZER_ID);
  });

  it("still returns no analyzer for a genuinely unsupported language", () => {
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "unknown", ".weird")).toBeNull();
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

// ---------------------------------------------------------------------------
// v0.3.4 Batch 1 -- registry stability across all four registered languages
// at once (not just one language at a time, as the describe blocks above
// already cover serially). Proves Java/Kotlin registration does not shadow
// TS/JS/Python selection, and that a Gradle Kotlin DSL build script never
// reaches the Kotlin analyzer via the real collection pipeline.
// ---------------------------------------------------------------------------
describe("DEFAULT_LANGUAGE_ANALYZER_REGISTRY — cross-language non-shadowing (Batch 1)", () => {
  function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "registry-stability-test-"));
  }
  function cleanup(...dirs: string[]): void {
    for (const d of dirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }
  function writeFile(root: string, relativePath: string, content = ""): void {
    const fullPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
  }

  it("resolves the correct analyzer for TS, JS, Python, Java, and Kotlin simultaneously", () => {
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "typescript", ".ts")?.id).toBe(
      TYPESCRIPT_JAVASCRIPT_ANALYZER_ID
    );
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "javascript", ".js")?.id).toBe(
      TYPESCRIPT_JAVASCRIPT_ANALYZER_ID
    );
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "python", ".py")?.id).toBe(PYTHON_ANALYZER_ID);
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "java", ".java")?.id).toBe(JAVA_ANALYZER_ID);
    expect(selectLanguageAnalyzer(DEFAULT_LANGUAGE_ANALYZER_REGISTRY, "kotlin", ".kt")?.id).toBe(KOTLIN_ANALYZER_ID);
  });

  it("never routes a Gradle Kotlin DSL build script to the Kotlin analyzer through the real collection pipeline", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "build.gradle.kts", 'plugins {\n    kotlin("jvm")\n}\n');
      writeFile(root, "settings.gradle.kts", 'rootProject.name = "fixture"\n');
      writeFile(root, "src/main/kotlin/com/example/Widget.kt", "package com.example\nclass Widget\n");

      const inventory = scanProjectInventory(root);
      // build.gradle.kts/settings.gradle.kts are classified as role "config"
      // (projectInventory.ts's JVM_PROJECT_METADATA_FILE_NAMES), which is
      // outside collectSourceFacts.ts's ANALYZABLE_ROLES {source, test} --
      // so they are never even offered to selectLanguageAnalyzer.
      const snapshot = await collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);
      const paths = snapshot.files.map((f) => f.relativePath);
      expect(paths).not.toContain("build.gradle.kts");
      expect(paths).not.toContain("settings.gradle.kts");

      const widget = snapshot.files.find((f) => f.relativePath === "src/main/kotlin/com/example/Widget.kt");
      expect(widget?.analyzerId).toBe(KOTLIN_ANALYZER_ID);
    } finally {
      cleanup(root);
    }
  });
});
