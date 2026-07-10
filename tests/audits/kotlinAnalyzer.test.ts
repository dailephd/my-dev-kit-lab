import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KOTLIN_ANALYZER, KOTLIN_ANALYZER_ID } from "../../src/audits/core/kotlinAnalyzer.js";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import type { SourceFileFacts } from "../../src/audits/core/sourceFacts.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kotlin-analyzer-test-"));
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

function analyze(root: string, relativePath: string): SourceFileFacts {
  const inventory = scanProjectInventory(root);
  const entry = inventory.files.find((f) => f.relativePath === relativePath);
  if (!entry) throw new Error(`fixture setup error: ${relativePath} not found in inventory`);
  const absolutePath = path.join(root, relativePath);
  const content = fs.readFileSync(absolutePath, "utf8");
  const result = KOTLIN_ANALYZER.analyzeFile({
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

describe("KOTLIN_ANALYZER — registration", () => {
  it("declares its id and supported language/extensions", () => {
    expect(KOTLIN_ANALYZER.id).toBe(KOTLIN_ANALYZER_ID);
    expect(KOTLIN_ANALYZER.supportedLanguages).toEqual(["kotlin"]);
    expect(KOTLIN_ANALYZER.supportedExtensions).toEqual([".kt", ".kts"]);
  });
});

describe("KOTLIN_ANALYZER — T6 package/import/declaration extraction", () => {
  it("extracts a package declaration and imports, including an aliased import", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/com/example/Widget.kt",
        ["package com.example", "", "import kotlin.collections.List", "import kotlin.collections.Map as KMap", "", "class Widget"].join(
          "\n"
        ) + "\n"
      );
      const facts = analyze(root, "src/com/example/Widget.kt");
      expect(facts.parseStatus).toBe("parsed");
      expect(facts.imports.some((i) => i.source === "kotlin.collections.List")).toBe(true);
      const aliased = facts.imports.find((i) => i.source === "kotlin.collections.Map");
      expect(aliased?.importedNames).toEqual(["KMap"]);
      expect(facts.imports.every((i) => i.kind === "static")).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("extracts class, data class, interface, object, and enum class declarations", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/Decls.kt",
        [
          "class PublicClass",
          "internal class InternalClass",
          "data class Point(val x: Int, val y: Int)",
          "interface Greeter",
          "object Singleton",
          "enum class Color { RED, GREEN, BLUE }",
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/Decls.kt");
      const byName = Object.fromEntries(facts.declarations.map((d) => [d.name, d]));

      expect(byName.PublicClass.kind).toBe("class");
      expect(byName.PublicClass.exported).toBe(true);

      expect(byName.InternalClass.kind).toBe("class");
      expect(byName.InternalClass.exported).toBe(false);

      expect(byName.Point.kind).toBe("class");
      expect(byName.Point.exported).toBe(true);

      expect(byName.Greeter.kind).toBe("interface");
      expect(byName.Greeter.exported).toBe(true);

      expect(byName.Singleton.kind).toBe("class");
      expect(byName.Singleton.exported).toBe(true);

      expect(byName.Color.kind).toBe("enum");
      expect(byName.Color.exported).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("extracts top-level functions as kind 'function' and member functions as kind 'method'", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/Functions.kt",
        [
          "fun topLevelFun(): Int {",
          "    return 1",
          "}",
          "",
          "private fun privateTopLevel() {}",
          "",
          "class Widget {",
          "    fun publicMember() {}",
          "    private fun privateMember() {}",
          "}",
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/Functions.kt");
      const byName = Object.fromEntries(facts.declarations.map((d) => [d.name, d]));

      expect(byName.topLevelFun.kind).toBe("function");
      expect(byName.topLevelFun.exported).toBe(true);

      expect(byName.privateTopLevel.kind).toBe("function");
      expect(byName.privateTopLevel.exported).toBe(false);

      expect(byName.publicMember.kind).toBe("method");
      expect(byName.publicMember.exported).toBe(true);

      expect(byName.privateMember.kind).toBe("method");
      expect(byName.privateMember.exported).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("records an extension function's own identifier, not its receiver type", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/Extensions.kt", "fun String.shout(): String {\n    return this.uppercase()\n}\n");
      const facts = analyze(root, "src/Extensions.kt");
      expect(facts.declarations.some((d) => d.name === "shout" && d.kind === "function")).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not misclassify if/for/while control flow as declarations", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/ControlFlow.kt",
        [
          "class ControlFlow {",
          "    fun run() {",
          "        if (true) {",
          "        }",
          "        for (i in 0..10) {",
          "        }",
          "        while (true) {",
          "            break",
          "        }",
          "    }",
          "}",
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/ControlFlow.kt");
      const names = facts.declarations.map((d) => d.name);
      expect(names).toEqual(["ControlFlow", "run"]);
    } finally {
      cleanup(root);
    }
  });
});

describe("KOTLIN_ANALYZER — T7 safe degraded behavior", () => {
  it("does not crash and reports parse-error for an unterminated raw string", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/Malformed.kt", 'val text = """this raw string never closes\nfun run() {}\n');
      const facts = analyze(root, "src/Malformed.kt");
      expect(facts.parseStatus).toBe("parse-error");
      expect(facts.diagnostics.some((d) => d.code === "unterminated-raw-string")).toBe(true);
      expect(facts.diagnostics[0].analyzerId).toBe(KOTLIN_ANALYZER_ID);
    } finally {
      cleanup(root);
    }
  });

  it("does not crash and reports parse-error for an unterminated block comment", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/MalformedComment.kt", "class Malformed {\n    /* this comment never closes\n    fun run() {}\n}\n");
      const facts = analyze(root, "src/MalformedComment.kt");
      expect(facts.parseStatus).toBe("parse-error");
      expect(facts.diagnostics.some((d) => d.code === "unterminated-block-comment")).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("reports parsed (no diagnostics) for a syntactically ordinary file", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/Ok.kt", "class Ok\n");
      const facts = analyze(root, "src/Ok.kt");
      expect(facts.parseStatus).toBe("parsed");
      expect(facts.diagnostics).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  it("does not treat braces/quotes inside strings, comments, or raw strings as real code structure", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/Strings.kt",
        [
          "class Strings {",
          '    // a comment with a brace { and a quote "',
          '    val s = "{ not real code }"',
          '    val raw = """also { not real } code"""',
          "    fun run() {}",
          "}",
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/Strings.kt");
      expect(facts.parseStatus).toBe("parsed");
      const byName = Object.fromEntries(facts.declarations.map((d) => [d.name, d]));
      expect(byName.run.kind).toBe("method");
    } finally {
      cleanup(root);
    }
  });
});

describe("KOTLIN_ANALYZER — line counts and identity", () => {
  it("carries relativePath, language, role, analyzerId, and lineCount through", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/test/kotlin/com/example/WidgetSpec.kt", "class WidgetSpec {\n    fun test() {}\n}\n");
      const facts = analyze(root, "src/test/kotlin/com/example/WidgetSpec.kt");
      expect(facts.relativePath).toBe("src/test/kotlin/com/example/WidgetSpec.kt");
      expect(facts.language).toBe("kotlin");
      expect(facts.role).toBe("test");
      expect(facts.analyzerId).toBe(KOTLIN_ANALYZER_ID);
      expect(facts.lineCount).toBe(4);
    } finally {
      cleanup(root);
    }
  });
});
