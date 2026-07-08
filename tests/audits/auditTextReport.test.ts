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

const REQUIRED_SECTIONS = [
  "Target",
  "Config",
  "Detectors",
  "Inventory summary",
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
