import { KitSourceEvidenceAcquisitionError, registerKitDeclarationPredicateEvidence, type KitFact, type KitFileRecord, type KitSourceEvidence } from "../../../src/audits/core/kitSourceEvidence.js";
import { createNotCollectedSourceFacts, type KitSourceReader } from "../../../src/audits/core/kitSourceProvider.js";
import type { SourceFileFacts } from "../../../src/audits/core/sourceFacts.js";
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
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { thing: "node scripts/thing.mjs" } }));
      writeFile(root, "scripts/thing.mjs", 'import { helper } from "./helper.mjs";\nhelper();\n');
      writeFile(root, "scripts/helper.mjs", "export function helper() {}\n");
      const result = await runAudit({ config: buildContext(root).config, toolRoot: root, registry: [DEAD_CODE_CANDIDATE_DETECTOR] });
      expect(result.sourceFacts.files.find(file => file.relativePath === "scripts/thing.mjs")?.imports)
        .toContainEqual(expect.objectContaining({ source: "./helper.mjs", importResolution: "resolved-local",
          targetPaths: ["scripts/helper.mjs"] }));
      expect(result.exitCode, JSON.stringify(result.detectorErrors)).toBe(0);
      expect(result.coverage).toContainEqual(expect.objectContaining({
        predicate: "unreferenced-script-file", actualStatus: "positive-witness", status: "NOT_APPLICABLE",
      }));
      const issues = result.issues;
      expect(issues.some((i) => i.title.includes('scripts/helper.mjs" is not referenced'))).toBe(false);
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
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { start: "node src/main.mjs" } }));
      writeFile(root, "src/main.mjs", 'import { helper } from "./helper.mjs";\nhelper();\n');
      writeFile(root, "src/helper.mjs", "export function helper() {}\n");
      const result = await runAudit({ config: buildContext(root).config, toolRoot: root, registry: [DEAD_CODE_CANDIDATE_DETECTOR] });
      expect(result.exitCode, JSON.stringify(result.detectorErrors)).toBe(0);
      expect(result.issues.some(issue => issue.affectedFiles.includes("src/helper.mjs"))).toBe(false);
      expect(result.coverage).toContainEqual(expect.objectContaining({
        predicate: "unreferenced-source-file",
        source: { kind: "domain", identity: "eligible selected file candidates" },
        status: "NOT_APPLICABLE", actualStatus: "positive-witness",
        reason: "Every eligible candidate has an authenticated positive path witness.",
      }));
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
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { start: "node src/main.mjs" } }));
      // Kit supplies the dynamic import proof for both default and explicit
      // source-facts execution.
      writeFile(root, "src/main.mjs", 'export async function load() { return import("./helper.mjs"); }\n');
      writeFile(root, "src/helper.mjs", "export function helper() {}\n");

      const result = await runAudit({ config: buildContext(root).config, toolRoot: root, registry: [DEAD_CODE_CANDIDATE_DETECTOR] });
      expect(result.exitCode, JSON.stringify(result.detectorErrors)).toBe(0);
      expect(result.issues.some(issue => issue.affectedFiles.includes("src/helper.mjs"))).toBe(false);
      expect(result.coverage).toContainEqual(expect.objectContaining({
        predicate: "unreferenced-source-file",
        source: { kind: "domain", identity: "eligible selected file candidates" },
        status: "NOT_APPLICABLE", actualStatus: "positive-witness",
        reason: "Every eligible candidate has an authenticated positive path witness.",
      }));
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

describe("DEAD_CODE_CANDIDATE_DETECTOR — bounded coverage regression guard", () => {
  it("retains deprecated findings when JVM target proof cannot qualify a declaration domain", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "jvm-domain-gap", version: "1.0.0" }));
      writeFile(root, "src/main/kotlin/com/example/Foo.kt", "package com.example\nclass Foo {}\n");
      writeFile(root, "src/test/kotlin/com/example/FooSpec.kt", "package com.example\nimport com.example.Foo as Bar\nclass FooSpec {}\n");
      writeFile(root, "src/old/retired.ts", "// independent deprecated finding\n");
      const result = await runAudit({ config: buildContext(root).config, toolRoot: root, registry: [DEAD_CODE_CANDIDATE_DETECTOR] });
      expect(result.exitCode).toBe(2);
      expect(result.issues.some(i => i.title.includes("old/deprecated"))).toBe(true);
      expect(result.coverage!.some(c => c.status === "UNAVAILABLE" && c.reason.includes("JVM_DECLARATION_DOMAIN_INCOMPLETE"))).toBe(true);
      expect(result.issues.some(i => i.title.includes("no detected in-repo importer"))).toBe(false);
    } finally { cleanup(root); }
  }, 120000);

  it("records unavailable reverse-reference coverage for a complete local inventory with an unresolved cross-file target", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "domain-gap", version: "1.0.0" }));
      writeFile(root, "src/importer.ts", "import '../unselected/hidden.js';\n");
      writeFile(root, "src/candidate.ts", "export const candidate = 1;\n");
      writeFile(root, "src/old/retired.ts", "// independently deprecated\n");
      writeFile(root, "src/orphan.generated.ts", "// independently orphaned\n");
      const ctx = buildContext(root);
      const result = await runAudit({ config: ctx.config, toolRoot: root, registry: [DEAD_CODE_CANDIDATE_DETECTOR] });
      expect(result.sourceFacts.files.every(f => f.kit?.capabilities.imports === "complete")).toBe(true);
      expect(result.exitCode).toBe(2);
      expect(result.coverage!.some(c => c.predicate === "unreferenced-source-file" && c.status === "UNAVAILABLE" && c.reason.includes("outside-selected-roots"))).toBe(true);
      expect(result.issues.some(i => i.title.includes("no detected in-repo importer"))).toBe(false);
      expect(result.issues.some(i => i.title.includes("old/deprecated"))).toBe(true);
      expect(result.issues.some(i => i.affectedFiles.includes("src/orphan.generated.ts"))).toBe(true);
    } finally { cleanup(root); }
  }, 120000);

  it("keeps dynamic imports mandatory for file candidates but outside the Python declaration premise", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/candidate.ts", "export const candidate = 1;\n");
      writeFile(root, "src/task.py", "def unused_task():\n    return 1\n");
      writeFile(root, "tests/check.test.ts", "declare const target: string;\nvoid import(target);\n");
      const ctx = buildContext(root);
      ctx.config.failOn = "none";
      const result = await runAudit({ config: ctx.config, toolRoot: root, registry: [DEAD_CODE_CANDIDATE_DETECTOR] });
      const records = result.coverage?.filter(c => c.source.identity === "tests/check.test.ts") ?? [];
      expect(records.filter(c => c.mandatory).map(c => [c.predicate, c.status])).toEqual([
        ["unreferenced-source-file", "UNAVAILABLE"],
      ]);
      expect(records, JSON.stringify(records)).toContainEqual(expect.objectContaining({
        predicate: "declarations evidence", capability: "declarations", actualStatus: "complete",
        reason: "dead-code-candidate has no declarations predicate for this file role and selected include areas.",
        status: "NOT_APPLICABLE", mandatory: false,
      }));
      expect(result.issues.map(i => i.title)).toEqual([expect.stringContaining('"unused_task"')]);
      expect(result.exitCode).toBe(2);
    } finally { cleanup(root); }
  }, 120000);

  it("limits JVM binding uncertainty to families with selected JVM candidates", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/candidate.ts", "export const candidate = 1;\n");
      writeFile(root, "src/task.py", "def unused_task():\n    return 1\n");
      writeFile(root, "src/test/kotlin/com/example/Check.kt", "package com.example\nimport sample.library.Unresolved\nclass Check\n");
      const result = await runAudit({ config: buildContext(root).config, toolRoot: root, registry: [DEAD_CODE_CANDIDATE_DETECTOR] });
      const records = result.coverage?.filter(c => c.reason.startsWith("JVM import sample.library.Unresolved"));
      expect(records?.map(c => [c.predicate, c.status, c.mandatory])).toEqual([
        ["unreferenced-source-file", "NOT_APPLICABLE", false],
        ["possibly-unreferenced-python-declaration", "NOT_APPLICABLE", false],
      ]);
      expect(result.exitCode).toBe(0);
    } finally { cleanup(root); }
  }, 120000);

  // Complete bounded cases retain the existing finding-policy assertions.
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
describe("fixture-reference positive and negative premises", () => {
  it.each(["absent", "present", "incomplete", "stale"] as const)(
    "uses authenticated byte occurrences for exact fixture basenames: %s", async outcome => {
      const root = makeTempDir();
      try {
        const input = "tests/data.properties";
        const target = "fixtures/Core.java";
        const basename = "Core.java";
        writeFile(root, input, outcome === "present" ? "\0" + "Core.java\0".repeat(201) : "password=\0x");
        writeFile(root, target);
        const ctx = buildContext(root);
        ctx.config.include = ["tests"];
        const gaps: string[][] = [];
        const queries: string[][] = [];
        const coverage: Parameters<NonNullable<AuditDetectorContext["reportCoverage"]>>[0][] = [];
        ctx.reportUnavailable = (_id, predicate, file) => { gaps.push([predicate, file]); };
        ctx.reportCoverage = record => { coverage.push(record); };
        ctx.kitSourceReader = {
          snapshotId: "qualified-snapshot",
          unsupportedRawContentReason: () => "selected input lacks authenticated text",
          occurrences: async () => { throw new Error("Binary text lookup"); },
          byteOccurrences: async (file: string, hex: string) => {
            queries.push([file, hex]);
            if (outcome === "stale") throw new KitSourceEvidenceAcquisitionError("stale-evidence", "changed binary");
            if (outcome === "present") return {
              complete: false, matchCount: 201,
              matches: Array.from({ length: 200 }, (_, index) => ({ startByte: 1 + 10 * index, endByteExclusive: 10 + 10 * index })),
            };
            return { complete: outcome === "absent", matchCount: 0, matches: [] };
          },
        } as unknown as AuditDetectorContext["kitSourceReader"];

        const run = DEAD_CODE_CANDIDATE_DETECTOR.run(ctx);
        if (outcome === "stale") {
          await expect(run).rejects.toMatchObject({ category: "stale-evidence" });
        } else {
          const issues = await run;
          expect(issues.map(issue => issue.affectedFiles)).toEqual(outcome === "absent" ? [[target]] : []);
          expect(gaps).toEqual(outcome === "incomplete" ? [["unreferenced-fixture " + target, input]] : []);
          if (outcome === "absent") expect(coverage).toContainEqual(expect.objectContaining({
            predicate: "unreferenced-fixture " + target,
            source: { kind: "file", identity: input }, status: "QUALIFIED",
            proof: { kind: "exact-literal-byte", snapshotId: "qualified-snapshot", references: [input, basename] },
          }));
        }
        expect(queries).toEqual([[input, "436f72652e6a617661"]]);
      } finally { cleanup(root); }
    },
  );

  it("uses the selected byte bound for literal feasibility while retaining a possible binary witness gap", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "fixtures/long-name.txt");
      writeFile(root, "fixtures/x.txt");
      writeFile(root, "tests/data.xml", "x.txt\0");
      const ctx = buildContext(root);
      ctx.config.include = ["tests"];
      const gaps: string[] = [];
      const inapplicable: string[] = [];
      ctx.reportUnavailable = (_id, predicate) => { gaps.push(predicate); };
      ctx.reportCoverage = record => { if (record.status === "NOT_APPLICABLE") inapplicable.push(record.predicate); };
      ctx.kitSourceReader = {
        unsupportedRawContentReason: () => "selected input lacks authenticated text",
        occurrences: async () => { throw new Error("Binary text lookup"); },
        authenticatedContent: async () => { throw new Error("Binary text read"); },
      } as unknown as AuditDetectorContext["kitSourceReader"];
      const issues = await DEAD_CODE_CANDIDATE_DETECTOR.run(ctx);
      expect(inapplicable).toEqual(["unreferenced-fixture fixtures/long-name.txt"]);
      expect(gaps).toEqual(["unreferenced-fixture fixtures/x.txt"]);
      expect(issues.map(issue => issue.affectedFiles)).toEqual([["fixtures/long-name.txt"]]);
    } finally { cleanup(root); }
  });

  it.each(["source", "script", "re-export"])("requires no global negative proof when every %s candidate is independently referenced", async kind => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "positive-domain", version: "1.0.0",
        scripts: kind === "script" ? { check: "node scripts/thing.mjs" } : kind === "re-export" ? { start: "node src/index.mjs" } : {} }));
      writeFile(root, kind === "script" ? "scripts/thing.mjs" : "src/thing.mjs", "export const thing = 1;\n");
      if (kind === "re-export") writeFile(root, "src/index.mjs", 'export { thing } from "./thing.mjs";\n');
      writeFile(root, "tests/check.test.ts", (kind === "source" ? 'import { thing } from "../src/thing.mjs";\n' : "") +
        (kind === "script" ? "declare const unknown: string;\nvoid import(unknown);\n"
          : 'import "unresolved-package";\n'));
      const ctx = buildContext(root);
      ctx.config.include = kind === "script" ? ["package", "tests"] : ["cli", "tests"];
      const result = await runAudit({ config: ctx.config, toolRoot: root, registry: [DEAD_CODE_CANDIDATE_DETECTOR] });
      expect(result.sourceFacts.files.find(file => file.relativePath === "tests/check.test.ts")!.kit!.capabilities.imports).toBe(kind === "script" ? "partial" : "complete");
      expect(result.exitCode, JSON.stringify(result.detectorErrors)).toBe(0);
      expect(result.issues).toEqual([]);
      expect(result.coverage).toContainEqual(expect.objectContaining(kind === "script" ? {
        predicate: "imports evidence", status: "NOT_APPLICABLE",
        reason: expect.stringContaining("no remaining candidate"),
      } : {
        predicate: "unreferenced-source-file", status: "NOT_APPLICABLE", actualStatus: "positive-witness",
        reason: "Every eligible candidate has an authenticated positive path witness.",
      }));
    } finally { cleanup(root); }
  }, 120000);

  it("preserves the inventory-qualified empty test domain without requiring a source reader", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "fixtures/unused.txt", "unused");
      const ctx = buildContext(root);
      ctx.config.include = ["tests"];
      const result = await runAudit({ config: ctx.config, toolRoot: root, registry: [DEAD_CODE_CANDIDATE_DETECTOR] });
      expect(result.exitCode).toBe(0);
      expect(result.detectorErrors).toEqual([]);
      expect(result.issues.some(issue => issue.title.includes("unused.txt"))).toBe(true);
    } finally { cleanup(root); }
  });

  it.each(["fact", "content", "partial occurrence"])("retains a qualified %s witness despite other unavailable raw inputs", async mode => {
    const root = makeTempDir();
    try {
      writeFile(root, "tests/check.test.ts", "// bounded test input\n");
      writeFile(root, "tests/unsupported.xml", "<fixture/>\n");
      writeFile(root, "fixtures/used.bin", "used");
      writeFile(root, "fixtures/absent.bin", "absent");
      const ctx = buildContext(root);
      ctx.config.include = ["tests"];
      const gaps: string[][] = [];
      const qualified: string[] = [];
      ctx.reportUnavailable = (_id, predicate, file) => { gaps.push([predicate, file]); };
      ctx.reportCoverage = record => { if (record.status === "QUALIFIED") qualified.push(record.predicate); };
      // Synthetic unit reader: package/byte validation is exercised separately
      // through the existing installed-provider integration tests.
      ctx.kitSourceReader = {
        unsupportedRawContentReason: (file: string) => file.endsWith(".xml") ? "authenticated inventory lacks raw content" : undefined,
        fixtureReferenceBasenames: () => mode === "fact" ? ["used.bin"] : [],
        authenticatedContent: mode === "partial occurrence" ? undefined : async () => mode === "content" ? "used.bin" : "",
        occurrences: async (_file: string, value: string) => ({ complete: value !== "used.bin",
          matchCount: value === "used.bin" ? 1 : 0, matches: value === "used.bin" ? [{ content: "used.bin" }] : [] }),
      } as unknown as AuditDetectorContext["kitSourceReader"];
      expect(await DEAD_CODE_CANDIDATE_DETECTOR.run(ctx)).toEqual([]);
      expect(qualified).toEqual(["unreferenced-fixture fixtures/used.bin"]);
      expect(gaps).toEqual([["unreferenced-fixture fixtures/absent.bin", "tests/unsupported.xml"]]);
    } finally { cleanup(root); }
  });
});

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

describe("R3 script origin reconciliation", () => {
  const controls = [
    ["scripts/check-docs.mjs", "SW123-G0007", "SW123-G0008"],
    ["scripts/clean-dist.mjs", "SW123-G0009", "SW123-G0010"],
    ["scripts/externalLocalPrivacyScan.ts", "SW123-G0021", "SW123-G0022"],
    ["scripts/run-verification-lane.mjs", "SW123-G0039", "SW123-G0040"],
    ["scripts/security/resolveToolRoot.ts", "SW123-G0043", "SW123-G0044"],
    ["scripts/verifyPackedPackageAgentSuccess.mjs", "SW123-G0065", "SW123-G0066"],
    ["scripts/verifyPackedPackageHelpers.ts", "SW123-G0067", "SW123-G0068"],
  ] as const;
  const predicates = ["unreferenced-script-file", "unreferenced-source-file"];
  const snapshotId = "a".repeat(64);

  function context(root: string, domain?: "partial" | "indeterminate" | "different snapshot" | "missing" | "positive" | "bounded") {
    writeFile(root, "package.json", JSON.stringify({ scripts: { unrelated: "node elsewhere.mjs" } }));
    writeFile(root, "src/old/dormant.ts", "export {};");
    writeFile(root, "scripts/referenced.mjs", "export {};");
    for (const [file] of controls) writeFile(root, file, 'import "node:fs";');
    const dynamic = "scripts/unknown.mjs";
    writeFile(root, dynamic, "import(target);");
    const ctx = buildContext(root);
    ctx.config.include = ["package", "cli"];
    const evidence = {
      snapshotId, traversalComplete: true, coverage: { inventoryComplete: true },
      fileEvidence: new Map(),
    } as KitSourceEvidence;
    const files = [...new Set([...ctx.inventory.scriptFiles, ...ctx.inventory.sourceFiles])].map(entry => {
      const id = entry.relativePath;
      const builtin = controls.some(([file]) => file === id);
      const partial = id === dynamic && !!domain;
      const capabilities = { imports: partial ? "partial" : "complete", exports: "complete" } as const;
      const kit = { capabilities, contentSha256: "b".repeat(64), producerStatus: "parsed", producerLanguage: entry.language, producerRole: entry.role };
      const imports: SourceFileFacts["imports"] = builtin ? [{
        source: "node:fs", kind: "static",
        provenance: { producer: "kit", factId: id, startLine: 1, startColumn: 0, endLine: 1, endColumn: 16, extractionMethod: "typescript-ast" },
      }] : [];
      const file: SourceFileFacts = {
        relativePath: id, role: entry.role, language: entry.language, kit, parseStatus: "parsed",
        analyzerId: "kit:typescript-ast", imports, declarations: [], exports: [], references: [], diagnostics: [],
      };
      evidence.fileEvidence.set(id, {
        record: { path: id, contentSha256: kit.contentSha256, status: "parsed", capabilities } as KitFileRecord,
        facts: builtin ? [{ id, kind: "import", sourceSpecifier: "node:fs", span: { path: id, startLine: 1 } } as KitFact] : [],
        factPages: 1,
      });
      registerKitDeclarationPredicateEvidence(file, evidence);
      return file;
    });
    ctx.sourceFacts = { ...createNotCollectedSourceFacts(root), provider: "kit", files };
    ctx.kitSourceReader = {
      snapshotId,
      producer: { packageName: "@dailephd/my-dev-kit", packageVersion: "1.15.1" },
      selectedFile: file => evidence.fileEvidence.get(file)!.record,
      occurrences: async () => { throw new Error("Unexpected raw occurrence request"); },
      importTarget: async () => { throw new Error("Unexpected ordinary import proof request"); },
      dispose: () => undefined,
      expressionDomains: async file => {
        if (file !== dynamic || !domain || domain === "missing") return [];
        return [{ proof: { expressionFactId: "dynamic", snapshotId: domain === "different snapshot" ? "c".repeat(64) : snapshotId,
          outcome: domain === "positive" || domain === "bounded" ? "finite" : "indeterminate", reasonCode: "INCOMPLETE_REFERENCE_PROFILE",
          domainComplete: domain === "positive" || domain === "bounded", positivePaths: domain === "positive" ? ["scripts/referenced.mjs"] : [],
          selectedTargetUpperBound: domain === "bounded" ? ["scripts/referenced.mjs"] : undefined,
          excludesSelectedDomain: false } }];
      },
      explicitImportsCompleteWithExpressions: file => domain === "bounded" && file === dynamic,
      reExportTargets: () => [],
    } as KitSourceReader;
    const gaps: string[] = [];
    ctx.reportUnavailable = (_detector, predicate, origin) => { gaps.push(origin + "|" + predicate); };
    return { ctx, gaps, dynamic };
  }

  it("reconciles all fourteen retained origin/predicate pairs and keeps unrelated unknown coverage", async () => {
    const root = makeTempDir();
    try {
      const { ctx, gaps, dynamic } = context(root, "indeterminate");
      const qualified: string[] = [];
      ctx.reportCoverage = record => {
        if (record.actualStatus === "disjoint-selected-domain") qualified.push(record.source.identity + "|" + record.predicate);
      };
      const issues = await DEAD_CODE_CANDIDATE_DETECTOR.run(ctx);
      for (const [origin, ...gapIds] of controls) {
        for (const [i, predicate] of predicates.entries()) {
          expect(qualified, gapIds[i]).toContain(origin + "|" + predicate);
          expect(gaps, gapIds[i]).not.toContain(origin + "|" + predicate);
        }
      }
      for (const predicate of predicates) expect(gaps).toContain(dynamic + "|" + predicate);
      expect(issues.some(issue => issue.affectedFiles.includes("src/old/dormant.ts"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it.each(["partial", "missing", "positive"] as const)("keeps the unknown %s origin independent of qualified siblings", async domain => {
    const root = makeTempDir();
    try {
      const { ctx, gaps, dynamic } = context(root, domain);
      const issues = await DEAD_CODE_CANDIDATE_DETECTOR.run(ctx);
      expect(gaps).toContain(dynamic + "|unreferenced-source-file");
      expect(issues.some(issue => issue.affectedFiles.includes("scripts/referenced.mjs"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("keeps a bounded origin gap from suppressing disjoint candidates", async () => {
    const root = makeTempDir();
    try {
      const { ctx, gaps, dynamic } = context(root, "bounded");
      const issues = await DEAD_CODE_CANDIDATE_DETECTOR.run(ctx);
      expect(gaps).toContain(dynamic + "|unreferenced-script-file");
      expect(gaps).not.toContain(dynamic + "|unreferenced-source-file");
      expect(issues.map(issue => issue.id)).toContain("dead-code-candidate:unreferenced-source-file:src/old/dormant.ts");
      expect(issues.map(issue => issue.id)).not.toContain("dead-code-candidate:unreferenced-script-file:scripts/referenced.mjs");
      expect(issues.map(issue => issue.id)).toContain("dead-code-candidate:unreferenced-script-file:scripts/check-docs.mjs");
    } finally {
      cleanup(root);
    }
  });

  it("rejects an expression proof from a different snapshot before reporting any discharge", async () => {
    const root = makeTempDir();
    try {
      const { ctx } = context(root, "different snapshot");
      await expect(DEAD_CODE_CANDIDATE_DETECTOR.run(ctx)).rejects.toThrow(/different Kit snapshot/);
    } finally {
      cleanup(root);
    }
  });
});
