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
});
