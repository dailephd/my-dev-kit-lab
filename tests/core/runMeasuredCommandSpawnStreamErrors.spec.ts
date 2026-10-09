import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * PATH-003/004 (portable half): a failed spawn can make the OS report the never-connected stdout/stderr pipes as
 * errors (Windows `read ENOTCONN` after `spawn ... ENOENT`). Those stream errors must be absorbed by the one failed
 * process's lifecycle and reported in its result, never escape as an unhandled 'error' event.
 */
const state = vi.hoisted(() => ({ script: (_child: unknown): void => undefined }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    ...actual,
    spawn: () => {
      const child = new Emitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: null; pid: number; unref(): void };
      child.stdout = new Emitter();
      child.stderr = new Emitter();
      for (const stream of [child.stdout, child.stderr]) (stream as EventEmitter & { destroy(): void }).destroy = () => undefined;
      child.stdin = null;
      child.pid = 0;
      child.unref = () => undefined;
      setImmediate(() => state.script(child));
      return child;
    }
  };
});

const { runMeasuredCommand } = await import("../../src/core/runMeasuredCommand.js");

const tempDirs: string[] = [];
afterEach(async () => {
  state.script = () => undefined;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

const run = (cwd: string) => {
  const outDir = mkdtempSync(path.join(os.tmpdir(), "spawn-stream-"));
  tempDirs.push(outDir);
  return runMeasuredCommand({ commandId: "c", executable: "tool", args: [], cwd, outDir, resolveCommand: false });
};

const enotconn = () => Object.assign(new Error("read ENOTCONN"), { code: "ENOTCONN", errno: -4053, syscall: "read" });

describe("runMeasuredCommand failed-spawn stream errors", () => {
  it("PATH-003/004: ENOTCONN on both pipes after a spawn ENOENT is absorbed and reported once, as a failure", async () => {
    state.script = (child) => {
      const c = child as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
      c.emit("error", Object.assign(new Error("spawn tool ENOENT"), { code: "ENOENT" }));
      c.stdout.emit("error", enotconn());
      c.stderr.emit("error", enotconn());
      c.emit("close", -4058);
    };
    const result = await run(os.tmpdir());
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(-4058);
    // the first cause wins and carries the measured cwd length; the later stream errors do not overwrite it
    expect(result.error).toContain("spawn tool ENOENT");
    expect(result.error).toContain(`cwd length ${os.tmpdir().length} characters`);
    expect(result.error).not.toContain("ENOTCONN");
  });

  it("PATH-004: a stream error with no earlier spawn error is still a reported failure", async () => {
    state.script = (child) => {
      const c = child as EventEmitter & { stdout: EventEmitter };
      c.stdout.emit("error", enotconn());
      c.emit("close", 0);
    };
    const result = await run(os.tmpdir());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to read command stdout: read ENOTCONN");
  });

  it("PATH-004: an ENOENT for a directory that does not exist keeps the plain message (no path-length hint)", async () => {
    state.script = (child) => {
      const c = child as EventEmitter;
      c.emit("error", Object.assign(new Error("spawn tool ENOENT"), { code: "ENOENT" }));
      c.emit("close", -4058);
    };
    const result = await run(path.join(os.tmpdir(), "definitely-missing-cwd-6f1a"));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("spawn tool ENOENT");
  });
});
