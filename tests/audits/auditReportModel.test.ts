import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import type { AuditDetector } from "../../src/audits/core/auditRegistry.js";
import type { AuditIssue } from "../../src/audits/core/auditIssue.js";
import type { AuditTarget } from "../../src/audits/core/auditTarget.js";
import { DEFAULT_AUDIT_REGISTRY } from "../../src/audits/core/auditRegistry.js";
import { buildAuditReportModel, buildRecommendations, computeVerdictLabel } from "../../src/audits/report/auditReportModel.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 5 — buildAuditReportModel() unit tests.
//
// Reuses the makeIssue/makeDetector/fakeTarget fixture pattern already
// established in tests/audits/auditRunner.test.ts.
// ---------------------------------------------------------------------------

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
    evidence: [],
    affectedFiles: [],
    recommendedAction: "Fix the thing.",
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
    run: () => [],
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

describe("buildAuditReportModel — top-level shape", () => {
  it("includes all required top-level fields", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });

    expect(model.schemaVersion).toBe("1.0");
    expect(model.metadata).toBeDefined();
    expect(model.target).toBeDefined();
    expect(model.config).toBeDefined();
    expect(model.summary).toBeDefined();
    expect(model.inventory).toBeDefined();
    expect(model.sourceOfTruth).toBeDefined();
    expect(model.sourceFacts).toBeDefined();
    expect(model.detectors).toBeDefined();
    expect(model.issues).toBeDefined();
    expect(model.skippedDetectors).toBeDefined();
    expect(model.detectorErrors).toBeDefined();
    expect(model.recommendations).toBeDefined();
    expect(model.exit).toBeDefined();
  });

  it("summary has all sub-count fields present", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const detector = makeDetector({ run: () => [makeIssue()] });
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });

    expect(model.summary.issuesBySeverity).toBeDefined();
    expect(model.summary.issuesByConfidence).toBeDefined();
    expect(model.summary.issuesByFalsePositiveRisk).toBeDefined();
    expect(model.summary.issuesByDetector).toEqual({ "test-detector": 1 });
    expect(model.summary.totalIssues).toBe(1);
    expect(model.summary.detectorCount).toBe(1);
    expect(model.summary.selectedDetectorCount).toBe(1);
  });
});

describe("buildAuditReportModel — detector status coverage", () => {
  it("covers all registry entries with correct status for various --types/--include combos", async () => {
    const config = normalizeAuditConfig({ include: "docs" }, toolRoot);
    const inDocs = makeDetector({ id: "in-docs", supportedIncludeAreas: ["docs"] });
    const inCli = makeDetector({ id: "in-cli", supportedIncludeAreas: ["cli"] });
    const registry = [inDocs, inCli];
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry });

    expect(model.detectors).toHaveLength(2);
    const byId = Object.fromEntries(model.detectors.map((d) => [d.id, d.status]));
    expect(byId["in-docs"]).toBe("selected");
    expect(byId["in-cli"]).toBe("excluded");
  });

  it("marks a detector skipped via shouldSkip as status 'skipped'", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const skipped = makeDetector({ id: "skipper", shouldSkip: () => ({ skip: true, reason: "tool unavailable" }) });
    const registry = [skipped];
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry });
    expect(model.detectors[0].status).toBe("skipped");
  });

  it("marks a throwing detector as status 'error'", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const throwing = makeDetector({
      id: "broken",
      run: () => {
        throw new Error("boom");
      },
    });
    const registry = [throwing];
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry });
    expect(model.detectors[0].status).toBe("error");
    expect(model.detectorErrors).toHaveLength(1);
    expect(model.detectorErrors[0].category).toBeDefined();
  });

  it("real DEFAULT_AUDIT_REGISTRY produces 10 detector entries", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget() });
    const model = buildAuditReportModel(result, { target: fakeTarget() });
    expect(model.detectors).toHaveLength(DEFAULT_AUDIT_REGISTRY.length);
    expect(model.detectors).toHaveLength(10);
  });
});

describe("buildAuditReportModel — verdict labels", () => {
  it("'no issues' when there are zero issues", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    expect(model.summary.finalVerdictLabel).toBe("no issues");
  });

  it("'issues found below fail-on threshold' when issues exist but don't breach", async () => {
    const config = normalizeAuditConfig({ failOn: "blocker" }, toolRoot);
    const detector = makeDetector({ run: () => [makeIssue({ severity: "medium" })] });
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
    expect(model.summary.finalVerdictLabel).toBe("issues found below fail-on threshold");
  });

  it("'fail-on threshold breached' when a breaching issue exists", async () => {
    const config = normalizeAuditConfig({ failOn: "medium" }, toolRoot);
    const detector = makeDetector({ run: () => [makeIssue({ severity: "high" })] });
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
    expect(model.summary.finalVerdictLabel).toBe("fail-on threshold breached");
  });

  it("computeVerdictLabel precedence: breach wins over detector errors", async () => {
    const config = normalizeAuditConfig({ failOn: "medium" }, toolRoot);
    const throwing = makeDetector({
      id: "broken",
      run: () => {
        throw new Error("boom");
      },
    });
    const breaching = makeDetector({ id: "breaching", run: () => [makeIssue({ severity: "high", detectorId: "breaching" })] });
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [throwing, breaching] });
    expect(computeVerdictLabel(result, true)).toBe("fail-on threshold breached");
  });
});

// ---------------------------------------------------------------------------
// v0.3.1 Batch 5 -- buildAuditReportModel()'s sourceFacts field (populated
// via summarizeSourceFacts(), added in v0.3.1 Batch 2) had no dedicated unit
// test in this file -- schema-shape coverage existed elsewhere
// (auditReportSchemaStability.test.ts, auditEndToEndReportSchema.test.ts)
// but not a test proving the summary's actual field values track a real,
// small fixture project. Uses the same temp-dir fixture pattern as the
// codeRot detector tests (fs.mkdtempSync + writeFile + cleanup).
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audit-report-model-source-facts-"));
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

describe("buildAuditReportModel — source facts summary", () => {
  it("reflects a real parsed TypeScript file's language/parse-status counts", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      writeFile(root, "src/index.ts", "export const x = 1;\n");
      const config = normalizeAuditConfig({}, root);
      const target = fakeTargetFor(root);
      const result = await runAudit({ config, toolRoot: root, target, registry: [] });
      const model = buildAuditReportModel(result, { target, registry: [] });

      expect(model.sourceFacts.totalFilesAnalyzed).toBeGreaterThan(0);
      expect(model.sourceFacts.filesByLanguage.typescript).toBeGreaterThanOrEqual(1);
      expect(model.sourceFacts.filesByParseStatus.parsed).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup(root);
    }
  });

  it("does not crash and reports zero analyzed files for a project with no source/test files", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
      writeFile(root, "README.md", "# fixture\n");
      const config = normalizeAuditConfig({}, root);
      const target = fakeTargetFor(root);
      const result = await runAudit({ config, toolRoot: root, target, registry: [] });
      const model = buildAuditReportModel(result, { target, registry: [] });

      expect(model.sourceFacts.totalFilesAnalyzed).toBe(0);
      expect(model.sourceFacts.filesByParseStatus.parsed).toBe(0);
    } finally {
      cleanup(root);
    }
  });
});

describe("buildRecommendations", () => {
  it("dedupes identical recommendedAction strings and aggregates issue/detector ids", () => {
    const issues = [
      makeIssue({ id: "a", severity: "medium", recommendedAction: "Do X", detectorId: "det-a" }),
      makeIssue({ id: "b", severity: "high", recommendedAction: "Do X", detectorId: "det-b" }),
      makeIssue({ id: "c", severity: "low", recommendedAction: "Do Y", detectorId: "det-a" }),
    ];
    const recs = buildRecommendations(issues);
    expect(recs).toHaveLength(2);
    const doX = recs.find((r) => r.text === "Do X")!;
    expect(doX.issueIds.sort()).toEqual(["a", "b"]);
    expect(doX.detectorIds.sort()).toEqual(["det-a", "det-b"]);
    // "Do X" has a high-severity contributor, "Do Y" only low -- "Do X" first.
    expect(recs[0].text).toBe("Do X");
    expect(doX.highestSeverity).toBe("high");
  });

  it("sorts blocker/high recommendations before medium/low/info, stable by first occurrence", () => {
    const issues = [
      makeIssue({ id: "1", severity: "info", recommendedAction: "Info rec" }),
      makeIssue({ id: "2", severity: "blocker", recommendedAction: "Blocker rec" }),
      makeIssue({ id: "3", severity: "medium", recommendedAction: "Medium rec" }),
    ];
    const recs = buildRecommendations(issues);
    expect(recs.map((r) => r.text)).toEqual(["Blocker rec", "Medium rec", "Info rec"]);
  });

  it("returns an empty array for zero issues", () => {
    expect(buildRecommendations([])).toEqual([]);
  });
});

describe("buildAuditReportModel — zero-issue and multi-severity cases", () => {
  it("zero issues: highestSeverity is null, failOnBreached is false", async () => {
    const config = normalizeAuditConfig({}, toolRoot);
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [] });
    expect(model.summary.highestSeverity).toBeNull();
    expect(model.summary.failOnBreached).toBe(false);
  });

  it("multi-severity: highestSeverity reflects the highest rank present", async () => {
    const config = normalizeAuditConfig({ failOn: "none" }, toolRoot);
    const detector = makeDetector({
      run: () => [
        makeIssue({ id: "a", severity: "low" }),
        makeIssue({ id: "b", severity: "blocker" }),
        makeIssue({ id: "c", severity: "medium" }),
      ],
    });
    const result = await runAudit({ config, toolRoot, target: fakeTarget(), registry: [detector] });
    const model = buildAuditReportModel(result, { target: fakeTarget(), registry: [detector] });
    expect(model.summary.highestSeverity).toBe("blocker");
  });
});
