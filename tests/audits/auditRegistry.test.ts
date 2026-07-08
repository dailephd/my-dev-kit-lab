import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAuditRegistry, selectDetectors, DEFAULT_AUDIT_REGISTRY, type AuditDetector } from "../../src/audits/core/auditRegistry.js";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditTarget } from "../../src/audits/core/auditTarget.js";
import { buildAuditReportModel } from "../../src/audits/report/auditReportModel.js";
import { renderAuditTextReport } from "../../src/audits/report/renderAuditTextReport.js";

function makeDetector(overrides: Partial<AuditDetector> = {}): AuditDetector {
  return {
    id: "test-detector",
    auditType: "code-rot",
    title: "Test detector",
    description: "Test description",
    supportedIncludeAreas: ["docs"],
    run: () => [],
    ...overrides,
  };
}

describe("DEFAULT_AUDIT_REGISTRY", () => {
  // Was empty in Batch 1/2 (no real code-rot detectors yet); Batch 3
  // intentionally populates it with the first 3 real detectors -- see
  // tests/audits/codeRot/codeRotRegistryIntegration.test.ts for the full
  // Batch 3 registry-contents assertions.
  it("is non-empty as of Batch 3 — real code-rot detectors are registered", () => {
    expect(DEFAULT_AUDIT_REGISTRY.length).toBeGreaterThan(0);
  });
});

describe("createAuditRegistry", () => {
  it("handles an empty detector list", () => {
    expect(createAuditRegistry([])).toEqual([]);
  });

  it("accepts a list of detectors with unique ids", () => {
    const detectors = [makeDetector({ id: "a" }), makeDetector({ id: "b" })];
    expect(createAuditRegistry(detectors)).toEqual(detectors);
  });

  it("rejects duplicate detector ids", () => {
    const detectors = [makeDetector({ id: "dup" }), makeDetector({ id: "dup" })];
    expect(() => createAuditRegistry(detectors)).toThrow(/Duplicate audit detector id/);
  });
});

describe("selectDetectors", () => {
  it("returns an empty list when the registry is empty", () => {
    expect(selectDetectors([], ["code-rot"], ["docs"])).toEqual([]);
  });

  it("filters by audit type", () => {
    const codeRot = makeDetector({ id: "cr", auditType: "code-rot" });
    const registry = [codeRot];
    expect(selectDetectors(registry, ["code-rot"], ["docs"])).toEqual([codeRot]);
    // "quality" is a recognized AuditType (even though unselectable via CLI
    // in Batch 1) — this exercises the registry's own filtering, not the
    // CLI's planned-type rejection.
    expect(selectDetectors(registry, ["quality"], ["docs"])).toEqual([]);
  });

  it("filters by include area — matches if any supported area is selected", () => {
    const detector = makeDetector({ supportedIncludeAreas: ["docs", "tests"] });
    expect(selectDetectors([detector], ["code-rot"], ["docs"])).toEqual([detector]);
    expect(selectDetectors([detector], ["code-rot"], ["tests"])).toEqual([detector]);
    expect(selectDetectors([detector], ["code-rot"], ["cli"])).toEqual([]);
  });

  it("preserves registry order (deterministic, not re-sorted)", () => {
    const a = makeDetector({ id: "a" });
    const b = makeDetector({ id: "b" });
    const c = makeDetector({ id: "c" });
    const selected = selectDetectors([c, a, b], ["code-rot"], ["docs"]);
    expect(selected.map((d) => d.id)).toEqual(["c", "a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// v0.3.0 Batch 6 — registry coverage / include-filter regression guards
// (spec 3.7). Extends this existing file rather than duplicating a new one.
// ---------------------------------------------------------------------------

const toolRoot = process.cwd();

const EXPECTED_DETECTOR_ID_ORDER = [
  "stale-command-reference",
  "docs-code-mismatch",
  "package-release-rot",
  "duplicate-implementation-candidate",
  "dead-code-candidate",
  "test-rot",
  "architecture-drift",
  "dependency-environment-rot",
  "cross-platform-rot",
  "security-validation-assumption-rot",
];

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

describe("DEFAULT_AUDIT_REGISTRY — Batch 6 hard order lock", () => {
  it("has exactly 10 detectors, unique ids, in the exact Batch 4-established order", () => {
    const ids = DEFAULT_AUDIT_REGISTRY.map((d) => d.id);
    expect(ids).toEqual(EXPECTED_DETECTOR_ID_ORDER);
    expect(new Set(ids).size).toBe(10);
  });

  it("every registered detector has a non-empty supportedIncludeAreas", () => {
    for (const detector of DEFAULT_AUDIT_REGISTRY) {
      expect(detector.supportedIncludeAreas.length).toBeGreaterThan(0);
    }
  });
});

describe("--include filtering — skipped vs excluded are distinct mechanisms", () => {
  it("a detector whose supportedIncludeAreas does not intersect --include is EXCLUDED (not selected at all, not in skippedDetectors)", async () => {
    // duplicate-implementation-candidate only supports cli/package/architecture
    // -- selecting only "tests" means it doesn't even get selected by
    // selectDetectors(), so it must never appear in skippedDetectors (that's
    // reserved for a detector that WAS selected but self-skipped via
    // shouldSkip()).
    const config = normalizeAuditConfig({ include: "tests" }, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: DEFAULT_AUDIT_REGISTRY });
    const skippedIds = result.skippedDetectors.map((d) => d.id);
    expect(skippedIds).not.toContain("duplicate-implementation-candidate");

    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: DEFAULT_AUDIT_REGISTRY });
    const entry = model.detectors.find((d) => d.id === "duplicate-implementation-candidate");
    expect(entry?.status).toBe("excluded");
  });

  it("a detector whose supportedIncludeAreas intersects --include but self-skips via shouldSkip() is SKIPPED (appears in skippedDetectors)", async () => {
    // stale-command-reference supports docs/cli/package and self-skips when
    // --include does not select docs. Selecting "package" alone means it IS
    // selected by selectDetectors() (package is a supported area) but then
    // self-skips.
    const config = normalizeAuditConfig({ include: "package" }, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: DEFAULT_AUDIT_REGISTRY });
    const skippedIds = result.skippedDetectors.map((d) => d.id);
    expect(skippedIds).toContain("stale-command-reference");

    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: DEFAULT_AUDIT_REGISTRY });
    const entry = model.detectors.find((d) => d.id === "stale-command-reference");
    expect(entry?.status).toBe("skipped");
  });

  it("skipped detectors appear in both the JSON model's skippedDetectors and the rendered text report", async () => {
    const config = normalizeAuditConfig({ include: "package" }, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: DEFAULT_AUDIT_REGISTRY });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: DEFAULT_AUDIT_REGISTRY });
    expect(model.skippedDetectors.some((d) => d.id === "stale-command-reference")).toBe(true);
    const text = renderAuditTextReport(model);
    expect(text).toContain("stale-command-reference");
  });
});

describe("runAudit({ registry: [] }) — empty registry behavior", () => {
  it("selectedDetectorCount is 0 and noDetectorsRegistered is true for an explicit empty registry", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    expect(result.noDetectorsRegistered).toBe(true);

    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    expect(model.summary.selectedDetectorCount).toBe(0);
    expect(model.summary.noDetectorsRegistered).toBe(true);
    expect(model.detectors).toEqual([]);
  });
});
