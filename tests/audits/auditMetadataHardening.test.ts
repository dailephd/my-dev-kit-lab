import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditTarget } from "../../src/audits/core/auditTarget.js";
import { AUDIT_REPORT_SCHEMA_VERSION, buildAuditReportModel } from "../../src/audits/report/auditReportModel.js";
import { renderAuditJsonReport } from "../../src/audits/report/renderAuditJsonReport.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 6 — metadata.auditTypes hardening (spec 3.2).
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
  "detectors",
  "issues",
  "skippedDetectors",
  "detectorErrors",
  "recommendations",
  "exit",
].sort();

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

describe("metadata.auditTypes — additive array field", () => {
  it("is an array containing 'code-rot' for a default (code-rot) audit type selection", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });

    expect(Array.isArray(model.metadata.auditTypes)).toBe(true);
    expect(model.metadata.auditTypes).toContain("code-rot");
    expect(model.metadata.auditTypes).toEqual(["code-rot"]);
  });

  it("metadata.auditType remains a plain, backward-compatible string", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });

    expect(typeof model.metadata.auditType).toBe("string");
    expect(model.metadata.auditType).toBe("code-rot");
    // Same underlying data, two representations.
    expect(model.metadata.auditType).toBe(model.metadata.auditTypes.join(","));
  });

  it("round-trips through the JSON renderer with auditTypes present alongside auditType", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const parsed = JSON.parse(renderAuditJsonReport(model)) as { metadata: { auditType: string; auditTypes: string[] } };

    expect(parsed.metadata.auditType).toBe("code-rot");
    expect(parsed.metadata.auditTypes).toEqual(["code-rot"]);
  });

  it("does not change the top-level 14-field schema and does not bump schemaVersion", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    const parsed = JSON.parse(renderAuditJsonReport(model));

    expect(Object.keys(parsed).sort()).toEqual(REQUIRED_TOP_LEVEL_KEYS);
    expect(AUDIT_REPORT_SCHEMA_VERSION).toBe("1.0");
    expect(model.schemaVersion).toBe("1.0");
  });
});
