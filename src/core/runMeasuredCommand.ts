import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseCommandString, serializeCommand } from "./commandLine.js";
import { forceTerminateProcess, terminateProcessTree } from "./processTree.js";
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
  /** Present only when a bounded-execution option was supplied (see MeasuredCommandBaseOptions). */
  timedOut?: boolean;
  /** Present only when a stdout/stderr byte limit was exceeded. */
  outputLimit?: { stream: "stdout" | "stderr"; limitBytes: number };
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
  /**
   * Opt-in bounded execution. Every option below is inert when omitted, so existing callers keep exactly
   * their current behavior (parent environment inherited, unbounded output, single-process termination).
   *
   * Maximum bytes retained per stream. Exceeding a limit keeps the first `limit` bytes, terminates the
   * process tree, and reports `outputLimit` with `ok: false`.
   */
  stdoutMaxBytes?: number;
  stderrMaxBytes?: number;
  /** When false, the child environment is exactly `env` (no merge over `process.env`). Defaults to true. */
  inheritParentEnv?: boolean;
  /**
   * When true, a timeout or output-limit terminates the whole process tree (awaited), and on non-Windows
   * platforms the child leads its own process group so descendants can be reached.
   */
  terminateProcessTree?: boolean;
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
  const bounded =
    options.stdoutMaxBytes !== undefined ||
    options.stderrMaxBytes !== undefined ||
    options.inheritParentEnv === false ||
    options.terminateProcessTree === true;
  const childEnv: NodeJS.ProcessEnv =
    options.inheritParentEnv === false ? { ...options.env } : { ...process.env, ...options.env };
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
          env: childEnv,
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
    const stdoutCollector = new OutputCollector(options.stdoutMaxBytes);
    const stderrCollector = new OutputCollector(options.stderrMaxBytes);
    let outputLimit: MeasuredCommandResult["outputLimit"];
    let spawnError: string | undefined;
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    let killGraceTimeout: NodeJS.Timeout | undefined;
    let settled = false;

    let child;
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: childEnv,
        shell: false,
        stdio: options.stdinText !== undefined ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
        // Own process group so a bounded termination can reach descendants. Windows reaches the tree
        // through `taskkill /T`, and `detached` there would open a new console, so it is not set.
        ...(options.terminateProcessTree === true && process.platform !== "win32" ? { detached: true } : {})
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
        stdout: "",
        stderr: "",
        stdoutPath,
        stderrPath,
        telemetryPath,
        ok: false,
        error: message,
        resolvedCommand: resolution
      };
      void Promise.all([
        writeArtifact(stdoutPath, ""),
        writeArtifact(stderrPath, ""),
        writeArtifact(telemetryPath, JSON.stringify(measured, null, 2))
      ]).then(() => resolve(measured));
      return;
    }

    // stdout/stderr are always piped in both stdio branches above.
    // The process-termination step is shared by the timeout and the opt-in output limit. Bounded callers
    // get an awaited tree termination; everyone else keeps the legacy fire-and-forget single termination.
    const KILL_GRACE_MS = 3000;
    const terminate = () => {
      if (options.terminateProcessTree === true) {
        void terminateProcessTree(child.pid);
      } else {
        forceTerminateProcess(child.pid);
      }
      killGraceTimeout ??= setTimeout(() => {
        void settle(null);
      }, KILL_GRACE_MS);
    };
    const collect = (collector: OutputCollector, stream: "stdout" | "stderr", limit: number | undefined) => (chunk: Buffer | string) => {
      if (collector.push(chunk) && limit !== undefined && outputLimit === undefined) {
        outputLimit = { stream, limitBytes: limit };
        spawnError = `Command ${stream} exceeded ${limit} bytes.`;
        terminate();
      }
    };
    child.stdout!.on("data", collect(stdoutCollector, "stdout", options.stdoutMaxBytes));
    child.stderr!.on("data", collect(stderrCollector, "stderr", options.stderrMaxBytes));
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
    // forceTerminateProcess is fire-and-forget (it never confirms the target process tree actually
    // exited: on Windows it spawns a detached `taskkill /T /F` and does not await or check its
    // result). That is normally sufficient, but a grandchild process spawned through an
    // intermediate shim (for example a Windows .cmd launcher) can occasionally outlive an
    // already-killed intermediate process. Without a bounded fallback, a caller whose kill silently
    // failed would await this promise forever instead of receiving the already-known timeout error.
    // (KILL_GRACE_MS and the shared `terminate` step are declared above, beside the output collectors.)
    const settle = async (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killGraceTimeout) clearTimeout(killGraceTimeout);
      // The caller's `scripts/cli.ts` entry point sets `process.exitCode` rather than calling
      // `process.exit()`, so the process only exits once Node's event loop actually drains. A
      // still-open child stdio pipe -- the same situation the kill-grace fallback above exists for
      // -- would otherwise keep this process alive forever even though this promise has already
      // resolved. Detaching is safe to do unconditionally: once "close" has fired the streams are
      // already ended, so this is a harmless no-op on the normal (non-fallback) path.
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
      child.removeAllListeners();
      child.unref();
      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - started;
      const stdout = stdoutCollector.toString();
      const stderr = stderrCollector.toString();
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
        resolvedCommand: resolution,
        ...(bounded ? { timedOut, ...(outputLimit ? { outputLimit } : {}) } : {})
      };
      await writeArtifact(telemetryPath, JSON.stringify(measured, null, 2));
      resolve(measured);
    };

    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        timedOut = true;
        spawnError = `Command timed out after ${options.timeoutMs}ms.`;
        terminate();
      }, options.timeoutMs);
    }
    child.on("close", (exitCode) => {
      void settle(exitCode);
    });
  });

  return result;
}

/**
 * Accumulates one output stream. Without a limit it reproduces the legacy `text += String(chunk)`
 * behavior exactly. With a limit it keeps raw bytes (so the cut is on a byte boundary), stops at the
 * limit, and reports once when more output than the limit arrived.
 */
class OutputCollector {
  private text = "";
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  private exceeded = false;

  constructor(private readonly limit?: number) {}

  /** Returns true exactly once: on the chunk that first exceeds the limit. */
  push(chunk: Buffer | string): boolean {
    if (this.limit === undefined) {
      this.text += String(chunk);
      return false;
    }
    if (this.exceeded) {
      return false;
    }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    const remaining = this.limit - this.bytes;
    if (buffer.length > remaining) {
      if (remaining > 0) {
        this.chunks.push(buffer.subarray(0, remaining));
      }
      this.bytes = this.limit;
      this.exceeded = true;
      return true;
    }
    this.chunks.push(buffer);
    this.bytes += buffer.length;
    return false;
  }

  toString(): string {
    return this.limit === undefined ? this.text : Buffer.concat(this.chunks).toString("utf8");
  }
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
