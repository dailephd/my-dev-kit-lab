import { runSecurityCommand, resolveNpmCommand } from "../commandRunner.js";
import type { CommandExecutionResult, SecurityCheckResult } from "../types.js";
import type { SecurityValidationTarget } from "./resolveTarget.js";

export async function runCliSecuritySuiteCheck(options: {
  toolRoot: string;
  target: SecurityValidationTarget;
  timeoutMs: number;
}): Promise<SecurityCheckResult> {
  const startedAt = new Date().toISOString();

  if (!options.target.isSelf && !options.target.hasPackageJson) {
    const finishedAt = new Date().toISOString();
    return {
      id: "cli-adversarial-suite",
      name: "Target security test suite",
      category: "cli-adversarial",
      status: "failed",
      severity: "major",
      startedAt,
      finishedAt,
      durationMs: 0,
      command: "npm run test:security",
      commandCwd: options.target.targetRoot,
      exitCode: null,
      findings: [
        {
          id: "target-security-suite-missing-package-json",
          title: "Target package.json is missing",
          severity: "major",
          category: "cli-adversarial",
          description: "Target-aware security suite validation requires a package.json at the target root.",
          recommendation: "Add a package.json with a test:security script or validate a package-based target.",
          releaseImpact: "Should fix before release",
        },
      ],
    };
  }

  if (!options.target.isSelf && !options.target.hasSecurityTestScript) {
    const finishedAt = new Date().toISOString();
    return {
      id: "cli-adversarial-suite",
      name: "Target security test suite",
      category: "cli-adversarial",
      status: "failed",
      severity: "major",
      startedAt,
      finishedAt,
      durationMs: 0,
      command: "npm run test:security",
      commandCwd: options.target.targetRoot,
      exitCode: null,
      findings: [
        {
          id: "target-security-suite-missing-script",
          title: "Target test:security script is missing",
          severity: "major",
          category: "cli-adversarial",
          description: "The target package.json does not define scripts.test:security, so the target security suite could not be validated.",
          recommendation: "Add a target test:security script and rerun security:validate.",
          releaseImpact: "Should fix before release",
        },
      ],
    };
  }

  const npm = resolveNpmCommand();
  const isSelf = options.target.isSelf;
  const commandCwd = isSelf ? options.toolRoot : options.target.targetRoot;
  const cmd = await runSecurityCommand({
    command: npm,
    args: ["run", "test:security"],
    cwd: commandCwd,
    timeoutMs: Math.min(options.timeoutMs * 3, 180_000),
  });
  const finishedAt = new Date().toISOString();
  const passed = cmd.exitCode === 0 && !cmd.timedOut && !cmd.spawnError && cmd.treeTerminated !== false;
  const name = isSelf
    ? "CLI adversarial test suite (tool self-tests)"
    : "Target security test suite";
  const outcome = cmd.timedOut
    ? `exceeded its ${cmd.timeoutMs ?? "configured"} ms deadline (exit code ${String(cmd.exitCode)}).`
    : cmd.spawnError
      ? "could not be started; see process error evidence."
      : cmd.treeTerminated === false
        ? "did not confirm process-tree cleanup."
        : `exited with code ${String(cmd.exitCode)}.`;

  return {
    id: "cli-adversarial-suite",
    name,
    category: "cli-adversarial",
    status: passed ? "passed" : "failed",
    severity: "major",
    startedAt,
    finishedAt,
    durationMs: cmd.durationMs,
    findings: passed
      ? []
      : [
          {
            id: "cli-adversarial-suite-failed",
            title: isSelf ? "CLI adversarial test suite had failures" : "Target test:security script failed",
            severity: "major",
            category: "cli-adversarial",
            description: isSelf
              ? `Tool-root test:security ${outcome}`
              : `Target-root test:security ${outcome}`,
            evidence: buildEvidence(cmd),
            recommendation: isSelf
              ? "Fix failing tool security tests before release."
              : "Fix the target test:security failure and rerun security:validate.",
            releaseImpact: "Should fix before release",
          },
        ],
    command: `${npm} run test:security`,
    commandCwd,
    exitCode: cmd.exitCode,
    stdoutSummary: summarizeOutput(cmd.stdout),
    stderrSummary: summarizeOutput(cmd.stderr),
  };
}

function summarizeOutput(value: string): string | undefined {
  const normalized = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, 500);
}

function buildEvidence(cmd: CommandExecutionResult): string {
  const parts = [
    `cwd=${cmd.cwd}`, `exitCode=${String(cmd.exitCode)}`,
    `timedOut=${cmd.timedOut}`, `signal=${cmd.signal === undefined ? "unknown" : String(cmd.signal)}`,
    `timeoutMs=${cmd.timeoutMs ?? "unknown"}`, `durationMs=${cmd.durationMs}`,
    `resolutionKind=${cmd.resolutionKind ?? "unknown"}`, `treeTerminated=${cmd.treeTerminated ?? "not-requested"}`,
  ];
  if (cmd.spawnError) parts.push(`spawnError=${summarizeOutput(cmd.spawnError)}`);
  const stdoutSummary = summarizeOutput(cmd.stdout);
  const stderrSummary = summarizeOutput(cmd.stderr);
  if (stdoutSummary) {
    parts.push(`stdout=${stdoutSummary}`);
  }
  if (stderrSummary) {
    parts.push(`stderr=${stderrSummary}`);
  }
  return parts.join(" | ");
}
