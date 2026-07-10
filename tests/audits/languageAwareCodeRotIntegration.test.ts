import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditTarget } from "../../src/audits/core/auditTarget.js";
import { buildAuditReportModel } from "../../src/audits/report/auditReportModel.js";
import { renderAuditJsonReport } from "../../src/audits/report/renderAuditJsonReport.js";
import { renderAuditTextReport } from "../../src/audits/report/renderAuditTextReport.js";

// ---------------------------------------------------------------------------
// v0.3.1 Batch 6 -- cross-layer integration test for the full language-aware
// code-rot path.
//
// Every prior batch's own test suite exercises its own layer in isolation:
//   - Batch 2/4's per-detector unit tests call a detector's .run(ctx)
//     directly with a hand-built AuditDetectorContext.
//   - Batch 5's report-model/renderer unit tests build a report model from a
//     hand-crafted AuditIssue via a synthetic makeDetector().
//   - The real-CLI e2e/smoke tests (auditCommandSmoke.test.ts,
//     auditEndToEndReportSchema.test.ts) use fixtures with no real
//     TypeScript/JavaScript source, so they never exercise a source-facts-
//     derived finding's content.
//
// No existing test runs the REAL DEFAULT_AUDIT_REGISTRY (not a synthetic
// detector) against a REAL small TS/JS fixture, through runAudit() ->
// buildAuditReportModel() -> both renderers, and inspects that a genuine
// source-facts-derived finding (produced by duplicateImplementationDetector
// and testRotDetector, not by a test-authored fixture issue) survives intact
// and readable end to end. This file closes that gap.
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "language-aware-code-rot-integration-"));
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

function fakeTargetFor(root: string): AuditTarget {
  return {
    rootPath: root,
    displayName: "fixture",
    exists: true,
    isDirectory: true,
    packageJsonPath: path.join(root, "package.json"),
    gitRoot: null,
    isSelf: false,
    safeReportOutputRoot: path.join(root, "reports", "audits"),
  };
}

describe("language-aware code-rot integration — real registry, real source facts, real report output", () => {
  it("carries a real duplicate-declaration finding and a real dynamic-import test-rot finding through to JSON and text output", async () => {
    const root = makeTempDir();
    try {
      const loggerSource = "export class Logger { log() {} }\n";
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/logger.ts", loggerSource);
      writeFile(root, "src/featureB/logger.ts", loggerSource);
      writeFile(
        root,
        "tests/example.test.ts",
        'it("loads", async () => { const mod = await import("../src/missingDynamic.js"); expect(mod).toBeDefined(); });\n'
      );

      const config = normalizeAuditConfig({}, root);
      const target = fakeTargetFor(root);
      // No `registry` override -- exercises the real DEFAULT_AUDIT_REGISTRY,
      // same as `npm run audit` would use.
      const result = await runAudit({ config, toolRoot: root, target });

      // 1. Source facts were actually collected against real files.
      expect(result.sourceFacts.files.length).toBeGreaterThan(0);
      expect(result.sourceFacts.filesByParseStatus.parsed).toBeGreaterThanOrEqual(3);

      const model = buildAuditReportModel(result, { target });
      const json = renderAuditJsonReport(model);
      const text = renderAuditTextReport(model);
      const parsed = JSON.parse(json);

      // 2. duplicateImplementationDetector's real, source-facts-derived
      // finding is present with its evidence intact.
      const dupIssue = model.issues.find(
        (i) => i.category === "duplicate-implementation-candidate" && i.title.includes('"Logger"')
      );
      expect(dupIssue).toBeDefined();
      expect(dupIssue!.severity).toBe("info");
      expect(dupIssue!.confidence).toBe("low");
      const dupEvidence = dupIssue!.evidence.find((e) => e.message.startsWith("Source facts:"));
      expect(dupEvidence).toBeDefined();
      expect(dupEvidence!.excerpt).toContain("src/featureA/logger.ts");
      expect(dupEvidence!.excerpt).toContain("src/featureB/logger.ts");

      // 3. testRotDetector's real, source-facts-derived dynamic-import
      // finding is present (regex-based RELATIVE_IMPORT_PATTERN cannot see a
      // bare `import(...)` call -- only the structured ImportFact path can).
      const testRotIssue = model.issues.find(
        (i) => i.category === "test-rot" && i.title.includes("missing source file") && i.title.includes("missingDynamic.js")
      );
      expect(testRotIssue).toBeDefined();

      // 4. Both findings round-trip through JSON unchanged.
      const parsedDup = parsed.issues.find((i: { id: string }) => i.id === dupIssue!.id);
      expect(parsedDup.evidence.some((e: { message: string }) => e.message.startsWith("Source facts:"))).toBe(true);
      const parsedTestRot = parsed.issues.find((i: { id: string }) => i.id === testRotIssue!.id);
      expect(parsedTestRot).toBeDefined();

      // 5. Both findings render readably in text output -- the Batch 5
      // message+excerpt fix, now proven against a real detector's evidence
      // rather than a hand-crafted one.
      expect(text).toContain("Source facts summary");
      expect(text).toContain('Source facts: an exported class named "Logger"');
      expect(text).toContain("src/featureA/logger.ts, src/featureB/logger.ts");
      expect(text).toContain("missingDynamic.js");

      // 6. No target project file was modified by the run.
      expect(fs.readFileSync(path.join(root, "src/featureA/logger.ts"), "utf8")).toBe(loggerSource);
      expect(fs.readFileSync(path.join(root, "src/featureB/logger.ts"), "utf8")).toBe(loggerSource);
    } finally {
      cleanup(root);
    }
  });
});

// ---------------------------------------------------------------------------
// v0.3.2 Batch 3 -- T5/T6 mixed-language cross-layer regression.
//
// A single fixture with TypeScript, JavaScript, Python, and Java files, run
// through the real registry end to end, proving:
//   - sourceFacts summary reports each language's file count correctly.
//   - Java is parsed by its own analyzer (v0.3.3 Batch 1) alongside the
//     other languages without disrupting any of them.
//   - the analyzerId-scoped duplicate-declaration grouping (v0.3.2 Batch 2)
//     keeps the TS/JS pair and the Python pair as two SEPARATE candidates,
//     never one merged cross-language group and never silently dropped.
//   - pythonProjectMetadata (v0.3.2 Batch 3's new report field) is populated
//     correctly and visible in both JSON and text output.
// ---------------------------------------------------------------------------
describe("language-aware code-rot integration — mixed TypeScript/JavaScript/Python/Java fixture (Batch 3)", () => {
  it("keeps sourceFacts, pythonProjectMetadata, and duplicate-declaration findings correctly separated across languages", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "pyproject.toml", '[project]\nname = "fixture-py"\n');
      writeFile(root, "pytest.ini", "[pytest]\n");

      // TS/JS duplicate pair -- existing family, must remain grouped together.
      writeFile(root, "src/featureA/widget.ts", "export class SharedThing {}\n");
      writeFile(root, "src/featureB/widget.js", "export class SharedThing {}\n");

      // Python duplicate pair -- its own family, must not merge with TS/JS above.
      writeFile(root, "src/featureA/widget.py", "class SharedThing:\n    pass\n");
      writeFile(root, "src/featureB/widget.py", "class SharedThing:\n    pass\n");

      // Java file -- now parsed by its own analyzer (v0.3.3 Batch 1); must
      // coexist safely alongside the other languages without disrupting any
      // of the assertions below.
      writeFile(root, "src/Main.java", "class Main {}\n");

      const config = normalizeAuditConfig({}, root);
      const target = fakeTargetFor(root);
      const result = await runAudit({ config, toolRoot: root, target });

      // 1. sourceFacts per-language counts are all correct simultaneously.
      expect(result.sourceFacts.filesByLanguage.typescript).toBeGreaterThanOrEqual(1);
      expect(result.sourceFacts.filesByLanguage.javascript).toBeGreaterThanOrEqual(1);
      expect(result.sourceFacts.filesByLanguage.python).toBeGreaterThanOrEqual(2);
      expect(result.sourceFacts.filesByLanguage.java).toBeGreaterThanOrEqual(1);

      // 2. Java is now parsed by its own analyzer (v0.3.3 Batch 1).
      const javaEntry = result.sourceFacts.files.find((f) => f.relativePath === "src/Main.java");
      expect(javaEntry?.parseStatus).toBe("parsed");
      expect(javaEntry?.analyzerId).toBe("java-analyzer");

      const model = buildAuditReportModel(result, { target });

      // 3. pythonProjectMetadata is populated correctly in the report model.
      expect(model.pythonProjectMetadata.hasPyprojectToml).toBe(true);
      expect(model.pythonProjectMetadata.projectName).toBe("fixture-py");
      expect(model.pythonProjectMetadata.hasPytestConfiguration).toBe(true);

      // 4. Exactly two "SharedThing" duplicate candidates -- one TS/JS pair,
      // one Python pair, never merged, never dropped.
      const sharedThingIssues = model.issues.filter(
        (i) => i.category === "duplicate-implementation-candidate" && i.title.includes('"SharedThing"')
      );
      expect(sharedThingIssues).toHaveLength(2);
      for (const issue of sharedThingIssues) {
        expect(issue.affectedFiles).toHaveLength(2);
        const allPython = issue.affectedFiles.every((f) => f.endsWith(".py"));
        const allTsJs = issue.affectedFiles.every((f) => f.endsWith(".ts") || f.endsWith(".js"));
        expect(allPython || allTsJs).toBe(true);
        expect(issue.severity).toBe("info");
        expect(issue.confidence).toBe("low");
      }

      // 5. Both JSON and text reports surface the new field/section correctly.
      const json = renderAuditJsonReport(model);
      const text = renderAuditTextReport(model);
      const parsed = JSON.parse(json);
      expect(parsed.sourceFacts.filesByLanguage.python).toBeGreaterThanOrEqual(2);
      expect(parsed.pythonProjectMetadata.hasPyprojectToml).toBe(true);
      expect(parsed.pythonProjectMetadata.projectName).toBe("fixture-py");
      expect(text).toContain("Python project metadata");
      expect(text).toContain("pyproject.toml=true");
      expect(text).toContain("project name detected: fixture-py");
    } finally {
      cleanup(root);
    }
  });
});
