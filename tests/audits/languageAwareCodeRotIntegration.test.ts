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
