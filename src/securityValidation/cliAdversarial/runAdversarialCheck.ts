import { spawn } from "node:child_process";
import path from "node:path";
import type { SecurityCheckCategory, SecurityCheckResult, SecurityFinding, SecuritySeverity } from "../types.js";

// ---------------------------------------------------------------------------
// Core adversarial check runner
// ---------------------------------------------------------------------------

export type AdversarialCommandResult = {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  spawnError?: string;
};

export type AdversarialCheckInput = {
  id: string;
  name: string;
  category: SecurityCheckCategory;
  severity: SecuritySeverity;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  /**
   * Called after the command completes. Returns findings (if any).
   * An empty array means the check passed.
   */
  evaluate: (result: AdversarialCommandResult) => SecurityFinding[];
};

export async function runAdversarialCheck(
  input: AdversarialCheckInput
): Promise<SecurityCheckResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();

  const cmdResult = await spawnAdversarialCommand({
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
  });

  const findings = input.evaluate(cmdResult);
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - started;

  const status = findings.length > 0
    ? (findings.some((f) => f.severity === "blocker" || f.severity === "major") ? "failed" : "warning")
    : "passed";

  return {
    id: input.id,
    name: input.name,
    category: input.category,
    status,
    severity: findings.length > 0 ? findings[0].severity : "informational",
    startedAt,
    finishedAt,
    durationMs,
    findings,
    command: [input.command, ...input.args].join(" "),
  };
}

export function skippedCheck(options: {
  id: string;
  name: string;
  category: SecurityCheckCategory;
  reason: string;
}): SecurityCheckResult {
  const now = new Date().toISOString();
  return {
    id: options.id,
    name: options.name,
    category: options.category,
    status: "skipped",
    severity: "skipped",
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    findings: [],
    skippedReason: options.reason,
  };
}

// ---------------------------------------------------------------------------
// Finding helpers
// ---------------------------------------------------------------------------

export function makeFinding(options: {
  id: string;
  title: string;
  severity: SecuritySeverity;
  category: SecurityCheckCategory;
  description: string;
  evidence?: string;
  affectedFiles?: string[];
  recommendation?: string;
}): SecurityFinding {
  return {
    id: options.id,
    title: options.title,
    severity: options.severity,
    category: options.category,
    description: options.description,
    evidence: options.evidence,
    affectedFiles: options.affectedFiles,
    recommendation: options.recommendation,
    releaseImpact: options.severity === "blocker" || options.severity === "major"
      ? "Must be resolved before release"
      : "Review before release",
  };
}

// ---------------------------------------------------------------------------
// Internal command runner (no shell interpolation)
// ---------------------------------------------------------------------------

async function spawnAdversarialCommand(options: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}): Promise<AdversarialCommandResult> {
  const started = Date.now();
  return new Promise<AdversarialCommandResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    let child;
    try {
      child = spawn(options.command, options.args, {
        cwd: options.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (err) {
      resolve({
        command: options.command,
        args: options.args,
        cwd: options.cwd,
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: Date.now() - started,
        timedOut: false,
        spawnError: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    if (options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // Already exited.
        }
      }, options.timeoutMs);
    }

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        command: options.command,
        args: options.args,
        cwd: options.cwd,
        exitCode: null,
        stdout,
        stderr: err.message,
        durationMs: Date.now() - started,
        timedOut,
      });
    });

    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        command: options.command,
        args: options.args,
        cwd: options.cwd,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
      });
    });
  });
}
