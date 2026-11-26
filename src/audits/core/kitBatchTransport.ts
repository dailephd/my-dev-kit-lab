import { KitSourceEvidenceAcquisitionError, sha256Hex } from "./kitSourceEvidence.js";

const MAX_ITEMS = 32;
const MAX_INPUT = 64 * 1024;
const MAX_PENDING = 512;
const MAX_ACTIVE = 2;

export type KitBatchFamily = "lookup" | "source";
export type KitBatchSelector =
  | { selector: "audit-files"; page: number }
  | ({ selector: "audit-file"; path: string } & (
      { page: number; testModifierProof?: never } | { page: 0; testModifierProof: true }))
  | { selector: "audit-import-target" | "audit-import-domain"; factId: string }
  | { selector: "line-range"; path: string; start: number; end: number; maxLines: number }
  | { selector: "exact-file-occurrence"; path: string; literal: string; context: number }
  | { selector: "exact-file-byte-occurrence"; path: string; needleHex: string };

type Item = KitBatchSelector & { id: string };
export type KitBatchFallback = { inputSha256: string; reason: "incomplete" | "output-limit" };

type Pending = {
  item: Item;
  standalone: (fallback?: KitBatchFallback) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};
export type KitBatchPacket = { family: KitBatchFamily; bytes: Buffer; count: number };
export type KitBatchProcessResult =
  | { exit: 0 | 2; body: unknown }
  | { exit: "producer-output-limit" };

type Identity = { snapshotId: string; selectionFingerprint: string };

function record(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
}

function invalid(message: string): never {
  throw new KitSourceEvidenceAcquisitionError("artifact-invalid", message);
}

function requireKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    invalid("Kit batch response has unexpected or missing fields.");
  }
}

export function validateKitBatchResponse(
  raw: unknown, exit: 0 | 2, packet: KitBatchPacket, identity: Identity, items: readonly Item[],
): Array<{ response: unknown } | { code: string }> {
  const envelope = record(raw);
  if (!envelope) invalid("Kit batch response is not an object.");
  requireKeys(envelope, ["schemaVersion", "mode", "family", "snapshotId", "selectionFingerprint", "inputSha256",
    "requestedCount", "returnedCount", "complete", "results"]);
  if (envelope.schemaVersion !== "1.0.0" || envelope.mode !== "audit-batch" || envelope.family !== packet.family ||
      envelope.snapshotId !== identity.snapshotId || envelope.selectionFingerprint !== identity.selectionFingerprint ||
      envelope.inputSha256 !== sha256Hex(packet.bytes) || envelope.requestedCount !== items.length ||
      envelope.returnedCount !== items.length || envelope.complete !== (exit === 0) ||
      !Array.isArray(envelope.results) || envelope.results.length !== items.length) {
    invalid("Kit batch response identity, result counts or completeness differ from the exact request.");
  }

  const results = envelope.results.map((rawItem: unknown, index: number) => {
    const item = record(rawItem);
    const expected = items[index]!;
    if (!item || item.id !== expected.id || item.selector !== expected.selector) {
      invalid("Kit batch response does not preserve ordered request identity.");
    }
    if (item.status === "ok") {
      requireKeys(item, ["id", "selector", "status", "response"]);
      if (!record(item.response)) invalid("Kit batch item has no selector response.");
      return { response: item.response };
    }
    requireKeys(item, ["id", "selector", "status", "error"]);
    const error = record(item.error);
    if (item.status !== "error" || !error || error.exitCode !== 2 ||
        typeof error.code !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(error.code)) {
      invalid("Kit batch item did not provide a valid typed failure.");
    }
    requireKeys(error, ["code", "exitCode"]);
    return { code: error.code };
  });
  if (results.some(item => "code" in item) !== (exit === 2)) {
    invalid("Kit batch process exit contradicts item statuses.");
  }
  return results;
}

/** A short-lived scheduler for one authenticated index and one producer. */
export function createKitBatchTransport(options: {
  identity: Identity;
  signal: AbortSignal;
  execute: (packet: KitBatchPacket) => Promise<KitBatchProcessResult>;
  itemError: (code: string) => Error;
  fallback?: (packet: KitBatchPacket, count: number, reason: "incomplete" | "output-limit") => void;
}): (family: KitBatchFamily, selector: KitBatchSelector, standalone: Pending["standalone"]) => Promise<unknown> {
  const queues: Record<KitBatchFamily, Pending[]> = { lookup: [], source: [] };
  let pending = 0;
  let active = 0;
  let nextId = 0;
  let scheduled = false;

  const cancelled = () => new KitSourceEvidenceAcquisitionError("subprocess-failed", "Kit request cancelled.");
  const safeStandalone = async (job: Pending, fallback?: KitBatchFallback) => {
    try {
      options.signal.throwIfAborted();
      const value = await job.standalone(fallback);
      options.signal.throwIfAborted();
      job.resolve(value);
    } catch (error) {
      job.reject(error);
    }
  };
  const packet = (family: KitBatchFamily, jobs: readonly Pending[]): KitBatchPacket => ({
    family, count: jobs.length, bytes: Buffer.from(JSON.stringify({
      schemaVersion: "1.0.0", mode: "audit-batch-request", family,
      expectedSnapshotId: options.identity.snapshotId,
      selectionFingerprint: options.identity.selectionFingerprint, requests: jobs.map(job => job.item),
    }), "utf8"),
  });

  async function run(jobs: readonly Pending[], request: KitBatchPacket) {
    try {
      options.signal.throwIfAborted();
      if (jobs.length === 1) {
        await safeStandalone(jobs[0]!);
        return;
      }
      const process = await options.execute(request);
      options.signal.throwIfAborted();
      if (process.exit === "producer-output-limit") {
        options.fallback?.(request, jobs.length, "output-limit");
        const fallback = { inputSha256: sha256Hex(request.bytes), reason: "output-limit" as const };
        for (const job of jobs) await safeStandalone(job, fallback);
        return;
      }
      const results = validateKitBatchResponse(process.body, process.exit, request, options.identity, jobs.map(job => job.item));
      if (process.exit === 0) {
        jobs.forEach((job, index) => {
          const item = results[index]!;
          if ("response" in item) job.resolve(item.response);
        });
        return;
      }

      // No evidence from an incomplete envelope is delivered. Typed failures
      // remain failures. Each successful-looking sibling gets at most one
      // independently authenticated standalone launch.
      options.fallback?.(request, results.filter(item => "response" in item).length, "incomplete");
      const fallback = { inputSha256: sha256Hex(request.bytes), reason: "incomplete" as const };
      for (const [index, job] of jobs.entries()) {
        const result = results[index]!;
        if ("code" in result) job.reject(options.itemError(result.code));
        else await safeStandalone(job, fallback);
      }
    } catch (error) {
      for (const job of jobs) job.reject(error);
    }
  }

  function pump(): void {
    scheduled = false;
    if (options.signal.aborted) {
      for (const queue of Object.values(queues)) {
        for (const job of queue.splice(0)) job.reject(cancelled());
      }
      pending = 0;
      return;
    }
    while (active < MAX_ACTIVE && pending > 0) {
      const family = queues.lookup.length > 0 ? "lookup" : "source";
      const queue = queues[family];
      const jobs = [queue.shift()!];
      let request = packet(family, jobs);
      while (jobs.length < MAX_ITEMS && queue.length > 0) {
        const candidate = packet(family, [...jobs, queue[0]!]);
        if (candidate.bytes.length > MAX_INPUT) break;
        jobs.push(queue.shift()!);
        request = candidate;
      }
      pending -= jobs.length;
      active += 1;
      void run(jobs, request).finally(() => {
        active -= 1;
        schedule();
      });
    }
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(pump);
  }

  options.signal.addEventListener("abort", schedule, { once: true });
  return (family, selector, standalone) => new Promise((resolve, reject) => {
    if (options.signal.aborted) { reject(cancelled()); return; }
    if (pending === MAX_PENDING) {
      reject(new KitSourceEvidenceAcquisitionError("output-limit", "Kit pending logical request limit exceeded."));
      return;
    }
    queues[family].push({ item: { ...selector, id: String(++nextId) }, standalone, resolve, reject });
    pending += 1;
    schedule();
  });
}
