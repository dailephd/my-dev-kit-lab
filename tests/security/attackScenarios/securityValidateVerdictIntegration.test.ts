import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseSecurityValidateArgs,
  normalizeSecurityValidateConfig,
  applyProfileDefaultChecksIfApplicable,
} from "../../../src/securityValidation/validate/cliOptions.js";
import { resolveAttackProfile } from "../../../src/securityValidation/attackScenarios/attackProfile.js";
import { findingsBreachFailOnThreshold } from "../../../src/securityValidation/validate/verdict.js";
import type { DependencyChecksOutput } from "../../../src/securityValidation/dependencies/runDependencyChecks.js";
import type { PackageChecksOutput } from "../../../src/securityValidation/packageChecks/runPackageChecks.js";
import type { SecurityCheckResult, SecurityFinding } from "../../../src/securityValidation/types.js";

const dependencyChecksMock = vi.hoisted(() => vi.fn());
const packageChecksMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/securityValidation/dependencies/runDependencyChecks.js", () => ({
  runDependencyChecks: dependencyChecksMock,
}));
vi.mock("../../../src/securityValidation/packageChecks/runPackageChecks.js", () => ({
  runPackageChecks: packageChecksMock,
}));

const { runSecurityValidation } = await import(
  "../../../src/securityValidation/validate/runSecurityValidation.js"
);

const toolRoot = process.cwd();
const FIXED_STARTED_AT = "2026-07-26T12:00:00.000Z";
const FIXED_FINISHED_AT = "2026-07-26T12:00:00.010Z";

const CONTROLLED_INFORMATIONAL_FINDING: SecurityFinding = {
  id: "controlled-outdated-package",
  title: "Controlled outdated dependency",
  severity: "informational",
  category: "dependency-audit",
  description: "A frozen informational dependency finding for fail-on policy integration.",
  recommendation: "Review the controlled dependency update separately.",
  releaseImpact: "No release impact",
};

const CONTROLLED_BLOCKER_FINDING: SecurityFinding = {
  id: "controlled-required-dependency-blocker",
  title: "Controlled required dependency blocker",
  severity: "blocker",
  category: "dependency-audit",
  description: "A frozen blocker used to prove required dependency verdict behavior.",
  recommendation: "Resolve the controlled blocker before release.",
  releaseImpact: "Must fix before release",
};

function makeControlledCheck(
  overrides: Pick<SecurityCheckResult, "id" | "name" | "status" | "severity"> &
    Partial<SecurityCheckResult>
): SecurityCheckResult {
  return {
    category: "dependency-audit",
    startedAt: FIXED_STARTED_AT,
    finishedAt: FIXED_FINISHED_AT,
    durationMs: 10,
    findings: [],
    ...overrides,
  };
}

function controlledDependencyOutput(
  auditFindings: SecurityFinding[] = [],
  outdatedFindings: SecurityFinding[] = [CONTROLLED_INFORMATIONAL_FINDING]
): DependencyChecksOutput {
  const checks = [
    makeControlledCheck({
      id: "npm-audit-full",
      name: "npm audit (full)",
      status: auditFindings.length > 0 ? "failed" : "passed",
      severity: auditFindings.length > 0 ? "blocker" : "informational",
      findings: auditFindings,
    }),
    makeControlledCheck({
      id: "npm-audit-runtime",
      name: "npm audit (runtime)",
      status: "passed",
      severity: "informational",
    }),
    makeControlledCheck({
      id: "npm-outdated",
      name: "npm outdated",
      status: outdatedFindings.length > 0 ? "warning" : "passed",
      severity: "informational",
      findings: outdatedFindings,
    }),
    makeControlledCheck({
      id: "npm-ls",
      name: "npm ls",
      status: "passed",
      severity: "informational",
    }),
    makeControlledCheck({
      id: "osv-scanner",
      name: "OSV-Scanner",
      status: "skipped",
      severity: "skipped",
      skippedReason: "Controlled optional tool unavailable.",
    }),
  ];
  return { checks, findings: checks.flatMap((check) => check.findings) };
}

function controlledPackageOutput(): PackageChecksOutput {
  return {
    checks: [
      makeControlledCheck({
        id: "npm-pack-dry-run",
        name: "npm pack --dry-run",
        category: "package-content",
        status: "passed",
        severity: "informational",
      }),
    ],
    findings: [],
  };
}

function buildEffectiveConfig(argv: string[]) {
  const args = parseSecurityValidateArgs(argv);
  let config = normalizeSecurityValidateConfig(args, toolRoot);
  config = applyProfileDefaultChecksIfApplicable(config, resolveAttackProfile(config.profile).defaultCheckIds);
  return config;
}

describe("profile-aware default checks (Batch 5)", () => {
  it("no --profile and no --checks preserves current default behavior", () => {
    const config = buildEffectiveConfig([]);
    expect(config.checks).toEqual(["deps", "package", "static", "cli-adversarial", "fuzz"]);
    expect(config.profile).toBe("node-cli-package");
  });

  it("explicit --checks overrides profile defaults even when --profile is also given", () => {
    const config = buildEffectiveConfig(["--profile", "local-tool", "--checks", "secrets"]);
    expect(config.checks).toEqual(["secrets"]);
  });

  it("--profile node-cli-package with no --checks uses that profile's default checks", () => {
    const config = buildEffectiveConfig(["--profile", "node-cli-package"]);
    const expected = resolveAttackProfile("node-cli-package").defaultCheckIds;
    expect(new Set(config.checks)).toEqual(new Set(expected));
    expect(config.checks).toContain("deps");
    expect(config.checks).toContain("package");
  });

  it("--profile local-tool with no --checks uses local-tool's default checks (excludes package)", () => {
    const config = buildEffectiveConfig(["--profile", "local-tool"]);
    const expected = resolveAttackProfile("local-tool").defaultCheckIds;
    expect(new Set(config.checks)).toEqual(new Set(expected));
    expect(config.checks).not.toContain("package");
  });

  it("--profile npm-package with no --checks uses npm-package's default checks", () => {
    const config = buildEffectiveConfig(["--profile", "npm-package"]);
    const expected = resolveAttackProfile("npm-package").defaultCheckIds;
    expect(new Set(config.checks)).toEqual(new Set(expected));
  });
});

const cleanupDirs: string[] = [];
beforeEach(() => {
  dependencyChecksMock.mockReset();
  packageChecksMock.mockReset();
  dependencyChecksMock.mockResolvedValue(controlledDependencyOutput());
  packageChecksMock.mockResolvedValue(controlledPackageOutput());
});

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("security:validate verdict/fail-on integration against a controlled fixture", () => {
  async function runDepsPackageValidation() {
    const reportDir = mkdtempSync(path.join(os.tmpdir(), "verdict-deps-package-report-"));
    cleanupDirs.push(reportDir);
    return runSecurityValidation({
      cwd: toolRoot,
      selectedChecks: ["deps", "package"],
      profile: "node-cli-package",
      config: {
        reportDir,
        rawOutputDir: path.join(reportDir, "raw"),
      },
    });
  }

  it("a fixture with a real secret exits nonzero (verdict not-ready) regardless of --fail-on", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "verdict-secret-"));
    cleanupDirs.push(root);
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }), "utf8");
    writeFileSync(
      path.join(root, "src", "config.ts"),
      'export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n',
      "utf8"
    );

    const summary = await runSecurityValidation({
      cwd: toolRoot,
      targetPath: root,
      selectedChecks: ["secrets"],
      profile: "node-cli-package",
    });

    expect(summary.verdict).toBe("not-ready-security-blocker-remains");
    expect(findingsBreachFailOnThreshold(summary.findings, "blocker")).toBe(true);
    expect(findingsBreachFailOnThreshold(summary.findings, "high")).toBe(true);
  }, 30_000);

  it("a scoped low-only-finding run behaves according to --fail-on threshold", async () => {
    const reportDir = mkdtempSync(path.join(os.tmpdir(), "verdict-deps-report-"));
    cleanupDirs.push(reportDir);
    const summary = await runSecurityValidation({
      cwd: toolRoot,
      selectedChecks: ["deps"],
      profile: "node-cli-package",
      config: {
        reportDir,
        rawOutputDir: path.join(reportDir, "raw"),
      },
    });

    expect(summary.findings).toEqual([CONTROLLED_INFORMATIONAL_FINDING]);
    expect(findingsBreachFailOnThreshold(summary.findings, "low")).toBe(true);
    expect(findingsBreachFailOnThreshold(summary.findings, "blocker")).toBe(false);
    expect(dependencyChecksMock).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("deps/package scoped validation reports optional-skip verdicts and is not a full release gate", async () => {
    const summary = await runDepsPackageValidation();

    expect(summary.verdict).toBe("ready-except-optional-manual-checks");
    expect(summary.isFullReleaseGate).toBe(false);
    expect(summary.checks.find((check) => check.id === "osv-scanner")).toMatchObject({
      status: "skipped",
      skippedReason: "Controlled optional tool unavailable.",
    });
    expect(dependencyChecksMock).toHaveBeenCalledTimes(1);
    expect(packageChecksMock).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("a frozen required dependency blocker wins over informational and optional-tool findings", async () => {
    dependencyChecksMock.mockResolvedValueOnce(
      controlledDependencyOutput(
        [CONTROLLED_BLOCKER_FINDING],
        [CONTROLLED_INFORMATIONAL_FINDING]
      )
    );

    const summary = await runDepsPackageValidation();

    expect(summary.findings).toEqual([
      CONTROLLED_BLOCKER_FINDING,
      CONTROLLED_INFORMATIONAL_FINDING,
    ]);
    expect(summary.verdict).toBe("not-ready-security-blocker-remains");
    expect(findingsBreachFailOnThreshold(summary.findings, "blocker")).toBe(true);
    expect(summary.checks.find((check) => check.id === "osv-scanner")?.status).toBe("skipped");
  }, 60_000);

  // The "full 5-check gate -> isFullReleaseGate true" case is exercised via
  // the no-flag default CLI smoke test (npm run security:validate, no
  // flags) rather than re-run here — it requires the expensive
  // cli-adversarial subprocess (spawns the whole test:security suite) and
  // is already covered end-to-end in this batch's validation.
});
