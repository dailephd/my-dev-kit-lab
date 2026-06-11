import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCommandString, runMeasuredCommand } from "../../src/core/runMeasuredCommand.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runMeasuredCommand", () => {
  it("captures stdout, stderr, exit code, duration, and telemetry", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "measured-"));
    tempDirs.push(outDir);
    const result = await runMeasuredCommand({
      commandId: "hello",
      commandString: `"${process.execPath}" -e "console.log('out'); console.error('err')"`,
      cwd: process.cwd(),
      outDir
    });
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("out");
    expect(result.stderr).toContain("err");
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(await readFile(result.telemetryPath, "utf8")).toContain("\"commandId\": \"hello\"");
    expect(result.resolvedCommand?.resolutionKind).toBeTruthy();
  });

  it("handles nonzero exit code", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "measured-"));
    tempDirs.push(outDir);
    const result = await runMeasuredCommand({
      commandId: "fail",
      commandString: `"${process.execPath}" -e "process.exit(3)"`,
      cwd: process.cwd(),
      outDir
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it("handles missing command with structured failure", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "measured-"));
    tempDirs.push(outDir);
    const result = await runMeasuredCommand({
      commandId: "missing",
      commandString: "definitely-not-a-real-command",
      cwd: process.cwd(),
      outDir
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("parses quoted command strings", () => {
    expect(parseCommandString('node "path with spaces/file.js" --flag')).toEqual({
      executable: "node",
      args: ["path with spaces/file.js", "--flag"]
    });
  });

  it("preserves args when command resolution is enabled", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "measured-"));
    tempDirs.push(outDir);
    const result = await runMeasuredCommand({
      commandId: "args",
      commandString: `"${process.execPath}"`,
      extraArgs: ["-e", "console.log(process.argv.slice(1).join(','))", "alpha", "beta"],
      cwd: process.cwd(),
      outDir
    });
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("alpha,beta");
  });

  it("returns structured failure on timeout", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "measured-"));
    tempDirs.push(outDir);
    const result = await runMeasuredCommand({
      commandId: "timeout",
      commandString: `"${process.execPath}"`,
      extraArgs: ["-e", "setTimeout(() => {}, 10000)"],
      cwd: process.cwd(),
      outDir,
      timeoutMs: 100
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("does not leave child stdin open for non-interactive commands", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "measured-"));
    tempDirs.push(outDir);
    const result = await runMeasuredCommand({
      commandId: "stdin",
      commandString: `"${process.execPath}"`,
      extraArgs: ["-e", "process.stdin.on('end', () => console.log('stdin-ended')); process.stdin.resume();"],
      cwd: process.cwd(),
      outDir,
      timeoutMs: 1000
    });
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("stdin-ended");
  });
});
