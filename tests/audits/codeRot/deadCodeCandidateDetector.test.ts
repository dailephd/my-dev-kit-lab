import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { collectSourceFacts } from "../../../src/audits/core/collectSourceFacts.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { DEAD_CODE_CANDIDATE_DETECTOR } from "../../../src/audits/codeRot/detectors/deadCodeCandidateDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

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
  return DEAD_CODE_CANDIDATE_DETECTOR.run(ctx);
}

async function runWithSourceFacts(root: string) {
  const ctx = buildContext(root);
  const sourceFacts = await collectSourceFacts(root, ctx.inventory);
  return DEAD_CODE_CANDIDATE_DETECTOR.run({ ...ctx, sourceFacts });
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
      // A dynamic import has no "from"/"require(" token, so the regex-based
      // reverse-reference scan (IMPORT_SPECIFIER_PATTERN) never sees it --
      // only the TypeScript/JavaScript analyzer's structured ImportFact
      // (kind "dynamic") records this reference.
      writeFile(root, "src/main.ts", 'export async function load() { return import("./helper.js"); }\n');
      writeFile(root, "src/helper.ts", "export function helper() {}\n");

      const withoutFacts = await run(root);
      expect(withoutFacts.some((i) => i.title.includes("helper.ts"))).toBe(true);

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
      expect(issue?.evidence.some((e) => e.message.startsWith("Source facts:"))).toBe(true);
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

  it("does not flag anything when sourceFacts is absent from the detector context", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/widget.py", "def unreferenced_fn():\n    return 1\n");
      const issues = await run(root); // buildContext() with no sourceFacts field
      expect(issues.some((i) => i.title.includes('"unreferenced_fn"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DEAD_CODE_CANDIDATE_DETECTOR — real self-scan regression guard", () => {
  it("produces no medium+ severity findings against this repo's own current state", async () => {
    const issues = await run(process.cwd());
    const nonInfoLow = issues.filter((i) => i.severity !== "info" && i.severity !== "low");
    expect(nonInfoLow).toEqual([]);
  });

  // v0.3.2 Batch 2 -- the test above uses run() (no sourceFacts), which
  // never exercises findPossiblyUnreferencedPythonDeclarations() against
  // this repo's real Python fixtures (benchmarks/projects/*/py, todo-python,
  // etc.). This is the real regression guard for that check.
  it("keeps Python declaration candidates at info/low against this repo's own real source facts", async () => {
    const issues = await runWithSourceFacts(process.cwd());
    const pythonDeclIssues = issues.filter((i) => i.id.startsWith(`${"dead-code-candidate"}:unreferenced-python-declaration:`));
    expect(pythonDeclIssues.every((i) => i.severity === "info")).toBe(true);
    expect(pythonDeclIssues.every((i) => i.confidence === "low")).toBe(true);
  });
});
