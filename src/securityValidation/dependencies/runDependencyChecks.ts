import path from "node:path";
import { runSecurityCommand, resolveNpmCommand } from "../commandRunner.js";
import { writeCheckResult } from "../artifacts.js";
import { parseNpmAudit } from "./parseNpmAudit.js";
import { parseNpmLs } from "./parseNpmLs.js";
import { parseNpmOutdated } from "./parseNpmOutdated.js";
import { runOsvScanner } from "./runOsvScanner.js";
import type { SecurityCheckResult, SecurityFinding } from "../types.js";
import type { SecurityValidationConfig } from "../config.js";

export type DependencyChecksOutput = {
  checks: SecurityCheckResult[];
  findings: SecurityFinding[];
};

// Orchestrate all dependency checks and write structured results to reportDir.
// npm audit, npm ls, and npm outdated require network/lockfile access;
// OSV-Scanner is optional and marked skipped if not installed.
export async function runDependencyChecks(options: {
  cwd: string;
  config: SecurityValidationConfig;
}): Promise<DependencyChecksOutput> {
  const { cwd, config } = options;
  const { reportDir, rawOutputDir, commandTimeoutMs, requireOsvScanner } = config;
  const allFindings: SecurityFinding[] = [];
  const checks: SecurityCheckResult[] = [];
  const npm = resolveNpmCommand();

  // npm audit --json (full audit including devDependencies)
  {
    const startedAt = new Date().toISOString();
    const cmd = await runSecurityCommand({
      command: npm,
      args: ["audit", "--json"],
      cwd,
      timeoutMs: commandTimeoutMs,
    });
    const finishedAt = new Date().toISOString();
    const parsed = parseNpmAudit(cmd.stdout, "npm-audit-full");
    const findings = parsed.findings;
    allFindings.push(...findings);

    const check: SecurityCheckResult = {
      id: "npm-audit-full",
      name: "npm audit (including devDependencies)",
      category: "dependency-audit",
      status: cmd.timedOut
        ? "failed"
        : parsed.parseError
          ? "warning"
          : parsed.ok
            ? "passed"
            : parsed.severityCounts.critical > 0 || parsed.severityCounts.high > 0
              ? "failed"
              : "warning",
      severity: parsed.ok
        ? "informational"
        : parsed.severityCounts.critical > 0 || parsed.severityCounts.high > 0
          ? "blocker"
          : parsed.severityCounts.moderate > 0
            ? "major"
            : "minor",
      startedAt,
      finishedAt,
      durationMs: cmd.durationMs,
      findings,
      skippedReason: undefined,
      command: "npm audit --json",
    };
    await writeCheckResult({
      result: check,
      outputPath: path.join(reportDir, "npm-audit-full.json"),
      rawDir: rawOutputDir,
      rawStdout: cmd.stdout,
      rawStderr: cmd.stderr,
    });
    checks.push(check);
  }

  // npm audit --omit=dev --json (runtime dependencies only)
  {
    const startedAt = new Date().toISOString();
    const cmd = await runSecurityCommand({
      command: npm,
      args: ["audit", "--omit=dev", "--json"],
      cwd,
      timeoutMs: commandTimeoutMs,
    });
    const finishedAt = new Date().toISOString();
    const parsed = parseNpmAudit(cmd.stdout, "npm-audit-runtime");
    const findings = parsed.findings;
    allFindings.push(...findings);

    const check: SecurityCheckResult = {
      id: "npm-audit-runtime",
      name: "npm audit --omit=dev (runtime dependencies only)",
      category: "dependency-audit",
      status: cmd.timedOut
        ? "failed"
        : parsed.parseError
          ? "warning"
          : parsed.ok
            ? "passed"
            : parsed.severityCounts.critical > 0 || parsed.severityCounts.high > 0
              ? "failed"
              : "warning",
      severity: parsed.ok
        ? "informational"
        : parsed.severityCounts.critical > 0 || parsed.severityCounts.high > 0
          ? "blocker"
          : parsed.severityCounts.moderate > 0
            ? "major"
            : "minor",
      startedAt,
      finishedAt,
      durationMs: cmd.durationMs,
      findings,
      skippedReason: undefined,
      command: "npm audit --omit=dev --json",
    };
    await writeCheckResult({
      result: check,
      outputPath: path.join(reportDir, "npm-audit-runtime.json"),
      rawDir: rawOutputDir,
      rawStdout: cmd.stdout,
      rawStderr: cmd.stderr,
    });
    checks.push(check);
  }

  // npm outdated --json
  {
    const startedAt = new Date().toISOString();
    const cmd = await runSecurityCommand({
      command: npm,
      args: ["outdated", "--json"],
      cwd,
      timeoutMs: commandTimeoutMs,
    });
    const finishedAt = new Date().toISOString();
    const parsed = parseNpmOutdated(cmd.stdout, "npm-outdated");
    const findings = parsed.findings;
    allFindings.push(...findings);

    const check: SecurityCheckResult = {
      id: "npm-outdated",
      name: "npm outdated",
      category: "dependency-audit",
      status: cmd.timedOut ? "failed" : parsed.outdatedCount > 0 ? "warning" : "passed",
      severity: "informational",
      startedAt,
      finishedAt,
      durationMs: cmd.durationMs,
      findings,
      skippedReason: undefined,
      command: "npm outdated --json",
    };
    await writeCheckResult({
      result: check,
      outputPath: path.join(reportDir, "npm-outdated.json"),
      rawDir: rawOutputDir,
      rawStdout: cmd.stdout,
      rawStderr: cmd.stderr,
    });
    checks.push(check);
  }

  // npm ls --all --json
  {
    const startedAt = new Date().toISOString();
    const cmd = await runSecurityCommand({
      command: npm,
      args: ["ls", "--all", "--json"],
      cwd,
      timeoutMs: commandTimeoutMs,
    });
    const finishedAt = new Date().toISOString();
    const parsed = parseNpmLs(cmd.stdout, "npm-ls");
    const findings = parsed.findings;
    allFindings.push(...findings);

    const check: SecurityCheckResult = {
      id: "npm-ls",
      name: "npm ls --all (dependency tree resolution)",
      category: "dependency-audit",
      status: cmd.timedOut
        ? "failed"
        : parsed.parseError
          ? "warning"
          : parsed.ok
            ? "passed"
            : "warning",
      severity: parsed.missingCount > 0 ? "major" : "informational",
      startedAt,
      finishedAt,
      durationMs: cmd.durationMs,
      findings,
      skippedReason: undefined,
      command: "npm ls --all --json",
    };
    await writeCheckResult({
      result: check,
      outputPath: path.join(reportDir, "npm-ls.json"),
      rawDir: rawOutputDir,
      rawStdout: cmd.stdout,
      rawStderr: cmd.stderr,
    });
    checks.push(check);
  }

  // OSV-Scanner (optional)
  {
    const startedAt = new Date().toISOString();
    const cmd = await runOsvScanner({ cwd, timeoutMs: commandTimeoutMs, requireOsvScanner });
    const finishedAt = new Date().toISOString();

    const check: SecurityCheckResult = {
      id: "osv-scanner",
      name: "OSV-Scanner",
      category: "dependency-audit",
      status: cmd.skipped ? "skipped" : cmd.timedOut || cmd.exitCode === null ? "failed" : cmd.exitCode === 0 ? "passed" : "warning",
      severity: cmd.skipped ? "skipped" : "informational",
      startedAt,
      finishedAt,
      durationMs: cmd.durationMs,
      findings: [],
      skippedReason: cmd.skippedReason,
      command: "osv-scanner --lockfile package-lock.json --format json",
    };
    await writeCheckResult({
      result: check,
      outputPath: path.join(reportDir, "osv-scanner.json"),
      rawDir: rawOutputDir,
      rawStdout: cmd.stdout,
      rawStderr: cmd.stderr,
    });
    checks.push(check);
  }

  // Write combined dependency checks summary
  const combined: SecurityCheckResult = {
    id: "dependency-checks",
    name: "Dependency checks summary",
    category: "dependency-audit",
    status: checks.some((c) => c.status === "failed") ? "failed" : checks.some((c) => c.status === "warning") ? "warning" : "passed",
    severity: allFindings.reduce(
      (worst, f) => {
        const order: Record<string, number> = { blocker: 4, major: 3, minor: 2, informational: 1, skipped: 0 };
        return (order[f.severity] ?? 0) > (order[worst] ?? 0) ? f.severity : worst;
      },
      "informational" as SecurityFinding["severity"]
    ),
    startedAt: checks[0]?.startedAt ?? new Date().toISOString(),
    finishedAt: checks[checks.length - 1]?.finishedAt ?? new Date().toISOString(),
    durationMs: checks.reduce((sum, c) => sum + c.durationMs, 0),
    findings: allFindings,
  };
  await writeCheckResult({
    result: combined,
    outputPath: path.join(reportDir, "dependency-checks.json"),
    rawDir: rawOutputDir,
  });

  return { checks, findings: allFindings };
}
