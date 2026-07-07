import { spawnSync } from "node:child_process";
import { runSecurityCommand, skippedResult } from "../commandRunner.js";
import type { CommandExecutionResult } from "../types.js";

// Detect whether osv-scanner is accessible by probing for its version flag.
function isOsvScannerAvailable(): boolean {
  try {
    const result = spawnSync("osv-scanner", ["--version"], { shell: false, encoding: "utf8" });
    return result.error === undefined && result.status !== null;
  } catch {
    return false;
  }
}

// Run OSV-Scanner on the lockfile if the tool is available.
// When not available and requireOsvScanner is false, returns a skipped result.
export async function runOsvScanner(options: {
  cwd: string;
  timeoutMs: number;
  requireOsvScanner: boolean;
}): Promise<CommandExecutionResult> {
  if (!isOsvScannerAvailable()) {
    if (options.requireOsvScanner) {
      return {
        command: "osv-scanner",
        args: ["--lockfile", "package-lock.json", "--format", "json"],
        cwd: options.cwd,
        exitCode: null,
        durationMs: 0,
        stdout: "",
        stderr: "osv-scanner not found on PATH",
        timedOut: false,
        skipped: false,
      };
    }
    return skippedResult({
      command: "osv-scanner",
      args: ["--lockfile", "package-lock.json", "--format", "json"],
      cwd: options.cwd,
      reason: "osv-scanner is not installed or not on PATH; check skipped",
    });
  }

  return runSecurityCommand({
    command: "osv-scanner",
    args: ["--lockfile", "package-lock.json", "--format", "json"],
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
  });
}
