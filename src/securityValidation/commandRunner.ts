import { spawn, type SpawnOptionsWithStdioTuple, type StdioNull, type StdioPipe } from "node:child_process";
import { resolveCommand } from "../core/resolveCommand.js";
import { terminateProcessTree } from "../core/processTree.js";
import type { CommandExecutionResult } from "./types.js";

// Prefer the unqualified npm command and let the shared resolver locate
// npm.cmd/.ps1 shims or direct executables per platform.
export function resolveNpmCommand(): string {
  return "npm";
}

// The single place the spawn options for security commands are constructed.
// runSecurityCommand() spawns with exactly this result, so the subprocess
// injection scenario can verify `shell: false` at runtime from the compiled
// module instead of reading unshipped TypeScript source.
export function buildSecurityCommandSpawnOptions(options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
}): SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe> {
  return {
    cwd: options.cwd,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: options.env,
  };
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
      resolutionKind: resolved.resolutionKind,
      timeoutMs: options.timeoutMs,
      skipped: false,
    };
  }

  return new Promise<CommandExecutionResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let closeGrace: NodeJS.Timeout | undefined;
    let termination: Promise<boolean> | undefined;
    let treeTerminated: boolean | undefined;
    let signal: NodeJS.Signals | null | undefined;
    let exitCode: number | null = null;
    let spawnError: string | undefined;

    let child;
    try {
      child = spawn(command, args, buildSecurityCommandSpawnOptions({ cwd: options.cwd, env }));
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
        spawnError: spawnErr instanceof Error ? spawnErr.message : String(spawnErr),
        resolutionKind: resolved.resolutionKind,
        timeoutMs: options.timeoutMs,
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

    const finish = async () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (termination) await termination;
      if (closeGrace) clearTimeout(closeGrace);
      resolve({
        command,
        args,
        cwd: options.cwd,
        exitCode,
        durationMs: Date.now() - started,
        stdout,
        stderr,
        timedOut,
        signal,
        spawnError,
        resolutionKind: resolved.resolutionKind,
        timeoutMs: options.timeoutMs,
        treeTerminated,
        skipped: false,
      });
    };

    child.on("error", (error) => {
      spawnError = error.message;
      stderr += `${stderr ? "\n" : ""}${error.message}`;
      void finish();
    });

    if (options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        // Keep the parent alive until its entire owned tree is addressed.
        // Killing only npm's cmd parent can strand its children and their pipes.
        termination = terminateProcessTree(child.pid, { waitTimeoutMs: 5000 }).then((terminated) => {
          treeTerminated = terminated;
          return terminated;
        });
        void termination.then(() => {
          if (settled) return;
          // A failed tree operation or a pipe that never closes must not make
          // the command wait indefinitely beyond its deadline and kill grace.
          closeGrace = setTimeout(() => {
            child.stdout.destroy();
            child.stderr.destroy();
            void finish();
          }, 1000);
        });
      }, options.timeoutMs);
    }

    child.on("close", (code, exitSignal) => {
      exitCode = code;
      signal = exitSignal;
      void finish();
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
