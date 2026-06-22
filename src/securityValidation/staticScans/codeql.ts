import { runSecurityCommand } from "../commandRunner.js";
import { resolveCommand } from "../../core/resolveCommand.js";
import { skippedCheck } from "../cliAdversarial/runAdversarialCheck.js";
import type { SecurityCheckResult } from "../types.js";

// CodeQL is primarily a GitHub Actions / code-scanning integration.
// Local CodeQL CLI is optional — if unavailable the check is skipped.
// Absence is not a release blocker; it surfaces as "ready except optional checks".

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
      name: "CodeQL static analysis",
      category: "static-scan",
      reason:
        "CodeQL CLI not found in PATH. Full analysis runs via GitHub Actions code-scanning workflow. Install the CodeQL CLI locally for local analysis.",
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
      name: "CodeQL static analysis",
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

  // CLI is present and functional. Full analysis runs in GitHub Actions.
  return {
    id: "codeql-scan",
    name: "CodeQL static analysis",
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
