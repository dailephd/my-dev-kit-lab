import { spawn } from "node:child_process";
import path from "node:path";

export type ForceTerminateProcessOptions = {
  /**
   * Signal used on non-Windows platforms. Defaults to "SIGTERM" because that is
   * the signal the pre-existing runMeasuredCommand timeout path sent, and that
   * behavior must not change. Callers that genuinely need an unblockable kill
   * (for example the managed-process forced-cleanup escalation, which only runs
   * after a graceful SIGTERM grace period has already elapsed) pass "SIGKILL".
   */
  posixSignal?: NodeJS.Signals;
};

/**
 * Asks a process to terminate normally.
 *
 * Sends SIGTERM on every platform. On Windows Node maps SIGTERM to
 * TerminateProcess, so the named process is terminated but its descendants are
 * not; this is a best-effort "please stop" step, not a tree operation.
 *
 * Never throws: the process may already have exited between the caller's
 * liveness check and this call.
 */
export function requestProcessTermination(pid: number | undefined): void {
  if (!pid) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The process may have exited between the liveness check and this signal.
  }
}

export type TerminateProcessTreeOptions = {
  /** Test seam; defaults to the running platform. */
  platform?: NodeJS.Platform;
  /** Signal for the non-Windows branch. Defaults to "SIGKILL". */
  posixSignal?: NodeJS.Signals;
  /** Upper bound for awaiting the Windows `taskkill` helper. Defaults to 5000 ms. */
  waitTimeoutMs?: number;
};

/**
 * Opt-in, awaitable descendant-tree termination for bounded execution
 * (see `terminateProcessTree` in `runMeasuredCommand`). The legacy
 * `forceTerminateProcess` above is intentionally unchanged: it stays
 * fire-and-forget and, off Windows, signals one pid only.
 *
 * Windows: `taskkill /pid <pid> /T /F` (shell:false) is awaited, bounded by
 * `waitTimeoutMs`. Returns false if the command fails or times out.
 *
 * Other platforms: the child must have been spawned `detached` so it leads its
 * own process group; the whole group is signalled via the negative pid. If no
 * group exists, the single pid is signalled as a fallback.
 *
 * Never throws. Returns true only when termination was confirmed (or no PID was supplied).
 */
export async function terminateProcessTree(
  pid: number | undefined,
  options: TerminateProcessTreeOptions = {}
): Promise<boolean> {
  if (!pid) {
    return true;
  }
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return await new Promise<boolean>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      let settled = false;
      const finish = (terminated: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(terminated);
      };
      let killer;
      try {
        const systemRoot = Object.entries(process.env).find(([name]) => name.toLowerCase() === "systemroot")?.[1];
        const taskkill = systemRoot ? path.join(systemRoot, "System32", "taskkill.exe") : "taskkill";
        killer = spawn(taskkill, ["/pid", String(pid), "/T", "/F"], {
          shell: false,
          stdio: "ignore",
          windowsHide: true
        });
      } catch {
        finish(false);
        return;
      }
      timer = setTimeout(() => {
        if (killer.pid) {
          try {
            killer.kill();
          } catch {
            // The bounded helper may already have exited.
          }
        }
        finish(false);
      }, options.waitTimeoutMs ?? 5000);
      killer.on("error", () => finish(false));
      killer.on("close", (code) => finish(code === 0));
    });
  }
  const signal = options.posixSignal ?? "SIGKILL";
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    // No process group for this pid (or it already exited); fall back to the single pid.
  }
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    // The process may have exited between the liveness check and this signal.
    return false;
  }
}

/**
 * Forced cleanup for a process that did not stop on request.
 *
 * Windows: `taskkill /pid <pid> /T /F` with shell:false. `/T` makes this a real
 * descendant-tree termination on Windows.
 *
 * Other platforms: a single `process.kill(pid, signal)` on the known process ID.
 * This deliberately does NOT walk or signal the descendant tree -- no process
 * group or `pgid` traversal is performed here -- so a child that spawned its own
 * grandchildren may leave those grandchildren running. The file name reflects
 * the Windows capability and the shared call site, not a POSIX tree guarantee.
 *
 * Never throws.
 */
export function forceTerminateProcess(
  pid: number | undefined,
  options: ForceTerminateProcessOptions = {}
): void {
  if (!pid) {
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { shell: false, stdio: "ignore" });
    killer.on("error", () => undefined);
    return;
  }
  try {
    process.kill(pid, options.posixSignal ?? "SIGTERM");
  } catch {
    // The process may have exited between the liveness check and this signal.
  }
}
