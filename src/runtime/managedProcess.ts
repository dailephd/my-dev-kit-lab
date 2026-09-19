import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { forceTerminateProcess, requestProcessTermination } from "../core/processTree.js";
import { resolveCommandInvocation, type ResolvedCommand } from "../core/resolveCommand.js";

/**
 * Long-running child process lifecycle.
 *
 * This owner is deliberately NOT a replacement for `runMeasuredCommand`.
 * `runMeasuredCommand` owns bounded commands that are expected to terminate and
 * whose full output is a measurement artifact. `startManagedProcess` owns
 * commands that are expected to stay alive until explicitly stopped (local demo
 * servers and viewers), so it returns a handle instead of a completed result and
 * streams its logs to disk instead of accumulating them in memory.
 *
 * It reuses the canonical command resolver and the shared process-termination
 * primitive; it does not implement a second command resolver and never uses a
 * shell.
 */

/** Bounded in-memory diagnostic tail retained per stream. Disk logs stay complete. */
export const MANAGED_PROCESS_CAPTURE_LIMIT_BYTES = 256 * 1024;

export const MANAGED_PROCESS_DEFAULT_GRACE_PERIOD_MS = 1500;

export const MANAGED_PROCESS_DEFAULT_READINESS_INTERVAL_MS = 100;
export const MANAGED_PROCESS_DEFAULT_REQUEST_TIMEOUT_MS = 1000;
export const MANAGED_PROCESS_DEFAULT_ACCEPTED_STATUS_MIN = 200;
export const MANAGED_PROCESS_DEFAULT_ACCEPTED_STATUS_MAX = 399;

/** Hostnames a readiness probe is permitted to contact. Loopback only, by design. */
const ALLOWED_READINESS_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export type ManagedProcessSpec = {
  id: string;
  executable: string;
  args?: readonly string[];
  cwd: string;
  /** Explicit writable output root for logs. Never inferred from cwd. */
  outDir: string;
  env?: NodeJS.ProcessEnv;
  allowPowerShellShim?: boolean;
};

export type LocalHttpReadinessProbe = {
  kind: "http";
  url: string;
  timeoutMs: number;
  intervalMs?: number;
  requestTimeoutMs?: number;
  acceptedStatusMin?: number;
  acceptedStatusMax?: number;
};

export type ManagedProcessExitResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
};

export type ManagedProcessReadinessStatus = "ready" | "timeout" | "process-exited" | "probe-failed";

export type ManagedProcessReadinessResult = {
  status: ManagedProcessReadinessStatus;
  url: string;
  attempts: number;
  elapsedMs: number;
  lastStatusCode?: number;
  error?: string;
};

export type ManagedProcessStopStatus = "already-exited" | "stopped" | "forced";

export type ManagedProcessStopResult = {
  status: ManagedProcessStopStatus;
  exit: ManagedProcessExitResult;
};

export type ManagedProcessOutputTail = {
  stdout: string;
  stderr: string;
  truncated: boolean;
};

export type ManagedProcessHandle = {
  readonly id: string;
  readonly pid: number;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly resolvedCommand: ResolvedCommand;

  waitForReadiness(probe: LocalHttpReadinessProbe): Promise<ManagedProcessReadinessResult>;
  waitForExit(): Promise<ManagedProcessExitResult>;
  stop(options?: { gracePeriodMs?: number }): Promise<ManagedProcessStopResult>;

  /**
   * Bounded diagnostic tail of the most recent output. The files at
   * `stdoutPath`/`stderrPath` remain the canonical, untruncated logs.
   */
  readRecentOutput(): ManagedProcessOutputTail;
};

/**
 * Thrown by `startManagedProcess` when the spec cannot produce a process at all.
 *
 * Start-time problems throw because there is no handle to return. Runtime states
 * a caller is expected to handle -- readiness timeout, the child exiting before
 * readiness, an invalid probe -- are returned as structured results instead.
 */
export class ManagedProcessStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagedProcessStartError";
  }
}

export async function startManagedProcess(spec: ManagedProcessSpec): Promise<ManagedProcessHandle> {
  const id = validateProcessId(spec.id);
  const executable = typeof spec.executable === "string" ? spec.executable.trim() : "";
  if (executable.length === 0) {
    throw new ManagedProcessStartError("Managed process executable must be a non-empty string.");
  }
  if (typeof spec.cwd !== "string" || spec.cwd.trim().length === 0) {
    throw new ManagedProcessStartError("Managed process cwd must be a non-empty path.");
  }
  if (typeof spec.outDir !== "string" || spec.outDir.trim().length === 0) {
    throw new ManagedProcessStartError("Managed process outDir must be a non-empty path.");
  }

  const cwd = path.resolve(spec.cwd);
  try {
    if (!(await stat(cwd)).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new ManagedProcessStartError(`Managed process cwd is not an existing directory: ${cwd}`);
  }

  const outDir = path.resolve(spec.outDir);
  try {
    await mkdir(outDir, { recursive: true });
  } catch (error) {
    throw new ManagedProcessStartError(
      `Managed process outDir could not be created: ${outDir} (${messageOf(error)})`
    );
  }

  const env: NodeJS.ProcessEnv = { ...process.env, ...spec.env };
  const invocation = resolveCommandInvocation(executable, spec.args ?? [], {
    cwd,
    env,
    allowPowerShellShim: spec.allowPowerShellShim
  });
  if (invocation.resolvedCommand.resolutionKind === "unavailable") {
    const warnings = invocation.resolvedCommand.warnings;
    throw new ManagedProcessStartError(
      `Managed process command is unavailable: ${executable}${
        warnings.length > 0 ? ` (${warnings.join("; ")})` : ""
      }`
    );
  }

  const stdoutPath = path.join(outDir, `${id}.stdout.txt`);
  const stderrPath = path.join(outDir, `${id}.stderr.txt`);

  // stdio ["ignore", "pipe", "pipe"]: stdin is deliberately not held open.
  let child: ChildProcessByStdio<null, Readable, Readable>;
  try {
    child = spawn(invocation.executable, invocation.args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    throw new ManagedProcessStartError(
      `Managed process failed to spawn: ${executable} (${messageOf(error)})`
    );
  }

  let exited = false;
  let exitResult: ManagedProcessExitResult | undefined;
  let spawnError: string | undefined;
  const exitWaiters: Array<(result: ManagedProcessExitResult) => void> = [];

  // Attached before any early return so a spawn failure can never surface as an
  // unhandled 'error' event.
  child.on("error", (error) => {
    spawnError = error.message;
  });

  if (child.pid === undefined) {
    throw new ManagedProcessStartError(
      `Managed process did not start and reported no pid: ${executable}${
        spawnError ? ` (${spawnError})` : ""
      }`
    );
  }
  const pid = child.pid;

  const stdoutStream = createWriteStream(stdoutPath, { flags: "w" });
  const stderrStream = createWriteStream(stderrPath, { flags: "w" });
  // Log-file write errors must not crash the host process; they are recorded and
  // surfaced through the exit result instead.
  stdoutStream.on("error", (error) => {
    spawnError = spawnError ?? `stdout log write failed: ${messageOf(error)}`;
  });
  stderrStream.on("error", (error) => {
    spawnError = spawnError ?? `stderr log write failed: ${messageOf(error)}`;
  });

  const stdoutTail = createBoundedTail();
  const stderrTail = createBoundedTail();

  attachStream(child.stdout, stdoutStream, stdoutTail);
  attachStream(child.stderr, stderrStream, stderrTail);

  child.on("close", (code, signal) => {
    exited = true;
    exitResult = {
      exitCode: code,
      signal: signal ?? null,
      ...(spawnError ? { error: spawnError } : {})
    };
    stdoutStream.end();
    stderrStream.end();
    const finalResult = exitResult;
    for (const waiter of exitWaiters.splice(0)) {
      waiter(finalResult);
    }
  });

  function waitForExit(): Promise<ManagedProcessExitResult> {
    if (exited && exitResult) {
      return Promise.resolve(exitResult);
    }
    return new Promise<ManagedProcessExitResult>((resolve) => {
      exitWaiters.push(resolve);
    });
  }

  async function waitForExitWithin(timeoutMs: number): Promise<ManagedProcessExitResult | undefined> {
    if (exited && exitResult) {
      return exitResult;
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
    });
    try {
      return await Promise.race([waitForExit(), timedOut]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  let stopInFlight: Promise<ManagedProcessStopResult> | undefined;

  async function stop(options?: { gracePeriodMs?: number }): Promise<ManagedProcessStopResult> {
    if (exited && exitResult) {
      return { status: "already-exited", exit: exitResult };
    }
    if (stopInFlight) {
      return stopInFlight;
    }
    const gracePeriodMs = options?.gracePeriodMs ?? MANAGED_PROCESS_DEFAULT_GRACE_PERIOD_MS;
    const pending = (async (): Promise<ManagedProcessStopResult> => {
      requestProcessTermination(pid);
      const gracefulExit = await waitForExitWithin(Math.max(0, gracePeriodMs));
      if (gracefulExit) {
        return { status: "stopped", exit: gracefulExit };
      }
      // Escalation only: SIGKILL here is safe because the graceful SIGTERM grace
      // period has already elapsed. On Windows this is taskkill /T /F.
      forceTerminateProcess(pid, { posixSignal: "SIGKILL" });
      return { status: "forced", exit: await waitForExit() };
    })();
    stopInFlight = pending;
    try {
      return await pending;
    } finally {
      stopInFlight = undefined;
    }
  }

  async function waitForReadiness(
    probe: LocalHttpReadinessProbe
  ): Promise<ManagedProcessReadinessResult> {
    const startedAt = Date.now();
    const validation = validateReadinessProbe(probe);
    if (!validation.ok) {
      return {
        status: "probe-failed",
        url: typeof probe?.url === "string" ? probe.url : "",
        attempts: 0,
        elapsedMs: Date.now() - startedAt,
        error: validation.error
      };
    }

    const { url, acceptedStatusMin, acceptedStatusMax, intervalMs } = validation;
    let attempts = 0;
    let lastStatusCode: number | undefined;
    let lastError: string | undefined;

    for (;;) {
      if (exited) {
        return {
          status: "process-exited",
          url: probe.url,
          attempts,
          elapsedMs: Date.now() - startedAt,
          ...(lastStatusCode !== undefined ? { lastStatusCode } : {}),
          error: `Managed process "${id}" exited before readiness was reached.`
        };
      }

      const remainingMs = probe.timeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        return {
          status: "timeout",
          url: probe.url,
          attempts,
          elapsedMs: Date.now() - startedAt,
          ...(lastStatusCode !== undefined ? { lastStatusCode } : {}),
          ...(lastError ? { error: lastError } : {})
        };
      }

      attempts += 1;
      const requestTimeoutMs = Math.max(
        1,
        Math.min(probe.requestTimeoutMs ?? MANAGED_PROCESS_DEFAULT_REQUEST_TIMEOUT_MS, remainingMs)
      );

      try {
        const response = await fetch(url, {
          // "manual" keeps a 3xx observable as a 3xx: a redirect is a legitimate
          // sign of a live server and is accepted by the default 200..399 range.
          redirect: "manual",
          signal: AbortSignal.timeout(requestTimeoutMs)
        });
        lastStatusCode = response.status;
        await response.body?.cancel().catch(() => undefined);
        if (response.status >= acceptedStatusMin && response.status <= acceptedStatusMax) {
          return {
            status: "ready",
            url: probe.url,
            attempts,
            elapsedMs: Date.now() - startedAt,
            lastStatusCode: response.status
          };
        }
        lastError = `Readiness probe received status ${response.status}.`;
      } catch (error) {
        // Connection refused / socket reset / per-attempt abort are all expected
        // while a local server is still starting, so they are retried.
        lastError = messageOf(error);
      }

      const remainingAfterAttempt = probe.timeoutMs - (Date.now() - startedAt);
      if (remainingAfterAttempt <= 0) {
        continue;
      }
      await delay(Math.min(intervalMs, remainingAfterAttempt));
    }
  }

  return Object.freeze({
    id,
    pid,
    executable: invocation.executable,
    args: Object.freeze([...invocation.args]),
    cwd,
    stdoutPath,
    stderrPath,
    resolvedCommand: invocation.resolvedCommand,
    waitForReadiness,
    waitForExit,
    stop,
    readRecentOutput: (): ManagedProcessOutputTail => ({
      stdout: stdoutTail.read(),
      stderr: stderrTail.read(),
      truncated: stdoutTail.truncated() || stderrTail.truncated()
    })
  });
}

type ReadinessProbeValidation =
  | { ok: false; error: string }
  | {
      ok: true;
      url: string;
      acceptedStatusMin: number;
      acceptedStatusMax: number;
      intervalMs: number;
    };

/**
 * Readiness is a bounded local-server liveness check, not a general network
 * fetch primitive: only http/https to a loopback host is permitted.
 */
function validateReadinessProbe(probe: LocalHttpReadinessProbe): ReadinessProbeValidation {
  if (!probe || probe.kind !== "http") {
    return { ok: false, error: 'Readiness probe kind must be "http".' };
  }
  if (typeof probe.url !== "string" || probe.url.trim().length === 0) {
    return { ok: false, error: "Readiness probe url must be a non-empty string." };
  }
  if (!Number.isFinite(probe.timeoutMs) || probe.timeoutMs <= 0) {
    return { ok: false, error: "Readiness probe timeoutMs must be a positive number." };
  }

  let parsed: URL;
  try {
    parsed = new URL(probe.url);
  } catch {
    return { ok: false, error: `Readiness probe url is not a valid URL: ${probe.url}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: `Readiness probe protocol must be http: or https:, received ${parsed.protocol}`
    };
  }
  // URL parsing renders an IPv6 host as "[::1]"; compare on the unbracketed form.
  const hostname = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (!ALLOWED_READINESS_HOSTS.has(hostname)) {
    return {
      ok: false,
      error: `Readiness probe host must be loopback (localhost, 127.0.0.1, ::1), received ${parsed.hostname}`
    };
  }

  const acceptedStatusMin = probe.acceptedStatusMin ?? MANAGED_PROCESS_DEFAULT_ACCEPTED_STATUS_MIN;
  const acceptedStatusMax = probe.acceptedStatusMax ?? MANAGED_PROCESS_DEFAULT_ACCEPTED_STATUS_MAX;
  if (!Number.isFinite(acceptedStatusMin) || !Number.isFinite(acceptedStatusMax)) {
    return { ok: false, error: "Readiness probe accepted status range must be numeric." };
  }
  if (acceptedStatusMin > acceptedStatusMax) {
    return {
      ok: false,
      error: `Readiness probe accepted status range is inverted: ${acceptedStatusMin}..${acceptedStatusMax}`
    };
  }

  const intervalMs = probe.intervalMs ?? MANAGED_PROCESS_DEFAULT_READINESS_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    return { ok: false, error: "Readiness probe intervalMs must be a non-negative number." };
  }

  return { ok: true, url: parsed.href, acceptedStatusMin, acceptedStatusMax, intervalMs };
}

function validateProcessId(id: string): string {
  const trimmed = typeof id === "string" ? id.trim() : "";
  if (trimmed.length === 0) {
    throw new ManagedProcessStartError("Managed process id must be a non-empty string.");
  }
  // The id becomes a log file name, so it must stay a single path segment.
  if (trimmed !== path.basename(trimmed) || trimmed === "." || trimmed === "..") {
    throw new ManagedProcessStartError(
      `Managed process id must be a single path segment without separators: ${id}`
    );
  }
  return trimmed;
}

type BoundedTail = {
  push(chunk: Buffer): void;
  read(): string;
  truncated(): boolean;
};

function createBoundedTail(limitBytes = MANAGED_PROCESS_CAPTURE_LIMIT_BYTES): BoundedTail {
  let buffer = Buffer.alloc(0);
  let dropped = false;
  return {
    push(chunk: Buffer): void {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > limitBytes) {
        buffer = buffer.subarray(buffer.length - limitBytes);
        dropped = true;
      }
    },
    read(): string {
      return buffer.toString("utf8");
    },
    truncated(): boolean {
      return dropped;
    }
  };
}

function attachStream(source: NodeJS.ReadableStream, sink: WriteStream, tail: BoundedTail): void {
  source.on("data", (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    tail.push(buffer);
    // Written as it arrives: a managed process may live for minutes and its log
    // must be readable while it runs.
    sink.write(buffer);
  });
  source.on("error", () => undefined);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
