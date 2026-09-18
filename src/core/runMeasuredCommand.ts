import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseCommandString } from "./commandLine.js";
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
  const trailingArgs = [...parsed.args, ...(options.extraArgs ?? [])];
  // Windows .cmd/.bat/.ps1 argument assembly is owned by resolveCommand.ts so
  // that every spawn site (measured commands and managed long-running processes)
  // shares exactly one shim rule.
  const invocation =
    options.resolveCommand === false
      ? buildResolvedCommandInvocation(
          {
            originalCommand: parsed.executable,
            command: parsed.executable,
            argsPrefix: [],
            resolutionKind: "direct" as const,
            resolvedPath: parsed.executable,
            warnings: []
          },
          trailingArgs
        )
      : resolveCommandInvocation(parsed.executable, trailingArgs, {
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
        writeArtifact(stdoutPath, stdout),
        writeArtifact(stderrPath, stderr),
        writeArtifact(telemetryPath, JSON.stringify(measured, null, 2))
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
