import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecurityValidationSummary } from "../../src/securityValidation/types.js";
import type { AuditTarget } from "../../src/audits/core/auditTarget.js";

// ---------------------------------------------------------------------------
// v0.3.4 Batch 3 -- repeated audit-run report stability (RPT1-RPT10).
//
// Proves that repeated audit runs produce stable, parseable, internally
// consistent report outputs and never reuse/leak stale security-validation
// report state -- across code-rot-only, security-only, and combined runs,
// and across run order and distinct targets.
//
// runSecurityValidation is mocked (same convention as
// tests/audits/security/securityAuditAdapter.test.ts) so security/combined
// scenarios stay fast and deterministic without shelling out to real
// npm audit/CodeQL/Semgrep/fuzz tooling -- everything downstream of the mock
// (buildSecurityReportFromSummary, writeSecurityReportFiles,
// runSecurityAuditAdapter, runAudit, buildAuditReportModel,
// renderAuditJsonReport/renderAuditTextReport, writeAuditReports) is real.
// ---------------------------------------------------------------------------

const runSecurityValidationMock = vi.fn();

vi.mock("../../src/securityValidation/validate/runSecurityValidation.js", () => ({
  runSecurityValidation: runSecurityValidationMock,
}));

const { normalizeAuditConfig } = await import("../../src/audits/core/auditConfig.js");
const { runAudit } = await import("../../src/audits/core/auditRunner.js");
const { buildAuditReportModel } = await import("../../src/audits/report/auditReportModel.js");
const { renderAuditJsonReport } = await import("../../src/audits/report/renderAuditJsonReport.js");
const { renderAuditTextReport } = await import("../../src/audits/report/renderAuditTextReport.js");
const { writeAuditReports } = await import("../../src/audits/report/writeAuditReports.js");

const FIXED_GENERATED_AT = "2026-01-01T00:00:00.000Z";

const cleanupDirs: string[] = [];

beforeEach(() => {
  runSecurityValidationMock.mockReset();
});

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0)) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function writeFile(root: string, relativePath: string, content = ""): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function fakeTargetFor(root: string, displayName = "fixture"): AuditTarget {
  return {
    rootPath: root,
    displayName,
    exists: true,
    isDirectory: true,
    packageJsonPath: path.join(root, "package.json"),
    gitRoot: null,
    isSelf: false,
    safeReportOutputRoot: path.join(root, "reports", "audits"),
  };
}

function buildMinimalFixture(name: string): string {
  const root = makeTempDir(`report-determinism-${name}-`);
  writeFile(root, "package.json", JSON.stringify({ name: `fixture-${name}`, version: "1.0.0", scripts: {} }));
  writeFile(root, "README.md", `# Fixture ${name}\n`);
  // A small, deterministic duplicate-declaration signal so code-rot issue
  // counts are non-trivial (not just "always zero issues"), same shape as
  // languageAwareCodeRotIntegration.test.ts's fixture.
  writeFile(root, "src/featureA/logger.ts", "export class Logger { log() {} }\n");
  writeFile(root, "src/featureB/logger.ts", "export class Logger { log() {} }\n");
  writeFile(root, "tests/example.test.ts", 'it("works", () => { expect(true).toBe(true); });\n');
  return root;
}

function makeSecuritySummary(overrides: Partial<SecurityValidationSummary> = {}): SecurityValidationSummary {
  return {
    toolRoot: overrides.toolRoot ?? "Z:/tool-root",
    toolPackageName: overrides.toolPackageName ?? "@dailephd/my-dev-kit-lab",
    toolPackageVersion: overrides.toolPackageVersion ?? "0.3.3",
    targetRoot: overrides.targetRoot ?? "Z:/target-root",
    targetDescription: overrides.targetDescription ?? "fixture-target",
    packageName: overrides.packageName ?? "fixture-target",
    packageVersion: overrides.packageVersion ?? "1.0.0",
    auditedBranch: overrides.auditedBranch ?? "feature/v0.3.4-cross-language-stability",
    auditedCommit: overrides.auditedCommit ?? "abc1234",
    isSelf: overrides.isSelf ?? false,
    startedAt: overrides.startedAt ?? "2026-07-10T12:00:00.000Z",
    finishedAt: overrides.finishedAt ?? "2026-07-10T12:00:01.000Z",
    checks: overrides.checks ?? [
      {
        id: "cli-adversarial-suite",
        name: "Target security test suite",
        category: "cli-adversarial",
        status: "passed",
        severity: "informational",
        startedAt: "2026-07-10T12:00:00.000Z",
        finishedAt: "2026-07-10T12:00:01.000Z",
        durationMs: 1000,
        command: "npm run test:security",
        commandCwd: overrides.targetRoot ?? "Z:/target-root",
        exitCode: 0,
        findings: [],
      },
    ],
    findings: overrides.findings ?? [],
    verdict: overrides.verdict ?? "ready-for-release-preparation",
    recommendedNextStep: overrides.recommendedNextStep ?? "All mandatory checks passed.",
    attackResults: overrides.attackResults ?? [],
    verdictReasonSummary: overrides.verdictReasonSummary,
    isFullReleaseGate: overrides.isFullReleaseGate ?? true,
  };
}

// Strips fields that are intentionally volatile across runs (temp-dir
// absolute paths, timestamps, run-scoped report paths) so the rest of the
// parsed JSON report can be compared for deep equality across two runs.
// Deliberately does NOT touch schemaVersion, issue content/severity/
// confidence, sourceFacts language counts, securitySummary.ran, or any other
// field this batch's spec says must stay a real equality check.
function normalizeVolatileFields(parsed: any): any {
  const clone = JSON.parse(JSON.stringify(parsed));
  clone.metadata.generatedAt = "<normalized>";
  clone.metadata.command = "<normalized>";
  clone.target.rootPath = "<normalized>";
  clone.config.out = "<normalized>";
  clone.inventory.targetRoot = "<normalized>";
  if (clone.securitySummary?.reportPaths) {
    clone.securitySummary.reportPaths = { text: "<normalized>", json: "<normalized>" };
  }
  return clone;
}

async function runAndWrite(root: string, typesArg: string | undefined, outDir: string, displayName?: string) {
  const config = normalizeAuditConfig({ out: outDir, ...(typesArg ? { types: typesArg } : {}) }, root);
  const target = fakeTargetFor(root, displayName);
  const result = await runAudit({ config, toolRoot: root, target });
  const model = buildAuditReportModel(result, { target, generatedAt: FIXED_GENERATED_AT });
  const { writtenPaths } = writeAuditReports({ model, config, outDir });
  const jsonPath = writtenPaths.find((p) => p.endsWith(".json"))!;
  const textPath = writtenPaths.find((p) => p.endsWith(".txt"))!;
  return {
    model,
    parsed: JSON.parse(fs.readFileSync(jsonPath, "utf8")),
    text: fs.readFileSync(textPath, "utf8"),
    jsonPath,
    textPath,
  };
}

describe("report determinism — RPT1/A1 code-rot repeated run JSON stability", () => {
  it("produces stable, parseable, internally consistent reports across two runs of the same fixture", async () => {
    const root = buildMinimalFixture("code-rot-repeat");
    const out1 = makeTempDir("report-determinism-out1-");
    const out2 = makeTempDir("report-determinism-out2-");

    const first = await runAndWrite(root, "code-rot", out1);
    const second = await runAndWrite(root, "code-rot", out2);

    expect(first.parsed.schemaVersion).toBe(second.parsed.schemaVersion);
    expect(first.parsed.summary.totalIssues).toBe(second.parsed.summary.totalIssues);
    expect(first.parsed.summary.issuesBySeverity).toEqual(second.parsed.summary.issuesBySeverity);
    expect(first.parsed.sourceFacts).toEqual(second.parsed.sourceFacts);
    expect(normalizeVolatileFields(first.parsed)).toEqual(normalizeVolatileFields(second.parsed));

    // Normalized issue signatures (id + category + severity, path-relative
    // fields only) are stable across runs.
    const signaturesOf = (parsed: any) =>
      parsed.issues.map((i: any) => `${i.id}:${i.category}:${i.severity}`).sort();
    expect(signaturesOf(first.parsed)).toEqual(signaturesOf(second.parsed));

    expect(first.parsed.securitySummary.ran).toBe(false);
    expect(second.parsed.securitySummary.ran).toBe(false);

    expect(first.text).toContain("Source facts summary");
    for (const forbidden of [/gradle/i, /maven/i, /\bandroid\b/i]) {
      // The minimal fixture has no JVM/Android content at all, so no report
      // section should mention executing any of these toolchains.
      expect(first.text).not.toMatch(new RegExp(`${forbidden.source}.*execut`, "i"));
    }
  });
});

describe("report determinism — RPT2/A2 security repeated run JSON stability", () => {
  it("keeps securitySummary current-run-accurate and reportPaths distinct across two runs, with no stale findings", async () => {
    const toolRoot = buildMinimalFixture("security-repeat-tool");
    const targetRoot = buildMinimalFixture("security-repeat-target");
    const out1 = makeTempDir("report-determinism-sec-out1-");
    const out2 = makeTempDir("report-determinism-sec-out2-");

    runSecurityValidationMock
      .mockResolvedValueOnce(
        makeSecuritySummary({
          toolRoot,
          targetRoot,
          startedAt: "2026-07-10T12:00:00.000Z",
          finishedAt: "2026-07-10T12:00:01.000Z",
          findings: [
            {
              id: "first-run-finding",
              title: "First run finding",
              severity: "major",
              category: "cli-adversarial",
              description: "Finding from the first run only.",
              recommendation: "Fix it.",
              releaseImpact: "Should fix before release",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        makeSecuritySummary({
          toolRoot,
          targetRoot,
          startedAt: "2026-07-10T12:05:00.000Z",
          finishedAt: "2026-07-10T12:05:01.000Z",
          findings: [],
        })
      );

    const config1 = normalizeAuditConfig({ target: targetRoot, types: "security", out: out1 }, toolRoot);
    const target = fakeTargetFor(targetRoot);
    const firstResult = await runAudit({ config: config1, toolRoot, target });
    const firstModel = buildAuditReportModel(firstResult, { target, generatedAt: FIXED_GENERATED_AT });
    writeAuditReports({ model: firstModel, config: config1, outDir: out1 });

    const config2 = normalizeAuditConfig({ target: targetRoot, types: "security", out: out2 }, toolRoot);
    const secondResult = await runAudit({ config: config2, toolRoot, target });
    const secondModel = buildAuditReportModel(secondResult, { target, generatedAt: FIXED_GENERATED_AT });
    writeAuditReports({ model: secondModel, config: config2, outDir: out2 });

    expect(firstModel.securitySummary.ran).toBe(true);
    expect(secondModel.securitySummary.ran).toBe(true);

    // RPT10 -- the second run's own findings (none) must not be
    // contaminated by the first run's "first-run-finding".
    expect(firstModel.securitySummary.findingCounts.major).toBe(1);
    expect(secondModel.securitySummary.findingCounts.major).toBe(0);
    expect(secondModel.issues.some((i) => i.title.includes("First run finding"))).toBe(false);

    // Current-run linkage: reportPaths are distinct files, both actually
    // exist, and each is what that specific run wrote.
    expect(firstModel.securitySummary.reportPaths.json).not.toBe(secondModel.securitySummary.reportPaths.json);
    expect(fs.existsSync(firstModel.securitySummary.reportPaths.json!)).toBe(true);
    expect(fs.existsSync(secondModel.securitySummary.reportPaths.json!)).toBe(true);
    const firstSecurityJson = JSON.parse(fs.readFileSync(firstModel.securitySummary.reportPaths.json!, "utf8"));
    const secondSecurityJson = JSON.parse(fs.readFileSync(secondModel.securitySummary.reportPaths.json!, "utf8"));
    expect(JSON.stringify(firstSecurityJson)).toContain("first-run-finding");
    expect(JSON.stringify(secondSecurityJson)).not.toContain("first-run-finding");
  });
});

describe("report determinism — RPT3/A3 combined repeated run JSON stability", () => {
  it("keeps code-rot and security issue counts stable and non-duplicated across two combined runs", async () => {
    const toolRoot = buildMinimalFixture("combined-repeat");
    const out1 = makeTempDir("report-determinism-combined-out1-");
    const out2 = makeTempDir("report-determinism-combined-out2-");

    const mockedFinding = {
      id: "combined-run-finding",
      title: "Combined run finding",
      severity: "major" as const,
      category: "cli-adversarial" as const,
      description: "Finding present in both combined runs.",
      recommendation: "Fix it.",
      releaseImpact: "Should fix before release" as const,
    };
    runSecurityValidationMock.mockResolvedValue(
      makeSecuritySummary({ toolRoot, targetRoot: toolRoot, findings: [mockedFinding] })
    );

    const first = await runAndWrite(toolRoot, "code-rot,security", out1);
    const second = await runAndWrite(toolRoot, "code-rot,security", out2);

    expect(first.parsed.securitySummary.ran).toBe(true);
    expect(second.parsed.securitySummary.ran).toBe(true);

    const codeRotCountOf = (parsed: any) => parsed.issues.filter((i: any) => i.auditType === "code-rot").length;
    const securityCountOf = (parsed: any) => parsed.issues.filter((i: any) => i.auditType === "security").length;

    expect(codeRotCountOf(first.parsed)).toBe(codeRotCountOf(second.parsed));
    expect(securityCountOf(first.parsed)).toBe(1);
    expect(securityCountOf(second.parsed)).toBe(1);
    expect(first.parsed.summary.totalIssues).toBe(second.parsed.summary.totalIssues);

    // Source attribution preserved, no duplicated mapped security issue.
    const securityIssues = first.parsed.issues.filter((i: any) => i.auditType === "security");
    expect(securityIssues).toHaveLength(1);
    expect(securityIssues[0].detectorId).toBe("security-validation-adapter");
  });
});

describe("report determinism — RPT4/A4 run-order isolation", () => {
  it("does not leak security state across a code-rot-only -> security-only -> combined -> code-rot-only sequence", async () => {
    const toolRoot = buildMinimalFixture("run-order");
    const dirA = makeTempDir("report-determinism-order-a-");
    const dirB = makeTempDir("report-determinism-order-b-");
    const dirC = makeTempDir("report-determinism-order-c-");
    const dirD = makeTempDir("report-determinism-order-d-");

    runSecurityValidationMock.mockResolvedValue(
      makeSecuritySummary({ toolRoot, targetRoot: toolRoot, findings: [] })
    );

    const runA = await runAndWrite(toolRoot, "code-rot", dirA);
    const runB = await runAndWrite(toolRoot, "security", dirB);
    const runC = await runAndWrite(toolRoot, "code-rot,security", dirC);
    const runD = await runAndWrite(toolRoot, "code-rot", dirD);

    expect(runA.parsed.securitySummary.ran).toBe(false);
    expect(runB.parsed.securitySummary.ran).toBe(true);
    expect(runC.parsed.securitySummary.ran).toBe(true);
    // The critical isolation assertion: a code-rot-only run AFTER a
    // security-including run must not inherit ran=true from the prior run.
    expect(runD.parsed.securitySummary.ran).toBe(false);
    expect(runD.parsed.securitySummary.reportPaths).toEqual({ text: null, json: null });
  });
});

describe("report determinism — RPT5/A5 target/output collision safety", () => {
  it("keeps two different targets' reports distinct when each run uses its own --out directory", async () => {
    // Two targets whose sanitized package names could plausibly collide if
    // report paths were derived from target name alone rather than from the
    // caller-provided --out directory.
    const targetOne = buildMinimalFixture("collide-1");
    const targetTwo = buildMinimalFixture("collide-2");
    const outOne = makeTempDir("report-determinism-collide-out1-");
    const outTwo = makeTempDir("report-determinism-collide-out2-");

    const first = await runAndWrite(targetOne, "code-rot", outOne, "target-one");
    const second = await runAndWrite(targetTwo, "code-rot", outTwo, "target-two");

    expect(first.jsonPath).not.toBe(second.jsonPath);
    expect(fs.existsSync(first.jsonPath)).toBe(true);
    expect(fs.existsSync(second.jsonPath)).toBe(true);
    expect(first.parsed.target.displayName).toBe("target-one");
    expect(second.parsed.target.displayName).toBe("target-two");
    expect(first.parsed.target.rootPath).toBe(path.resolve(targetOne));
    expect(second.parsed.target.rootPath).toBe(path.resolve(targetTwo));
    // Re-reading the first report after the second run completed proves the
    // second run's write did not overwrite the first (distinct --out dirs).
    const firstReread = JSON.parse(fs.readFileSync(first.jsonPath, "utf8"));
    expect(firstReread.target.displayName).toBe("target-one");
  });
});

describe("report determinism — RPT6/A6 text and JSON reports agree", () => {
  it("keeps text-report issue/severity totals in sync with the JSON report, for code-rot-only and combined runs", async () => {
    const codeRotRoot = buildMinimalFixture("text-json-code-rot");
    const outCodeRot = makeTempDir("report-determinism-text-json-cr-");
    const codeRotRun = await runAndWrite(codeRotRoot, "code-rot", outCodeRot);

    expect(codeRotRun.text).toContain(`Total issues: ${codeRotRun.parsed.summary.totalIssues}`);
    const sev = codeRotRun.parsed.summary.issuesBySeverity;
    expect(codeRotRun.text).toContain(
      `By severity: blocker=${sev.blocker} high=${sev.high} medium=${sev.medium} low=${sev.low} info=${sev.info}`
    );
    expect(codeRotRun.text).toContain("Source facts summary");
    expect(codeRotRun.text).toContain("(not run -- add \"security\" to --types to include it");

    const combinedRoot = buildMinimalFixture("text-json-combined");
    const outCombined = makeTempDir("report-determinism-text-json-combined-");
    runSecurityValidationMock.mockResolvedValue(
      makeSecuritySummary({ toolRoot: combinedRoot, targetRoot: combinedRoot, findings: [] })
    );
    const combinedRun = await runAndWrite(combinedRoot, "code-rot,security", outCombined);

    expect(combinedRun.text).toContain(`Total issues: ${combinedRun.parsed.summary.totalIssues}`);
    expect(combinedRun.text).toContain("Source facts summary");
    expect(combinedRun.text).toContain(`Verdict: ${combinedRun.parsed.securitySummary.verdictLabel}`);
    expect(combinedRun.text).not.toContain("(not run -- add \"security\" to --types");
  });
});

describe("report determinism — RPT7 securitySummary.ran correctness by audit type", () => {
  it("is false for code-rot-only and true for security/combined, matching config.types exactly", async () => {
    const root = buildMinimalFixture("ran-correctness");
    runSecurityValidationMock.mockResolvedValue(makeSecuritySummary({ toolRoot: root, targetRoot: root, findings: [] }));

    const codeRotOnly = await runAndWrite(root, "code-rot", makeTempDir("report-determinism-ran-cr-"));
    const securityOnly = await runAndWrite(root, "security", makeTempDir("report-determinism-ran-sec-"));
    const combined = await runAndWrite(root, "code-rot,security", makeTempDir("report-determinism-ran-combo-"));

    expect(codeRotOnly.parsed.securitySummary.ran).toBe(false);
    expect(securityOnly.parsed.securitySummary.ran).toBe(true);
    expect(combined.parsed.securitySummary.ran).toBe(true);
  });
});

describe("report determinism — RPT8 stable top-level schema field presence", () => {
  it("keeps every required top-level and nested field present across a real fixture run", async () => {
    const root = buildMinimalFixture("schema-presence");
    const { parsed } = await runAndWrite(root, "code-rot", makeTempDir("report-determinism-schema-"));

    expect(parsed.schemaVersion).toBeTruthy();
    expect(typeof parsed.metadata.generatedAt).toBe("string");
    expect(parsed.target).toBeDefined();
    expect(parsed.metadata.packageName).toBeDefined();
    expect(parsed.metadata.packageVersion).toBeDefined();
    expect(Array.isArray(parsed.metadata.auditTypes)).toBe(true);
    expect(parsed.summary).toBeDefined();
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(parsed.sourceFacts).toBeDefined();
    expect(parsed.pythonProjectMetadata).toBeDefined();
    expect(parsed.securitySummary).toBeDefined();
  });
});

describe("report determinism — RPT9 generated report files stay outside the target source tree", () => {
  it("writes only to the configured --out directory, never into the fixture's own src/tests trees", async () => {
    const root = buildMinimalFixture("artifact-hygiene");
    const beforeFiles = new Set(walkAll(root));
    const outDir = makeTempDir("report-determinism-hygiene-out-");

    const { jsonPath, textPath } = await runAndWrite(root, "code-rot", outDir);

    expect(path.resolve(jsonPath).startsWith(path.resolve(outDir))).toBe(true);
    expect(path.resolve(textPath).startsWith(path.resolve(outDir))).toBe(true);
    const afterFiles = new Set(walkAll(root));
    expect(afterFiles).toEqual(beforeFiles);
  });
});

describe("report determinism — RPT10 no stale security findings after repeated runs", () => {
  it("never carries a prior run's finding into a subsequent run's mapped issues or reportPaths content", async () => {
    const root = buildMinimalFixture("no-stale-findings");
    runSecurityValidationMock
      .mockResolvedValueOnce(
        makeSecuritySummary({
          toolRoot: root,
          targetRoot: root,
          findings: [
            {
              id: "stale-candidate-finding",
              title: "Stale candidate finding",
              severity: "minor",
              category: "cli-adversarial",
              description: "Should not survive into the next run.",
              recommendation: "n/a",
              releaseImpact: "Can fix in patch/docs",
            },
          ],
        })
      )
      .mockResolvedValueOnce(makeSecuritySummary({ toolRoot: root, targetRoot: root, findings: [] }));

    const first = await runAndWrite(root, "security", makeTempDir("report-determinism-stale-1-"));
    const second = await runAndWrite(root, "security", makeTempDir("report-determinism-stale-2-"));

    expect(first.parsed.securitySummary.findingCounts.minor).toBe(1);
    expect(second.parsed.securitySummary.findingCounts.minor).toBe(0);
    expect(JSON.stringify(second.parsed.issues)).not.toContain("stale-candidate-finding");
    expect(second.text).not.toContain("Stale candidate finding");
  });
});

function walkAll(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkAll(full));
    } else {
      result.push(full);
    }
  }
  return result.sort();
}
