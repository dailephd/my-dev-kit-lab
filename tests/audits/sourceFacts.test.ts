import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import { collectSourceFacts } from "../../src/audits/core/collectSourceFacts.js";
import {
  createLanguageAnalyzerRegistry,
  DEFAULT_LANGUAGE_ANALYZER_REGISTRY,
  type LanguageAnalyzer,
} from "../../src/audits/core/languageAnalyzerRegistry.js";
import type { SourceFileFacts } from "../../src/audits/core/sourceFacts.js";

// v0.3.1 Batch 3 registered the TypeScript/JavaScript analyzer as the
// default (see languageAnalyzerRegistry.ts), so this file's original Batch 2
// "fallback behavior" tests now pass an explicit empty registry to keep
// exercising collectSourceFacts.ts's no-analyzer fallback policy in
// isolation, per the Batch 3 regression requirement ("no-analyzer fallback
// still works when using an empty/custom registry"). A separate describe
// block below exercises the real DEFAULT_LANGUAGE_ANALYZER_REGISTRY.
const EMPTY_REGISTRY = createLanguageAnalyzerRegistry([]);

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "source-facts-test-"));
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

// Fixture project covering every language/role combination this batch's
// fallback policy needs to distinguish.
function buildFixtureProject(): string {
  const root = makeTempDir();
  writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
  writeFile(root, "README.md", "# Fixture\n");
  writeFile(root, "tsconfig.json", "{}");
  writeFile(root, "src/index.ts", "export const x = 1;\n");
  writeFile(root, "src/app.js", "module.exports = {};\n");
  writeFile(root, "src/lib.py", "x = 1\n");
  writeFile(root, "src/Main.java", "class Main {}\n");
  writeFile(root, "src/Main.kt", "fun main() {}\n");
  // .go has no NormalizedLanguage mapping (Batch 1 scope), so this is the
  // real "known role (source), unknown language" case -- not an invented
  // extension.
  writeFile(root, "src/main.go", "package main\n");
  writeFile(root, "tests/index.test.ts", "import {} from 'vitest';\n");
  return root;
}

describe("collectSourceFacts — fallback behavior (explicit empty registry)", () => {
  it("gives a TypeScript source file file-level-only fallback facts", async () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, EMPTY_REGISTRY);
      const entry = snapshot.files.find((f) => f.relativePath === "src/index.ts");
      expect(entry).toBeDefined();
      expect(entry?.parseStatus).toBe("file-level-only");
      expect(entry?.analyzerId).toBeNull();
      expect(entry?.imports).toEqual([]);
      expect(entry?.exports).toEqual([]);
      expect(entry?.declarations).toEqual([]);
      expect(entry?.references).toEqual([]);
      expect(entry?.diagnostics.length).toBeGreaterThan(0);
      expect(entry?.diagnostics[0].code).toBe("no-analyzer-registered");
    } finally {
      cleanup(root);
    }
  });

  it("gives a JavaScript source file file-level-only fallback facts", async () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, EMPTY_REGISTRY);
      const entry = snapshot.files.find((f) => f.relativePath === "src/app.js");
      expect(entry?.parseStatus).toBe("file-level-only");
      expect(entry?.language).toBe("javascript");
    } finally {
      cleanup(root);
    }
  });

  it("classifies Python/Java/Kotlin files but does not parse them", async () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, EMPTY_REGISTRY);
      const py = snapshot.files.find((f) => f.relativePath === "src/lib.py");
      const java = snapshot.files.find((f) => f.relativePath === "src/Main.java");
      const kt = snapshot.files.find((f) => f.relativePath === "src/Main.kt");

      for (const entry of [py, java, kt]) {
        expect(entry?.parseStatus).toBe("file-level-only");
        expect(entry?.analyzerId).toBeNull();
        expect(entry?.imports).toEqual([]);
        expect(entry?.declarations).toEqual([]);
      }
      expect(py?.language).toBe("python");
      expect(java?.language).toBe("java");
      expect(kt?.language).toBe("kotlin");
    } finally {
      cleanup(root);
    }
  });

  it("gives an unknown-language source file an unsupported fallback", async () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, EMPTY_REGISTRY);
      const entry = snapshot.files.find((f) => f.relativePath === "src/main.go");
      expect(entry).toBeDefined();
      expect(entry?.role).toBe("source");
      expect(entry?.language).toBe("unknown");
      expect(entry?.parseStatus).toBe("unsupported");
      expect(entry?.diagnostics[0].code).toBe("unsupported-language");
    } finally {
      cleanup(root);
    }
  });

  it("gives a test-role TypeScript file the same fallback treatment as source", async () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, EMPTY_REGISTRY);
      const entry = snapshot.files.find((f) => f.relativePath === "tests/index.test.ts");
      expect(entry?.role).toBe("test");
      expect(entry?.parseStatus).toBe("file-level-only");
    } finally {
      cleanup(root);
    }
  });

  it("omits docs/config/package files from the snapshot entirely", async () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, EMPTY_REGISTRY);
      const paths = snapshot.files.map((f) => f.relativePath);
      expect(paths).not.toContain("README.md");
      expect(paths).not.toContain("tsconfig.json");
      expect(paths).not.toContain("package.json");
    } finally {
      cleanup(root);
    }
  });

  it("does not treat generated/build-output/vendor/report-output files as normal parsed source", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      writeFile(root, "src/index.ts", "export const x = 1;\n");
      writeFile(root, "packages/app/vendor/lib.js", "");
      writeFile(root, "packages/app/generated/schema.ts", "");
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory);
      const paths = snapshot.files.map((f) => f.relativePath);
      expect(paths).not.toContain("packages/app/vendor/lib.js");
      expect(paths).not.toContain("packages/app/generated/schema.ts");
      expect(paths).toContain("src/index.ts");
    } finally {
      cleanup(root);
    }
  });

  it("produces summary counts by language and parse status", async () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, EMPTY_REGISTRY);
      expect(snapshot.filesByLanguage.typescript).toBeGreaterThan(0);
      expect(snapshot.filesByParseStatus["file-level-only"]).toBeGreaterThan(0);
      expect(snapshot.filesByParseStatus.unsupported).toBeGreaterThan(0);
    } finally {
      cleanup(root);
    }
  });

  it("preserves deterministic file ordering across repeated runs", async () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const first = await collectSourceFacts(root, inventory, EMPTY_REGISTRY);
      const second = await collectSourceFacts(root, inventory, EMPTY_REGISTRY);
      expect(first.files.map((f) => f.relativePath)).toEqual(second.files.map((f) => f.relativePath));
    } finally {
      cleanup(root);
    }
  });

  it("does not modify target files", async () => {
    const root = buildFixtureProject();
    try {
      const before = fs.readFileSync(path.join(root, "src/index.ts"), "utf8");
      const inventory = scanProjectInventory(root);
      await collectSourceFacts(root, inventory, EMPTY_REGISTRY);
      const after = fs.readFileSync(path.join(root, "src/index.ts"), "utf8");
      expect(after).toBe(before);
    } finally {
      cleanup(root);
    }
  });
});

describe("collectSourceFacts — with a registered analyzer", () => {
  it("uses the registered analyzer's facts instead of the fallback", async () => {
    const root = buildFixtureProject();
    try {
      const analyzer: LanguageAnalyzer = {
        id: "fixture-ts-analyzer",
        supportedLanguages: ["typescript"],
        analyzeFile: (input): SourceFileFacts => ({
          relativePath: input.relativePath,
          language: input.language,
          role: input.role,
          parseStatus: "parsed",
          analyzerId: "fixture-ts-analyzer",
          imports: [{ source: "vitest", kind: "static" }],
          exports: [],
          declarations: [],
          references: [],
          diagnostics: [],
        }),
      };
      const registry = createLanguageAnalyzerRegistry([analyzer]);
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, registry);
      const entry = snapshot.files.find((f) => f.relativePath === "src/index.ts");
      expect(entry?.parseStatus).toBe("parsed");
      expect(entry?.analyzerId).toBe("fixture-ts-analyzer");

      // JavaScript is unaffected (analyzer only claims typescript) and still
      // falls back.
      const jsEntry = snapshot.files.find((f) => f.relativePath === "src/app.js");
      expect(jsEntry?.parseStatus).toBe("file-level-only");
    } finally {
      cleanup(root);
    }
  });

  it("catches an analyzer error and records a parse-error diagnostic", async () => {
    const root = buildFixtureProject();
    try {
      const analyzer: LanguageAnalyzer = {
        id: "throwing-analyzer",
        supportedLanguages: ["typescript"],
        analyzeFile: (): SourceFileFacts => {
          throw new Error("boom");
        },
      };
      const registry = createLanguageAnalyzerRegistry([analyzer]);
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, registry);
      const entry = snapshot.files.find((f) => f.relativePath === "src/index.ts");
      expect(entry?.parseStatus).toBe("parse-error");
      expect(entry?.analyzerId).toBe("throwing-analyzer");
      expect(entry?.diagnostics[0].code).toBe("analyzer-error");
      expect(snapshot.analyzerDiagnostics.length).toBeGreaterThan(0);
    } finally {
      cleanup(root);
    }
  });

  it("supports an async analyzer", async () => {
    const root = buildFixtureProject();
    try {
      const analyzer: LanguageAnalyzer = {
        id: "async-analyzer",
        supportedLanguages: ["typescript"],
        analyzeFile: async (input): Promise<SourceFileFacts> => {
          await Promise.resolve();
          return {
            relativePath: input.relativePath,
            language: input.language,
            role: input.role,
            parseStatus: "parsed",
            analyzerId: "async-analyzer",
            imports: [],
            exports: [],
            declarations: [],
            references: [],
            diagnostics: [],
          };
        },
      };
      const registry = createLanguageAnalyzerRegistry([analyzer]);
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, registry);
      const entry = snapshot.files.find((f) => f.relativePath === "src/index.ts");
      expect(entry?.parseStatus).toBe("parsed");
      expect(entry?.analyzerId).toBe("async-analyzer");
    } finally {
      cleanup(root);
    }
  });
});

describe("collectSourceFacts — with the real DEFAULT_LANGUAGE_ANALYZER_REGISTRY (Batch 3)", () => {
  it("parses TypeScript and JavaScript files by default", async () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);
      const tsEntry = snapshot.files.find((f) => f.relativePath === "src/index.ts");
      const jsEntry = snapshot.files.find((f) => f.relativePath === "src/app.js");
      expect(tsEntry?.parseStatus).toBe("parsed");
      expect(tsEntry?.analyzerId).toBe("typescript-javascript-analyzer");
      expect(tsEntry?.exports.some((e) => e.name === "x")).toBe(true);
      expect(jsEntry?.parseStatus).toBe("parsed");
      expect(jsEntry?.analyzerId).toBe("typescript-javascript-analyzer");
    } finally {
      cleanup(root);
    }
  });

  // v0.3.3 Batch 1 -- Java and Kotlin are now parsed by the real default
  // registry (see javaAnalyzer.ts/kotlinAnalyzer.ts/languageAnalyzerRegistry.ts)
  // instead of falling back to file-level-only. This is the T9
  // "source-facts collection integration" proof: the real
  // collectSourceFacts() -> real DEFAULT_LANGUAGE_ANALYZER_REGISTRY path
  // actually invokes the Java/Kotlin analyzers, not just a synthetic unit
  // test of each analyzer in isolation.
  it("parses Java and Kotlin files by default via the real registry", async () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);
      const java = snapshot.files.find((f) => f.relativePath === "src/Main.java");
      const kt = snapshot.files.find((f) => f.relativePath === "src/Main.kt");
      expect(java?.parseStatus).toBe("parsed");
      expect(java?.analyzerId).toBe("java-analyzer");
      expect(java?.declarations.some((d) => d.name === "Main" && d.kind === "class")).toBe(true);
      expect(kt?.parseStatus).toBe("parsed");
      expect(kt?.analyzerId).toBe("kotlin-analyzer");
      expect(kt?.declarations.some((d) => d.name === "main" && d.kind === "function")).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  // v0.3.2 Batch 1 -- Python is now parsed by the real default registry
  // (see pythonAnalyzer.ts / languageAnalyzerRegistry.ts) instead of falling
  // back to file-level-only. This is the T8 "source-facts collection
  // integration" proof: the real collectSourceFacts() -> real
  // DEFAULT_LANGUAGE_ANALYZER_REGISTRY path actually invokes the Python
  // analyzer, not just a synthetic unit test of the analyzer in isolation.
  it("parses Python files by default via the real registry", async () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);
      const py = snapshot.files.find((f) => f.relativePath === "src/lib.py");
      expect(py?.parseStatus).toBe("parsed");
      expect(py?.analyzerId).toBe("python-analyzer");
    } finally {
      cleanup(root);
    }
  });

  it("still produces an unsupported fallback for unknown-language source files", async () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);
      const entry = snapshot.files.find((f) => f.relativePath === "src/main.go");
      expect(entry?.parseStatus).toBe("unsupported");
      expect(entry?.analyzerId).toBeNull();
    } finally {
      cleanup(root);
    }
  });

  it("parses a test-role TypeScript file the same as source", async () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const snapshot = await collectSourceFacts(root, inventory, DEFAULT_LANGUAGE_ANALYZER_REGISTRY);
      const entry = snapshot.files.find((f) => f.relativePath === "tests/index.test.ts");
      expect(entry?.role).toBe("test");
      expect(entry?.parseStatus).toBe("parsed");
    } finally {
      cleanup(root);
    }
  });
});
