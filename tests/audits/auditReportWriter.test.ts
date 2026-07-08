import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditTarget } from "../../src/audits/core/auditTarget.js";
import { buildAuditReportModel } from "../../src/audits/report/auditReportModel.js";
import { writeAuditReports } from "../../src/audits/report/writeAuditReports.js";
import { AUDIT_JSON_REPORT_FILENAME, AUDIT_TEXT_REPORT_FILENAME } from "../../src/audits/report/auditReportPaths.js";

const toolRoot = process.cwd();
const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fakeTarget(rootPath = toolRoot): AuditTarget {
  return {
    rootPath,
    displayName: "fake",
    exists: true,
    isDirectory: true,
    packageJsonPath: path.join(rootPath, "package.json"),
    gitRoot: rootPath,
    isSelf: rootPath === toolRoot,
    safeReportOutputRoot: path.join(toolRoot, "reports", "audits"),
  };
}

describe("writeAuditReports — format combinations", () => {
  it("writes only json when formats=['json']", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-writer-json-"));
    cleanupDirs.push(outDir);
    const config = normalizeAuditConfig({ format: "json", out: outDir }, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const { writtenPaths } = writeAuditReports({ model, config, outDir });

    expect(writtenPaths).toHaveLength(1);
    expect(existsSync(path.join(outDir, AUDIT_JSON_REPORT_FILENAME))).toBe(true);
    expect(existsSync(path.join(outDir, AUDIT_TEXT_REPORT_FILENAME))).toBe(false);
  });

  it("writes only text when formats=['text']", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-writer-text-"));
    cleanupDirs.push(outDir);
    const config = normalizeAuditConfig({ format: "text", out: outDir }, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const { writtenPaths } = writeAuditReports({ model, config, outDir });

    expect(writtenPaths).toHaveLength(1);
    expect(existsSync(path.join(outDir, AUDIT_TEXT_REPORT_FILENAME))).toBe(true);
    expect(existsSync(path.join(outDir, AUDIT_JSON_REPORT_FILENAME))).toBe(false);
  });

  it("writes both for 'text,json' and 'json,text'", async () => {
    for (const formatArg of ["text,json", "json,text"]) {
      const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-writer-both-"));
      cleanupDirs.push(outDir);
      const config = normalizeAuditConfig({ format: formatArg, out: outDir }, toolRoot);
      const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
      const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
      const { writtenPaths } = writeAuditReports({ model, config, outDir });

      expect(writtenPaths).toHaveLength(2);
      expect(existsSync(path.join(outDir, AUDIT_JSON_REPORT_FILENAME))).toBe(true);
      expect(existsSync(path.join(outDir, AUDIT_TEXT_REPORT_FILENAME))).toBe(true);
    }
  });
});

describe("writeAuditReports — output boundaries", () => {
  it("writes under the provided outDir only", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-writer-outdir-"));
    cleanupDirs.push(outDir);
    const config = normalizeAuditConfig({ format: "text,json", out: outDir }, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const { writtenPaths } = writeAuditReports({ model, config, outDir });

    for (const p of writtenPaths) {
      expect(p.startsWith(path.resolve(outDir))).toBe(true);
    }
  });

  it("path-with-spaces outDir works", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit writer spaces "));
    cleanupDirs.push(outDir);
    const config = normalizeAuditConfig({ format: "text,json", out: outDir }, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const { writtenPaths } = writeAuditReports({ model, config, outDir });

    expect(writtenPaths).toHaveLength(2);
    for (const p of writtenPaths) {
      expect(existsSync(p)).toBe(true);
    }
  });

  it("does not touch files outside outDir (sibling directory untouched)", async () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), "audit-writer-sibling-"));
    cleanupDirs.push(parent);
    const outDir = path.join(parent, "out");
    const sibling = path.join(parent, "sibling");
    mkdirSync(sibling, { recursive: true });
    writeFileSync(path.join(sibling, "untouched.txt"), "keep me", "utf8");

    const config = normalizeAuditConfig({ format: "text,json", out: outDir }, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    writeAuditReports({ model, config, outDir });

    expect(readdirSync(sibling)).toEqual(["untouched.txt"]);
    expect(readFileSync(path.join(sibling, "untouched.txt"), "utf8")).toBe("keep me");
  });

  it("empty formats array writes nothing", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-writer-empty-"));
    cleanupDirs.push(outDir);
    const config = normalizeAuditConfig({ out: outDir }, toolRoot);
    config.formats = [];
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const { writtenPaths } = writeAuditReports({ model, config, outDir });
    expect(writtenPaths).toEqual([]);
  });
});

describe("writeAuditReports — nested output directory creation", () => {
  it("creates a 3-levels-deep non-existent --out path (fs.mkdirSync recursive semantics)", async () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), "audit-writer-nested-"));
    cleanupDirs.push(parent);
    const outDir = path.join(parent, "a", "b", "c");
    expect(existsSync(outDir)).toBe(false);

    const config = normalizeAuditConfig({ format: "text,json", out: outDir }, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const { writtenPaths } = writeAuditReports({ model, config, outDir });

    expect(writtenPaths).toHaveLength(2);
    expect(existsSync(path.join(outDir, AUDIT_JSON_REPORT_FILENAME))).toBe(true);
    expect(existsSync(path.join(outDir, AUDIT_TEXT_REPORT_FILENAME))).toBe(true);
  });
});

describe("writeAuditReports — default output path when --out is omitted", () => {
  it("uses reports/audits/<primary-type>/ under the tool root by default", () => {
    const config = normalizeAuditConfig({}, toolRoot);
    expect(config.out).toBe(path.join(path.resolve(toolRoot), "reports", "audits", "code-rot"));
    expect(config.outWasDefault).toBe(true);
  });
});

describe("writeAuditReports — deterministic fixed filenames", () => {
  it("always writes exactly AUDIT_JSON_REPORT_FILENAME/AUDIT_TEXT_REPORT_FILENAME, never a variant name", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-writer-filenames-"));
    cleanupDirs.push(outDir);
    const config = normalizeAuditConfig({ format: "text,json", out: outDir }, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const { writtenPaths } = writeAuditReports({ model, config, outDir });

    expect(AUDIT_JSON_REPORT_FILENAME).toBe("code-rot-audit.json");
    expect(AUDIT_TEXT_REPORT_FILENAME).toBe("code-rot-audit.txt");
    expect(readdirSync(outDir).sort()).toEqual([AUDIT_JSON_REPORT_FILENAME, AUDIT_TEXT_REPORT_FILENAME].sort());
    expect(writtenPaths.map((p) => path.basename(p)).sort()).toEqual([AUDIT_JSON_REPORT_FILENAME, AUDIT_TEXT_REPORT_FILENAME].sort());
  });
});

describe("writeAuditReports — running twice against the same --out overwrites cleanly", () => {
  it("run 2's output reflects run 2's actual state only, no bleed-through from run 1", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "audit-writer-rerun-"));
    cleanupDirs.push(outDir);
    const config = normalizeAuditConfig({ format: "text,json", out: outDir }, toolRoot);

    // Run 1: a synthetic registry with one detector producing 2 issues.
    const manyIssuesDetector = {
      id: "many-issues",
      auditType: "code-rot" as const,
      title: "Many issues",
      description: "test",
      supportedIncludeAreas: ["docs" as const],
      run: () => [
        makeFakeIssue("issue-a"),
        makeFakeIssue("issue-b"),
      ],
    };
    const result1 = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [manyIssuesDetector] });
    const model1 = buildAuditReportModel(result1, { target: fakeTarget(), registry: [manyIssuesDetector] });
    writeAuditReports({ model: model1, config, outDir });

    const jsonPath = path.join(outDir, AUDIT_JSON_REPORT_FILENAME);
    const textPath = path.join(outDir, AUDIT_TEXT_REPORT_FILENAME);
    const afterRun1Json = JSON.parse(readFileSync(jsonPath, "utf8")) as { summary: { totalIssues: number } };
    expect(afterRun1Json.summary.totalIssues).toBe(2);
    expect(readFileSync(textPath, "utf8")).toContain("Total issues: 2");

    // Run 2: zero-detector registry, zero issues.
    const result2 = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model2 = buildAuditReportModel(result2, { target: fakeTarget(), registry: [] });
    writeAuditReports({ model: model2, config, outDir });

    const afterRun2Json = JSON.parse(readFileSync(jsonPath, "utf8")) as { summary: { totalIssues: number } };
    expect(afterRun2Json.summary.totalIssues).toBe(0);
    const afterRun2Text = readFileSync(textPath, "utf8");
    expect(afterRun2Text).toContain("Total issues: 0");
    expect(afterRun2Text).not.toContain("issue-a");
    expect(afterRun2Text).not.toContain("issue-b");
  });
});

function makeFakeIssue(id: string) {
  return {
    id,
    auditType: "code-rot" as const,
    detectorId: "many-issues",
    title: id,
    description: "test issue",
    severity: "medium" as const,
    confidence: "medium" as const,
    falsePositiveRisk: "low" as const,
    category: "test",
    evidence: [],
    affectedFiles: [],
    recommendedAction: "n/a",
    suggestedFixStrategy: "n/a",
    validationCommands: [],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
  };
}

describe("writeAuditReports — external target does not receive reports by default", () => {
  it("config.out for an external target still resolves under the tool's own reports/ tree, not the target root", () => {
    const externalRoot = mkdtempSync(path.join(os.tmpdir(), "audit-writer-external-target-"));
    cleanupDirs.push(externalRoot);
    const config = normalizeAuditConfig({ target: externalRoot }, toolRoot);
    // Default --out resolution is entirely config/toolRoot-driven (see
    // auditConfig.ts's defaultOutDir()) -- it never depends on or points at
    // the audit target path, confirming reports never land under an
    // external target by default.
    expect(config.out.startsWith(path.resolve(toolRoot))).toBe(true);
    expect(config.out.startsWith(path.resolve(externalRoot))).toBe(false);
    expect(readdirSync(externalRoot)).toEqual([]);
  });
});
