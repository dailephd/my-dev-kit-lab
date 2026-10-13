import path from "node:path";
import { runSecurityCommand, resolveNpmCommand } from "../commandRunner.js";
import { writeCheckResult } from "../artifacts.js";
import { parseNpmPackDryRun } from "./parseNpmPackDryRun.js";
import { detectForbiddenContents } from "./forbiddenPackageContents.js";
import { detectMissingRequiredContents, requiredContentsForTarget } from "./requiredPackageContents.js";
import { resolveValidationTarget, type SecurityValidationTarget } from "../validate/resolveTarget.js";
import { discoverPackageRoot } from "../../runtime/packageRoot.js";
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
  target?: SecurityValidationTarget;
}): Promise<PackageChecksOutput> {
  const { cwd, config } = options;
  const { reportDir, rawOutputDir, commandTimeoutMs, forbiddenPackagePatterns, allowedPackageExceptions } = config;
  const allFindings: SecurityFinding[] = [];
  const checks: SecurityCheckResult[] = [];
  const npm = resolveNpmCommand();
  const target = options.target ?? resolveValidationTarget(path.resolve(cwd), discoverPackageRoot());
  if (path.resolve(target.targetRoot) !== path.resolve(cwd)) {
    throw new Error("Package check cwd does not match the resolved target root");
  }
  const policy = await requiredContentsForTarget(target);

  // npm pack --dry-run to get the tarball file list
  const startedAt = new Date().toISOString();
  const cmd = await runSecurityCommand({
    command: npm,
    args: ["pack", "--dry-run", "--json", "--ignore-scripts", "--cache", path.resolve(rawOutputDir, "npm-cache")],
    cwd,
    timeoutMs: commandTimeoutMs,
  });
  const finishedAt = new Date().toISOString();

  // Supported npm versions emit JSON on stdout. Lifecycle scripts are disabled
  // so inspection cannot build, install, or rewrite the target.
  const packOutput = cmd.stdout;
  const parsed = parseNpmPackDryRun(packOutput);

  const { findings: contentFindings } = detectForbiddenContents({
    files: parsed.files,
    forbiddenPatterns: forbiddenPackagePatterns,
    allowedExceptions: allowedPackageExceptions,
    checkId: "npm-pack",
  });
  const { findings: missingRequiredFindings } = detectMissingRequiredContents({
    files: parsed.files,
    checkId: "npm-pack",
    requiredFiles: policy.requiredFiles,
  });
  const evidenceFindings: SecurityFinding[] = [];
  if (cmd.exitCode !== 0 || cmd.timedOut || cmd.skipped || parsed.parseError || parsed.files.length === 0) {
    evidenceFindings.push({
      id: "npm-pack-evidence-invalid",
      title: "npm package inventory could not be validated",
      severity: "blocker",
      category: "package-content",
      description: "A successful npm pack operation and a nonempty, parseable inventory are required.",
      evidence: `exitCode=${String(cmd.exitCode)}; timedOut=${cmd.timedOut}; skipped=${cmd.skipped}; ${parsed.parseError ?? ""}; ${cmd.stderr.slice(0, 500)}`,
      recommendation: "Resolve the package command or inventory failure and rerun validation.",
      releaseImpact: "Blocker: required package evidence is unavailable",
    });
  }
  const packageFindings = [...policy.findings, ...evidenceFindings, ...contentFindings, ...missingRequiredFindings];
  allFindings.push(...packageFindings);

  const packCheck: SecurityCheckResult = {
    id: "npm-pack-dry-run",
    name: "npm pack --dry-run (tarball file list)",
    category: "package-content",
    status: packageFindings.length > 0 ? "failed" : "passed",
    severity: packageFindings.length > 0
      ? packageFindings.some((f) => f.severity === "blocker")
        ? "blocker"
        : "major"
      : "informational",
    startedAt,
    finishedAt,
    durationMs: cmd.durationMs,
    findings: packageFindings,
    skippedReason: undefined,
    command: "npm pack --dry-run --json --ignore-scripts",
    commandCwd: cwd,
    exitCode: cmd.exitCode,
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
