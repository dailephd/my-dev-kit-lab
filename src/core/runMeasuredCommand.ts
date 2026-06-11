import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveCommand, type ResolvedCommand } from "./resolveCommand.js";

export type ParsedCommand = {
  executable: string;
  args: string[];
};

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

export function parseCommandString(command: string): ParsedCommand {
  const parts = command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((part) => part.replace(/^['"]|['"]$/g, "")) ?? [];
  if (parts.length === 0) {
    throw new Error("Command string is empty.");
  }
  return {
    executable: parts[0],
    args: parts.slice(1)
  };
}

export async function runMeasuredCommand(options: {
  commandId: string;
  commandString: string;
  cwd: string;
  outDir: string;
  extraArgs?: string[];
  env?: NodeJS.ProcessEnv;
  resolveCommand?: boolean;
  allowPowerShellShim?: boolean;
  timeoutMs?: number;
}): Promise<MeasuredCommandResult> {
  await mkdir(options.outDir, { recursive: true });
  const parsed = parseCommandString(options.commandString);
  const resolution =
    options.resolveCommand === false
      ? {
          originalCommand: parsed.executable,
          command: parsed.executable,
          argsPrefix: [],
          resolutionKind: "direct" as const,
          resolvedPath: parsed.executable,
          warnings: []
        }
      : resolveCommand(parsed.executable, {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          allowPowerShellShim: options.allowPowerShellShim
        });
  const executable = resolution.command;
  const args = [...resolution.argsPrefix, ...parsed.args, ...(options.extraArgs ?? [])];
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
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      const measured: MeasuredCommandResult = {
        commandId: options.commandId,
        commandString: options.commandString,
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
        writeFile(stdoutPath, stdout, "utf8"),
        writeFile(stderrPath, stderr, "utf8"),
        writeFile(telemetryPath, JSON.stringify(measured, null, 2), "utf8")
      ]).then(() => resolve(measured));
      return;
    }

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      spawnError = error.message;
    });
    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        timedOut = true;
        spawnError = `Command timed out after ${options.timeoutMs}ms.`;
        killProcessTree(child.pid);
      }, options.timeoutMs);
    }
    child.on("close", async (exitCode) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - started;
      await writeFile(stdoutPath, stdout, "utf8");
      await writeFile(stderrPath, stderr, "utf8");
      const measured: MeasuredCommandResult = {
        commandId: options.commandId,
        commandString: options.commandString,
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
      await writeFile(telemetryPath, JSON.stringify(measured, null, 2), "utf8");
      resolve(measured);
    });
  });

  return result;
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) {
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { shell: false, stdio: "ignore" });
    killer.on("error", () => undefined);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The child may have exited between timeout scheduling and kill.
  }
}
