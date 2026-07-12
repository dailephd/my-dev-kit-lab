import { spawn } from "node:child_process";
import { resolveCommand } from "../core/resolveCommand.js";
import type { CommandExecutionResult } from "./types.js";

// Prefer the unqualified npm command and let the shared resolver locate
// npm.cmd/.ps1 shims or direct executables per platform.
export function resolveNpmCommand(): string {
  return "npm";
}

// Runs a security check command with an argument array (no shell interpolation).
// npm audit returns exit code 1 on vulnerabilities; that is not treated as a
// spawn failure here — the caller inspects the output and exit code separately.
//
// `env` is optional and additive (v0.4.1 Batch 7): omitted, it defaults to
// `process.env` exactly as before this option existed, so every pre-existing
// caller is unaffected. A caller that supplies a minimized environment (e.g.
// the Batch 7 external-tool adapters, which must not propagate arbitrary
// caller credentials to a spawned child process) gets that environment used
// for both PATH resolution and the actual spawn.
export async function runSecurityCommand(options: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}): Promise<CommandExecutionResult> {
  const started = Date.now();
  const env = options.env ?? process.env;
  const resolved = resolveCommand(options.command, {
    cwd: options.cwd,
    env,
    allowPowerShellShim: false,
  });
  const command = resolved.command;
  const needsResolvedPathArg =
    resolved.resolutionKind === "windows-cmd-shim" ||
    resolved.resolutionKind === "windows-powershell-shim";
  const args = [
    ...resolved.argsPrefix,
    ...(needsResolvedPathArg && resolved.resolvedPath ? [resolved.resolvedPath] : []),
    ...options.args,
  ];

  if (resolved.resolutionKind === "unavailable") {
    return {
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      exitCode: null,
      durationMs: Date.now() - started,
      stdout: "",
      stderr: resolved.warnings.join("\n"),
      timedOut: false,
      skipped: false,
    };
  }

  return new Promise<CommandExecutionResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });
    } catch (spawnErr) {
      resolve({
        command,
        args,
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

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        command,
        args,
        cwd: options.cwd,
        exitCode: null,
        durationMs: Date.now() - started,
        stdout,
        stderr: error.message,
        timedOut,
        skipped: false,
      });
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
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        command,
        args,
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
