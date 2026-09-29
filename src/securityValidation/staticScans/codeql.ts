import { runSecurityCommand } from "../commandRunner.js";
import { resolveCommand } from "../../core/resolveCommand.js";
import { skippedCheck } from "../cliAdversarial/runAdversarialCheck.js";
import type { SecurityCheckResult } from "../types.js";

// This local check only verifies CodeQL CLI availability and integration.
// Full CodeQL analysis is owned by .github/workflows/codeql.yml.
// Release readiness requires successful GitHub analysis for the exact candidate SHA.

export async function runCodeqlCheck(options: {
  cwd: string;
  targetRoot?: string;
  timeoutMs: number;
}): Promise<SecurityCheckResult> {
  const { cwd, timeoutMs } = options;

  const resolved = resolveCommand("codeql", { cwd, env: process.env });
  if (resolved.resolutionKind === "unavailable") {
    return skippedCheck({
      id: "codeql-scan",
      name: "CodeQL CLI availability preflight",
      category: "static-scan",
      reason:
        "Local CodeQL CLI is unavailable, so the local availability preflight is skipped. Full release-readiness coverage requires a successful GitHub CodeQL advanced-setup analysis for the exact candidate SHA.",
    });
  }

  const startedAt = new Date().toISOString();

  // Confirm the CLI is functional with a version check.
  // Full database creation and analysis is delegated to GitHub Actions because
  // it requires a build step and significant disk/CPU resources.
  const versionCmd = await runSecurityCommand({
    command: "codeql",
    args: ["version", "--format", "terse"],
    cwd,
    timeoutMs: Math.min(timeoutMs, 15_000),
  });

  const finishedAt = new Date().toISOString();

  if (versionCmd.exitCode !== 0 || versionCmd.exitCode === null) {
    return {
      id: "codeql-scan",
      name: "CodeQL CLI availability preflight",
      category: "static-scan",
      status: "failed",
      severity: "major",
      startedAt,
      finishedAt,
      durationMs: versionCmd.durationMs,
      findings: [
        {
          id: "codeql-cli-error",
          title: "CodeQL CLI returned an error",
          severity: "major",
          category: "static-scan",
          description: `CodeQL CLI exited with code ${String(versionCmd.exitCode)}. stderr: ${versionCmd.stderr.slice(0, 500)}`,
          recommendation: "Verify CodeQL CLI installation.",
          releaseImpact: "Review before release",
        },
      ],
      command: "codeql version --format terse",
    };
  }

  // The CLI is present and functional; this is not repository-wide analysis.
  return {
    id: "codeql-scan",
    name: "CodeQL CLI availability preflight",
    category: "static-scan",
    status: "passed",
    severity: "informational",
    startedAt,
    finishedAt,
    durationMs: versionCmd.durationMs,
    findings: [],
    command: "codeql version --format terse",
  };
}
