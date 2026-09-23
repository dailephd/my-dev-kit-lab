import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseCommandString, serializeCommand } from "./commandLine.js";
import { forceTerminateProcess } from "./processTree.js";
import {
  buildResolvedCommandInvocation,
  resolveCommandInvocation,
  type ResolvedCommand
} from "./resolveCommand.js";

export { parseCommandString } from "./commandLine.js";

export type MeasuredCommandResult = {
  commandId: string;
  commandString: string;
  executable: string;
  args: string[];
  cwd: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutPath: string;
  stderrPath: string;
  telemetryPath: string;
  ok: boolean;
  error?: string;
  resolvedCommand?: ResolvedCommand;
};

type MeasuredCommandBaseOptions = {
  commandId: string;
  cwd: string;
  outDir: string;
  extraArgs?: string[];
  env?: NodeJS.ProcessEnv;
  resolveCommand?: boolean;
  allowPowerShellShim?: boolean;
  timeoutMs?: number;
  /**
   * Optional prompt/text payload delivered over the child process's stdin instead of argv. Never
   * recorded in the returned result, telemetry, commandString, or args -- the caller owns any
   * separate prompt artifact.
   */
  stdinText?: string;
};

/**
 * Two mutually exclusive ways to name the command.
 *
 * `commandString` is the original form: a single line that is split with the
 * repository's quoting rules. `executable` + `args` is the structured form added
 * in v0.4.7: it skips command-string parsing entirely, which matters for callers
 * whose executable is an absolute path. `quoteCommandPart()` escapes backslashes
 * and `parseCommandString()` does not unescape them, so a Windows path round
 * -tripped through a command string comes back with doubled separators. A caller
 * that already holds a discrete executable and argument array should never have
 * to serialize it just to have it re-parsed.
 */
export type RunMeasuredCommandOptions =
  | (MeasuredCommandBaseOptions & { commandString: string; executable?: never; args?: never })
  | (MeasuredCommandBaseOptions & { executable: string; args?: readonly string[]; commandString?: never });

export async function runMeasuredCommand(options: RunMeasuredCommandOptions): Promise<MeasuredCommandResult> {
  await mkdir(options.outDir, { recursive: true });
  const named = readCommandName(options);
  const commandString = named.commandString;
  const trailingArgs = [...named.args, ...(options.extraArgs ?? [])];
  // Windows .cmd/.bat/.ps1 argument assembly is owned by resolveCommand.ts so
  // that every spawn site (measured commands and managed long-running processes)
  // shares exactly one shim rule.
  const invocation =
    options.resolveCommand === false
      ? buildResolvedCommandInvocation(
          {
            originalCommand: named.executable,
            command: named.executable,
            argsPrefix: [],
            resolutionKind: "direct" as const,
            resolvedPath: named.executable,
            warnings: []
          },
          trailingArgs
        )
      : resolveCommandInvocation(named.executable, trailingArgs, {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          allowPowerShellShim: options.allowPowerShellShim
        });
  const resolution = invocation.resolvedCommand;
  const executable = invocation.executable;
  const args = invocation.args;
  const stdoutPath = path.join(options.outDir, `${options.commandId}.stdout.txt`);
  const stderrPath = path.join(options.outDir, `${options.commandId}.stderr.txt`);
  const telemetryPath = path.join(options.outDir, `${options.commandId}.telemetry.json`);
  const startedAt = new Date().toISOString();
  const started = Date.now();

  const result = await new Promise<MeasuredCommandResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let spawnError: string | undefined;
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;

    let child;
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        shell: false,
        stdio: options.stdinText !== undefined ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      const measured: MeasuredCommandResult = {
        commandId: options.commandId,
        commandString,
        executable,
        args,
        cwd: options.cwd,
        startedAt,
        endedAt,
        durationMs,
        exitCode: null,
        stdout,
        stderr,
        stdoutPath,
        stderrPath,
        telemetryPath,
        ok: false,
        error: message,
        resolvedCommand: resolution
      };
      void Promise.all([
        writeArtifact(stdoutPath, stdout),
        writeArtifact(stderrPath, stderr),
        writeArtifact(telemetryPath, JSON.stringify(measured, null, 2))
      ]).then(() => resolve(measured));
      return;
    }

    // stdout/stderr are always piped in both stdio branches above.
    child.stdout!.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr!.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      spawnError = error.message;
    });
    if (options.stdinText !== undefined) {
      // A child that exits or closes stdin before we write must not crash the process (EPIPE).
      child.stdin?.on("error", (error) => {
        spawnError = spawnError ?? `Failed to write to command stdin: ${error.message}`;
      });
      child.stdin?.write(options.stdinText, "utf8");
      child.stdin?.end();
    }
    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        timedOut = true;
        spawnError = `Command timed out after ${options.timeoutMs}ms.`;
        forceTerminateProcess(child.pid);
      }, options.timeoutMs);
    }
    child.on("close", async (exitCode) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - started;
      await writeArtifact(stdoutPath, stdout);
      await writeArtifact(stderrPath, stderr);
      const measured: MeasuredCommandResult = {
        commandId: options.commandId,
        commandString,
        executable,
        args,
        cwd: options.cwd,
        startedAt,
        endedAt,
        durationMs,
        exitCode,
        stdout,
        stderr,
        stdoutPath,
        stderrPath,
        telemetryPath,
        ok: exitCode === 0 && !spawnError && !timedOut,
        error: spawnError,
        resolvedCommand: resolution
      };
      await writeArtifact(telemetryPath, JSON.stringify(measured, null, 2));
      resolve(measured);
    });
  });

  return result;
}

async function writeArtifact(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

/**
 * Normalizes either input form into an executable, its arguments, and a
 * human-readable command line for the telemetry record. The serialized string is
 * for display only -- it is never parsed back into arguments.
 */
function readCommandName(options: RunMeasuredCommandOptions): {
  executable: string;
  args: string[];
  commandString: string;
} {
  if (options.commandString !== undefined) {
    const parsed = parseCommandString(options.commandString);
    return { executable: parsed.executable, args: parsed.args, commandString: options.commandString };
  }
  if (options.executable !== undefined) {
    const args = [...(options.args ?? [])];
    return {
      executable: options.executable,
      args,
      commandString: serializeCommand([options.executable, ...args])
    };
  }
  throw new Error("runMeasuredCommand requires either a commandString or an executable.");
}
