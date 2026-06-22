import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { runDependencyChecks } from "../dependencies/runDependencyChecks.js";
import { runPackageChecks } from "../packageChecks/runPackageChecks.js";
import { runCodeqlCheck } from "../staticScans/codeql.js";
import { runSemgrepCheck } from "../staticScans/semgrep.js";
import { runAllFuzzTargets } from "../fuzz/fuzzHarness.js";
import { ALL_FUZZ_TARGETS } from "../fuzz/fuzzTargets.js";
import { runSecurityCommand, resolveNpmCommand } from "../commandRunner.js";
import { calculateVerdict } from "./verdict.js";
import { DEFAULT_SECURITY_CONFIG } from "../config.js";
import type { SecurityCheckResult, SecurityFinding, SecurityValidationSummary } from "../types.js";
import type { SecurityValidationConfig } from "../config.js";

export type RunSecurityValidationOptions = {
  cwd: string;
  config?: Partial<SecurityValidationConfig>;
  fuzzIterations?: number;
  fuzzSeed?: number;
};

export async function runSecurityValidation(
  options: RunSecurityValidationOptions
): Promise<SecurityValidationSummary> {
  const cwd = options.cwd;
  const config: SecurityValidationConfig = {
    ...DEFAULT_SECURITY_CONFIG,
    reportDir: path.join(cwd, DEFAULT_SECURITY_CONFIG.reportDir),
    rawOutputDir: path.join(cwd, DEFAULT_SECURITY_CONFIG.rawOutputDir),
    ...options.config,
  };

  const startedAt = new Date().toISOString();
  const allChecks: SecurityCheckResult[] = [];
  const allFindings: SecurityFinding[] = [];

  function collect(check: SecurityCheckResult): void {
    allChecks.push(check);
    allFindings.push(...check.findings);
  }

  function collectMany(checks: SecurityCheckResult[]): void {
    for (const c of checks) collect(c);
  }

  // --- Dependency checks ---
  try {
    const depOutput = await runDependencyChecks({ cwd, config });
    collectMany(depOutput.checks);
  } catch (err) {
    collect(errorCheck("dependency-checks", "Dependency checks", "dependency-audit", err));
  }

  // --- Package content checks ---
  try {
    const pkgOutput = await runPackageChecks({ cwd, config });
    collectMany(pkgOutput.checks);
  } catch (err) {
    collect(errorCheck("package-content", "Package content checks", "package-content", err));
  }

  // --- Static scans ---
  try {
    collect(await runCodeqlCheck({ cwd, timeoutMs: config.commandTimeoutMs }));
  } catch (err) {
    collect(errorCheck("codeql-scan", "CodeQL static analysis", "static-scan", err));
  }

  try {
    collect(await runSemgrepCheck({ cwd, timeoutMs: config.commandTimeoutMs }));
  } catch (err) {
    collect(errorCheck("semgrep-scan", "Semgrep static analysis", "static-scan", err));
  }

  // --- CLI adversarial tests (via vitest subprocess) ---
  // Individual adversarial checks have varied signatures and specific test inputs.
  // Run the full test:security suite via vitest and capture pass/fail as a single result.
  {
    const startedAt2 = new Date().toISOString();
    const npm = resolveNpmCommand();
    const cmd = await runSecurityCommand({
      command: npm,
      args: ["run", "test:security", "--", "--reporter=json"],
      cwd,
      timeoutMs: Math.min(config.commandTimeoutMs * 3, 180_000),
    });
    const finishedAt2 = new Date().toISOString();

    const passed = cmd.exitCode === 0;
    collect({
      id: "cli-adversarial-suite",
      name: "CLI adversarial test suite (test:security)",
      category: "cli-adversarial",
      status: passed ? "passed" : "failed",
      severity: "major",
      startedAt: startedAt2,
      finishedAt: finishedAt2,
      durationMs: cmd.durationMs,
      findings: passed
        ? []
        : [
            {
              id: "cli-adversarial-suite-failed",
              title: "CLI adversarial test suite had failures",
              severity: "major",
              category: "cli-adversarial",
              description: `test:security exited with code ${String(cmd.exitCode)}. Run 'npm run test:security' for details.`,
              recommendation: "Fix failing adversarial tests before release.",
              releaseImpact: "Should fix before release",
            },
          ],
      command: `${npm} run test:security`,
    });
  }

  // --- Fuzz smoke ---
  try {
    collect(
      await runAllFuzzTargets(ALL_FUZZ_TARGETS, {
        seed: options.fuzzSeed ?? 0xdeadbeef,
        iterations: options.fuzzIterations ?? 50,
      })
    );
  } catch (err) {
    collect(errorCheck("fuzz-smoke", "Fuzz smoke", "fuzz-smoke", err));
  }

  const finishedAt = new Date().toISOString();

  // --- Metadata ---
  let packageName = "my-dev-kit-lab";
  let packageVersion = "unknown";
  let auditedBranch = "unknown";
  let auditedCommit = "unknown";

  try {
    const pkgRaw = fs.readFileSync(path.join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { name?: string; version?: string };
    if (pkg.name) packageName = pkg.name;
    if (pkg.version) packageVersion = pkg.version;
  } catch {
    // Use defaults.
  }

  try {
    auditedBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    // Leave as unknown.
  }

  try {
    auditedCommit = execSync("git rev-parse --short HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    // Leave as unknown.
  }

  const { verdict, recommendedNextStep } = calculateVerdict(allChecks, allFindings);

  return {
    packageName,
    packageVersion,
    auditedBranch,
    auditedCommit,
    startedAt,
    finishedAt,
    checks: allChecks,
    findings: allFindings,
    verdict,
    recommendedNextStep,
  };
}

function errorCheck(
  id: string,
  name: string,
  category: SecurityCheckResult["category"],
  err: unknown
): SecurityCheckResult {
  const now = new Date().toISOString();
  return {
    id,
    name: `${name} (orchestrator error)`,
    category,
    status: "failed",
    severity: "major",
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    findings: [],
    skippedReason: err instanceof Error ? err.message : String(err),
  };
}
