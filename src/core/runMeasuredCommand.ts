import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

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
}): Promise<MeasuredCommandResult> {
  await mkdir(options.outDir, { recursive: true });
  const parsed = parseCommandString(options.commandString);
  const executable = parsed.executable;
  const args = [...parsed.args, ...(options.extraArgs ?? [])];
  const stdoutPath = path.join(options.outDir, `${options.commandId}.stdout.txt`);
  const stderrPath = path.join(options.outDir, `${options.commandId}.stderr.txt`);
  const telemetryPath = path.join(options.outDir, `${options.commandId}.telemetry.json`);
  const startedAt = new Date().toISOString();
  const started = Date.now();

  const result = await new Promise<MeasuredCommandResult>((resolve) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false
    });

    let stdout = "";
    let stderr = "";
    let spawnError: string | undefined;

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("close", async (exitCode) => {
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
        ok: exitCode === 0 && !spawnError,
        error: spawnError
      };
      await writeFile(telemetryPath, JSON.stringify(measured, null, 2), "utf8");
      resolve(measured);
    });
  });

  return result;
}
