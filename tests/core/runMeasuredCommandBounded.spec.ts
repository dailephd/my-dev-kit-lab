import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { terminateProcessTree } from "../../src/core/processTree.js";
import { runMeasuredCommand } from "../../src/core/runMeasuredCommand.js";

const tempDirs: string[] = [];
const savedEnv = { ...process.env };

afterEach(async () => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined)));
});

function temp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bounded-"));
  tempDirs.push(dir);
  return dir;
}

function hostEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...extra };
  for (const name of ["SystemRoot", "SYSTEMROOT", "PATH", "Path", "TEMP", "TMP"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
}

const run = (outDir: string, script: string, options: Partial<Parameters<typeof runMeasuredCommand>[0]> = {}) =>
  runMeasuredCommand({
    commandId: "bounded",
    executable: process.execPath,
    args: ["-e", script],
    cwd: process.cwd(),
    outDir,
    resolveCommand: false,
    ...options
  } as Parameters<typeof runMeasuredCommand>[0]);

async function waitUntilDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe("runMeasuredCommand default behavior is unchanged", () => {
  it("RSP-041 adds no bounded-mode fields or telemetry keys when no new option is used", async () => {
    const outDir = temp();
    const result = await run(outDir, "console.log('out'); console.error('err')");
    expect(result.ok).toBe(true);
    expect(Object.keys(result)).not.toContain("timedOut");
    expect(Object.keys(result)).not.toContain("outputLimit");
    const telemetry = JSON.parse(readFileSync(result.telemetryPath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(telemetry).sort()).toEqual(
      ["args", "commandId", "commandString", "cwd", "durationMs", "endedAt", "executable", "exitCode", "ok", "resolvedCommand", "startedAt", "stderr", "stderrPath", "stdout", "stdoutPath", "telemetryPath"].sort()
    );
  });

  it("RSP-041 still reports a legacy timeout without bounded-mode fields", async () => {
    const outDir = temp();
    const result = await run(outDir, "setTimeout(() => {}, 10000)", { timeoutMs: 200 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
    expect(Object.keys(result)).not.toContain("timedOut");
  });

  it("RSP-044 keeps inheriting the parent environment by default", async () => {
    process.env.LAB_BOUNDED_PARENT = "from-parent";
    const result = await run(temp(), "console.log(process.env.LAB_BOUNDED_PARENT ?? 'missing')", { env: { LAB_BOUNDED_EXTRA: "x" } });
    expect(result.stdout.trim()).toBe("from-parent");
  });
});

describe("runMeasuredCommand bounded options", () => {
  it("RSP-042 caps stdout, terminates the process, and reports the limit", async () => {
    const outDir = temp();
    const started = Date.now();
    const result = await run(outDir, "setInterval(() => process.stdout.write('a'.repeat(700)), 1)", { stdoutMaxBytes: 1000, terminateProcessTree: true, timeoutMs: 20_000 });
    expect(result.ok).toBe(false);
    expect(result.outputLimit).toEqual({ stream: "stdout", limitBytes: 1000 });
    expect(result.timedOut).toBe(false);
    expect(result.error).toContain("stdout exceeded 1000 bytes");
    expect(Buffer.byteLength(result.stdout)).toBe(1000);
    expect(statSync(result.stdoutPath).size).toBe(1000);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("RSP-042 does not flag output that is exactly at the limit", async () => {
    const result = await run(temp(), "process.stdout.write('b'.repeat(1000))", { stdoutMaxBytes: 1000 });
    expect(result.ok).toBe(true);
    expect(result.outputLimit).toBeUndefined();
    expect(result.stdout).toHaveLength(1000);
  });

  it("RSP-043 caps stderr independently of stdout", async () => {
    const result = await run(temp(), "process.stdout.write('ok'); setInterval(() => process.stderr.write('e'.repeat(700)), 1)", { stderrMaxBytes: 1500, terminateProcessTree: true, timeoutMs: 20_000 });
    expect(result.ok).toBe(false);
    expect(result.outputLimit).toEqual({ stream: "stderr", limitBytes: 1500 });
    expect(Buffer.byteLength(result.stderr)).toBe(1500);
    expect(result.stdout).toBe("ok");
  });

  it("RSP-045 can disable parent environment inheritance", async () => {
    process.env.LAB_BOUNDED_PARENT = "from-parent";
    process.env.LAB_BOUNDED_SECRET_TOKEN = "must-not-leak";
    const result = await run(temp(), "console.log(JSON.stringify(Object.keys(process.env)))", { inheritParentEnv: false, env: hostEnv({ LAB_BOUNDED_EXPLICIT: "yes" }) });
    expect(result.ok).toBe(true);
    const names = (JSON.parse(result.stdout) as string[]).map((name) => name.toLowerCase());
    expect(names).toContain("lab_bounded_explicit");
    expect(names).not.toContain("lab_bounded_parent");
    expect(names).not.toContain("lab_bounded_secret_token");
    expect(result.timedOut).toBe(false);
  });

  it("RSP-046 terminates descendants of a timed-out command when a process tree is requested", async () => {
    const dir = temp();
    const pidFile = path.join(dir, "grandchild.pid").replace(/\\/g, "/");
    const parentScript = [
      "const { spawn } = require('node:child_process');",
      "const fs = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      `fs.writeFileSync('${pidFile}', String(child.pid));`,
      "setInterval(() => {}, 1000);"
    ].join("\n");
    const result = await run(dir, parentScript, { timeoutMs: 2500, terminateProcessTree: true });
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    const grandchildPid = Number(readFileSync(pidFile, "utf8"));
    expect(Number.isInteger(grandchildPid) && grandchildPid > 0).toBe(true);
    expect(await waitUntilDead(grandchildPid, 10_000)).toBe(true);
  });
});

describe("terminateProcessTree", () => {
  it("resolves without throwing for an undefined or already-exited pid", async () => {
    await expect(terminateProcessTree(undefined)).resolves.toBeUndefined();
    await expect(terminateProcessTree(2_147_000_000)).resolves.toBeUndefined();
  });
});
