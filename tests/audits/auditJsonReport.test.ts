import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditDetector } from "../../src/audits/core/auditRegistry.js";
import type { AuditIssue } from "../../src/audits/core/auditIssue.js";
import type { AuditTarget } from "../../src/audits/core/auditTarget.js";
import { buildAuditReportModel } from "../../src/audits/report/auditReportModel.js";
import { renderAuditJsonReport } from "../../src/audits/report/renderAuditJsonReport.js";

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

describe("renderAuditJsonReport", () => {
  it("produces valid, parseable JSON with every required top-level field", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const detector = makeDetector();
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
    const json = renderAuditJsonReport(model);

    const parsed = JSON.parse(json);
    for (const key of [
      "schemaVersion",
      "metadata",
      "target",
      "config",
      "summary",
      "inventory",
      "sourceOfTruth",
      "sourceFacts",
      "pythonProjectMetadata",
      "detectors",
      "issues",
      "skippedDetectors",
      "detectorErrors",
      "recommendations",
      "exit",
    ]) {
      expect(parsed).toHaveProperty(key);
    }
  });

  it("AuditIssue fields are fully present per issue", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const detector = makeDetector();
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
    const parsed = JSON.parse(renderAuditJsonReport(model));

    expect(parsed.issues).toHaveLength(1);
    const issue = parsed.issues[0];
    for (const key of [
      "id",
      "auditType",
      "detectorId",
      "title",
      "description",
      "severity",
      "confidence",
      "falsePositiveRisk",
      "category",
      "evidence",
      "affectedFiles",
      "recommendedAction",
      "suggestedFixStrategy",
      "validationCommands",
      "releaseBlocking",
      "implementationBlocking",
      "autoFixEligible",
    ]) {
      expect(issue).toHaveProperty(key);
    }
  });

  it("avoids raw full file contents — no 'files' array from inventory", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const parsed = JSON.parse(renderAuditJsonReport(model));

    expect("files" in parsed.inventory).toBe(false);
    expect("sourceFiles" in parsed.inventory).toBe(false);
    expect("docsFiles" in parsed.inventory).toBe(false);
  });

  it("sourceFacts summary has the condensed field shape (counts, not a per-file array)", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const parsed = JSON.parse(renderAuditJsonReport(model));

    expect(parsed.sourceFacts).toHaveProperty("totalFilesAnalyzed");
    expect(parsed.sourceFacts).toHaveProperty("filesByLanguage");
    expect(parsed.sourceFacts).toHaveProperty("filesByParseStatus");
    expect(parsed.sourceFacts).toHaveProperty("analyzerDiagnosticCount");
    expect("files" in parsed.sourceFacts).toBe(false);
  });

  it("preserves a source-facts-derived evidence entry (v0.3.1 Batch 4 detector output) verbatim", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const detector = makeDetector({
      run: () => [
        makeIssue({
          evidence: [
            {
              kind: "reference",
              message: "Source facts: the TypeScript/JavaScript analyzer parsed this file and recorded 1 export(s), 0 declaration(s), and 0 import(s).",
              filePath: "src/example.ts",
              source: "test-detector",
              confidence: "medium",
            },
          ],
        }),
      ],
    });
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
    const parsed = JSON.parse(renderAuditJsonReport(model));

    expect(parsed.issues[0].evidence[0].message).toContain("Source facts:");
    expect(parsed.issues[0].evidence[0].filePath).toBe("src/example.ts");
  });

  // v0.3.2 Batch 3 -- T2: filesWithDiagnosticsCount is additive/optional in
  // spirit (always present, but purely informational) alongside the
  // existing sourceFacts fields.
  it("sourceFacts summary includes the new filesWithDiagnosticsCount field", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const parsed = JSON.parse(renderAuditJsonReport(model));

    expect(parsed.sourceFacts).toHaveProperty("filesWithDiagnosticsCount");
    expect(typeof parsed.sourceFacts.filesWithDiagnosticsCount).toBe("number");
  });

  // v0.3.2 Batch 3 -- T3: pythonProjectMetadata is a small, condensed,
  // always-present (never undefined) informational object -- never a
  // per-file array, never a blocker signal.
  it("pythonProjectMetadata has the expected condensed, informational shape", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const parsed = JSON.parse(renderAuditJsonReport(model));

    for (const key of [
      "hasPyprojectToml",
      "hasRequirementsTxt",
      "hasSetupPy",
      "hasSetupCfg",
      "hasToxIni",
      "hasPytestIni",
      "hasPytestConfiguration",
      "projectName",
      "warnings",
    ]) {
      expect(parsed.pythonProjectMetadata).toHaveProperty(key);
    }
  });

  // v0.3.2 Batch 3 -- T4: a Python-derived detector finding (dead-code,
  // duplicate-declaration, or test-rot) preserves its conservative wording
  // and evidence through JSON exactly like any other issue -- no special
  // Python-only JSON handling exists or is needed.
  it("preserves a Python-derived detector issue's conservative wording and evidence verbatim", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const detector = makeDetector({
      run: () => [
        makeIssue({
          category: "dead-code-candidate",
          title: 'Python function "widget_fn" in "src/widget.py" has no detected cross-file import (weak signal)',
          description:
            '"widget_fn" (function) is declared in "src/widget.py" and does not appear as an imported name in any other scanned Python file. This is a deterministic source-facts signal from a conservative, non-semantic scan -- it does not resolve dynamic imports, framework/plugin discovery, string-based dispatch, or usage from outside the scanned project, so it may indicate dead code but is not proof.',
          severity: "info",
          confidence: "low",
          falsePositiveRisk: "high",
          evidence: [
            {
              kind: "reference",
              message:
                'Source facts: the Python analyzer parsed this file and found no other scanned Python file importing the name "widget_fn". Static-analysis limitation -- confidence reduced because this scan cannot see dynamic imports or usage outside the scanned file set.',
              filePath: "src/widget.py",
              source: "test-detector",
              confidence: "low",
            },
          ],
        }),
      ],
    });
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
    const parsed = JSON.parse(renderAuditJsonReport(model));

    const issue = parsed.issues[0];
    expect(issue.severity).toBe("info");
    expect(issue.confidence).toBe("low");
    expect(issue.title.toLowerCase()).not.toContain("is unused");
    expect(issue.title.toLowerCase()).not.toContain("is dead");
    expect(issue.description.toLowerCase()).not.toContain("definitely unreferenced");
    expect(issue.evidence[0].message).toContain("Static-analysis limitation");
  });
});
