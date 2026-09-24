import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCommandString, runMeasuredCommand } from "../../src/core/runMeasuredCommand.js";
import { resolveCommandInvocation } from "../../src/core/resolveCommand.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runMeasuredCommand", () => {
  function writeHostExecutable(filePath: string, nodeScript: string): void {
    if (process.platform === "win32") {
      // node -e mode: real args start at argv[1]
      writeFileSync(filePath, `@echo off\r\nnode -e "${nodeScript.replace(/"/g, '\\"')}" %*\r\n`, "utf8");
      return;
    }
    // Shebang mode: argv[0]=node, argv[1]=scriptPath, real args start at argv[2]
    const unixScript = nodeScript.replace(/process\.argv\.slice\(1\)/g, "process.argv.slice(2)");
    writeFileSync(filePath, `#!/usr/bin/env node\n${unixScript}\n`, "utf8");
    chmodSync(filePath, 0o755);
  }

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

  it("parses escaped quotes and extra whitespace", () => {
    expect(parseCommandString('  node   "script \\"quoted\\".js"   --label  "hello world"  ')).toEqual({
      executable: "node",
      args: ['script "quoted".js', "--label", "hello world"]
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

  // Regression (v0.5.2 Batch 6): a packed-package acceptance run discovered that a detached
  // descendant which outlives the directly-killed target keeps the "close" event from ever firing
  // (Node only emits "close" once every inherited stdio stream has actually drained), which made
  // this promise -- and every caller awaiting it -- hang forever even though the timeout fired and
  // forceTerminateProcess was called. This reproduces that shape deterministically (independent of
  // any platform-specific kill/signal behavior) and proves the bounded kill-grace fallback resolves
  // the call instead of hanging.
  it("resolves via a bounded kill-grace fallback when an orphaned descendant keeps stdio open after timeout", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "measured-"));
    tempDirs.push(outDir);
    const script = [
      "const { spawn } = require('node:child_process');",
      "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'inherit', detached: true });",
      "grandchild.unref();",
      "setInterval(() => {}, 60000);"
    ].join(" ");
    const started = Date.now();
    const result = await runMeasuredCommand({
      commandId: "orphaned-descendant",
      commandString: `"${process.execPath}"`,
      extraArgs: ["-e", script],
      cwd: process.cwd(),
      outDir,
      timeoutMs: 150
    });
    const elapsedMs = Date.now() - started;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
    // Bounded by timeoutMs plus the internal kill-grace fallback, never by the orphaned
    // descendant's own 60s lifetime.
    expect(elapsedMs).toBeLessThan(6000);
  }, 10000);

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

  // Regression guard for the v0.4.7 extraction of shim-argument assembly into
  // resolveCommand.ts: runMeasuredCommand must spawn exactly what the shared
  // invocation helper produces, on every platform.
  it("spawns exactly the invocation the shared resolver produces", async () => {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), "measured-invocation-"));
    const binDir = path.join(rootDir, "bin with spaces");
    const outDir = path.join(rootDir, "out");
    const nodeBinDir = path.dirname(process.execPath);
    const shimName = process.platform === "win32" ? "echo-args.cmd" : "echo-args";
    tempDirs.push(rootDir);
    mkdirSync(binDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });
    writeHostExecutable(path.join(binDir, shimName), "console.log(process.argv.slice(1).join('|'))");

    const env = {
      Path: `${binDir}${path.delimiter}${nodeBinDir}`,
      PATH: `${binDir}${path.delimiter}${nodeBinDir}`
    };
    const extraArgs = ["alpha", "two words"];
    const expected = resolveCommandInvocation("echo-args", extraArgs, {
      cwd: process.cwd(),
      env: { ...process.env, ...env }
    });

    const result = await runMeasuredCommand({
      commandId: "invocation",
      commandString: "echo-args",
      cwd: process.cwd(),
      outDir,
      extraArgs,
      env,
      timeoutMs: 5000
    });

    expect(result.executable).toBe(expected.executable);
    expect(result.args).toEqual(expected.args);
    expect(result.resolvedCommand?.resolutionKind).toBe(expected.resolvedCommand.resolutionKind);
    expect(result.ok).toBe(true);
  });

  describe("stdinText (v0.5.2 Batch 2)", () => {
    it("preserves current behavior exactly when stdinText is absent", async () => {
      const outDir = mkdtempSync(path.join(os.tmpdir(), "measured-stdin-absent-"));
      tempDirs.push(outDir);
      const result = await runMeasuredCommand({
        commandId: "no-stdin",
        commandString: `"${process.execPath}"`,
        extraArgs: ["-e", "process.stdin.on('end', () => console.log('stdin-ended')); process.stdin.resume();"],
        cwd: process.cwd(),
        outDir,
        timeoutMs: 1000
      });
      expect(result.ok).toBe(true);
      expect(result.stdout).toContain("stdin-ended");
    });

    it("delivers the exact UTF-8 stdin text, including spaces, quotes, newlines, and unicode", async () => {
      const outDir = mkdtempSync(path.join(os.tmpdir(), "measured-stdin-text-"));
      tempDirs.push(outDir);
      const stdinText = 'line one with "quotes" and spaces\nline two éè中文 emoji 😀\nline three';
      const result = await runMeasuredCommand({
        commandId: "stdin-text",
        commandString: `"${process.execPath}"`,
        extraArgs: ["-e", "let data = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { data += c; }); process.stdin.on('end', () => { process.stdout.write(JSON.stringify(data)); });"],
        cwd: process.cwd(),
        outDir,
        stdinText,
        timeoutMs: 5000
      });
      expect(result.ok).toBe(true);
      expect(JSON.parse(result.stdout)).toBe(stdinText);
    });

    it("delivers large stdin input without relying on argv length", async () => {
      const outDir = mkdtempSync(path.join(os.tmpdir(), "measured-stdin-large-"));
      tempDirs.push(outDir);
      const stdinText = "x".repeat(500_000);
      const result = await runMeasuredCommand({
        commandId: "stdin-large",
        commandString: `"${process.execPath}"`,
        extraArgs: ["-e", "let n = 0; process.stdin.on('data', (c) => { n += c.length; }); process.stdin.on('end', () => console.log(n));"],
        cwd: process.cwd(),
        outDir,
        stdinText,
        timeoutMs: 10000
      });
      expect(result.ok).toBe(true);
      expect(result.stdout.trim()).toBe(String(stdinText.length));
    });

    it("never places the stdin payload in commandString, args, or telemetry fields", async () => {
      const outDir = mkdtempSync(path.join(os.tmpdir(), "measured-stdin-confidential-"));
      tempDirs.push(outDir);
      const sentinel = "UNIQUE_STDIN_SENTINEL_9f3c1a7d";
      const result = await runMeasuredCommand({
        commandId: "stdin-confidential",
        commandString: `"${process.execPath}"`,
        extraArgs: ["-e", "process.stdin.resume(); process.stdin.on('end', () => console.log('done'));"],
        cwd: process.cwd(),
        outDir,
        stdinText: sentinel,
        timeoutMs: 5000
      });
      expect(result.ok).toBe(true);
      expect(result.commandString).not.toContain(sentinel);
      expect(result.args.join(" ")).not.toContain(sentinel);
      const telemetry = await readFile(result.telemetryPath, "utf8");
      expect(telemetry).not.toContain(sentinel);
    });

    it("terminates a stdin-fed process that exceeds its timeout through the existing timeout path", async () => {
      const outDir = mkdtempSync(path.join(os.tmpdir(), "measured-stdin-timeout-"));
      tempDirs.push(outDir);
      const result = await runMeasuredCommand({
        commandId: "stdin-timeout",
        commandString: `"${process.execPath}"`,
        extraArgs: ["-e", "process.stdin.resume(); setTimeout(() => {}, 10000)"],
        cwd: process.cwd(),
        outDir,
        stdinText: "hello",
        timeoutMs: 100
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("timed out");
    });

    it("does not crash the process when the child closes stdin early", async () => {
      const outDir = mkdtempSync(path.join(os.tmpdir(), "measured-stdin-early-close-"));
      tempDirs.push(outDir);
      const result = await runMeasuredCommand({
        commandId: "stdin-early-close",
        commandString: `"${process.execPath}"`,
        extraArgs: ["-e", "process.stdin.destroy(); console.log('closed-early');"],
        cwd: process.cwd(),
        outDir,
        stdinText: "x".repeat(1_000_000),
        timeoutMs: 5000
      });
      // The measured-command promise resolving at all (rather than an unhandled process crash) is
      // the property under test; the exact outcome depends on OS pipe-buffer timing.
      expect(typeof result.ok).toBe("boolean");
      expect(result.stdout).toContain("closed-early");
    });
  });

  it("executes host-platform PATH shims from a path containing spaces", async () => {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), "measured-cmd-root-"));
    const binDir = path.join(rootDir, "bin with spaces");
    const outDir = path.join(rootDir, "out");
    const nodeBinDir = path.dirname(process.execPath);
    const shimName = process.platform === "win32" ? "echo-args.cmd" : "echo-args";
    tempDirs.push(rootDir);
    mkdirSync(binDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });
    writeHostExecutable(path.join(binDir, shimName), "console.log(process.argv.slice(1).join('|'))");

    const result = await runMeasuredCommand({
      commandId: "cmd-shim",
      commandString: "echo-args",
      cwd: process.cwd(),
      outDir,
      extraArgs: ["alpha", "two words"],
      env: { Path: `${binDir}${path.delimiter}${nodeBinDir}`, PATH: `${binDir}${path.delimiter}${nodeBinDir}` },
      timeoutMs: 5000
    });

    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe("alpha|two words");
    if (process.platform === "win32") {
      expect(result.executable.toLowerCase()).toContain("cmd");
      expect(result.args.some((arg) => arg.includes("echo-args.cmd"))).toBe(true);
    } else {
      expect(result.executable).toBe("echo-args");
      expect(result.args.some((arg) => arg.includes("echo-args.cmd"))).toBe(false);
    }
  });
});
