import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TYPESCRIPT_JAVASCRIPT_ANALYZER,
  TYPESCRIPT_JAVASCRIPT_ANALYZER_ID,
} from "../../src/audits/core/typescriptJavaScriptAnalyzer.js";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import type { SourceFileFacts } from "../../src/audits/core/sourceFacts.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ts-js-analyzer-test-"));
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

// Builds an AnalyzeFileInput the same way collectSourceFacts.ts does: scan a
// real temp-dir fixture with the real inventory scanner, then hand the real
// InventoryFileEntry + file content to the analyzer directly (bypassing the
// collector) so these tests isolate analyzer behavior specifically.
function analyze(root: string, relativePath: string): SourceFileFacts {
  const inventory = scanProjectInventory(root);
  const entry = inventory.files.find((f) => f.relativePath === relativePath);
  if (!entry) throw new Error(`fixture setup error: ${relativePath} not found in inventory`);
  const absolutePath = path.join(root, relativePath);
  const content = fs.readFileSync(absolutePath, "utf8");
  const result = TYPESCRIPT_JAVASCRIPT_ANALYZER.analyzeFile({
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

describe("TYPESCRIPT_JAVASCRIPT_ANALYZER — registration", () => {
  it("declares its id and supported languages/extensions", () => {
    expect(TYPESCRIPT_JAVASCRIPT_ANALYZER.id).toBe(TYPESCRIPT_JAVASCRIPT_ANALYZER_ID);
    expect(TYPESCRIPT_JAVASCRIPT_ANALYZER.supportedLanguages).toEqual(["typescript", "javascript"]);
    expect(TYPESCRIPT_JAVASCRIPT_ANALYZER.supportedExtensions).toEqual(
      expect.arrayContaining([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"])
    );
  });
});

describe("TYPESCRIPT_JAVASCRIPT_ANALYZER — TypeScript facts", () => {
  it("extracts static imports with imported names", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/imports.ts",
        [
          `import Default from "default-module";`,
          `import { a, b as c } from "named-module";`,
          `import * as ns from "namespace-module";`,
          `import "side-effect-module";`,
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/imports.ts");
      expect(facts.parseStatus).toBe("parsed");
      const sources = facts.imports.map((i) => i.source);
      expect(sources).toEqual(["default-module", "named-module", "namespace-module", "side-effect-module"]);
      const defaultImport = facts.imports.find((i) => i.source === "default-module");
      expect(defaultImport?.kind).toBe("static");
      expect(defaultImport?.importedNames).toEqual(["Default"]);
      const namedImport = facts.imports.find((i) => i.source === "named-module");
      expect(namedImport?.importedNames).toEqual(["a", "c"]);
      const nsImport = facts.imports.find((i) => i.source === "namespace-module");
      expect(nsImport?.importedNames).toEqual(["ns"]);
    } finally {
      cleanup(root);
    }
  });

  it("extracts re-exports (export ... from)", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/reexports.ts",
        [`export { a, b as c } from "named-source";`, `export * from "star-source";`, `export * as ns from "ns-source";`].join(
          "\n"
        ) + "\n"
      );
      const facts = analyze(root, "src/reexports.ts");
      expect(facts.parseStatus).toBe("parsed");
      const reExportSources = facts.imports.filter((i) => i.kind === "re-export").map((i) => i.source);
      expect(reExportSources).toEqual(["named-source", "star-source", "ns-source"]);

      expect(facts.exports).toEqual(
        expect.arrayContaining([
          { name: "a", kind: "named", line: expect.any(Number) },
          { name: "c", kind: "named", line: expect.any(Number) },
          { name: "*", kind: "namespace", line: expect.any(Number) },
          { name: "ns", kind: "namespace", line: expect.any(Number) },
        ])
      );
    } finally {
      cleanup(root);
    }
  });

  it("extracts named and default exports", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/exports.ts",
        [
          `export function namedFn() {}`,
          `export default function defaultFn() {}`,
          `const local = 1;`,
          `export { local };`,
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/exports.ts");
      expect(facts.parseStatus).toBe("parsed");
      expect(facts.exports).toEqual(
        expect.arrayContaining([
          { name: "namedFn", kind: "named", line: expect.any(Number) },
          { name: "defaultFn", kind: "default", line: expect.any(Number) },
          { name: "local", kind: "named", line: expect.any(Number) },
        ])
      );
    } finally {
      cleanup(root);
    }
  });

  it("extracts function/class/interface/type/enum/variable declarations", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/declarations.ts",
        [
          `function plainFn() {}`,
          `class PlainClass {}`,
          `interface PlainInterface {}`,
          `type PlainType = string;`,
          `enum PlainEnum { A, B }`,
          `const plainConst = 1;`,
          `let plainVar = 2;`,
          `const arrowConst = () => {};`,
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/declarations.ts");
      expect(facts.parseStatus).toBe("parsed");
      const byName = Object.fromEntries(facts.declarations.map((d) => [d.name, d.kind]));
      expect(byName.plainFn).toBe("function");
      expect(byName.PlainClass).toBe("class");
      expect(byName.PlainInterface).toBe("interface");
      expect(byName.PlainType).toBe("type");
      expect(byName.PlainEnum).toBe("enum");
      expect(byName.plainConst).toBe("constant");
      expect(byName.plainVar).toBe("variable");
      expect(byName.arrowConst).toBe("constant");
      for (const d of facts.declarations) expect(d.exported).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("marks declarations exported when syntactically exported", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/exported-decl.ts", `export class ExportedClass {}\n`);
      const facts = analyze(root, "src/exported-decl.ts");
      const decl = facts.declarations.find((d) => d.name === "ExportedClass");
      expect(decl?.exported).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("extracts method declarations inside a class", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/methods.ts", `class WithMethods {\n  doThing() {}\n}\n`);
      const facts = analyze(root, "src/methods.ts");
      expect(facts.declarations.some((d) => d.name === "doThing" && d.kind === "method")).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("extracts require() and dynamic import() as commonjs/dynamic imports", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/mixed-imports.ts",
        [`const fs = require("node:fs");`, `async function loadLazy() { return import("lazy-module"); }`].join("\n") + "\n"
      );
      const facts = analyze(root, "src/mixed-imports.ts");
      const commonjsImport = facts.imports.find((i) => i.kind === "commonjs");
      const dynamicImport = facts.imports.find((i) => i.kind === "dynamic");
      expect(commonjsImport?.source).toBe("node:fs");
      expect(dynamicImport?.source).toBe("lazy-module");
      // "require" itself must not also appear as a call reference -- it's
      // already represented as an import fact.
      expect(facts.references.some((r) => r.name === "require")).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("extracts conservative call-expression references", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/refs.ts", `function helper() {}\nhelper();\n`);
      const facts = analyze(root, "src/refs.ts");
      expect(facts.references).toEqual(expect.arrayContaining([{ name: "helper", kind: "call", line: expect.any(Number) }]));
    } finally {
      cleanup(root);
    }
  });

  it("handles .tsx files (JSX)", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/Component.tsx",
        [`import React from "react";`, `export function Component() { return <div>hi</div>; }`].join("\n") + "\n"
      );
      const facts = analyze(root, "src/Component.tsx");
      expect(facts.parseStatus).toBe("parsed");
      expect(facts.imports.some((i) => i.source === "react")).toBe(true);
      expect(facts.exports.some((e) => e.name === "Component")).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("handles .mts and .cts files", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/module.mts", `export const mtsValue = 1;\n`);
      writeFile(root, "src/module.cts", `export const ctsValue = 1;\n`);
      const mtsFacts = analyze(root, "src/module.mts");
      const ctsFacts = analyze(root, "src/module.cts");
      expect(mtsFacts.parseStatus).toBe("parsed");
      expect(mtsFacts.language).toBe("typescript");
      expect(mtsFacts.exports.some((e) => e.name === "mtsValue")).toBe(true);
      expect(ctsFacts.parseStatus).toBe("parsed");
      expect(ctsFacts.exports.some((e) => e.name === "ctsValue")).toBe(true);
    } finally {
      cleanup(root);
    }
  });
});

describe("TYPESCRIPT_JAVASCRIPT_ANALYZER — JavaScript facts", () => {
  it("extracts ESM imports/exports in a .js file", () => {
    const root = makeTempDir();
    try {
      // Uses a bare (non-relative) specifier rather than a real relative
      // path like "./helper.js" -- a relative specifier here would itself
      // get flagged by this repo's own testRotDetector as "imports a missing
      // source file" (a naive text scan over this very test file, not an
      // analyzer bug), which is pure self-audit noise unrelated to what this
      // test is verifying.
      writeFile(root, "src/esm.js", [`import { helper } from "esm-helper-module";`, `export function useHelper() { return helper(); }`].join("\n") + "\n");
      const facts = analyze(root, "src/esm.js");
      expect(facts.parseStatus).toBe("parsed");
      expect(facts.imports.some((i) => i.source === "esm-helper-module")).toBe(true);
      expect(facts.exports.some((e) => e.name === "useHelper")).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("extracts CommonJS require/module.exports/exports.name", () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "src/commonjs.js",
        [
          `const path = require("node:path");`,
          `function helper() { return path.sep; }`,
          `module.exports = helper;`,
          `exports.named = helper;`,
        ].join("\n") + "\n"
      );
      const facts = analyze(root, "src/commonjs.js");
      expect(facts.imports.some((i) => i.source === "node:path" && i.kind === "commonjs")).toBe(true);
      expect(facts.exports).toEqual(
        expect.arrayContaining([
          { name: "module.exports", kind: "commonjs", line: expect.any(Number) },
          { name: "named", kind: "commonjs", line: expect.any(Number) },
        ])
      );
    } finally {
      cleanup(root);
    }
  });

  it("handles .mjs and .cjs files", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/module.mjs", `export const mjsValue = 1;\n`);
      writeFile(root, "src/module.cjs", `module.exports = { cjsValue: 1 };\n`);
      const mjsFacts = analyze(root, "src/module.mjs");
      const cjsFacts = analyze(root, "src/module.cjs");
      expect(mjsFacts.parseStatus).toBe("parsed");
      expect(mjsFacts.language).toBe("javascript");
      expect(mjsFacts.exports.some((e) => e.name === "mjsValue")).toBe(true);
      expect(cjsFacts.parseStatus).toBe("parsed");
      expect(cjsFacts.exports.some((e) => e.name === "module.exports")).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("handles JSX in a .jsx file", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/Component.jsx", `export function Component() { return <div>hi</div>; }\n`);
      const facts = analyze(root, "src/Component.jsx");
      expect(facts.parseStatus).toBe("parsed");
      expect(facts.exports.some((e) => e.name === "Component")).toBe(true);
    } finally {
      cleanup(root);
    }
  });
});

describe("TYPESCRIPT_JAVASCRIPT_ANALYZER — parse diagnostics", () => {
  it("does not crash on a malformed TypeScript file and reports parse-error", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/malformed.ts", `function broken( {\n  const x = ;\n`);
      const facts = analyze(root, "src/malformed.ts");
      expect(facts.parseStatus).toBe("parse-error");
      expect(facts.diagnostics.length).toBeGreaterThan(0);
      expect(facts.diagnostics[0].analyzerId).toBe(TYPESCRIPT_JAVASCRIPT_ANALYZER_ID);
      expect(facts.diagnostics[0].severity).toBe("error");
    } finally {
      cleanup(root);
    }
  });

  it("does not crash on a malformed JavaScript file and reports parse-error", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/malformed.js", `function broken( {\n`);
      const facts = analyze(root, "src/malformed.js");
      expect(facts.parseStatus).toBe("parse-error");
      expect(facts.diagnostics.length).toBeGreaterThan(0);
    } finally {
      cleanup(root);
    }
  });

  it("reports parsed (no diagnostics) for syntactically valid files", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/valid.ts", `export const ok = 1;\n`);
      const facts = analyze(root, "src/valid.ts");
      expect(facts.parseStatus).toBe("parsed");
      expect(facts.diagnostics).toEqual([]);
    } finally {
      cleanup(root);
    }
  });
});

describe("TYPESCRIPT_JAVASCRIPT_ANALYZER — line counts and identity", () => {
  it("carries relativePath, language, role, analyzerId, and lineCount through", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "tests/sample.test.ts", `export const x = 1;\nexport const y = 2;\n`);
      const facts = analyze(root, "tests/sample.test.ts");
      expect(facts.relativePath).toBe("tests/sample.test.ts");
      expect(facts.language).toBe("typescript");
      expect(facts.role).toBe("test");
      expect(facts.analyzerId).toBe(TYPESCRIPT_JAVASCRIPT_ANALYZER_ID);
      // Batch 1's line-count convention counts the trailing newline as a
      // 3rd (empty) line -- see projectInventory.ts's tryCountLines().
      expect(facts.lineCount).toBe(3);
    } finally {
      cleanup(root);
    }
  });
});
