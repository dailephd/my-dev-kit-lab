import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import type { SecurityValidationSummary } from "../../../src/securityValidation/types.js";

const runSecurityValidationMock = vi.fn();

vi.mock("../../../src/securityValidation/validate/runSecurityValidation.js", () => ({
  runSecurityValidation: runSecurityValidationMock,
}));

const { runSecurityAuditAdapter } = await import("../../../src/audits/security/securityAuditAdapter.js");

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

function writeFile(root: string, relativePath: string, content: string): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function makeFixtureToolRoot(): string {
  const root = makeTempDir("sec-adapter-tool-");
  writeFile(
    root,
    "package.json",
    JSON.stringify(
      {
        name: "@dailephd/my-dev-kit-lab",
        version: "0.3.2",
        scripts: {},
      },
      null,
      2
    )
  );
  return root;
}

function makeFixtureTargetRoot(): string {
  const root = makeTempDir("sec-adapter-target-");
  writeFile(root, "package.json", JSON.stringify({ name: "fixture-target", version: "1.0.0", scripts: {} }, null, 2));
  writeFile(root, "src/index.js", "module.exports = 1;\n");
  return root;
}

function makeSummary(overrides: Partial<SecurityValidationSummary> = {}): SecurityValidationSummary {
  return {
    toolRoot: overrides.toolRoot ?? "Z:/tool-root",
    toolPackageName: overrides.toolPackageName ?? "@dailephd/my-dev-kit-lab",
    toolPackageVersion: overrides.toolPackageVersion ?? "0.3.2",
    targetRoot: overrides.targetRoot ?? "Z:/target-root",
    targetDescription: overrides.targetDescription ?? "fixture-target",
    packageName: overrides.packageName ?? "fixture-target",
    packageVersion: overrides.packageVersion ?? "1.0.0",
    auditedBranch: overrides.auditedBranch ?? "feature/v0.3.3-java-kotlin-code-rot",
    auditedCommit: overrides.auditedCommit ?? "abc1234",
    isSelf: overrides.isSelf ?? false,
    startedAt: overrides.startedAt ?? "2026-07-09T12:00:00.000Z",
    finishedAt: overrides.finishedAt ?? "2026-07-09T12:00:01.000Z",
    checks: overrides.checks ?? [
      {
        id: "cli-adversarial-suite",
        name: "Target security test suite",
        category: "cli-adversarial",
        status: "failed",
        severity: "major",
        startedAt: "2026-07-09T12:00:00.000Z",
        finishedAt: "2026-07-09T12:00:01.000Z",
        durationMs: 1000,
        command: "npm run test:security",
        commandCwd: overrides.targetRoot ?? "Z:/target-root",
        exitCode: null,
        findings: [],
      },
    ],
    findings: overrides.findings ?? [
      {
        id: "target-security-suite-missing-script",
        title: "Target test:security script is missing",
        severity: "major",
        category: "cli-adversarial",
        description: "The target package.json does not define scripts.test:security.",
        recommendation: "Add a target test:security script and rerun security:validate.",
        releaseImpact: "Should fix before release",
      },
    ],
    verdict: overrides.verdict ?? "not-ready-security-blocker-remains",
    recommendedNextStep: overrides.recommendedNextStep ?? "Fix failing security checks before release.",
    attackResults: overrides.attackResults ?? [],
    verdictReasonSummary: overrides.verdictReasonSummary,
    isFullReleaseGate: overrides.isFullReleaseGate ?? true,
  };
}

describe("runSecurityAuditAdapter", () => {
  it("maps security findings into audit issues without running the real security gate", async () => {
    const toolRoot = makeFixtureToolRoot();
    const targetRoot = makeFixtureTargetRoot();
    runSecurityValidationMock.mockResolvedValue(
      makeSummary({
        toolRoot,
        targetRoot,
      })
    );

    const config = normalizeAuditConfig({ target: targetRoot, types: "security" }, toolRoot);
    const result = await runSecurityAuditAdapter({ toolRoot, config });

    expect(runSecurityValidationMock).toHaveBeenCalledTimes(1);
    expect(runSecurityValidationMock).toHaveBeenCalledWith({
      cwd: toolRoot,
      targetPath: targetRoot,
    });
    expect(result.summary.ran).toBe(true);
    expect(result.summary.totalChecks).toBe(1);
    expect(result.summary.mappedIssueCount).toBe(1);
    expect(result.summary.findingCounts.major).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.auditType).toBe("security");
    expect(result.issues[0]?.detectorId).toBe("security-validation-adapter");
  });

  it("keeps skipped optional checks out of the mapped issue list", async () => {
    const toolRoot = makeFixtureToolRoot();
    const targetRoot = makeFixtureTargetRoot();
    runSecurityValidationMock.mockResolvedValue(
      makeSummary({
        toolRoot,
        targetRoot,
        checks: [
          {
            id: "codeql-scan",
            name: "CodeQL",
            category: "static-scan",
            status: "skipped",
            severity: "skipped",
            startedAt: "2026-07-09T12:00:00.000Z",
            finishedAt: "2026-07-09T12:00:01.000Z",
            durationMs: 5,
            findings: [],
            skippedReason: "Tool not installed",
          },
        ],
        findings: [],
        verdict: "ready-except-optional-manual-checks",
        recommendedNextStep: "Optional checks were skipped.",
      })
    );

    const config = normalizeAuditConfig({ target: targetRoot, types: "security" }, toolRoot);
    const result = await runSecurityAuditAdapter({ toolRoot, config });

    expect(result.issues).toHaveLength(0);
    expect(result.summary.checksSkipped).toBe(1);
    expect(result.summary.checksPassed).toBe(0);
    expect(result.summary.mappedIssueCount).toBe(0);
  });

  it("writes run-scoped security reports under the tool root and never touches the external target", async () => {
    const toolRoot = makeFixtureToolRoot();
    const targetRoot = makeFixtureTargetRoot();
    const beforeTargetFiles = new Set(fs.readdirSync(targetRoot));
    runSecurityValidationMock.mockResolvedValue(
      makeSummary({
        toolRoot,
        targetRoot,
      })
    );

    const config = normalizeAuditConfig({ target: targetRoot, types: "security" }, toolRoot);
    const result = await runSecurityAuditAdapter({ toolRoot, config });

    expect(result.summary.reportPaths.text).not.toBeNull();
    expect(result.summary.reportPaths.json).not.toBeNull();
    expect(fs.existsSync(result.summary.reportPaths.text!)).toBe(true);
    expect(fs.existsSync(result.summary.reportPaths.json!)).toBe(true);
    expect(path.resolve(result.summary.reportPaths.text!).startsWith(path.resolve(toolRoot, "reports", "security"))).toBe(true);
    expect(path.basename(result.summary.reportPaths.text!)).toMatch(
      /^fixture-target-v1\.0\.0-\d{14}-\d{14}-\d+-security-validation\.txt$/
    );
    expect(fs.existsSync(path.join(targetRoot, "reports"))).toBe(false);
    expect(new Set(fs.readdirSync(targetRoot))).toEqual(beforeTargetFiles);
  });

  it("keeps repeated audit runs on distinct security report files", async () => {
    const toolRoot = makeFixtureToolRoot();
    const targetRoot = makeFixtureTargetRoot();
    runSecurityValidationMock
      .mockResolvedValueOnce(
        makeSummary({
          toolRoot,
          targetRoot,
          startedAt: "2026-07-09T12:00:00.000Z",
          finishedAt: "2026-07-09T12:00:01.000Z",
          auditedCommit: "first-run",
        })
      )
      .mockResolvedValueOnce(
        makeSummary({
          toolRoot,
          targetRoot,
          startedAt: "2026-07-09T12:05:00.000Z",
          finishedAt: "2026-07-09T12:05:01.000Z",
          auditedCommit: "second-run",
        })
      );

    const config = normalizeAuditConfig({ target: targetRoot, types: "security" }, toolRoot);
    const first = await runSecurityAuditAdapter({ toolRoot, config });
    const firstText = fs.readFileSync(first.summary.reportPaths.text!, "utf8");
    const firstJson = fs.readFileSync(first.summary.reportPaths.json!, "utf8");
    const second = await runSecurityAuditAdapter({ toolRoot, config });

    expect(first.summary.reportPaths.text).not.toBe(second.summary.reportPaths.text);
    expect(first.summary.reportPaths.json).not.toBe(second.summary.reportPaths.json);
    expect(fs.readFileSync(first.summary.reportPaths.text!, "utf8")).toBe(firstText);
    expect(fs.readFileSync(first.summary.reportPaths.json!, "utf8")).toBe(firstJson);
    expect(fs.readFileSync(second.summary.reportPaths.text!, "utf8")).toContain("second-run");
    expect(fs.readFileSync(second.summary.reportPaths.json!, "utf8")).toContain("second-run");
  });
});
