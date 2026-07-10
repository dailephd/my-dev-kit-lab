import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JAVA_ANALYZER, JAVA_ANALYZER_ID } from "../../src/audits/core/javaAnalyzer.js";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import type { SourceFileFacts } from "../../src/audits/core/sourceFacts.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "java-analyzer-test-"));
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

// Mirrors pythonAnalyzer.test.ts's analyze() helper.
function analyze(root: string, relativePath: string): SourceFileFacts {
  const inventory = scanProjectInventory(root);
  const entry = inventory.files.find((f) => f.relativePath === relativePath);
  if (!entry) throw new Error(`fixture setup error: ${relativePath} not found in inventory`);
  const absolutePath = path.join(root, relativePath);
  const content = fs.readFileSync(absolutePath, "utf8");
  const result = JAVA_ANALYZER.analyzeFile({
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

describe("JAVA_ANALYZER — registration", () => {
  it("declares its id and supported language/extension", () => {
    expect(JAVA_ANALYZER.id).toBe(JAVA_ANALYZER_ID);
    expect(JAVA_ANALYZER.supportedLanguages).toEqual(["java"]);
    expect(JAVA_ANALYZER.supportedExtensions).toEqual([".java"]);
  });
});

describe("JAVA_ANALYZER — T4 package/import/declaration extraction", () => {
  it("extracts a package declaration, static and non-static imports", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/com/example/Widget.java",
        [
          "package com.example;",
          "",
          "import java.util.List;",
          "import static java.util.Collections.emptyList;",
          "",
          "public class Widget {",
          "}",
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/com/example/Widget.java");
      expect(facts.parseStatus).toBe("parsed");
      expect(facts.imports.some((i) => i.source === "java.util.List")).toBe(true);
      expect(facts.imports.some((i) => i.source === "java.util.Collections.emptyList")).toBe(true);
      expect(facts.imports.every((i) => i.kind === "static")).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("extracts class, interface, and enum declarations with visibility folded into exported", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/Decls.java",
        [
          "public class PublicClass {",
          "}",
          "",
          "class PackagePrivateClass {",
          "}",
          "",
          "public interface PublicInterface {",
          "}",
          "",
          "public enum Color {",
          "    RED, GREEN, BLUE",
          "}",
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/Decls.java");
      const byName = Object.fromEntries(facts.declarations.map((d) => [d.name, d]));

      expect(byName.PublicClass.kind).toBe("class");
      expect(byName.PublicClass.exported).toBe(true);

      expect(byName.PackagePrivateClass.kind).toBe("class");
      expect(byName.PackagePrivateClass.exported).toBe(false);

      expect(byName.PublicInterface.kind).toBe("interface");
      expect(byName.PublicInterface.exported).toBe(true);

      expect(byName.Color.kind).toBe("enum");
      expect(byName.Color.exported).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("extracts method declarations directly inside a class body, distinct visibility per method", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/Service.java",
        [
          "public class Service {",
          "    public void doPublicThing() {",
          "        int x = 1;",
          "    }",
          "",
          "    private int doPrivateThing(String name) {",
          "        return name.length();",
          "    }",
          "",
          "    protected boolean flag() { return true; }",
          "}",
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/Service.java");
      const byName = Object.fromEntries(facts.declarations.map((d) => [d.name, d]));

      expect(byName.doPublicThing.kind).toBe("method");
      expect(byName.doPublicThing.exported).toBe(true);
      expect(byName.doPrivateThing.kind).toBe("method");
      expect(byName.doPrivateThing.exported).toBe(false);
      expect(byName.flag.kind).toBe("method");
      expect(byName.flag.exported).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("extracts a constructor as kind 'method' by matching the enclosing class name", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/Widget.java",
        ["public class Widget {", "    public Widget(String name) {", "        this.name = name;", "    }", "}"].join(
          "\n"
        ) + "\n"
      );
      const facts = analyze(root, "src/Widget.java");
      const ctor = facts.declarations.find((d) => d.name === "Widget" && d.line !== 1);
      expect(ctor).toBeDefined();
      expect(ctor?.kind).toBe("method");
      expect(ctor?.exported).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not misclassify if/for/while/switch statements or plain method calls as declarations", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/ControlFlow.java",
        [
          "public class ControlFlow {",
          "    public void run() {",
          "        if (true) {",
          "        }",
          "        for (int i = 0; i < 10; i++) {",
          "        }",
          "        while (true) {",
          "            break;",
          "        }",
          "        someObject.doSomething();",
          "    }",
          "}",
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/ControlFlow.java");
      const names = facts.declarations.map((d) => d.name);
      expect(names).toEqual(["ControlFlow", "run"]);
    } finally {
      cleanup(root);
    }
  });

  it("keeps nested class methods distinct from outer-class methods at the correct scope depth", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/Outer.java",
        [
          "public class Outer {",
          "    public void outerMethod() {}",
          "",
          "    public static class Inner {",
          "        public void innerMethod() {}",
          "    }",
          "}",
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/Outer.java");
      const byName = Object.fromEntries(facts.declarations.map((d) => [d.name, d]));
      expect(byName.outerMethod.kind).toBe("method");
      expect(byName.Inner.kind).toBe("class");
      expect(byName.innerMethod.kind).toBe("method");
    } finally {
      cleanup(root);
    }
  });
});

describe("JAVA_ANALYZER — T5 safe degraded behavior", () => {
  it("does not crash and reports parse-error for an unterminated block comment", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/Malformed.java",
        ["public class Malformed {", "    /* this comment never closes", "    public void run() {}", "}"].join("\n") +
          "\n"
      );
      const facts = analyze(root, "src/Malformed.java");
      expect(facts.parseStatus).toBe("parse-error");
      expect(facts.diagnostics.some((d) => d.code === "unterminated-block-comment")).toBe(true);
      expect(facts.diagnostics[0].analyzerId).toBe(JAVA_ANALYZER_ID);
    } finally {
      cleanup(root);
    }
  });

  it("reports parsed (no diagnostics) for a syntactically ordinary file", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/Ok.java", "public class Ok {\n}\n");
      const facts = analyze(root, "src/Ok.java");
      expect(facts.parseStatus).toBe("parsed");
      expect(facts.diagnostics).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  it("does not treat braces/quotes inside strings or comments as real code structure", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/Strings.java",
        [
          "public class Strings {",
          '    // a comment with a brace { and a quote "',
          '    String s = "{ not real code }";',
          "    public void run() {}",
          "}",
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/Strings.java");
      expect(facts.parseStatus).toBe("parsed");
      const byName = Object.fromEntries(facts.declarations.map((d) => [d.name, d]));
      expect(byName.run.kind).toBe("method");
    } finally {
      cleanup(root);
    }
  });
});

describe("JAVA_ANALYZER — line counts and identity", () => {
  it("carries relativePath, language, role, analyzerId, and lineCount through", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/test/java/com/example/WidgetTest.java",
        ["public class WidgetTest {", "    public void testSomething() {}", "}"].join("\n") + "\n"
      );
      const facts = analyze(root, "src/test/java/com/example/WidgetTest.java");
      expect(facts.relativePath).toBe("src/test/java/com/example/WidgetTest.java");
      expect(facts.language).toBe("java");
      expect(facts.role).toBe("test");
      expect(facts.analyzerId).toBe(JAVA_ANALYZER_ID);
      // 3 physical content lines + the scanner's trailing-newline
      // convention (see pythonAnalyzer.test.ts's identical "N content lines
      // -> N+1 lineCount" pattern with a trailing newline).
      expect(facts.lineCount).toBe(4);
    } finally {
      cleanup(root);
    }
  });
});
