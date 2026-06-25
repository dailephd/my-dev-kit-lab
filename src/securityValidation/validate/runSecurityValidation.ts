import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { runDependencyChecks } from "../dependencies/runDependencyChecks.js";
import { runPackageChecks } from "../packageChecks/runPackageChecks.js";
import { runCodeqlCheck } from "../staticScans/codeql.js";
import { runSemgrepCheck } from "../staticScans/semgrep.js";
import { runAllFuzzTargets } from "../fuzz/fuzzHarness.js";
import { ALL_FUZZ_TARGETS } from "../fuzz/fuzzTargets.js";
import { calculateVerdict } from "./verdict.js";
import { resolveValidationTarget, targetDescription as describeTarget } from "./resolveTarget.js";
import { DEFAULT_SECURITY_CONFIG } from "../config.js";
import type { SecurityCheckResult, SecurityFinding, SecurityValidationSummary } from "../types.js";
import type { SecurityValidationConfig } from "../config.js";
import { runCliSecuritySuiteCheck } from "./runCliSecuritySuiteCheck.js";

export type RunSecurityValidationOptions = {
  // my-dev-kit-lab root (tool root — where configs, fuzz targets, and tests live)
  cwd: string;
  // Optional path to the project being validated. Omit for self-validation.
  targetPath?: string;
  config?: Partial<SecurityValidationConfig>;
  fuzzIterations?: number;
  fuzzSeed?: number;
};

export async function runSecurityValidation(
  options: RunSecurityValidationOptions
): Promise<SecurityValidationSummary> {
  const toolRoot = options.cwd;
  const config: SecurityValidationConfig = {
    ...DEFAULT_SECURITY_CONFIG,
    reportDir: path.join(toolRoot, DEFAULT_SECURITY_CONFIG.reportDir),
    rawOutputDir: path.join(toolRoot, DEFAULT_SECURITY_CONFIG.rawOutputDir),
    ...options.config,
  };

  // Resolve and validate the target project
  const target = resolveValidationTarget(options.targetPath, toolRoot);

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

  // --- Dependency checks (runs in target root) ---
  // If target has no package.json/lockfile, runDependencyChecks will surface that
  // as a structured finding rather than crashing.
  try {
    const depOutput = await runDependencyChecks({ cwd: target.targetRoot, config });
    collectMany(depOutput.checks);
  } catch (err) {
    collect(errorCheck("dependency-checks", "Dependency checks", "dependency-audit", err));
  }

  // --- Package content checks (runs in target root) ---
  // Not all projects are publishable npm packages; runPackageChecks handles
  // missing package.json gracefully.
  try {
    const pkgOutput = await runPackageChecks({ cwd: target.targetRoot, config });
    collectMany(pkgOutput.checks);
  } catch (err) {
    collect(errorCheck("package-content", "Package content checks", "package-content", err));
  }

  // --- Static scans (scan target root; config from tool root) ---
  try {
    collect(
      await runCodeqlCheck({ cwd: toolRoot, targetRoot: target.targetRoot, timeoutMs: config.commandTimeoutMs })
    );
  } catch (err) {
    collect(errorCheck("codeql-scan", "CodeQL static analysis", "static-scan", err));
  }

  try {
    collect(
      await runSemgrepCheck({
        targetRoot: target.targetRoot,
        toolRoot,
        timeoutMs: config.commandTimeoutMs,
      })
    );
  } catch (err) {
    collect(errorCheck("semgrep-scan", "Semgrep static analysis", "static-scan", err));
  }

  // --- Security suite check ---
  // Self-validation runs the lab's own test:security suite.
  // External validation runs the target project's test:security script when present.
  collect(
    await runCliSecuritySuiteCheck({
      toolRoot,
      target,
      timeoutMs: config.commandTimeoutMs,
    })
  );

  // --- Fuzz smoke (always tool-internal; tests library parser/helper code) ---
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

  // --- Tool root metadata ---
  let toolPackageName = "my-dev-kit-lab";
  let toolPackageVersion = "unknown";

  try {
    const pkgRaw = fs.readFileSync(path.join(toolRoot, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { name?: string; version?: string };
    if (pkg.name) toolPackageName = pkg.name;
    if (pkg.version) toolPackageVersion = pkg.version;
  } catch {
    // Use defaults.
  }

  const { verdict, recommendedNextStep } = calculateVerdict(allChecks, allFindings);

  return {
    toolRoot,
    toolPackageName,
    toolPackageVersion,
    targetRoot: target.targetRoot,
    targetDescription: describeTarget(target),
    packageName: target.packageName ?? (target.isSelf ? toolPackageName : path.basename(target.targetRoot)),
    packageVersion: target.packageVersion ?? (target.isSelf ? toolPackageVersion : "unknown"),
    auditedBranch: target.branch ?? "unknown",
    auditedCommit: target.commit ?? "unknown",
    isSelf: target.isSelf,
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
