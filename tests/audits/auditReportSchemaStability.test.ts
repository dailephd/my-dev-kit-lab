import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditDetector } from "../../src/audits/core/auditRegistry.js";
import type { AuditIssue } from "../../src/audits/core/auditIssue.js";
import type { AuditTarget } from "../../src/audits/core/auditTarget.js";
import { buildAuditReportModel } from "../../src/audits/report/auditReportModel.js";
import { renderAuditJsonReport } from "../../src/audits/report/renderAuditJsonReport.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 5 — locks the top-level JSON key set so an accidental field
// rename/removal fails loudly. metadata.generatedAt (timestamp) and
// target.rootPath (absolute path) are excluded from value comparisons since
// they are inherently non-deterministic/machine-specific.
// ---------------------------------------------------------------------------

const toolRoot = process.cwd();

const REQUIRED_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "metadata",
  "target",
  "config",
  "summary",
  "inventory",
  "sourceOfTruth",
  "sourceFacts",
  // v0.3.2 Batch 3 -- 15th top-level field, alongside the existing 14.
  "pythonProjectMetadata",
  // v0.3.2 Batch 4 -- 16th top-level field.
  "securitySummary",
  // v0.4.2 Batch 3 -- 17th top-level field.
  "androidSecurity",
  "detectors",
  "issues",
  "skippedDetectors",
  "detectorErrors",
  "recommendations",
  "exit",
].sort();

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
    evidence: [],
    affectedFiles: [],
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

describe("audit JSON report schema stability", () => {
  it("locks the exact top-level key set", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const detector = makeDetector();
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
    const parsed = JSON.parse(renderAuditJsonReport(model));

    expect(Object.keys(parsed).sort()).toEqual(REQUIRED_TOP_LEVEL_KEYS);
  });

  it("checks required nested fields exist", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const detector = makeDetector();
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
    const parsed = JSON.parse(renderAuditJsonReport(model));

    for (const key of [
      "totalIssues",
      "issuesBySeverity",
      "issuesByConfidence",
      "issuesByFalsePositiveRisk",
      "issuesByDetector",
      "releaseBlockingCount",
      "implementationBlockingCount",
      "autoFixEligibleCount",
      "detectorCount",
      "selectedDetectorCount",
      "skippedDetectorCount",
      "detectorErrorCount",
      "highestSeverity",
      "failOnBreached",
      "finalExitCode",
      "finalVerdictLabel",
    ]) {
      expect(parsed.summary).toHaveProperty(key);
    }

    for (const key of ["code", "reason", "failOnThreshold", "breached"]) {
      expect(parsed.exit).toHaveProperty(key);
    }

    expect(parsed.detectors.length).toBeGreaterThan(0);
    for (const key of ["id", "auditType", "title", "supportedIncludeAreas", "status", "issueCount"]) {
      expect(parsed.detectors[0]).toHaveProperty(key);
    }

    expect(parsed.issues.length).toBeGreaterThan(0);
    for (const key of ["id", "detectorId", "title", "severity", "confidence", "evidence", "recommendedAction"]) {
      expect(parsed.issues[0]).toHaveProperty(key);
    }
  });

  it("metadata.generatedAt and target.rootPath are present but excluded from stable comparisons", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const parsed = JSON.parse(renderAuditJsonReport(model));

    expect(typeof parsed.metadata.generatedAt).toBe("string");
    expect(typeof parsed.target.rootPath).toBe("string");
    // Normalized comparison: everything except the two volatile fields.
    const { generatedAt: _g, ...restMetadata } = parsed.metadata;
    const { rootPath: _r, ...restTarget } = parsed.target;
    // v0.3.0 Batch 6 — "auditTypes" (additive array field, spec 3.2) added
    // alongside "auditType" (kept unchanged for backward compat).
    expect(Object.keys(restMetadata).sort()).toEqual(
      ["auditType", "auditTypes", "command", "packageName", "packageVersion", "reportType"].sort()
    );
    expect(Object.keys(restTarget).sort()).toEqual(["displayName", "hasGitRoot", "hasPackageJson", "targetKind"].sort());
  });
});
