import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PYTHON_ANALYZER, PYTHON_ANALYZER_ID } from "../../src/audits/core/pythonAnalyzer.js";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import type { SourceFileFacts } from "../../src/audits/core/sourceFacts.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "python-analyzer-test-"));
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

// Mirrors typescriptJavaScriptAnalyzer.test.ts's analyze() helper: builds a
// real InventoryFileEntry via the real inventory scanner, then hands the
// real file content to the analyzer directly (bypassing collectSourceFacts)
// so these tests isolate analyzer behavior specifically.
function analyze(root: string, relativePath: string): SourceFileFacts {
  const inventory = scanProjectInventory(root);
  const entry = inventory.files.find((f) => f.relativePath === relativePath);
  if (!entry) throw new Error(`fixture setup error: ${relativePath} not found in inventory`);
  const absolutePath = path.join(root, relativePath);
  const content = fs.readFileSync(absolutePath, "utf8");
  const result = PYTHON_ANALYZER.analyzeFile({
    targetRoot: root,
    relativePath,
    absolutePath,
    content,
    inventoryEntry: entry,
    language: entry.language,
    role: entry.role,
  });
  if (result instanceof Promise) throw new Error("expected a synchronous result");
  return result;
}

describe("PYTHON_ANALYZER — registration", () => {
  it("declares its id and supported language/extension", () => {
    expect(PYTHON_ANALYZER.id).toBe(PYTHON_ANALYZER_ID);
    expect(PYTHON_ANALYZER.supportedLanguages).toEqual(["python"]);
    expect(PYTHON_ANALYZER.supportedExtensions).toEqual([".py"]);
  });
});

describe("PYTHON_ANALYZER — T3 import extraction", () => {
  it("extracts import module, import module as alias, from-import, and relative from-import", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/imports.py",
        [
          "import os",
          "import pandas as pd",
          "from pkg.module import Name",
          "from .local import helper",
          "from ..parent import other",
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/imports.py");
      expect(facts.parseStatus).toBe("parsed");

      const osImport = facts.imports.find((i) => i.source === "os");
      expect(osImport?.kind).toBe("static");

      const pdImport = facts.imports.find((i) => i.source === "pandas");
      expect(pdImport?.importedNames).toEqual(["pd"]);

      const namedFromImport = facts.imports.find((i) => i.source === "pkg.module");
      expect(namedFromImport?.importedNames).toEqual(["Name"]);

      const relativeImport = facts.imports.find((i) => i.source === ".local");
      expect(relativeImport?.importedNames).toEqual(["helper"]);

      const parentRelativeImport = facts.imports.find((i) => i.source === "..parent");
      expect(parentRelativeImport?.importedNames).toEqual(["other"]);
    } finally {
      cleanup(root);
    }
  });

  it("extracts multiple comma-separated import targets and from-import names", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/multi.py", ["import os, sys", "from pkg import a, b as c"].join("\n") + "\n");
      const facts = analyze(root, "src/multi.py");
      expect(facts.imports.some((i) => i.source === "os")).toBe(true);
      expect(facts.imports.some((i) => i.source === "sys")).toBe(true);
      const fromImport = facts.imports.find((i) => i.source === "pkg");
      expect(fromImport?.importedNames).toEqual(["a", "c"]);
    } finally {
      cleanup(root);
    }
  });

  it("extracts from-import star and a bare 'from . import name' package-relative import", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/star.py", ["from pkg import *", "from . import sibling"].join("\n") + "\n");
      const facts = analyze(root, "src/star.py");
      expect(facts.imports.some((i) => i.source === "pkg")).toBe(true);
      expect(facts.imports.some((i) => i.source === ".")).toBe(true);
    } finally {
      cleanup(root);
    }
  });
});

describe("PYTHON_ANALYZER — T4 declaration extraction", () => {
  it("extracts def, async def, and class declarations", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/decls.py",
        ["def plain_fn():", "    return 1", "", "async def async_fn():", "    return 2", "", "class PlainClass:", "    pass"].join(
          "\n"
        ) + "\n"
      );
      const facts = analyze(root, "src/decls.py");
      expect(facts.parseStatus).toBe("parsed");
      const byName = Object.fromEntries(facts.declarations.map((d) => [d.name, d.kind]));
      expect(byName.plain_fn).toBe("function");
      expect(byName.async_fn).toBe("function");
      expect(byName.PlainClass).toBe("class");
    } finally {
      cleanup(root);
    }
  });

  it("extracts class methods as kind 'method', distinct from module-level functions", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/methods.py",
        ["class Widget:", "    def do_thing(self):", "        return 1", "", "def module_fn():", "    return 2"].join("\n") + "\n"
      );
      const facts = analyze(root, "src/methods.py");
      const doThing = facts.declarations.find((d) => d.name === "do_thing");
      const moduleFn = facts.declarations.find((d) => d.name === "module_fn");
      expect(doThing?.kind).toBe("method");
      expect(moduleFn?.kind).toBe("function");
    } finally {
      cleanup(root);
    }
  });

  it("marks declarations exported by leading-underscore convention when __all__ is absent", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/convention.py", ["def public_fn():", "    pass", "", "def _private_fn():", "    pass"].join("\n") + "\n");
      const facts = analyze(root, "src/convention.py");
      expect(facts.declarations.find((d) => d.name === "public_fn")?.exported).toBe(true);
      expect(facts.declarations.find((d) => d.name === "_private_fn")?.exported).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("marks declarations exported precisely per a single-line __all__ list when present", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/all_export.py",
        ["__all__ = [\"included_fn\"]", "", "def included_fn():", "    pass", "", "def excluded_fn():", "    pass"].join("\n") +
          "\n"
      );
      const facts = analyze(root, "src/all_export.py");
      expect(facts.exports).toEqual([{ name: "included_fn", kind: "named" }]);
      expect(facts.declarations.find((d) => d.name === "included_fn")?.exported).toBe(true);
      expect(facts.declarations.find((d) => d.name === "excluded_fn")?.exported).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("supports a tuple-form __all__", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/all_tuple.py", "__all__ = ('a', 'b')\n");
      const facts = analyze(root, "src/all_tuple.py");
      expect(facts.exports.map((e) => e.name).sort()).toEqual(["a", "b"]);
    } finally {
      cleanup(root);
    }
  });
});

describe("PYTHON_ANALYZER — T5 safe degraded behavior", () => {
  it("does not crash and reports parse-error for an unterminated triple-quoted string", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/malformed.py", ['def broken():', '    """docstring that never closes', '    return 1'].join("\n") + "\n");
      const facts = analyze(root, "src/malformed.py");
      expect(facts.parseStatus).toBe("parse-error");
      expect(facts.diagnostics.length).toBeGreaterThan(0);
      expect(facts.diagnostics.some((d) => d.code === "unterminated-triple-quoted-string")).toBe(true);
      expect(facts.diagnostics[0].analyzerId).toBe(PYTHON_ANALYZER_ID);
    } finally {
      cleanup(root);
    }
  });

  it("does not crash on dynamic __import__/importlib.import_module patterns and records an info diagnostic instead of a resolved import", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/dynamic.py",
        ["import importlib", "", "def load(name):", "    return importlib.import_module(name)", "", "mod = __import__('os')"].join(
          "\n"
        ) + "\n"
      );
      const facts = analyze(root, "src/dynamic.py");
      expect(facts.parseStatus).toBe("parsed");
      expect(facts.diagnostics.some((d) => d.code === "dynamic-import-pattern-unsupported")).toBe(true);
      // The dynamic call itself must never appear as a resolved import
      // fact -- only the real "import importlib" static import does.
      expect(facts.imports).toEqual([{ source: "importlib", kind: "static", line: 1 }]);
    } finally {
      cleanup(root);
    }
  });

  it("reports parsed (no diagnostics) for a syntactically ordinary file", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/ok.py", "x = 1\n");
      const facts = analyze(root, "src/ok.py");
      expect(facts.parseStatus).toBe("parsed");
      expect(facts.diagnostics).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  it("records a diagnostic instead of guessing at a multi-line parenthesized from-import", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/multiline_import.py", ["from pkg import (", "    a,", "    b,", ")"].join("\n") + "\n");
      const facts = analyze(root, "src/multiline_import.py");
      expect(facts.diagnostics.some((d) => d.code === "multiline-from-import-unsupported")).toBe(true);
    } finally {
      cleanup(root);
    }
  });
});

describe("PYTHON_ANALYZER — line counts and identity", () => {
  it("carries relativePath, language, role, analyzerId, and lineCount through", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "tests/test_sample.py", "def test_a():\n    assert True\n");
      const facts = analyze(root, "tests/test_sample.py");
      expect(facts.relativePath).toBe("tests/test_sample.py");
      expect(facts.language).toBe("python");
      expect(facts.role).toBe("test");
      expect(facts.analyzerId).toBe(PYTHON_ANALYZER_ID);
      expect(facts.lineCount).toBe(3);
    } finally {
      cleanup(root);
    }
  });
});
