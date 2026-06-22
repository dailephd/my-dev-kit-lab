import { spawn } from "node:child_process";
import type { CommandExecutionResult } from "./types.js";

// On Windows, npm is a .cmd script and cannot be spawned directly with shell: false.
// Resolve npm to npm.cmd on Windows so spawn works without shell: true.
export function resolveNpmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

// Runs a security check command with an argument array (no shell interpolation).
// npm audit returns exit code 1 on vulnerabilities; that is not treated as a
// spawn failure here — the caller inspects the output and exit code separately.
export async function runSecurityCommand(options: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}): Promise<CommandExecutionResult> {
  const started = Date.now();

  return new Promise<CommandExecutionResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;

    let child;
    try {
      child = spawn(options.command, options.args, {
        cwd: options.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (spawnErr) {
      resolve({
        command: options.command,
        args: options.args,
        cwd: options.cwd,
        exitCode: null,
        durationMs: Date.now() - started,
        stdout: "",
        stderr: spawnErr instanceof Error ? spawnErr.message : String(spawnErr),
        timedOut: false,
        skipped: false,
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
          // Process may have already exited.
        }
      }, options.timeoutMs);
    }

    child.on("close", (exitCode) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        command: options.command,
        args: options.args,
        cwd: options.cwd,
        exitCode,
        durationMs: Date.now() - started,
        stdout,
        stderr,
        timedOut,
        skipped: false,
      });
    });
  });
}

// Returns a skipped result when a tool is not available.
export function skippedResult(options: {
  command: string;
  args: string[];
  cwd: string;
  reason: string;
}): CommandExecutionResult {
  return {
    command: options.command,
    args: options.args,
    cwd: options.cwd,
    exitCode: null,
    durationMs: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    skipped: true,
    skippedReason: options.reason,
  };
}
