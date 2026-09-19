import { spawn } from "node:child_process";

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
