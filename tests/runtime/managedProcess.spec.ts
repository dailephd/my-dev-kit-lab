import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MANAGED_PROCESS_CAPTURE_LIMIT_BYTES,
  ManagedProcessStartError,
  startManagedProcess,
  type ManagedProcessHandle
} from "../../src/runtime/managedProcess.js";

const tempDirs: string[] = [];
const liveHandles: ManagedProcessHandle[] = [];
const liveServers: http.Server[] = [];

// Every started process and listener is torn down here as well as in each
// test's own finally, so a failing assertion can never leave a child alive or a
// temporary directory behind.
afterEach(async () => {
  await Promise.all(liveHandles.splice(0).map((handle) => handle.stop().catch(() => undefined)));
  await Promise.all(liveServers.splice(0).map((server) => closeServer(server)));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Portable long-running child: prints on start, then stays alive until stopped. */
const STAY_ALIVE = "setInterval(() => {}, 1000);";

async function startNodeChild(options: {
  id: string;
  script: string;
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  outDir?: string;
}): Promise<ManagedProcessHandle> {
  const handle = await startManagedProcess({
    id: options.id,
    executable: process.execPath,
    args: ["-e", options.script, ...(options.args ?? [])],
    cwd: options.cwd ?? process.cwd(),
    outDir: options.outDir ?? makeTempDir("managed-out-"),
    env: options.env
  });
  liveHandles.push(handle);
  return handle;
}

async function waitForFileToContain(filePath: string, needle: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      last = await readFile(filePath, "utf8");
      if (last.includes(needle)) {
        return last;
      }
    } catch {
      // The log file may not exist for the first few milliseconds.
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${filePath} to contain ${JSON.stringify(needle)}. Last: ${last}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

async function startLocalServer(
  handler: http.RequestListener,
  host = "127.0.0.1",
  port = 0
): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler);
  liveServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  return { server, port: (server.address() as AddressInfo).port };
}

async function findFreePort(host = "127.0.0.1"): Promise<number> {
  const { server, port } = await startLocalServer(() => undefined, host);
  await closeServer(server);
  liveServers.splice(liveServers.indexOf(server), 1);
  return port;
}

async function supportsIpv6Loopback(): Promise<boolean> {
  try {
    const { server } = await startLocalServer((_req, res) => res.end("ok"), "::1");
    await closeServer(server);
    liveServers.splice(liveServers.indexOf(server), 1);
    return true;
  } catch {
    return false;
  }
}

describe("startManagedProcess lifecycle", () => {
  it("starts a long-running child without a shell and records pid and resolved command", async () => {
    const handle = await startNodeChild({ id: "alive", script: `console.log("up"); ${STAY_ALIVE}` });
    try {
      expect(handle.pid).toBeGreaterThan(0);
      expect(isProcessAlive(handle.pid)).toBe(true);
      expect(handle.resolvedCommand.resolutionKind).toBeTruthy();
      expect(handle.resolvedCommand.resolutionKind).not.toBe("unavailable");
      expect(handle.executable).toBe(process.execPath);
      expect(handle.args[0]).toBe("-e");
      await waitForFileToContain(handle.stdoutPath, "up");
    } finally {
      await handle.stop();
    }
  });

  it("writes stdout to <id>.stdout.txt while the child is still running", async () => {
    const handle = await startNodeChild({
      id: "stream-out",
      script: `console.log("first-line"); setTimeout(() => console.log("second-line"), 150); ${STAY_ALIVE}`
    });
    try {
      expect(handle.stdoutPath).toBe(path.join(path.dirname(handle.stdoutPath), "stream-out.stdout.txt"));
      await waitForFileToContain(handle.stdoutPath, "first-line");
      // Proves output is flushed as it arrives rather than at exit.
      await waitForFileToContain(handle.stdoutPath, "second-line");
      expect(isProcessAlive(handle.pid)).toBe(true);
    } finally {
      await handle.stop();
    }
  });

  it("writes stderr to <id>.stderr.txt while the child is still running", async () => {
    const handle = await startNodeChild({
      id: "stream-err",
      script: `console.error("err-line"); ${STAY_ALIVE}`
    });
    try {
      expect(path.basename(handle.stderrPath)).toBe("stream-err.stderr.txt");
      await waitForFileToContain(handle.stderrPath, "err-line");
      expect(isProcessAlive(handle.pid)).toBe(true);
    } finally {
      await handle.stop();
    }
  });

  it("preserves arguments containing spaces", async () => {
    const handle = await startNodeChild({
      id: "spaced-args",
      script: `console.log(process.argv.slice(1).join("|")); ${STAY_ALIVE}`,
      args: ["alpha", "two words"]
    });
    try {
      const contents = await waitForFileToContain(handle.stdoutPath, "alpha|two words");
      expect(contents).toContain("alpha|two words");
      expect(handle.args).toContain("two words");
    } finally {
      await handle.stop();
    }
  });

  it("merges spec.env over the parent environment for the child", async () => {
    const handle = await startNodeChild({
      id: "env-merge",
      script: `console.log("v=" + process.env.MANAGED_TEST_VALUE + " path=" + (process.env.PATH || process.env.Path ? "yes" : "no")); ${STAY_ALIVE}`,
      env: { MANAGED_TEST_VALUE: "from-spec" }
    });
    try {
      const contents = await waitForFileToContain(handle.stdoutPath, "v=from-spec");
      expect(contents).toContain("path=yes");
    } finally {
      await handle.stop();
    }
  });

  it("does not leave child stdin open", async () => {
    const handle = await startNodeChild({
      id: "stdin-closed",
      script: 'process.stdin.on("end", () => console.log("stdin-ended")); process.stdin.resume();'
    });
    try {
      await waitForFileToContain(handle.stdoutPath, "stdin-ended");
    } finally {
      await handle.stop();
    }
  });

  it("returns normalized exit information and gives every waiter the same result", async () => {
    const handle = await startNodeChild({ id: "exit-code", script: "process.exit(7)" });
    const [first, second] = await Promise.all([handle.waitForExit(), handle.waitForExit()]);
    const third = await handle.waitForExit();

    expect(first.exitCode).toBe(7);
    expect(first.signal).toBeNull();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("stops a running child and reports it as stopped or forced", async () => {
    const handle = await startNodeChild({ id: "stop-me", script: `console.log("up"); ${STAY_ALIVE}` });
    await waitForFileToContain(handle.stdoutPath, "up");

    const result = await handle.stop();

    expect(["stopped", "forced"]).toContain(result.status);
    expect(isProcessAlive(handle.pid)).toBe(false);
    expect(await handle.waitForExit()).toBe(result.exit);
  });

  it("is idempotent when stop is called repeatedly", async () => {
    const handle = await startNodeChild({ id: "stop-twice", script: `console.log("up"); ${STAY_ALIVE}` });
    await waitForFileToContain(handle.stdoutPath, "up");

    const first = await handle.stop();
    const second = await handle.stop();
    const third = await handle.stop();

    expect(["stopped", "forced"]).toContain(first.status);
    expect(second.status).toBe("already-exited");
    expect(third.status).toBe("already-exited");
    expect(second.exit).toEqual(first.exit);
  });

  it("reports already-exited for a child that exited before stop", async () => {
    const handle = await startNodeChild({ id: "self-exit", script: "process.exit(0)" });
    await handle.waitForExit();

    const result = await handle.stop();

    expect(result.status).toBe("already-exited");
    expect(result.exit.exitCode).toBe(0);
  });

  it("exposes a bounded diagnostic output tail without truncating the on-disk log", async () => {
    const handle = await startNodeChild({
      id: "tail",
      script: `console.log("tail-line"); ${STAY_ALIVE}`
    });
    try {
      await waitForFileToContain(handle.stdoutPath, "tail-line");
      const tail = handle.readRecentOutput();
      expect(tail.stdout).toContain("tail-line");
      expect(tail.truncated).toBe(false);
      expect(MANAGED_PROCESS_CAPTURE_LIMIT_BYTES).toBe(256 * 1024);
    } finally {
      await handle.stop();
    }
  });

  it("emits no unhandled child-process error or rejection events across a full lifecycle", async () => {
    const unhandled: unknown[] = [];
    const onUncaught = (error: unknown) => unhandled.push(error);
    process.on("uncaughtException", onUncaught);
    process.on("unhandledRejection", onUncaught);
    try {
      const handle = await startNodeChild({ id: "clean", script: `console.log("up"); ${STAY_ALIVE}` });
      await waitForFileToContain(handle.stdoutPath, "up");
      await handle.stop();
      await handle.stop();
      await delay(50);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
      process.off("unhandledRejection", onUncaught);
    }
  });
});

describe("startManagedProcess validation", () => {
  it("rejects an empty id", async () => {
    await expect(
      startManagedProcess({
        id: "   ",
        executable: process.execPath,
        cwd: process.cwd(),
        outDir: makeTempDir("managed-out-")
      })
    ).rejects.toBeInstanceOf(ManagedProcessStartError);
  });

  it("rejects an id that is not a single path segment", async () => {
    await expect(
      startManagedProcess({
        id: "../escape",
        executable: process.execPath,
        cwd: process.cwd(),
        outDir: makeTempDir("managed-out-")
      })
    ).rejects.toBeInstanceOf(ManagedProcessStartError);
  });

  it("rejects an empty executable", async () => {
    await expect(
      startManagedProcess({
        id: "empty-exe",
        executable: "",
        cwd: process.cwd(),
        outDir: makeTempDir("managed-out-")
      })
    ).rejects.toBeInstanceOf(ManagedProcessStartError);
  });

  it("rejects a cwd that does not exist", async () => {
    await expect(
      startManagedProcess({
        id: "bad-cwd",
        executable: process.execPath,
        cwd: path.join(os.tmpdir(), "managed-process-definitely-missing-dir"),
        outDir: makeTempDir("managed-out-")
      })
    ).rejects.toBeInstanceOf(ManagedProcessStartError);
  });

  it("rejects an unavailable command instead of spawning through a shell", async () => {
    await expect(
      startManagedProcess({
        id: "missing-command",
        executable: "definitely-not-a-real-command",
        cwd: process.cwd(),
        outDir: makeTempDir("managed-out-")
      })
    ).rejects.toBeInstanceOf(ManagedProcessStartError);
  });
});

describe("managed process local HTTP readiness", () => {
  it("becomes ready on a 200 response and populates attempts and elapsedMs", async () => {
    const { port } = await startLocalServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    const handle = await startNodeChild({ id: "ready-200", script: STAY_ALIVE });
    try {
      const result = await handle.waitForReadiness({
        kind: "http",
        url: `http://127.0.0.1:${port}/`,
        timeoutMs: 5000
      });

      expect(result.status).toBe("ready");
      expect(result.lastStatusCode).toBe(200);
      expect(result.attempts).toBeGreaterThanOrEqual(1);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    } finally {
      await handle.stop();
    }
  });

  it("accepts a 3xx response under the default 200..399 range", async () => {
    const { port } = await startLocalServer((_req, res) => {
      res.writeHead(302, { Location: "/elsewhere" });
      res.end();
    });
    const handle = await startNodeChild({ id: "ready-302", script: STAY_ALIVE });
    try {
      const result = await handle.waitForReadiness({
        kind: "http",
        url: `http://127.0.0.1:${port}/`,
        timeoutMs: 5000
      });

      expect(result.status).toBe("ready");
      expect(result.lastStatusCode).toBe(302);
    } finally {
      await handle.stop();
    }
  });

  it("honors a configured accepted status range", async () => {
    const { port } = await startLocalServer((_req, res) => {
      res.writeHead(503);
      res.end("starting");
    });
    const handle = await startNodeChild({ id: "ready-range", script: STAY_ALIVE });
    try {
      const accepted = await handle.waitForReadiness({
        kind: "http",
        url: `http://127.0.0.1:${port}/`,
        timeoutMs: 3000,
        acceptedStatusMin: 500,
        acceptedStatusMax: 599
      });
      expect(accepted.status).toBe("ready");
      expect(accepted.lastStatusCode).toBe(503);

      const rejected = await handle.waitForReadiness({
        kind: "http",
        url: `http://127.0.0.1:${port}/`,
        timeoutMs: 300,
        intervalMs: 50
      });
      expect(rejected.status).toBe("timeout");
      expect(rejected.lastStatusCode).toBe(503);
    } finally {
      await handle.stop();
    }
  });

  it("retries a refused connection until the local server appears", async () => {
    const port = await findFreePort();
    const handle = await startNodeChild({ id: "ready-retry", script: STAY_ALIVE });
    let timer: NodeJS.Timeout | undefined;
    try {
      timer = setTimeout(() => {
        void startLocalServer((_req, res) => {
          res.writeHead(200);
          res.end("late");
        }, "127.0.0.1", port);
      }, 300);

      const result = await handle.waitForReadiness({
        kind: "http",
        url: `http://127.0.0.1:${port}/`,
        timeoutMs: 10_000,
        intervalMs: 50
      });

      expect(result.status).toBe("ready");
      expect(result.attempts).toBeGreaterThan(1);
    } finally {
      if (timer) clearTimeout(timer);
      await handle.stop();
    }
  });

  it("returns timeout when the overall budget expires", async () => {
    const port = await findFreePort();
    const handle = await startNodeChild({ id: "ready-timeout", script: STAY_ALIVE });
    try {
      const result = await handle.waitForReadiness({
        kind: "http",
        url: `http://127.0.0.1:${port}/`,
        timeoutMs: 400,
        intervalMs: 50
      });

      expect(result.status).toBe("timeout");
      expect(result.attempts).toBeGreaterThanOrEqual(1);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(400);
      expect(result.error).toBeTruthy();
    } finally {
      await handle.stop();
    }
  });

  it("returns process-exited when the child dies before readiness", async () => {
    const port = await findFreePort();
    const handle = await startNodeChild({
      id: "ready-exit",
      script: "setTimeout(() => process.exit(2), 150);"
    });
    try {
      const result = await handle.waitForReadiness({
        kind: "http",
        url: `http://127.0.0.1:${port}/`,
        timeoutMs: 10_000,
        intervalMs: 50
      });

      expect(result.status).toBe("process-exited");
      expect(result.error).toContain("exited before readiness");
    } finally {
      await handle.stop();
    }
  });

  it("cleans up after a readiness timeout when the caller stops the handle", async () => {
    const port = await findFreePort();
    const handle = await startNodeChild({ id: "ready-cleanup", script: `console.log("up"); ${STAY_ALIVE}` });
    const readiness = await handle.waitForReadiness({
      kind: "http",
      url: `http://127.0.0.1:${port}/`,
      timeoutMs: 300,
      intervalMs: 50
    });
    expect(readiness.status).toBe("timeout");
    expect(isProcessAlive(handle.pid)).toBe(true);

    const stopped = await handle.stop();
    expect(["stopped", "forced"]).toContain(stopped.status);
    expect(isProcessAlive(handle.pid)).toBe(false);
  });

  it("rejects a non-loopback host without making any external request", async () => {
    const handle = await startNodeChild({ id: "ready-external", script: STAY_ALIVE });
    try {
      const result = await handle.waitForReadiness({
        kind: "http",
        url: "http://example.com/",
        timeoutMs: 1000
      });

      expect(result.status).toBe("probe-failed");
      expect(result.attempts).toBe(0);
      expect(result.error).toContain("loopback");
    } finally {
      await handle.stop();
    }
  });

  it("rejects a non-http protocol and a malformed url", async () => {
    const handle = await startNodeChild({ id: "ready-proto", script: STAY_ALIVE });
    try {
      const badProtocol = await handle.waitForReadiness({
        kind: "http",
        url: "file:///etc/hosts",
        timeoutMs: 1000
      });
      expect(badProtocol.status).toBe("probe-failed");

      const malformed = await handle.waitForReadiness({
        kind: "http",
        url: "not a url",
        timeoutMs: 1000
      });
      expect(malformed.status).toBe("probe-failed");
    } finally {
      await handle.stop();
    }
  });

  it("accepts localhost", async () => {
    const { port } = await startLocalServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    const handle = await startNodeChild({ id: "ready-localhost", script: STAY_ALIVE });
    try {
      const result = await handle.waitForReadiness({
        kind: "http",
        url: `http://localhost:${port}/`,
        timeoutMs: 5000
      });
      expect(result.status).toBe("ready");
    } finally {
      await handle.stop();
    }
  });

  it("accepts the IPv6 loopback when the host supports it", async () => {
    const handle = await startNodeChild({ id: "ready-ipv6", script: STAY_ALIVE });
    try {
      if (!(await supportsIpv6Loopback())) {
        // Host has no usable ::1 listener; the address policy is still proven by
        // the localhost/127.0.0.1 cases above.
        return;
      }
      const { port } = await startLocalServer((_req, res) => {
        res.writeHead(200);
        res.end("ok");
      }, "::1");

      const result = await handle.waitForReadiness({
        kind: "http",
        url: `http://[::1]:${port}/`,
        timeoutMs: 5000
      });
      expect(result.status).toBe("ready");
    } finally {
      await handle.stop();
    }
  });
});
