import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditDetector } from "../../src/audits/core/auditRegistry.js";
import type { AuditIssue } from "../../src/audits/core/auditIssue.js";
import type { AuditSeverity } from "../../src/audits/core/auditTypes.js";
import type { AuditTarget } from "../../src/audits/core/auditTarget.js";
import { buildAuditReportModel } from "../../src/audits/report/auditReportModel.js";
import { renderAuditTextReport } from "../../src/audits/report/renderAuditTextReport.js";

const toolRoot = process.cwd();

function makeIssue(overrides: Partial<AuditIssue> = {}): AuditIssue {
  return {
    id: "issue-1",
    auditType: "code-rot",
    detectorId: "test-detector",
    title: "Test issue",
    description: "Test description",
    severity: "medium",
    confidence: "medium",
    falsePositiveRisk: "low",
    category: "test",
    evidence: [{ kind: "observation", message: "evidence msg", source: "test-detector", confidence: "medium" }],
    affectedFiles: ["some/file.ts"],
    recommendedAction: "Fix it.",
    suggestedFixStrategy: "n/a",
    validationCommands: [],
    releaseBlocking: false,
    implementationBlocking: false,
    autoFixEligible: false,
    ...overrides,
  };
}

function fakeTarget(): AuditTarget {
  return {
    rootPath: toolRoot,
    displayName: "fake",
    exists: true,
    isDirectory: true,
    packageJsonPath: path.join(toolRoot, "package.json"),
    gitRoot: toolRoot,
    isSelf: true,
    safeReportOutputRoot: path.join(toolRoot, "reports", "audits"),
  };
}

function makeDetector(overrides: Partial<AuditDetector> = {}): AuditDetector {
  return {
    id: "test-detector",
    auditType: "code-rot",
    title: "Test detector",
    description: "Test description",
    supportedIncludeAreas: ["docs"],
    run: () => [makeIssue()],
    ...overrides,
  };
}

const REQUIRED_SECTIONS = [
  "Target",
  "Config",
  "Detectors",
  "Inventory summary",
  "Source facts summary",
  // v0.3.2 Batch 3.
  "Python project metadata",
  "Source-of-truth summary",
  "Issue summary",
  "Skipped detectors",
  "Detector errors",
  "Exit result",
];

describe("renderAuditTextReport — 0 issues", () => {
  it("includes all required sections and stays readable with zero issues", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const text = renderAuditTextReport(model);

    for (const section of REQUIRED_SECTIONS) {
      expect(text).toContain(section);
    }
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/no issues found|clean\b/i);
    expect(text).toContain("(no issues in this run)");
  });
});

describe("renderAuditTextReport — source facts summary", () => {
  it("renders a readable, bounded parse-status line (not a per-file dump)", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const text = renderAuditTextReport(model);

    expect(text).toMatch(/analyzed=\d+/);
    expect(text).toMatch(/parsed=\d+ file-level-only=\d+ unsupported=\d+ parse-error=\d+ skipped=\d+/);
    // Bounded: no full source text or per-file paths from the source-facts
    // snapshot leak into the summary section itself.
    const summarySection = text.split("Source facts summary")[1]?.split("Source-of-truth summary")[0] ?? "";
    expect(summarySection.length).toBeLessThan(500);
  });

  it("renders a source-facts-derived evidence message in a bounded, readable issue block", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const detector = makeDetector({
      run: () => [
        makeIssue({
          // Mirrors deadCodeCandidateDetector.ts's findUnreferencedSourceFiles():
          // a basename-observation entry (index 0) followed by a source-facts
          // evidence entry (index 1) -- exactly at MAX_EVIDENCE_PER_ISSUE (2),
          // plus a third that must NOT render.
          evidence: [
            {
              kind: "observation",
              message: "No relative import/require specifier resolves to this file's basename.",
              filePath: "src/example.ts",
              source: "test-detector",
              confidence: "low",
            },
            {
              kind: "reference",
              message: "Source facts: the TypeScript/JavaScript analyzer parsed this file and recorded 1 export(s), 0 declaration(s), and 0 import(s).",
              filePath: "src/example.ts",
              source: "test-detector",
              confidence: "medium",
            },
            {
              kind: "reference",
              message: "THIRD_EVIDENCE_SHOULD_NOT_RENDER",
              source: "test-detector",
              confidence: "low",
            },
          ],
        }),
      ],
    });
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
    const text = renderAuditTextReport(model);

    expect(text).toContain("Source facts:");
    expect(text).not.toContain("THIRD_EVIDENCE_SHOULD_NOT_RENDER");
  });

  it("renders an evidence entry's message even when it also carries an excerpt (e.g. duplicateImplementationDetector's source-facts-derived findings)", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const detector = makeDetector({
      run: () => [
        makeIssue({
          // Mirrors duplicateImplementationDetector.ts's
          // findDuplicateDeclarationCandidates(): a "Source facts: ..."
          // message paired with a file-path-list excerpt on the SAME
          // evidence entry -- previously the excerpt silently suppressed
          // the message entirely in text output.
          evidence: [
            {
              kind: "reference",
              message: 'Source facts: an exported class named "Logger" was parsed in 2 distinct files.',
              excerpt: "src/featureA/logger.ts, src/featureB/logger.ts",
              source: "test-detector",
              confidence: "low",
            },
          ],
        }),
      ],
    });
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
    const text = renderAuditTextReport(model);

    expect(text).toContain('Source facts: an exported class named "Logger"');
    expect(text).toContain("src/featureA/logger.ts, src/featureB/logger.ts");
  });
});

describe("renderAuditTextReport — many issues (15 synthetic issues)", () => {
  const severities: AuditSeverity[] = ["blocker", "high", "medium", "low", "info"];

  function manyIssueDetector(): AuditDetector {
    const issues: AuditIssue[] = [];
    for (let i = 0; i < 15; i++) {
      const severity = severities[i % severities.length];
      issues.push(
        makeIssue({
          id: `issue-${i}`,
          severity,
          title: `Synthetic issue ${i} (${severity})`,
          recommendedAction: `Recommendation for issue ${i}`,
        })
      );
    }
    return {
      id: "many-issue-detector",
      auditType: "code-rot",
      title: "Many issue detector",
      description: "test",
      supportedIncludeAreas: ["docs"],
      run: () => issues,
    };
  }

  it("does not say 'clean'/'no issues' when issues exist, stays structured", async () => {
    const config = normalizeAuditConfig({ failOn: "none" }, toolRoot);
    const detector = manyIssueDetector();
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
    const text = renderAuditTextReport(model);

    expect(text).not.toMatch(/no issues found|report is clean/i);
    expect(text).toContain("-- BLOCKER");
    expect(text).toContain("-- HIGH");
    expect(text).toContain("-- MEDIUM");
    expect(text).toContain("-- LOW");
    expect(text).toContain("-- INFO");
    // Grouped by severity, not a flat unreadable wall — blocker heading
    // appears before the info heading.
    expect(text.indexOf("-- BLOCKER")).toBeLessThan(text.indexOf("-- INFO"));
  });

  it("bounds recommendations shown in text to the top N (does not dump all 15)", async () => {
    const config = normalizeAuditConfig({ failOn: "none" }, toolRoot);
    const detector = manyIssueDetector();
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
    const text = renderAuditTextReport(model);

    const recSectionMatch = text.match(/Top recommendations[\s\S]*?\n\n/);
    expect(recSectionMatch).not.toBeNull();
    const bulletCount = (recSectionMatch![0].match(/^  - /gm) ?? []).length;
    expect(bulletCount).toBeLessThanOrEqual(10);
  });
});

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audit-text-report-python-"));
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

describe("renderAuditTextReport — Python project metadata (Batch 3)", () => {
  it("T3: renders recognized Python metadata presence, project name, and pytest configuration presence, boundedly", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      writeFile(root, "pyproject.toml", ["[project]", 'name = "fixture-py"'].join("\n") + "\n");
      writeFile(root, "pytest.ini", "[pytest]\n");
      const config = normalizeAuditConfig({}, root);
      const target = fakeTargetFor(root);
      const result = await runAudit({ config, toolRoot: root, target, registry: [] });
      const model = buildAuditReportModel(result, { target, registry: [] });
      const text = renderAuditTextReport(model);

      expect(text).toContain("Python project metadata");
      expect(text).toContain("pyproject.toml=true");
      expect(text).toContain("requirements.txt=false");
      expect(text).toContain("project name detected: fixture-py");
      expect(text).toContain("pytest configuration detected: true");

      // Bounded: the section itself must not balloon with raw file content.
      const section = text.split("Python project metadata")[1]?.split("Source-of-truth summary")[0] ?? "";
      expect(section.length).toBeLessThan(400);
    } finally {
      cleanup(root);
    }
  });

  it("renders all-false/none for a project with no recognized Python metadata files, without crashing", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      const config = normalizeAuditConfig({}, root);
      const target = fakeTargetFor(root);
      const result = await runAudit({ config, toolRoot: root, target, registry: [] });
      const model = buildAuditReportModel(result, { target, registry: [] });
      const text = renderAuditTextReport(model);

      expect(text).toContain("pyproject.toml=false");
      expect(text).toContain("project name detected: (none)");
      expect(text).toContain("pytest configuration detected: false");
    } finally {
      cleanup(root);
    }
  });

  // v0.3.2 Batch 3 -- T4: conservative wording requirement, checked directly
  // against real rendered text output (not just the JSON evidence field).
  it("T4: renders a Python-derived detector issue without forbidden overclaiming phrases", async () => {
    const detector: AuditDetector = {
      id: "test-detector",
      auditType: "code-rot",
      title: "Test detector",
      description: "test",
      supportedIncludeAreas: ["docs"],
      run: () => [
        makeIssue({
          category: "test-rot",
          title: 'Test "tests/test_foo.py" imports a Python module that may not exist: ".missing_module"',
          description:
            'tests/test_foo.py imports ".missing_module" (source-facts-derived via the Python analyzer). No candidate local module or package file was found relative to the test file. This is a deterministic source-facts signal from a conservative, non-semantic scan -- it does not resolve Python\'s real package/sys.path rules, namespace packages, or editable installs, so this may indicate a stale import but is not proof.',
          severity: "low",
          confidence: "low",
          falsePositiveRisk: "medium",
          evidence: [
            {
              kind: "file",
              message:
                "Analyzer-recorded relative Python import does not resolve to a candidate local module/package file. This is a best-effort, path-based check -- it does not resolve Python's real package/sys.path rules, so confirm manually before treating it as stale.",
              filePath: "tests/test_foo.py",
              excerpt: ".missing_module",
              source: "test-detector",
              confidence: "low",
            },
          ],
        }),
      ],
    };
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
    const text = renderAuditTextReport(model);

    expect(text).toContain("may not exist");
    expect(text.toLowerCase()).not.toContain("broken test");
    expect(text.toLowerCase()).not.toContain("missing dependency");
    expect(text.toLowerCase()).not.toContain("definitely unreferenced");
  });
});
