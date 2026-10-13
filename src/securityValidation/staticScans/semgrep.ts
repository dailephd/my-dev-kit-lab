import path from "node:path";
import fs from "node:fs";
import { runSecurityCommand } from "../commandRunner.js";
import { resolveCommand } from "../../core/resolveCommand.js";
import { skippedCheck } from "../cliAdversarial/runAdversarialCheck.js";
import type { CommandExecutionResult, SecurityCheckResult, SecurityFinding } from "../types.js";

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
  analysisError?: string;
  rawOutput: string;
};

export function parseSemgrepJson(raw: string): ParsedSemgrepOutput {
  if (!raw.trim()) {
    return { findings: [], parseError: "Semgrep produced no JSON scan evidence", rawOutput: raw };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
      return { findings: [], parseError: "Semgrep JSON requires a results array", rawOutput: raw };
    }
    const findings: SemgrepFinding[] = [];
    let parseError = !Array.isArray(parsed.errors) || !isRecord(parsed.paths) ||
      !Array.isArray(parsed.paths.scanned) || parsed.paths.scanned.some((file) => typeof file !== "string")
      ? "Semgrep JSON requires errors and paths.scanned arrays" : undefined;
    for (const [index, r] of parsed.results.entries()) {
      if (!isRecord(r) || typeof r.check_id !== "string" || !r.check_id ||
          typeof r.path !== "string" || !r.path || !isRecord(r.start) ||
          !Number.isInteger(r.start.line) || Number(r.start.line) < 1 || !isRecord(r.extra) ||
          (r.extra.message !== undefined && typeof r.extra.message !== "string") ||
          (r.extra.metadata !== undefined && !isRecord(r.extra.metadata))) {
        parseError ??= `Malformed Semgrep result at index ${index}`;
        continue;
      }
      const item = r as Record<string, unknown>;
      const checkId = typeof item["check_id"] === "string" ? item["check_id"] : "unknown";
      const extra = (item["extra"] as Record<string, unknown> | undefined) ?? {};
      const metadata = (extra["metadata"] as Record<string, unknown> | undefined) ?? {};
      if ((extra.severity !== undefined && (typeof extra.severity !== "string" || !extra.severity.trim())) ||
          (extra.severity === undefined && (typeof metadata.severity !== "string" || !metadata.severity.trim()))) {
        parseError ??= `Missing or malformed Semgrep severity at index ${index}`;
        continue;
      }
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
      findings.push({ ruleId: checkId, severity, message, path: filePath, line });
    }
    // Semgrep's CLI contract reports partial/fatal analysis in errors even
    // when the process exits zero. Retain matches, but never call this clean.
    const analysisError = Array.isArray(parsed.errors) && parsed.errors.length > 0
      ? `Semgrep reported ${parsed.errors.length} analysis error(s): ${JSON.stringify(parsed.errors).slice(0, 500)}`
      : undefined;
    return { findings, parseError, analysisError, rawOutput: raw };
  } catch (err) {
    return {
      findings: [],
      parseError: err instanceof Error ? err.message : String(err),
      rawOutput: raw,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

  let cmd: CommandExecutionResult;
  try {
    cmd = await runSecurityCommand({ command, args: scanArgs, cwd: targetRoot, timeoutMs });
  } catch (error) {
    cmd = { command, args: scanArgs, cwd: targetRoot, exitCode: null, durationMs: 0,
      stdout: "", stderr: error instanceof Error ? error.message : String(error), timedOut: false, skipped: false };
  }

  const finishedAt = new Date().toISOString();

  // Distinguish positively established absence from a failed attempted scan.
  // Network, permission, generic npm, or native spawn errors are not absence.
  const unavailable = !cmd.timedOut && cmd.exitCode !== 0 && !cmd.stdout.trim() && (
    (cmd.skipped && cmd.exitCode === null && Boolean(cmd.skippedReason?.match(/\b(semgrep|scanner|cli)\b.*(unavailable|not installed|not found|not on PATH)/i))) ||
    (useNpx && !cmd.skipped && cmd.exitCode === 1 && /could not determine executable to run/i.test(cmd.stderr))
  );
  if (unavailable) {
    return { ...skippedCheck({ id: "semgrep-scan", name: "Semgrep static analysis", category: "static-scan",
      reason: cmd.skippedReason ?? "Semgrep CLI is unavailable; the npx fallback package provides no executable." }),
      command: [command, ...scanArgs].join(" "), commandCwd: targetRoot, exitCode: cmd.exitCode };
  }

  const parsed = parseSemgrepJson(cmd.stdout);

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

  const executionFailed = cmd.timedOut || cmd.skipped || (cmd.exitCode !== 0 && cmd.exitCode !== 1) ||
    (cmd.exitCode === 1 && parsed.findings.length === 0);
  const evidenceError = executionFailed
    ? `Semgrep execution failed: exitCode=${String(cmd.exitCode)}, timedOut=${cmd.timedOut}, skipped=${cmd.skipped}. ${cmd.stderr.slice(0, 500)}`
    : parsed.parseError ?? parsed.analysisError;
  if (evidenceError) {
    securityFindings.push({
      id: executionFailed ? "semgrep-execution-error" : parsed.parseError ? "semgrep-parse-error" : "semgrep-analysis-error",
      title: "Semgrep scan evidence is incomplete or unsuccessful",
      severity: "major",
      category: "static-scan",
      description: evidenceError,
      evidence: `exitCode=${String(cmd.exitCode)}; ${parsed.parseError ?? parsed.analysisError ?? ""}`,
      recommendation: "Resolve the scanner execution or analysis error and rerun with valid JSON scan evidence.",
      releaseImpact: "Review before release",
    });
  }

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
    commandCwd: targetRoot,
    exitCode: cmd.exitCode,
  };
}
