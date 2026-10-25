import { describe, expect, it } from "vitest";
import { runSecurityCommand } from "../../src/securityValidation/commandRunner.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { terminateProcessTree } from "../../src/core/processTree.js";

// v0.4.1 Batch 7 — narrow additive regression: the optional `env` parameter
// must never affect callers that omit it (every pre-existing caller), and
// must be honored by the child process when supplied.
describe("runSecurityCommand env parameter (Batch 7 narrow correction)", () => {
  it("defaults to inheriting process.env when env is omitted", async () => {
    process.env.RUN_SECURITY_COMMAND_ENV_TEST = "inherited-value";
    try {
      const result = await runSecurityCommand({
        command: process.execPath,
        args: ["-e", "process.stdout.write(process.env.RUN_SECURITY_COMMAND_ENV_TEST || '')"],
        cwd: process.cwd(),
        timeoutMs: 10_000,
      });
      expect(result.stdout).toBe("inherited-value");
    } finally {
      delete process.env.RUN_SECURITY_COMMAND_ENV_TEST;
    }
  });

  it("uses the supplied minimal env instead of the full process env when provided", async () => {
    process.env.RUN_SECURITY_COMMAND_ENV_TEST = "should-not-be-visible";
    try {
      const minimalEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH, ONLY_ALLOWED_VAR: "visible-value" };
      const result = await runSecurityCommand({
        command: process.execPath,
        args: ["-e", "process.stdout.write((process.env.RUN_SECURITY_COMMAND_ENV_TEST || 'ABSENT') + ':' + (process.env.ONLY_ALLOWED_VAR || 'ABSENT'))"],
        cwd: process.cwd(),
        timeoutMs: 10_000,
        env: minimalEnv,
      });
      expect(result.stdout).toBe("ABSENT:visible-value");
    } finally {
      delete process.env.RUN_SECURITY_COMMAND_ENV_TEST;
    }
  });
});

describe("security command process evidence and deadlines", () => {
  it("preserves zero/nonzero exits and literal shell metacharacters", async () => {
    const literal = "$(never-execute) & echo ; | > <";
    const success = await runSecurityCommand({ command: process.execPath, args: ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", literal], cwd: process.cwd(), timeoutMs: 5000 });
    expect(success.exitCode).toBe(0);
    expect(success.timedOut).toBe(false);
    expect(JSON.parse(success.stdout)).toEqual([literal]);
    const failed = await runSecurityCommand({ command: process.execPath, args: ["-e", "console.error('real-nonzero');process.exit(7)"], cwd: process.cwd(), timeoutMs: 5000 });
    expect(failed.exitCode).toBe(7);
    expect(failed.stderr).toContain("real-nonzero");
    expect(failed.timedOut).toBe(false);
  });

  it("distinguishes unavailable resolution from a spawned signal/null exit", async () => {
    const missing = await runSecurityCommand({ command: "lab-wc-deliberately-unavailable-command", args: [], cwd: process.cwd(), env: { PATH: "", Path: "" }, timeoutMs: 5000 });
    expect(missing.exitCode).toBeNull();
    expect(missing.timedOut).toBe(false);
    expect(missing.resolutionKind).toBe("unavailable");
    const signaled = await runSecurityCommand({ command: process.execPath, args: ["-e", "process.kill(process.pid,'SIGTERM')"], cwd: process.cwd(), timeoutMs: 5000 });
    // Windows self-termination is an exit status, whereas POSIX reports a signal.
    expect(signaled.exitCode).toBe(process.platform === "win32" ? 1 : null);
    expect(signaled.signal).toBe(process.platform === "win32" ? null : "SIGTERM");
    expect(signaled.timedOut).toBe(false);
    const spawnFailure = await runSecurityCommand({ command: process.execPath, args: [], cwd: path.join(process.cwd(), "wc-missing-cwd-for-spawn-error"), timeoutMs: 5000 });
    expect(spawnFailure.exitCode).toBeNull();
    expect(spawnFailure.timedOut).toBe(false);
    expect(spawnFailure.spawnError).toContain("ENOENT");
    expect(spawnFailure.resolutionKind).not.toBe("unavailable");
  });

  it("awaits bounded timeout cleanup of the npm parent and owned descendant", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wc process tree "));
    const pidFile = path.join(dir, "owned-child.json");
    const parentFile = path.join(dir, "owned-parent.json");
    let ownedPid: number | undefined;
    try {
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "wc-owned-timeout", type: "commonjs", scripts: { "test:security": "node parent.cjs" } }));
      const childCode = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({pid:process.pid,marker:'wc-owned-child'}));setTimeout(()=>process.exit(0),10000);`;
      writeFileSync(path.join(dir, "parent.cjs"), `require('node:fs').writeFileSync(${JSON.stringify(parentFile)},JSON.stringify({pid:process.pid,marker:'wc-owned-parent'}));require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit',windowsHide:true});setTimeout(()=>process.exit(0),9000);`);
      const started = Date.now();
      const result = await runSecurityCommand({ command: "npm", args: ["run", "test:security"], cwd: dir, timeoutMs: 1500 });
      expect(Date.now() - started).toBeLessThan(8000);
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
      expect(existsSync(pidFile)).toBe(true);
      const record = JSON.parse(readFileSync(pidFile, "utf8"));
      expect(record.marker).toBe("wc-owned-child");
      ownedPid = record.pid;
      let alive = true;
      try { process.kill(ownedPid!, 0); } catch { alive = false; }
      expect(alive, "a timed-out security command must not leave the owned descendant alive").toBe(false);
      expect(result.treeTerminated).toBe(true);
    } finally {
      // Only the PID just authenticated in this fixture's private marker is eligible.
      if (ownedPid) await terminateProcessTree(ownedPid);
      if (existsSync(parentFile)) {
        const record = JSON.parse(readFileSync(parentFile, "utf8"));
        if (record.marker === "wc-owned-parent") await terminateProcessTree(record.pid);
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
