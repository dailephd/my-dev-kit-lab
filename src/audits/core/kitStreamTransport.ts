import type { MeasuredCommandInteraction, MeasuredCommandResult } from "../../core/runMeasuredCommand.js";
import { type KitBatchFamily, type KitBatchSelector, validateKitBatchResponse } from "./kitBatchTransport.js";
import { KitSourceEvidenceAcquisitionError, sha256Hex } from "./kitSourceEvidence.js";

const MAX_INPUT = 64 * 1024;
const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_PENDING = 512;
const MAX_FRAMES = 8192;
// Retire cleanly ahead of the producer’s 60-second idle limit.
const IDLE_RETIRE_MS = 45_000;

type Pipe = Parameters<MeasuredCommandInteraction["onStart"]>[0];
type Job = {
  requestId: string; item: KitBatchSelector & { id: string }; bytes: Buffer;
  resolve: (value: unknown) => void; reject: (error: unknown) => void;
};
type Active = Job & { timer: NodeJS.Timeout };
type Session = {
  family: KitBatchFamily;
  controller: AbortController;
  frames: number;
  chunks: Buffer[];
  buffered: number;
  pipe?: Pipe;
  active?: Active;
  timeout?: NodeJS.Timeout;
  idle?: NodeJS.Timeout;
  closing: boolean;
  expectedExit: 0 | 2;
  done: Promise<void>;
};

export type KitStreamEvent = {
  family: KitBatchFamily;
  type: "ready" | "frame-sent" | "frame-complete" | "frame-incomplete" | "retiring" | "closed" | "failed";
  pid?: number;
  requestId?: string;
  selector?: KitBatchSelector["selector"];
  inputSha256?: string;
  requestBytes?: number;
  responseBytes?: number;
  pending?: number;
  exit?: number | null;
  reason?: string;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KitSourceEvidenceAcquisitionError("artifact-invalid", "Kit session response is not a JSON object.");
  }
  return value as Record<string, unknown>;
}
function transportError(message: string): KitSourceEvidenceAcquisitionError {
  return new KitSourceEvidenceAcquisitionError("subprocess-failed", message);
}

/** One ordered frame in flight per family and no persisted response cache. */
export function createKitStreamTransport(options: {
  identity: { snapshotId: string; selectionFingerprint: string };
  signal: AbortSignal;
  frameLimit?: number;
  timeoutMs?: number;
  launch: (family: KitBatchFamily, interaction: MeasuredCommandInteraction, signal: AbortSignal) => Promise<MeasuredCommandResult>;
  itemError: (code: string) => Error;
  observe?: (event: KitStreamEvent) => void;
}) {
  const limit = options.frameLimit ?? MAX_FRAMES;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_FRAMES ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new RangeError("Invalid Kit session bounds.");
  }

  const sessions = new Map<KitBatchFamily, Session>();
  const queues: Record<KitBatchFamily, Job[]> = { lookup: [], source: [] };
  let poisoned: unknown;
  let closing = false;
  let next = 0;
  let pending = 0;
  let closePromise: Promise<void> | undefined;
  const emit = (family: KitBatchFamily, event: Omit<KitStreamEvent, "family">) => {
    try { options.observe?.({ family, ...event }); }
    catch (error) { fail(error); }
  };

  function takeActive(session: Session): Active | undefined {
    const active = session.active;
    session.active = undefined;
    if (active) {
      clearTimeout(active.timer);
      pending--;
    }
    return active;
  }

  function fail(error: unknown, family?: KitBatchFamily): void {
    if (poisoned !== undefined) return;
    poisoned = error ?? transportError("Kit session failed.");
    for (const queue of Object.values(queues)) {
      for (const job of queue.splice(0)) { pending--; job.reject(poisoned); }
    }
    for (const session of sessions.values()) {
      takeActive(session)?.reject(poisoned);
      clearTimeout(session.timeout);
      clearTimeout(session.idle);
      session.chunks = [];
      session.controller.abort();
    }
    if (family) emit(family, { type: "failed", reason: poisoned instanceof Error ? poisoned.message : "Kit session failed." });
  }

  function retire(session: Session, reason: "idle" | "frame-limit" | "dispose"): void {
    if (session.closing) return;
    session.closing = true;
    clearTimeout(session.idle);
    emit(session.family, { type: "retiring", reason });
    session.pipe?.end();
    session.timeout = setTimeout(() => fail(transportError("Kit session did not settle after EOF."), session.family), 4000);
  }

  function receive(session: Session, chunk: Buffer): void {
    if (poisoned !== undefined) return;
    try {
      const active = session.active;
      if (!active) throw transportError("Unsolicited Kit session stdout.");
      const newline = chunk.indexOf(10);
      const end = newline < 0 ? chunk.length : newline;
      session.buffered += end;
      if (session.buffered + 1 > MAX_OUTPUT) {
        throw new KitSourceEvidenceAcquisitionError("output-limit", "Kit session response exceeded 8 MiB.");
      }
      session.chunks.push(chunk.subarray(0, end));
      if (newline < 0) return;
      if (newline !== chunk.length - 1) throw transportError("Extra stdout after the Kit response frame.");

      const body = Buffer.concat(session.chunks, session.buffered);
      const responseBytes = body.length + 1;
      session.chunks = [];
      session.buffered = 0;
      const raw = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
      if (Object.keys(raw).length !== 4 || raw.schemaVersion !== "1.0.0" || raw.requestId !== active.requestId ||
          (raw.status !== "complete" && raw.status !== "incomplete")) {
        throw new KitSourceEvidenceAcquisitionError("artifact-invalid", "Kit session response identity or status mismatch.");
      }
      const complete = raw.status === "complete";
      let result: { response: unknown } | { code: string };
      if (!complete && Object.hasOwn(raw, "error")) {
        const error = record(raw.error);
        if (Object.hasOwn(raw, "batch") || Object.keys(error).length !== 2 ||
            typeof error.code !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(error.code) || typeof error.fatal !== "boolean") {
          throw transportError("Malformed Kit session error frame.");
        }
        if (error.fatal || error.code !== "AUDIT_BATCH_OUTPUT_LIMIT") {
          throw transportError("Kit session rejected its frame (" + error.code + ").");
        }
        result = { code: error.code };
      } else {
        if (!Object.hasOwn(raw, "batch")) throw transportError("Kit session omitted its batch envelope.");
        result = validateKitBatchResponse(raw.batch, complete ? 0 : 2, {
          family: session.family, bytes: active.bytes, count: 1,
        }, options.identity, [active.item])[0]!;
      }

      emit(session.family, { type: complete ? "frame-complete" : "frame-incomplete", requestId: active.requestId,
        selector: active.item.selector, responseBytes, ...("code" in result && { reason: result.code }) });
      takeActive(session);
      if ("code" in result) {
        session.expectedExit = 2;
        active.reject(options.itemError(result.code));
      } else {
        active.resolve(result.response);
      }
      if (poisoned === undefined) {
        session.idle = setTimeout(() => retire(session, "idle"), IDLE_RETIRE_MS);
        queueMicrotask(() => pump(session.family));
      }
    } catch (error) {
      fail(error instanceof SyntaxError || error instanceof TypeError ?
        new KitSourceEvidenceAcquisitionError("invalid-json", "Malformed Kit session UTF-8 JSON response.") : error, session.family);
    }
  }

  function start(family: KitBatchFamily): Session {
    const controller = new AbortController();
    const session: Session = { family, controller, frames: 0, chunks: [], buffered: 0, closing: false,
      expectedExit: 0, done: Promise.resolve() };
    sessions.set(family, session);
    session.timeout = setTimeout(() => fail(transportError("Kit session startup timed out."), family), timeoutMs);
    session.done = Promise.resolve().then(() => options.launch(family, {
      onStart(pipe) {
        clearTimeout(session.timeout);
        session.pipe = pipe;
        if (poisoned !== undefined) return;
        emit(family, { type: "ready", pid: pipe.pid });
        if (closing) retire(session, "dispose");
        else pump(family);
      },
      onStdout: bytes => receive(session, bytes),
      onStderr: () => fail(transportError("Unexpected Kit session stderr."), family),
    }, AbortSignal.any([options.signal, controller.signal]))).then(result => {
      emit(family, { type: "closed", exit: result.exitCode, ...(result.error && { reason: result.error }) });
      if (poisoned === undefined && (!session.closing || session.active || session.buffered ||
          result.exitCode !== session.expectedExit || result.error || result.timedOut || result.outputLimit || result.signal)) {
        fail(transportError(session.buffered ? "Kit session truncated its final response." :
          "Kit session ended unexpectedly (exit " + (result.exitCode ?? "none") + ")."), family);
      }
    }).catch(error => fail(error, family)).finally(() => {
      clearTimeout(session.timeout);
      clearTimeout(session.idle);
      sessions.delete(family);
      if (!closing && poisoned === undefined) pump(family);
    });
    return session;
  }

  function pump(family: KitBatchFamily): void {
    const queue = queues[family];
    if (poisoned !== undefined || closing || !queue.length) return;
    const session = sessions.get(family) ?? start(family);
    if (!session.pipe || session.active || session.closing) return;
    if (session.frames === limit) { retire(session, "frame-limit"); return; }
    clearTimeout(session.idle);
    const job = queue.shift()!;
    const { requestId, item, bytes } = job;
    session.frames++;
    const timer = setTimeout(() => fail(new KitSourceEvidenceAcquisitionError("subprocess-timeout",
      "Kit session frame timed out."), family), timeoutMs);
    session.active = { ...job, timer };
    try {
      emit(family, { type: "frame-sent", requestId, selector: item.selector, requestBytes: bytes.length,
        inputSha256: sha256Hex(bytes), pending });
      void session.pipe.write(Buffer.concat([bytes, Buffer.from("\n")])).catch(error => fail(error, family));
    } catch (error) {
      fail(error, family);
    }
  }

  const abort = () => fail(transportError("Kit session cancelled."));
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();

  return {
    query(family: KitBatchFamily, item: KitBatchSelector): Promise<unknown> {
      if (poisoned !== undefined || closing) return Promise.reject(poisoned ?? transportError("Kit session is closed."));
      if (pending >= MAX_PENDING) return Promise.reject(transportError("Kit session pending request limit reached."));
      const requestId = String(++next);
      const entry = { ...item, id: requestId };
      const bytes = Buffer.from(JSON.stringify({ schemaVersion: "1.0.0", requestId, requests: [entry] }));
      if (bytes.length > MAX_INPUT) return Promise.reject(new KitSourceEvidenceAcquisitionError("output-limit", "Kit session request exceeded 64 KiB."));
      return new Promise((resolve, reject) => {
        pending++;
        queues[family].push({ requestId, item: entry, bytes, resolve, reject });
        pump(family);
      });
    },
    close(): Promise<void> {
      if (closePromise) return closePromise;
      closing = true;
      const graceful = pending === 0 && poisoned === undefined;
      if (pending) abort();
      else if (graceful) for (const session of sessions.values()) if (session.pipe) retire(session, "dispose");
      closePromise = Promise.all([...sessions.values()].map(session => session.done)).then(() => {
        options.signal.removeEventListener("abort", abort);
        if (graceful && poisoned !== undefined) throw poisoned;
      });
      return closePromise;
    },
  };
}

export type KitStreamTransport = ReturnType<typeof createKitStreamTransport>;
