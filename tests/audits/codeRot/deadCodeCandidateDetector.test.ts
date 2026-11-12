import { createRequire } from "node:module";
import { runAudit } from "../../../src/audits/core/auditRunner.js";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { DEAD_CODE_CANDIDATE_DETECTOR } from "../../../src/audits/codeRot/detectors/deadCodeCandidateDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

// Production-positive fixtures use the actual managed published provider.
// Historical Candidate 05 bytes and differential-comparison fixtures stay unchanged.
const publishedKitRoot = path.dirname(createRequire(import.meta.url).resolve("@dailephd/my-dev-kit/package.json"));

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dead-code-test-"));
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

function buildContext(root: string): AuditDetectorContext {
  const inventory = scanProjectInventory(root);
  const sourceOfTruth = collectSourceOfTruth(root, inventory);
  const target = resolveAuditTarget(undefined, root);
  const config = normalizeAuditConfig({ include: "docs,tests,package,architecture,cli" }, root);
  return { target, config, inventory, sourceOfTruth };
}

async function run(root: string) {
  const ctx = buildContext(root);
  return executeWithKit(ctx);
}

async function runWithSourceFacts(root: string) {
  // The runner supplies qualified facts and its authenticated reader together.
  return executeWithKit(buildContext(root));
}

describe("DEAD_CODE_CANDIDATE_DETECTOR — unreferenced scripts/ files", () => {
  it("flags a scripts/ file not referenced by any package.json script", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { build: "tsc" } }));
      writeFile(root, "scripts/orphan.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('scripts/orphan.ts" is not referenced'))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a scripts/ file referenced by a package.json script", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { thing: "tsx scripts/thing.ts" } }));
      writeFile(root, "scripts/thing.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('scripts/thing.ts" is not referenced'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a scripts/ helper file imported by another script", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { thing: "tsx scripts/thing.ts" } }));
      writeFile(root, "scripts/thing.ts", 'import { helper } from "./helper.js";\nhelper();\n');
      writeFile(root, "scripts/helper.ts", "export function helper() {}\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('scripts/helper.ts" is not referenced'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DEAD_CODE_CANDIDATE_DETECTOR — unreferenced source files", () => {
  it("flags a source file with no in-repo importer", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/orphanModule.ts", "export const x = 1;\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("orphanModule.ts"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a source file imported by another source file", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main.ts", 'import { helper } from "./helper.js";\nhelper();\n');
      writeFile(root, "src/helper.ts", "export function helper() {}\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("helper.ts"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag files under benchmarks/ or examples/ (fixture/example content, not part of the import graph)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "benchmarks/projects/todo/src/service.ts", "export const x = 1;\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("service.ts"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DEAD_CODE_CANDIDATE_DETECTOR — old/deprecated directories", () => {
  it("flags a file under a legacy/ directory not mentioned in docs", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/legacy/oldThing.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("oldThing.ts"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a legacy/ file that is mentioned in docs", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/legacy/oldThing.ts", "export {};\n");
      writeFile(root, "README.md", "See src/legacy/oldThing.ts for the legacy compatibility shim.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("old/deprecated/legacy") && i.title.includes("oldThing.ts"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DEAD_CODE_CANDIDATE_DETECTOR — orphaned generated-looking files", () => {
  it("flags a stray .bak file", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/notes.ts.bak", "// old\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("notes.ts.bak"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a normal source file", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/normal.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.category === "dead-code-candidate" && i.title.includes("Orphaned generated"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DEAD_CODE_CANDIDATE_DETECTOR — source-facts-derived reference evidence", () => {
  it("suppresses a flag for a file only referenced via a dynamic import, when sourceFacts is available", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      // Kit supplies the dynamic import proof for both default and explicit
      // source-facts execution.
      writeFile(root, "src/main.ts", 'export async function load() { return import("./helper.js"); }\n');
      writeFile(root, "src/helper.ts", "export function helper() {}\n");

      const defaultKit = await run(root);
      expect(defaultKit.some((i) => i.title.includes("helper.ts"))).toBe(false);

      const withFacts = await runWithSourceFacts(root);
      expect(withFacts.some((i) => i.title.includes("helper.ts"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("adds source-facts evidence to a flagged issue when the candidate file was parsed", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/orphanModule.ts", "export const x = 1;\n");
      const issues = await runWithSourceFacts(root);
      const issue = issues.find((i) => i.title.includes("orphanModule.ts"));
      expect(issue).toBeDefined();
      const sourceEvidence = issue?.evidence.find((e) => e.message.startsWith("Source facts for"));
      expect(sourceEvidence).toMatchObject({ filePath: "src/orphanModule.ts", kind: "reference", confidence: "medium" });
      expect(sourceEvidence?.message).toContain('Source facts for "src/orphanModule.ts" (typescript)');
      expect(sourceEvidence?.message).toContain("recorded 1 export(s), 1 declaration(s), and 0 import(s)");
    } finally {
      cleanup(root);
    }
  });
});

describe("DEAD_CODE_CANDIDATE_DETECTOR — Python declaration candidates (Batch 2)", () => {
  it("T2: flags an unreferenced module-level Python function/class as a low-confidence candidate, never as a proof-worded claim", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/widget.py", ["def unreferenced_fn():", "    return 1", "", "class UnreferencedClass:", "    pass"].join("\n") + "\n");
      const issues = await runWithSourceFacts(root);
      const fnIssue = issues.find((i) => i.title.includes('"unreferenced_fn"'));
      const classIssue = issues.find((i) => i.title.includes('"UnreferencedClass"'));
      expect(fnIssue).toBeDefined();
      expect(classIssue).toBeDefined();
      for (const issue of [fnIssue, classIssue]) {
        expect(issue?.severity).toBe("info");
        expect(issue?.confidence).toBe("low");
        expect(issue?.falsePositiveRisk).toBe("high");
        // Conservative wording requirement -- never claim the symbol is
        // definitely unused/dead.
        expect(issue?.title.toLowerCase()).not.toContain("is unused");
        expect(issue?.title.toLowerCase()).not.toContain("is dead");
        expect(issue?.description.toLowerCase()).not.toContain("definitely unreferenced");
      }
    } finally {
      cleanup(root);
    }
  });

  it("T3: does not flag a declaration that is imported elsewhere", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/widget.py", "def referenced_fn():\n    return 1\n");
      writeFile(root, "src/consumer.py", "from src.widget import referenced_fn\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"referenced_fn"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T3: does not flag a declaration listed in __all__", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/widget.py", ["__all__ = [\"public_fn\"]", "", "def public_fn():", "    return 1"].join("\n") + "\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"public_fn"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T3: does not flag a leading-underscore (private-convention) declaration", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/widget.py", "def _private_fn():\n    return 1\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"_private_fn"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T3: does not flag any declaration in __init__.py", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/pkg/__init__.py", "def unreferenced_fn():\n    return 1\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"unreferenced_fn"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T3: does not flag a test file's declarations", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "tests/test_widget.py", "def helper_fn():\n    return 1\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"helper_fn"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T3: does not flag common lifecycle/entry-point names (main, run, handler, setup, teardown, __init__, __call__, test_*)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "src/widget.py",
        [
          "def main():",
          "    pass",
          "",
          "def run():",
          "    pass",
          "",
          "def handler():",
          "    pass",
          "",
          "def setup():",
          "    pass",
          "",
          "def teardown():",
          "    pass",
          "",
          "def test_something():",
          "    pass",
          "",
          "class Widget:",
          "    def __init__(self):",
          "        pass",
          "    def __call__(self):",
          "        pass",
        ].join("\n") + "\n"
      );
      const issues = await runWithSourceFacts(root);
      for (const name of ["main", "run", "handler", "setup", "teardown", "test_something"]) {
        expect(issues.some((i) => i.title.includes(`"${name}"`))).toBe(false);
      }
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a class method (conservative -- no method-level dead-code evidence for any language)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/widget.py", "class Widget:\n    def unreferenced_method(self):\n        return 1\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"unreferenced_method"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("fails closed when authenticated source content is absent from the detector context", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/widget.py", "def unreferenced_fn():\n    return 1\n");
      await expect(DEAD_CODE_CANDIDATE_DETECTOR.run(buildContext(root))).rejects.toMatchObject({
        category: "invalid-request",
      });
    } finally {
      cleanup(root);
    }
  });
});

describe("DEAD_CODE_CANDIDATE_DETECTOR — Java declaration candidates (v0.3.3 Batch 2)", () => {
  it("T2: flags an unreferenced package-private Java class as a low-confidence candidate, never as a proof-worded claim", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main/java/com/example/Unreferenced.java", "package com.example;\n\nclass Unreferenced {\n}\n");
      const issues = await runWithSourceFacts(root);
      const issue = issues.find((i) => i.title.includes('"Unreferenced"'));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("info");
      expect(issue?.confidence).toBe("low");
      expect(issue?.falsePositiveRisk).toBe("high");
      expect(issue?.title.toLowerCase()).not.toContain("is unused");
      expect(issue?.title.toLowerCase()).not.toContain("is dead");
      expect(issue?.description.toLowerCase()).not.toContain("definitely unreferenced");
      expect(issue?.description).toContain("no compiler/classpath analysis was performed");
      expect(issue?.description).toContain("no Gradle/Maven execution was performed");
    } finally {
      cleanup(root);
    }
  });

  it("T3: does not flag a public Java class", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main/java/com/example/PublicThing.java", "package com.example;\n\npublic class PublicThing {\n}\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"PublicThing"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T3: does not flag a Java constructor (represented as kind 'method', excluded entirely)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "src/main/java/com/example/Widget.java",
        "package com.example;\n\nclass Widget {\n    Widget(String name) {\n    }\n}\n"
      );
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"Widget"') && i.title.includes("method"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T3: does not flag common lifecycle/Object-override/bean-accessor names (main, toString, equals, hashCode, get*, set*, is*)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "src/main/java/com/example/Widget.java",
        [
          "package com.example;",
          "",
          "class Widget {",
          "    void main() {}",
          "    String toString() { return \"\"; }",
          "    boolean equals(Object o) { return false; }",
          "    int hashCode() { return 0; }",
          "    String getName() { return null; }",
          "    void setName(String n) {}",
          "    boolean isReady() { return false; }",
          "}",
        ].join("\n") + "\n"
      );
      const issues = await runWithSourceFacts(root);
      // All of these are kind "method" and therefore already excluded
      // entirely, but this test protects the intent directly (never
      // flagged by name, regardless of kind-based exclusion changing).
      for (const name of ["main", "toString", "equals", "hashCode", "getName", "setName", "isReady"]) {
        expect(issues.some((i) => i.title.includes(`"${name}"`))).toBe(false);
      }
    } finally {
      cleanup(root);
    }
  });

  it("T3: does not flag a test file's Java declarations", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/test/java/com/example/HelperTest.java", "package com.example;\n\nclass HelperInTest {\n}\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"HelperInTest"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T3: does not flag a declaration referenced by an import elsewhere in the project", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main/java/com/example/Referenced.java", "package com.example;\n\nclass Referenced {\n}\n");
      writeFile(root, "src/main/java/com/example/Consumer.java", "package com.example;\n\nimport com.example.Referenced;\n\nclass Consumer {\n}\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"Referenced"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DEAD_CODE_CANDIDATE_DETECTOR — Kotlin declaration candidates (v0.3.3 Batch 2)", () => {
  it("T4: flags an unreferenced internal top-level Kotlin function as a low-confidence candidate, never as a proof-worded claim", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main/kotlin/com/example/Widget.kt", "package com.example\n\ninternal fun unreferencedFn() {\n}\n");
      const issues = await runWithSourceFacts(root);
      const issue = issues.find((i) => i.title.includes('"unreferencedFn"'));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("info");
      expect(issue?.confidence).toBe("low");
      expect(issue?.falsePositiveRisk).toBe("high");
      expect(issue?.title.toLowerCase()).not.toContain("is unused");
      expect(issue?.title.toLowerCase()).not.toContain("is dead");
    } finally {
      cleanup(root);
    }
  });

  it("T4: flags an unreferenced private top-level Kotlin class as a low-confidence candidate", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main/kotlin/com/example/Widget.kt", "package com.example\n\nprivate class UnreferencedThing\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"UnreferencedThing"'))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("T5: does not flag a public-by-default Kotlin class", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main/kotlin/com/example/PublicThing.kt", "package com.example\n\nclass PublicThing\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"PublicThing"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T5: does not flag data-class generated-like member names (copy, component1)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "src/main/kotlin/com/example/Point.kt",
        ["package com.example", "", "class Point {", "    fun copy(): Point { return this }", "    fun component1(): Int { return 0 }", "}"].join(
          "\n"
        ) + "\n"
      );
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"copy"'))).toBe(false);
      expect(issues.some((i) => i.title.includes('"component1"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T5: does not flag common lifecycle names (main, test*) or a test file's declarations", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main/kotlin/com/example/Widget.kt", "package com.example\n\ninternal fun main() {\n}\n\ninternal fun testHelper() {\n}\n");
      writeFile(root, "src/test/kotlin/com/example/WidgetSpec.kt", "package com.example\n\ninternal class HelperInTest\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"main"'))).toBe(false);
      expect(issues.some((i) => i.title.includes('"testHelper"'))).toBe(false);
      expect(issues.some((i) => i.title.includes('"HelperInTest"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T5: does not flag a Kotlin member function (conservative -- no method-level dead-code evidence for any language)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "src/main/kotlin/com/example/Widget.kt",
        "package com.example\n\nclass Widget {\n    internal fun unreferencedMember() {\n    }\n}\n"
      );
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"unreferencedMember"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T5: does not flag a declaration referenced by an import elsewhere in the project", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main/kotlin/com/example/Referenced.kt", "package com.example\n\ninternal class Referenced\n");
      writeFile(root, "src/main/kotlin/com/example/Consumer.kt", "package com.example\n\nimport com.example.Referenced\n\nclass Consumer\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"Referenced"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DEAD_CODE_CANDIDATE_DETECTOR — real self-scan regression guard", () => {
  it("fails closed when the real repository contains unqualified required import evidence", async () => {
    await expect(run(process.cwd())).rejects.toMatchObject({ category: "capability-insufficient" });
  }, 1800000);

  // Qualified bounded cases retain the finding-policy assertions independently
  // of the real repository acquisition failure above.
  it("keeps qualified Python declaration candidates conservative without treating acquisition failure as empty findings", async () => {
    const root = makeTempDir();
    try {
    writeFile(root, "package.json", JSON.stringify({ name: "qualified-python-guard", version: "1.0.0" }));
    writeFile(root, "src/unused.py", "def unreferenced_fn():\n    return 1\n");
    const issues = await runWithSourceFacts(root);
    const nonInfoLow = issues.filter((i) => i.severity !== "info" && i.severity !== "low");
    expect(nonInfoLow).toEqual([]);
    const pythonDeclIssues = issues.filter((i) => i.id.startsWith(`${"dead-code-candidate"}:unreferenced-python-declaration:`));
    expect(pythonDeclIssues.length).toBeGreaterThan(0);
    expect(pythonDeclIssues.every((i) => i.severity === "info")).toBe(true);
    expect(pythonDeclIssues.every((i) => i.confidence === "low")).toBe(true);
    } finally { cleanup(root); }
  }, 1800000);
});

// Real whole-repository acquisition performs paged CLI queries for every selected file.
// Its integration timeout includes those queries; finding assertions remain unchanged.
// Test setup delegates source acquisition to the real qualified provider.
let selfRun: Promise<Awaited<ReturnType<typeof DEAD_CODE_CANDIDATE_DETECTOR.run>>> | undefined;
async function executeWithKit(ctx: AuditDetectorContext) {
  const perform = async () => {
  const result = await runAudit({ config: ctx.config, toolRoot: ctx.target.rootPath, target: ctx.target, registry: [DEAD_CODE_CANDIDATE_DETECTOR],
    kitSourceProviderDependencies: { installedPackageRoot: publishedKitRoot } });
  if (result.detectorErrors.length) throw new Error(JSON.stringify(result.detectorErrors));
  return result.issues;

  };
  if (path.resolve(ctx.target.rootPath) === path.resolve(process.cwd())) return selfRun ??= perform();
  return perform();
}
