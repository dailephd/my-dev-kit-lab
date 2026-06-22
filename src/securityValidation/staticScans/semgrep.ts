import path from "node:path";
import fs from "node:fs";
import { runSecurityCommand } from "../commandRunner.js";
import { resolveCommand } from "../../core/resolveCommand.js";
import { skippedCheck } from "../cliAdversarial/runAdversarialCheck.js";
import type { SecurityCheckResult, SecurityFinding } from "../types.js";

// Semgrep scan focused on subprocess safety, path traversal, fs safety,
// and secret leakage in the my-dev-kit source tree.
// If neither a local binary nor npx semgrep is available the check is skipped.

export type SemgrepFinding = {
  ruleId: string;
  severity: string;
  message: string;
  path: string;
  line: number;
};

export type ParsedSemgrepOutput = {
  findings: SemgrepFinding[];
  parseError?: string;
  rawOutput: string;
};

export function parseSemgrepJson(raw: string): ParsedSemgrepOutput {
  if (!raw.trim()) {
    return { findings: [], rawOutput: raw };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const results = Array.isArray(parsed["results"]) ? (parsed["results"] as unknown[]) : [];
    const findings: SemgrepFinding[] = results.map((r) => {
      const item = r as Record<string, unknown>;
      const checkId = typeof item["check_id"] === "string" ? item["check_id"] : "unknown";
      const extra = (item["extra"] as Record<string, unknown> | undefined) ?? {};
      const metadata = (extra["metadata"] as Record<string, unknown> | undefined) ?? {};
      const severity =
        typeof extra["severity"] === "string"
          ? extra["severity"]
          : typeof metadata["severity"] === "string"
            ? (metadata["severity"] as string)
            : "WARNING";
      const message = typeof extra["message"] === "string" ? extra["message"] : checkId;
      const filePath = typeof item["path"] === "string" ? item["path"] : "";
      const startObj = (item["start"] as Record<string, unknown> | undefined) ?? {};
      const line = typeof startObj["line"] === "number" ? startObj["line"] : 0;
      return { ruleId: checkId, severity, message, path: filePath, line };
    });
    return { findings, rawOutput: raw };
  } catch (err) {
    return {
      findings: [],
      parseError: err instanceof Error ? err.message : String(err),
      rawOutput: raw,
    };
  }
}

function semgrepSeverityToSecurity(semgrepSeverity: string): SecurityFinding["severity"] {
  switch (semgrepSeverity.toUpperCase()) {
    case "ERROR":
      return "major";
    case "WARNING":
      return "minor";
    default:
      return "informational";
  }
}

export async function runSemgrepCheck(options: {
  // Root of the project being scanned (may differ from toolRoot for external targets)
  targetRoot: string;
  // Tool root — where .semgrep.yml lives; defaults to targetRoot if not provided
  toolRoot?: string;
  configPath?: string;
  timeoutMs: number;
}): Promise<SecurityCheckResult> {
  const { targetRoot, timeoutMs } = options;
  const toolRoot = options.toolRoot ?? targetRoot;
  const configPath = options.configPath ?? path.join(toolRoot, ".semgrep.yml");

  // Prefer a locally installed semgrep binary; fall back to npx.
  const localResolved = resolveCommand("semgrep", { cwd: toolRoot, env: process.env });
  const useNpx = localResolved.resolutionKind === "unavailable";

  // Check if npx is available as fallback.
  if (useNpx) {
    const npxResolved = resolveCommand("npx", { cwd: toolRoot, env: process.env });
    if (npxResolved.resolutionKind === "unavailable") {
      return skippedCheck({
        id: "semgrep-scan",
        name: "Semgrep static analysis",
        category: "static-scan",
        reason:
          "Semgrep CLI not found in PATH and npx is unavailable. Install semgrep (pip install semgrep) or ensure npx is on PATH.",
      });
    }
  }

  const startedAt = new Date().toISOString();

  // Determine what directory to scan.
  // For self-validation, scan src/ (matches original behavior).
  // For external targets, scan src/ if it exists, otherwise the target root itself.
  const isSelf = path.resolve(targetRoot) === path.resolve(toolRoot);
  const srcDir = path.join(targetRoot, "src");
  let scanTarget: string;
  if (isSelf) {
    scanTarget = "src/";
  } else {
    scanTarget = fs.existsSync(srcDir) ? srcDir : targetRoot;
  }

  const command = useNpx ? "npx" : "semgrep";
  const baseArgs = useNpx ? ["--yes", "semgrep"] : [];
  const scanArgs = [
    ...baseArgs,
    "scan",
    "--config", configPath,
    "--json",
    "--quiet",
    scanTarget,
  ];

  const cmd = await runSecurityCommand({
    command,
    args: scanArgs,
    cwd: targetRoot,
    timeoutMs,
  });

  const finishedAt = new Date().toISOString();

  // Semgrep exits 0 = no findings, 1 = findings found, other = error.
  const isError = cmd.exitCode !== 0 && cmd.exitCode !== 1;
  const isTimedOut = cmd.timedOut;

  if (isTimedOut || (isError && !cmd.stdout.trim())) {
    return {
      id: "semgrep-scan",
      name: "Semgrep static analysis",
      category: "static-scan",
      status: "failed",
      severity: "major",
      startedAt,
      finishedAt,
      durationMs: cmd.durationMs,
      findings: [
        {
          id: "semgrep-execution-error",
          title: "Semgrep execution failed",
          severity: "major",
          category: "static-scan",
          description: isTimedOut
            ? "Semgrep timed out."
            : `Semgrep exited with code ${String(cmd.exitCode)}. stderr: ${cmd.stderr.slice(0, 500)}`,
          recommendation: "Check semgrep installation and .semgrep.yml config.",
          releaseImpact: "Review before release",
        },
      ],
      command: [command, ...scanArgs].join(" "),
    };
  }

  const parsed = parseSemgrepJson(cmd.stdout);

  if (parsed.parseError) {
    return {
      id: "semgrep-scan",
      name: "Semgrep static analysis",
      category: "static-scan",
      status: "warning",
      severity: "minor",
      startedAt,
      finishedAt,
      durationMs: cmd.durationMs,
      findings: [
        {
          id: "semgrep-parse-error",
          title: "Could not parse Semgrep output",
          severity: "minor",
          category: "static-scan",
          description: `JSON parse error: ${parsed.parseError}`,
          recommendation: "Verify semgrep version produces valid JSON output.",
          releaseImpact: "Review before release",
        },
      ],
      command: [command, ...scanArgs].join(" "),
    };
  }

  const securityFindings: SecurityFinding[] = parsed.findings.map((f) => ({
    id: `semgrep-${f.ruleId.replace(/[^a-z0-9-]/gi, "-")}`,
    title: f.ruleId,
    severity: semgrepSeverityToSecurity(f.severity),
    category: "static-scan" as const,
    description: f.message,
    affectedFiles: [`${f.path}:${f.line}`],
    releaseImpact:
      semgrepSeverityToSecurity(f.severity) === "major"
        ? "Should fix before release"
        : "Review before release",
  }));

  const hasBlockerOrMajor = securityFindings.some(
    (f) => f.severity === "blocker" || f.severity === "major"
  );

  return {
    id: "semgrep-scan",
    name: "Semgrep static analysis",
    category: "static-scan",
    status:
      securityFindings.length === 0 ? "passed" : hasBlockerOrMajor ? "failed" : "warning",
    severity:
      securityFindings.length === 0
        ? "informational"
        : hasBlockerOrMajor
          ? "major"
          : "minor",
    startedAt,
    finishedAt,
    durationMs: cmd.durationMs,
    findings: securityFindings,
    command: [command, ...scanArgs].join(" "),
  };
}
