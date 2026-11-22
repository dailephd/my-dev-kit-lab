import type { KitBatchFallback } from "./kitBatchTransport.js";
import { KitSourceEvidenceAcquisitionError } from "./kitSourceEvidence.js";

export const MAX_KIT_AUDIT_LAUNCHES = 5000;

export type KitLaunchEvent = {
  commandId: string;
  kind: string;
  status: "reserved" | "started" | "failed-to-start" | "completed" | "cancelled" | "refused";
  reservation?: number;
  fallback?: KitBatchFallback;
  exitCode?: number | null;
};

export function createKitLaunchGuard(limit = MAX_KIT_AUDIT_LAUNCHES, signal?: AbortSignal) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_KIT_AUDIT_LAUNCHES) {
    throw new RangeError("Invalid Kit launch budget.");
  }
  let count = 0;
  const closed = new AbortController();
  const cancellation = signal ? AbortSignal.any([closed.signal, signal]) : closed.signal;
  return {
    signal: cancellation,
    close: () => closed.abort(new KitSourceEvidenceAcquisitionError("subprocess-failed", "The per-audit Kit reader is closed.")),
    attempt(commandId: string, kind: string, emit: (event: KitLaunchEvent) => void) {
      let reservation: number | undefined;
      let started = false;
      let finished = false;
      const report = (status: KitLaunchEvent["status"], exitCode?: number | null) =>
        emit({ commandId, kind, status, reservation, exitCode });
      return {
        beforeSpawn() {
          if (cancellation.aborted || count >= limit || reservation !== undefined) {
            report("refused");
            throw new KitSourceEvidenceAcquisitionError("subprocess-failed",
              cancellation.aborted ? "Kit launch refused after cancellation." : "Kit launch budget exhausted before spawn.");
          }
          reservation = ++count;
          report("reserved");
        },
        started() {
          started = true;
          report("started");
        },
        settled(exitCode: number | null, cancelled: boolean) {
          if (finished || reservation === undefined) return;
          finished = true;
          report(cancelled ? "cancelled" : started ? "completed" : "failed-to-start", exitCode);
        },
      };
    },
  };
}

export type KitLaunchGuard = ReturnType<typeof createKitLaunchGuard>;
