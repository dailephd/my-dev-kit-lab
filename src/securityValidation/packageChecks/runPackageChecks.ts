import path from "node:path";
import { runSecurityCommand, resolveNpmCommand } from "../commandRunner.js";
import { writeCheckResult } from "../artifacts.js";
import { parseNpmPackDryRun } from "./parseNpmPackDryRun.js";
import { detectForbiddenContents } from "./forbiddenPackageContents.js";
import { detectMissingRequiredContents } from "./requiredPackageContents.js";
import {
  attachPackagePolicyContext,
  buildPackageContentPolicy,
  type PackagePolicyTarget,
} from "./packageContentPolicy.js";
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
  target: PackagePolicyTarget;
}): Promise<PackageChecksOutput> {
  const { cwd, config, target } = options;
  const { reportDir, rawOutputDir, commandTimeoutMs, forbiddenPackagePatterns, allowedPackageExceptions } = config;
  const allFindings: SecurityFinding[] = [];
  const checks: SecurityCheckResult[] = [];
  const npm = resolveNpmCommand();

  // npm pack --dry-run to get the tarball file list
  const startedAt = new Date().toISOString();
  const cmd = await runSecurityCommand({
    command: npm,
    args: ["pack", "--dry-run", "--json"],
    cwd,
    timeoutMs: commandTimeoutMs,
  });
  const finishedAt = new Date().toISOString();

  // npm pack --dry-run writes the tarball filename to stdout on some npm
  // versions and the detailed file list to stderr. Prefer whichever stream
  // contains the tarball contents section, then fall back to combined output.
  const streamCandidates = [cmd.stdout, cmd.stderr].filter(Boolean);
  const parsedCandidates = streamCandidates.map((stream) => parseNpmPackDryRun(stream));
  const parsed =
    parsedCandidates.find((candidate) => candidate.files.length > 0) ??
    parseNpmPackDryRun(streamCandidates.join("\n"));
  const policy = buildPackageContentPolicy({
    target,
    packedFiles: parsed.files,
    checkId: "npm-pack",
  });

  const { findings: contentFindings } = detectForbiddenContents({
    files: parsed.files,
    forbiddenPatterns: forbiddenPackagePatterns,
    allowedExceptions: allowedPackageExceptions,
    checkId: "npm-pack",
  });
  const { findings: missingRequiredFindings } = detectMissingRequiredContents({
    files: parsed.files,
    requirements: policy.requirements,
    checkId: "npm-pack",
  });
  const packedEvidence = `${parsed.files.length} packed file(s) observed`;
  const contextualContentFindings = contentFindings.map((finding) =>
    attachPackagePolicyContext({
      finding,
      target,
      mode: policy.mode,
      source: policy.source,
      expectedPath: finding.affectedFiles?.[0],
      observedPackedFileEvidence: finding.evidence ?? packedEvidence,
    }),
  );
  const contextualRequiredFindings = missingRequiredFindings.map((finding, index) => {
    const requirement = policy.requirements.filter((candidate) => {
      const expected = candidate.expectedPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
      return finding.affectedFiles?.[0] === expected;
    })[0];
    return attachPackagePolicyContext({
      finding,
      target,
      mode: policy.mode,
      source: requirement?.policySource ?? policy.source,
      expectedPath: finding.affectedFiles?.[0],
      declaringMetadataField: requirement?.declaringMetadataField,
      observedPackedFileEvidence: `${packedEvidence}; required path absent (finding ${index + 1})`,
    });
  });
  const commandFindings: SecurityFinding[] = [];
  if (cmd.timedOut || (cmd.exitCode !== 0 && cmd.exitCode !== null)) {
    commandFindings.push(attachPackagePolicyContext({
      finding: {
        id: "npm-pack-command-failed",
        title: "npm package inventory command failed",
        severity: "blocker",
        category: "package-content",
        description: "npm pack --dry-run --json did not complete successfully",
        evidence: `Exit code: ${String(cmd.exitCode)}; timed out: ${String(cmd.timedOut)}`,
        recommendation: "Correct the target package configuration so npm can generate a dry-run inventory",
        releaseImpact: "Blocker: package contents cannot be validated",
      },
      target,
      mode: policy.mode,
      source: policy.source,
      observedPackedFileEvidence: packedEvidence,
    }));
  }
  if (parsed.files.length === 0) {
    commandFindings.push(attachPackagePolicyContext({
      finding: {
        id: "npm-pack-inventory-empty",
        title: "npm package inventory is empty or unreadable",
        severity: "blocker",
        category: "package-content",
        description: parsed.parseError ?? "npm produced an empty packed file list",
        evidence: parsed.parseError ?? "No packed files observed",
        recommendation: "Produce a nonempty, parseable npm pack dry-run inventory",
        releaseImpact: "Blocker: package contents cannot be established",
      },
      target,
      mode: policy.mode,
      source: policy.source,
      observedPackedFileEvidence: packedEvidence,
    }));
  }
  const packageFindings = [
    ...policy.findings,
    ...contextualContentFindings,
    ...contextualRequiredFindings,
    ...commandFindings,
  ].sort((left, right) => left.id.localeCompare(right.id));
  const hasFailingFinding = packageFindings.some(
    (finding) => finding.severity === "blocker" || finding.severity === "major",
  );
  allFindings.push(...packageFindings);

  const packCheck: SecurityCheckResult = {
    id: "npm-pack-dry-run",
    name: "npm pack --dry-run (tarball file list)",
    category: "package-content",
    status: cmd.timedOut || hasFailingFinding
      ? "failed"
      : parsed.parseError && parsed.files.length === 0
        ? "warning"
        : packageFindings.length > 0
          ? "warning"
          : "passed",
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
    command: "npm pack --dry-run --json",
    commandCwd: cwd,
    exitCode: cmd.exitCode,
    packagePolicy: {
      mode: policy.mode,
      source: policy.source,
      targetRoot: target.targetRoot,
      packageName: target.packageName,
      packageVersion: target.packageVersion,
      requiredPaths: policy.requirements.map((requirement) => ({
        expectedPath: requirement.expectedPath,
        declaringMetadataField: requirement.declaringMetadataField,
      })),
      packedFileCount: parsed.files.length,
    },
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
