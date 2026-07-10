import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { collectSourceFacts } from "../../../src/audits/core/collectSourceFacts.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { DUPLICATE_IMPLEMENTATION_DETECTOR } from "../../../src/audits/codeRot/detectors/duplicateImplementationDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dup-impl-test-"));
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
  return DUPLICATE_IMPLEMENTATION_DETECTOR.run(ctx);
}

async function runWithSourceFacts(root: string) {
  const ctx = buildContext(root);
  const sourceFacts = await collectSourceFacts(root, ctx.inventory);
  return DUPLICATE_IMPLEMENTATION_DETECTOR.run({ ...ctx, sourceFacts });
}

describe("DUPLICATE_IMPLEMENTATION_DETECTOR — duplicate script entrypoints", () => {
  it("flags two scripts invoking the same target file", async () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "package.json",
        JSON.stringify({
          name: "fixture",
          version: "1.0.0",
          scripts: {
            "run-thing": "tsx scripts/thing.ts",
            "run-thing-again": "tsx scripts/thing.ts --flag",
          },
        })
      );
      writeFile(root, "scripts/thing.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.category === "duplicate-implementation-candidate" && i.title.includes("scripts/thing.ts"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a single script invoking a target file", async () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "package.json",
        JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { "run-thing": "tsx scripts/thing.ts" } })
      );
      writeFile(root, "scripts/thing.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("Multiple npm scripts"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DUPLICATE_IMPLEMENTATION_DETECTOR — parallel directories", () => {
  // Note: "report"/"reports" is intentionally NOT used as the fixture pair
  // here, even though it's in PARALLEL_DIR_PAIRS -- the shared project
  // inventory scanner (src/audits/core/projectInventory.ts) globally
  // excludes any directory literally named "reports" from traversal (it is
  // this project's own generated-output directory convention), so that
  // specific pair can never actually be observed by this detector for any
  // target. "util"/"utils" is not excluded and exercises the same logic.
  it("flags both util/ and utils/ existing as top-level directories", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "util/index.ts", "export {};\n");
      writeFile(root, "utils/index.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('"util/" and "utils/"'))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag when only one of a parallel directory pair exists", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "util/index.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.category === "duplicate-implementation-candidate" && i.title.includes("parallel"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DUPLICATE_IMPLEMENTATION_DETECTOR — basename repeats across roots", () => {
  it("flags a non-generic basename repeated across two unrelated src roots (weak signal)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/uniqueWidget.ts", "export {};\n");
      writeFile(root, "src/featureB/uniqueWidget.ts", "export {};\n");
      const issues = await run(root);
      const issue = issues.find((i) => i.title.includes("uniquewidget"));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("info");
    } finally {
      cleanup(root);
    }
  });

  it("does not flag generic infra basenames (e.g. index, types) repeated across roots", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/types.ts", "export {};\n");
      writeFile(root, "src/featureB/types.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('"types"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DUPLICATE_IMPLEMENTATION_DETECTOR — source-facts-derived duplicate declarations", () => {
  it("flags the same exported class name parsed in two unrelated source files", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/logger.ts", "export class Logger { log() {} }\n");
      writeFile(root, "src/featureB/logger.ts", "export class Logger { log() {} }\n");
      const issues = await runWithSourceFacts(root);
      expect(
        issues.some(
          (i) => i.category === "duplicate-implementation-candidate" && i.title.includes('"Logger"') && i.title.includes("class")
        )
      ).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a generic exported declaration name (e.g. 'run') across files", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/entry.ts", "export function run() {}\n");
      writeFile(root, "src/featureB/entry.ts", "export function run() {}\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"run"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a non-exported declaration with the same name", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/logger.ts", "class Logger { log() {} }\nexport {};\n");
      writeFile(root, "src/featureB/logger.ts", "class Logger { log() {} }\nexport {};\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"Logger"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag when sourceFacts is absent from the detector context", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/logger.ts", "export class Logger { log() {} }\n");
      writeFile(root, "src/featureB/logger.ts", "export class Logger { log() {} }\n");
      const issues = await run(root); // buildContext() with no sourceFacts field
      expect(issues.some((i) => i.title.includes('"Logger"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DUPLICATE_IMPLEMENTATION_DETECTOR — Python duplicate declaration candidates (Batch 2)", () => {
  it("T4: flags the same exported Python class name parsed in two unrelated source files", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/widget.py", "class WidgetHandler:\n    pass\n");
      writeFile(root, "src/featureB/widget.py", "class WidgetHandler:\n    pass\n");
      const issues = await runWithSourceFacts(root);
      const issue = issues.find((i) => i.title.includes('"WidgetHandler"'));
      expect(issue).toBeDefined();
      expect(issue?.category).toBe("duplicate-implementation-candidate");
      expect(issue?.severity).toBe("info");
      expect(issue?.confidence).toBe("low");
      // Conservative wording -- never claim semantic/behavioral equivalence.
      expect(issue?.description.toLowerCase()).not.toContain("duplicate implementation proof");
      expect(issue?.description.toLowerCase()).not.toContain("identical behavior");
    } finally {
      cleanup(root);
    }
  });

  it("T4: flags the same exported Python function name parsed in two unrelated source files", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/service.py", "def compute_widget_score():\n    return 1\n");
      writeFile(root, "src/featureB/service.py", "def compute_widget_score():\n    return 2\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"compute_widget_score"'))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("T5: does not create a cross-language duplicate candidate between a Python and a TypeScript declaration with the same name", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/widget.py", "class SharedName:\n    pass\n");
      writeFile(root, "src/featureB/widget.ts", "export class SharedName {}\n");
      const issues = await runWithSourceFacts(root);
      // Only one file declares "SharedName" per language -- since duplicate
      // detection is now language-scoped, neither the Python nor the
      // TypeScript declaration should form a cross-language pair, and
      // within-language there is only one file each, so no finding at all.
      expect(issues.some((i) => i.title.includes('"SharedName"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T5: does not merge a same-named Python declaration group with a same-named TypeScript group even when both independently have 2+ files", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/pyA/shared.py", "class SharedThing:\n    pass\n");
      writeFile(root, "src/pyB/shared.py", "class SharedThing:\n    pass\n");
      writeFile(root, "src/tsA/shared.ts", "export class SharedThing {}\n");
      writeFile(root, "src/tsB/shared.ts", "export class SharedThing {}\n");
      const issues = await runWithSourceFacts(root);
      const sharedThingIssues = issues.filter((i) => i.title.includes('"SharedThing"'));
      // Two separate candidates (one per language), each affecting exactly
      // its own language's 2 files -- never one candidate spanning all 4.
      expect(sharedThingIssues).toHaveLength(2);
      for (const issue of sharedThingIssues) {
        expect(issue.affectedFiles).toHaveLength(2);
        const allPython = issue.affectedFiles.every((f) => f.endsWith(".py"));
        const allTypeScript = issue.affectedFiles.every((f) => f.endsWith(".ts"));
        expect(allPython || allTypeScript).toBe(true);
      }
    } finally {
      cleanup(root);
    }
  });

  it("T6: does not flag common low-signal Python lifecycle names (main, run, handler, setup, teardown, __init__, test_*)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/entry.py", "def main():\n    pass\ndef run():\n    pass\ndef setup():\n    pass\ndef test_thing():\n    pass\n");
      writeFile(root, "src/featureB/entry.py", "def main():\n    pass\ndef run():\n    pass\ndef setup():\n    pass\ndef test_thing():\n    pass\n");
      const issues = await runWithSourceFacts(root);
      for (const name of ["main", "run", "setup", "test_thing"]) {
        expect(issues.some((i) => i.title.includes(`"${name}"`))).toBe(false);
      }
    } finally {
      cleanup(root);
    }
  });

  it("regression: a TypeScript and a JavaScript file with the same exported declaration name still form one candidate, not two dropped single-file groups", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/widget.ts", "export function sharedWidgetFn() { return 1; }\n");
      writeFile(root, "src/featureB/widget.js", "export function sharedWidgetFn() { return 2; }\n");
      const issues = await runWithSourceFacts(root);
      const issue = issues.find((i) => i.title.includes('"sharedWidgetFn"'));
      expect(issue).toBeDefined();
      expect(issue?.affectedFiles.sort()).toEqual(["src/featureA/widget.ts", "src/featureB/widget.js"].sort());
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a Python declaration with the same name across more than 4 unrelated files (same 2-4 bound as TS/JS)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      for (const feature of ["featureA", "featureB", "featureC", "featureD", "featureE"]) {
        writeFile(root, `src/${feature}/widget.py`, "class WidelySharedName:\n    pass\n");
      }
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"WidelySharedName"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DUPLICATE_IMPLEMENTATION_DETECTOR — Java/Kotlin duplicate declaration candidates (v0.3.3 Batch 2)", () => {
  it("T6: flags the same exported Java class name declared in two unrelated source files", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/com/example/WidgetHandler.java", "package com.example;\n\npublic class WidgetHandler {\n}\n");
      writeFile(root, "src/featureB/com/example/WidgetHandler.java", "package com.example;\n\npublic class WidgetHandler {\n}\n");
      const issues = await runWithSourceFacts(root);
      const issue = issues.find((i) => i.title.includes('"WidgetHandler"'));
      expect(issue).toBeDefined();
      expect(issue?.category).toBe("duplicate-implementation-candidate");
      expect(issue?.severity).toBe("info");
      expect(issue?.confidence).toBe("low");
      expect(issue?.description.toLowerCase()).not.toContain("duplicate implementation proof");
      expect(issue?.description.toLowerCase()).not.toContain("identical behavior");
    } finally {
      cleanup(root);
    }
  });

  it("T7: flags the same exported Kotlin class name declared in two unrelated source files", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/com/example/WidgetHandler.kt", "package com.example\n\nclass WidgetHandler\n");
      writeFile(root, "src/featureB/com/example/WidgetHandler.kt", "package com.example\n\nclass WidgetHandler\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"WidgetHandler"'))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("T7: flags the same exported top-level Kotlin function name declared in two unrelated source files", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/computeWidgetScore.kt", "fun computeWidgetScore(): Int {\n    return 1\n}\n");
      writeFile(root, "src/featureB/computeWidgetScore.kt", "fun computeWidgetScore(): Int {\n    return 2\n}\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"computeWidgetScore"'))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("T8: does not create a cross-language duplicate candidate between a Java and a Kotlin declaration with the same name", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/SharedName.java", "public class SharedName {\n}\n");
      writeFile(root, "src/featureB/SharedName.kt", "class SharedName\n");
      const issues = await runWithSourceFacts(root);
      // Only one file declares "SharedName" per language -- Java and
      // Kotlin are two distinct analyzer scopes, so neither forms a
      // cross-language pair, and within-language there is only one file
      // each, so no finding at all.
      expect(issues.some((i) => i.title.includes('"SharedName"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("T8: does not merge a same-named Java declaration group with a same-named Kotlin group even when both independently have 2+ files", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/javaA/SharedThing.java", "public class SharedThing {\n}\n");
      writeFile(root, "src/javaB/SharedThing.java", "public class SharedThing {\n}\n");
      writeFile(root, "src/ktA/SharedThing.kt", "class SharedThing\n");
      writeFile(root, "src/ktB/SharedThing.kt", "class SharedThing\n");
      const issues = await runWithSourceFacts(root);
      const sharedThingIssues = issues.filter((i) => i.title.includes('"SharedThing"'));
      // Two separate candidates (one per language), never one candidate
      // spanning all 4 files, and never merged with the existing TS/JS/
      // Python groups exercised by the tests above.
      expect(sharedThingIssues).toHaveLength(2);
      for (const issue of sharedThingIssues) {
        expect(issue.affectedFiles).toHaveLength(2);
        const allJava = issue.affectedFiles.every((f) => f.endsWith(".java"));
        const allKotlin = issue.affectedFiles.every((f) => f.endsWith(".kt"));
        expect(allJava || allKotlin).toBe(true);
      }
    } finally {
      cleanup(root);
    }
  });

  it("T8: a same-named Java, Kotlin, Python, TypeScript, and JavaScript declaration each forms its own separate candidate", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/javaA/MultiLang.java", "public class MultiLang {\n}\n");
      writeFile(root, "src/javaB/MultiLang.java", "public class MultiLang {\n}\n");
      writeFile(root, "src/ktA/MultiLang.kt", "class MultiLang\n");
      writeFile(root, "src/ktB/MultiLang.kt", "class MultiLang\n");
      writeFile(root, "src/pyA/multi_lang.py", "class MultiLang:\n    pass\n");
      writeFile(root, "src/pyB/multi_lang.py", "class MultiLang:\n    pass\n");
      writeFile(root, "src/tsA/multiLang.ts", "export class MultiLang {}\n");
      writeFile(root, "src/tsB/multiLang.js", "export class MultiLang {}\n");
      const issues = await runWithSourceFacts(root);
      const multiLangIssues = issues.filter((i) => i.title.includes('"MultiLang"'));
      // Java (own group), Kotlin (own group), Python (own group), and
      // TS+JS (one shared group, since they share one analyzer) -- 4
      // groups total, never fewer (merged) or more (over-split).
      expect(multiLangIssues).toHaveLength(4);
      for (const issue of multiLangIssues) {
        const exts = issue.affectedFiles.map((f) => path.extname(f));
        const allSameFamily =
          exts.every((e) => e === ".java") ||
          exts.every((e) => e === ".kt") ||
          exts.every((e) => e === ".py") ||
          exts.every((e) => e === ".ts" || e === ".js");
        expect(allSameFamily).toBe(true);
      }
    } finally {
      cleanup(root);
    }
  });

  it("T9: does not flag common low-signal JVM names (Main, App, Config, Service, Controller, test*, setup, tearDown)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(
        root,
        "src/featureA/Widget.java",
        [
          "public class Main {}",
          "class App {}",
          "class Config {}",
          "class Service {}",
          "class Controller {}",
          "class testHelper {}",
        ].join("\n") + "\n"
      );
      writeFile(
        root,
        "src/featureB/Widget.java",
        [
          "public class Main {}",
          "class App {}",
          "class Config {}",
          "class Service {}",
          "class Controller {}",
          "class testHelper {}",
        ].join("\n") + "\n"
      );
      const issues = await runWithSourceFacts(root);
      for (const name of ["Main", "App", "Config", "Service", "Controller", "testHelper"]) {
        expect(issues.some((i) => i.title.includes(`"${name}"`))).toBe(false);
      }
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a Java/Kotlin method (methods are excluded entirely, same as every other language)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/Widget.java", "public class WidgetA {\n    public void sharedMethodName() {}\n}\n");
      writeFile(root, "src/featureB/Widget.java", "public class WidgetB {\n    public void sharedMethodName() {}\n}\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"sharedMethodName"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DUPLICATE_IMPLEMENTATION_DETECTOR — real self-scan regression guard", () => {
  it("produces no findings above info severity against this repo's own current state", async () => {
    const issues = await run(process.cwd());
    expect(issues.every((i) => i.severity === "info" || i.severity === "low")).toBe(true);
  });

  // v0.3.1 Batch 6 -- the test above never actually exercises
  // findDuplicateDeclarationCandidates() against this repo's real code:
  // run() builds a context via buildContext(), which has no `sourceFacts`
  // field, so the source-facts-derived check returns [] before ever
  // touching this repo's own duplicate declaration names (e.g. "Logger",
  // "TaskService", "TaskStore" across this repo's benchmark fixtures --
  // manually confirmed via `npm run audit` smoke output in Batch 5). This
  // is the actual regression guard for that check: real sourceFacts,
  // against this repo's real ~500-file source tree, asserting the
  // source-facts-derived findings stay conservative (info/low) the same
  // way the regex-based checks above already are.
  it("keeps source-facts-derived duplicate-declaration candidates at info/low against this repo's own real source facts", async () => {
    const issues = await runWithSourceFacts(process.cwd());
    const sourceFactsDerived = issues.filter((i) =>
      i.evidence.some((e) => e.message.startsWith("Source facts:"))
    );
    // This repo's benchmark fixtures are expected to produce at least one
    // real source-facts-derived candidate (see Batch 5's manual smoke
    // inspection) -- if this ever drops to zero, the check likely broke
    // silently rather than the repo becoming duplicate-free, so this is
    // worth knowing about rather than silently passing on an empty array.
    expect(sourceFactsDerived.length).toBeGreaterThan(0);
    expect(sourceFactsDerived.every((i) => i.severity === "info")).toBe(true);
    expect(sourceFactsDerived.every((i) => i.confidence === "low")).toBe(true);
    expect(sourceFactsDerived.every((i) => i.falsePositiveRisk === "high")).toBe(true);
  });
});
