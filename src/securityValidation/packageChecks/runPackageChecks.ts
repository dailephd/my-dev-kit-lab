import path from "node:path";
import { runSecurityCommand, resolveNpmCommand } from "../commandRunner.js";
import { writeCheckResult } from "../artifacts.js";
import { parseNpmPackDryRun } from "./parseNpmPackDryRun.js";
import { detectForbiddenContents } from "./forbiddenPackageContents.js";
import type { SecurityCheckResult, SecurityFinding } from "../types.js";
import type { SecurityValidationConfig } from "../config.js";

export type PackageChecksOutput = {
  checks: SecurityCheckResult[];
  findings: SecurityFinding[];
};

// Run npm pack --dry-run and inspect the resulting file list for forbidden contents.
// Does not publish anything.
export async function runPackageChecks(options: {
  cwd: string;
  config: SecurityValidationConfig;
}): Promise<PackageChecksOutput> {
  const { cwd, config } = options;
  const { reportDir, rawOutputDir, commandTimeoutMs, forbiddenPackagePatterns, allowedPackageExceptions } = config;
  const allFindings: SecurityFinding[] = [];
  const checks: SecurityCheckResult[] = [];
  const npm = resolveNpmCommand();

  // npm pack --dry-run to get the tarball file list
  const startedAt = new Date().toISOString();
  const cmd = await runSecurityCommand({
    command: npm,
    args: ["pack", "--dry-run"],
    cwd,
    timeoutMs: commandTimeoutMs,
  });
  const finishedAt = new Date().toISOString();

  // npm pack --dry-run writes the tarball filename to stdout on some npm
  // versions and the detailed file list to stderr. Prefer whichever stream
  // contains the tarball contents section, then fall back to combined output.
  const packOutput =
    [cmd.stdout, cmd.stderr].find((stream) => /tarball contents/i.test(stream)) ??
    [cmd.stdout, cmd.stderr].filter(Boolean).join("\n");
  const parsed = parseNpmPackDryRun(packOutput);

  const { findings: contentFindings } = detectForbiddenContents({
    files: parsed.files,
    forbiddenPatterns: forbiddenPackagePatterns,
    allowedExceptions: allowedPackageExceptions,
    checkId: "npm-pack",
  });
  allFindings.push(...contentFindings);

  const packCheck: SecurityCheckResult = {
    id: "npm-pack-dry-run",
    name: "npm pack --dry-run (tarball file list)",
    category: "package-content",
    status: cmd.timedOut
      ? "failed"
      : parsed.parseError && parsed.files.length === 0
        ? "warning"
        : contentFindings.length > 0
          ? "failed"
          : "passed",
    severity: contentFindings.length > 0
      ? contentFindings.some((f) => f.severity === "blocker")
        ? "blocker"
        : "major"
      : "informational",
    startedAt,
    finishedAt,
    durationMs: cmd.durationMs,
    findings: contentFindings,
    skippedReason: undefined,
    command: "npm pack --dry-run",
  };
  await writeCheckResult({
    result: packCheck,
    outputPath: path.join(reportDir, "npm-pack-dry-run.json"),
    rawDir: rawOutputDir,
    rawStdout: cmd.stdout,
    rawStderr: cmd.stderr,
  });
  checks.push(packCheck);

  // Write combined package checks summary
  const combined: SecurityCheckResult = {
    id: "package-checks",
    name: "Package checks summary",
    category: "package-content",
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
    outputPath: path.join(reportDir, "package-checks.json"),
    rawDir: rawOutputDir,
  });

  return { checks, findings: allFindings };
}
