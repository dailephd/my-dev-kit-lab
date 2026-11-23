import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readRepositoryIdentity } from "../../evaluation/localRepositorySubject/gitRepository.js";
import type { ProjectInventorySnapshot } from "./projectInventory.js";

export function describeAuditFile(filename: string) {
  if (!fs.statSync(filename).isFile()) throw new Error(`Cannot hash a non-regular audit artifact: ${filename}`);
  const file = fs.openSync(filename, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytes = 0;
    for (let count; (count = fs.readSync(file, buffer, 0, buffer.length, null)) > 0;) {
      hash.update(buffer.subarray(0, count));
      bytes += count;
    }
    return { path: filename, bytes, sha256: hash.digest("hex") };
  } finally {
    fs.closeSync(file);
  }
}

export type AuditExecutionReceipt = ReturnType<typeof reserveAuditExecution>;

const JOURNAL_DIRECTORY = "receipt-journal-v1";
const JOURNAL_LIMIT = 64 * 1024 * 1024;
const JOURNAL_HEADER_LIMIT = 2048;
const JOURNAL_SEAL_SPACE = 512;
const JOURNAL_MODE = "MY_DEV_KIT_LAB_RECEIPT_JOURNAL_V1";
const RECEIPT_NAME = /^[a-z0-9][a-z0-9-]{0,159}$/;
const JOURNAL_NAME = /^kit-(logical|stream)-(0|[1-9][0-9]*)$/;
const SHA256 = /^[a-f0-9]{64}$/;

type Digest = { bytes: number; sha256: string };
type Checkpoint = Digest & { path: string };
type Segment = Digest & { file: string; records: number };
type RequestIdentity = { selector: string; requestSha256: string };
type JournalRecord = Digest & {
  type: "receipt"; sequence: number; name: string; previous: string | null;
  request?: RequestIdentity;
};
type JournalSeal = { type: "seal"; executionId: string; segment: number; records: number; head: string };
type JournalManifest = {
  version: 1; executionId: string; state: "sealed"; records: number; head: string | null;
  segments: Segment[]; terminal: Digest & { name: "outcome" | "failure" };
};

function digest(bytes: Buffer): Digest {
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function sameDigest(actual: Digest, expected: Digest) {
  return actual.bytes === expected.bytes && actual.sha256 === expected.sha256;
}

function journalCheck(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid audit receipt evidence: ${message}`);
}

function physical(location: string, directory = false) {
  const info = fs.lstatSync(location);
  journalCheck((directory ? info.isDirectory() : info.isFile() && info.nlink === 1) &&
    path.relative(location, fs.realpathSync(location)) === "", "unexpected file or directory identity");
  return info;
}

function serializeReceipt(id: string, value: unknown, checkpoints?: readonly Checkpoint[]) {
  return Buffer.from(JSON.stringify({ schemaVersion: "1.0.0", executionId: id, evidence: value,
    ...(checkpoints && { checkpoints }) }, null, 2) + "\n");
}

function writeDurable(filename: string, bytes: Buffer | (() => Buffer)) {
  const fd = fs.openSync(filename, "wx", 0o600);
  try {
    fs.writeFileSync(fd, typeof bytes === "function" ? bytes() : bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function encodeHeader(header: JournalRecord | JournalSeal) {
  const json = Buffer.from(JSON.stringify(header));
  journalCheck(json.length <= JOURNAL_HEADER_LIMIT, "oversized record header");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(json.length);
  return Buffer.concat([length, json]);
}

function segmentName(index: number) {
  return `segment-${String(index).padStart(8, "0")}.bin`;
}

function openReceiptJournal(directory: string, executionId: string) {
  const root = path.join(directory, JOURNAL_DIRECTORY);
  fs.mkdirSync(root, { mode: 0o700 });
  const segments: Segment[] = [];
  let active: { fd: number; file: string; bytes: number; records: number; hash: ReturnType<typeof createHash> } | undefined;
  let records = 0;
  let head: string | null = null;

  function appendBytes(bytes: Buffer) {
    const segment = active!;
    fs.writeFileSync(segment.fd, bytes);
    fs.fsyncSync(segment.fd);
    segment.hash.update(bytes);
    segment.bytes += bytes.length;
  }

  function sealSegment() {
    const segment = active;
    if (!segment) return;
    const seal = encodeHeader({ type: "seal", executionId, segment: segments.length, records: segment.records, head: head! });
    journalCheck(seal.length <= JOURNAL_SEAL_SPACE, "oversized segment seal");
    try { appendBytes(seal); }
    finally {
      active = undefined;
      fs.closeSync(segment.fd);
    }
    const descriptor = { file: segment.file, records: segment.records, bytes: segment.bytes, sha256: segment.hash.digest("hex") };
    const filename = path.join(root, segment.file);
    physical(root, true);
    physical(filename);
    journalCheck(sameDigest(describeAuditFile(filename), descriptor), "segment changed before sealing");
    segments.push(descriptor);
  }

  return {
    append(name: string, payload: Buffer, content: Digest, request?: RequestIdentity) {
      const header = encodeHeader({ type: "receipt", sequence: records + 1, name, previous: head, ...content,
        ...(request && { request }) });
      const length = header.length + payload.length;
      journalCheck(length + JOURNAL_SEAL_SPACE <= JOURNAL_LIMIT, "receipt exceeds segment ceiling");
      if (active && active.bytes + length + JOURNAL_SEAL_SPACE > JOURNAL_LIMIT) sealSegment();
      if (!active) {
        physical(root, true);
        const file = segmentName(segments.length);
        const fd = fs.openSync(path.join(root, file), "wx", 0o600);
        active = { fd, file, bytes: 0, records: 0, hash: createHash("sha256") };
      }
      appendBytes(Buffer.concat([header, payload], length));
      active.records++;
      records++;
      head = createHash("sha256").update(header).update(payload).digest("hex");
    },
    seal(terminal: JournalManifest["terminal"]) {
      sealSegment();
      physical(root, true);
      const manifest: JournalManifest = { version: 1, executionId, state: "sealed", records, head, segments, terminal };
      writeDurable(path.join(root, "manifest.json"), Buffer.from(JSON.stringify(manifest) + "\n"));
    },
    publish() {
      physical(root, true);
      // Create the marker only after every segment, the manifest and the
      // terminal checkpoint have passed their own fsync.
      writeDurable(path.join(root, "sealed"), Buffer.alloc(0));
    },
    abandon() {
      const segment = active;
      active = undefined;
      if (segment) fs.closeSync(segment.fd);
    },
  };
}

export function reserveAuditExecution(workspace: string, target: string, retryOf?: string, isSelf = false) {
  const mode = process.env[JOURNAL_MODE];
  if (mode !== undefined && mode !== "1") throw new Error(`Invalid ${JOURNAL_MODE} value.`);
  const base = fs.realpathSync(workspace);
  const targetRoot = fs.realpathSync(target);
  let parent = base;
  for (const segment of ["lab-output", "evidence"]) {
    parent = path.join(parent, segment);
    if (!isSelf || targetRoot !== base) {
      const relative = path.relative(targetRoot, parent);
      if (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep)) {
        throw new Error("Audit evidence destination is inside the inspected target.");
      }
    }
    try { fs.mkdirSync(parent, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    if (!fs.lstatSync(parent).isDirectory() || path.relative(parent, fs.realpathSync(parent)) !== "") {
      throw new Error("Audit evidence destination must be a physical directory within the Lab workspace.");
    }
  }
  if (retryOf && !/^audit-[0-9a-f-]{36}$/.test(retryOf)) throw new Error("Invalid prior audit execution ID.");
  if (retryOf && !fs.lstatSync(path.join(parent, retryOf, "initial.json")).isFile()) {
    throw new Error("Prior audit execution receipt is unavailable.");
  }
  const id = "audit-" + randomUUID();
  const directory = path.join(parent, id);
  fs.mkdirSync(directory, { mode: 0o700 });
  const journal = mode === "1" ? openReceiptJournal(directory, id) : undefined;
  let stage = "initialization";
  let journalState: "open" | "sealed" | "failed" = "open";
  const checkpoints: Checkpoint[] = [];
  const names = new Set<string>();
  function write(name: string, value: unknown, request?: RequestIdentity) {
    const filename = path.join(directory, name + ".json");
    const terminal = name === "outcome" || name === "failure";
    if (!journal) {
      writeDurable(filename, () => serializeReceipt(id, value, terminal ? checkpoints : undefined));
      checkpoints.push(describeAuditFile(filename));
      return;
    }
    journalCheck(journalState === "open", "journal is no longer writable");
    try {
      journalCheck(RECEIPT_NAME.test(name) && !names.has(name), "invalid or duplicate receipt name");
      physical(directory, true);
      const bytes = serializeReceipt(id, value, terminal ? checkpoints : undefined);
      if (terminal) {
        journal.seal({ name, ...digest(bytes) });
        writeDurable(filename, bytes);
        journal.publish();
        journalState = "sealed";
      } else if (JOURNAL_NAME.test(name)) {
        const content = digest(bytes);
        journal.append(name, bytes, content, request);
        checkpoints.push({ path: filename, ...content });
      } else {
        writeDurable(filename, bytes);
        checkpoints.push(describeAuditFile(filename));
      }
      names.add(name);
    } catch (error) {
      journalState = "failed";
      try { journal.abandon(); }
      catch (closeError) { throw new AggregateError([error, closeError], "Audit receipt generation failed"); }
      throw error;
    }
  }
  return {
    id, directory, retryOf: retryOf ?? null, write,
    journalEnabled: journal !== undefined,
    setStage(value: string) { stage = value; },
    get stage() { return stage; },
  };
}

type ReplayEntry = JournalRecord & { filename: string; offset: number };
const STREAM_EVENTS = new Set(["ready", "frame-sent", "frame-complete", "frame-incomplete", "retiring", "closed", "failed"]);

function receiptObject(bytes: Buffer, id: string): { evidence: Record<string, unknown>; checkpoints?: Checkpoint[] } {
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  journalCheck(value?.schemaVersion === "1.0.0" && value.executionId === id && Object.hasOwn(value, "evidence"),
    "receipt envelope identity");
  return value;
}

function readJournalFile(filename: string, limit: number) {
  const info = physical(filename);
  journalCheck(info.size <= limit, "oversized journal file");
  const file = fs.openSync(filename, "r");
  try {
    const opened = fs.fstatSync(file);
    journalCheck(opened.dev === info.dev && opened.ino === info.ino && opened.size === info.size && opened.nlink === 1,
      "journal file was replaced");
    const bytes = Buffer.alloc(info.size);
    readExactly(file, bytes, 0);
    journalCheck(fs.fstatSync(file).size === info.size, "journal file size changed");
    return bytes;
  } finally {
    fs.closeSync(file);
  }
}

function readExactly(file: number, bytes: Buffer, position: number) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.readSync(file, bytes, offset, bytes.length - offset, position + offset);
    journalCheck(count > 0, "truncated record");
    offset += count;
  }
}

function replayJournal(root: string, id: string, manifest: JournalManifest) {
  journalCheck(manifest?.version === 1 && manifest.executionId === id && manifest.state === "sealed" &&
    Array.isArray(manifest.segments), "journal seal identity");
  const files = fs.readdirSync(root);
  journalCheck(files.length === manifest.segments.length + 2 && files.includes("manifest.json") && files.includes("sealed"),
    "journal file set or completion marker differs");
  journalCheck(physical(path.join(root, "sealed")).size === 0, "invalid completion marker");
  const entries = new Map<string, ReplayEntry>();
  const sent = new Set<string>();
  const pending = new Map<string, { id: string; selector: unknown }>();
  let streamSequence = 0;
  let logicalSequence: number | undefined;
  let head: string | null = null;

  for (const [index, segment] of manifest.segments.entries()) {
    journalCheck(segment?.file === segmentName(index) && Number.isSafeInteger(segment.records) && segment.records > 0,
      "segment sequence");
    const filename = path.join(root, segment.file);
    const bytes = readJournalFile(filename, JOURNAL_LIMIT);
    journalCheck(sameDigest(digest(bytes), segment), "physical segment digest differs");
    let offset = 0;
    for (let count = 0; count <= segment.records; count++) {
      const start = offset;
      journalCheck(offset + 4 <= bytes.length, "missing header or seal");
      const headerLength = bytes.readUInt32LE(offset);
      journalCheck(headerLength > 0 && headerLength <= JOURNAL_HEADER_LIMIT && offset + 4 + headerLength <= bytes.length,
        "invalid record header length");
      offset += 4 + headerLength;
      const header: JournalRecord | JournalSeal = JSON.parse(bytes.toString("utf8", start + 4, offset));
      journalCheck(header && encodeHeader(header).equals(bytes.subarray(start, offset)), "noncanonical record header");
      if (count === segment.records) {
        journalCheck(header.type === "seal" && header.executionId === id && header.segment === index &&
          header.records === count && header.head === head && offset === bytes.length, "invalid segment seal");
        break;
      }
      journalCheck(header.type === "receipt" && header.sequence === entries.size + 1 && header.previous === head &&
        !entries.has(header.name) && Number.isSafeInteger(header.bytes) && header.bytes > 0 &&
        offset + header.bytes <= bytes.length, "record identity, length or sequence differs");
      const match = JOURNAL_NAME.exec(header.name);
      journalCheck(match, "unknown logical receipt name");
      const sequence = Number(match[2]);
      journalCheck(Number.isSafeInteger(sequence), "invalid original receipt sequence");
      const payload = bytes.subarray(offset, offset + header.bytes);
      journalCheck(sameDigest(digest(payload), header), "logical payload digest differs");
      const { evidence } = receiptObject(payload, id);
      journalCheck(payload.equals(serializeReceipt(id, evidence)), "invalid logical receipt envelope");
      journalCheck(evidence?.family === "source" || evidence?.family === "lookup", "invalid receipt family");
      if (match[1] === "logical") {
        journalCheck(typeof evidence.kind === "string" && header.request && typeof header.request.selector === "string" &&
          SHA256.test(header.request.requestSha256), "missing logical request identity");
        journalCheck(logicalSequence === undefined || sequence === logicalSequence + 1 ||
          (logicalSequence < 1_000_000 && sequence >= 1_000_000), "logical request sequence differs");
        logicalSequence = sequence;
      } else {
        journalCheck(sequence === ++streamSequence && typeof evidence.type === "string" && STREAM_EVENTS.has(evidence.type),
          "stream event sequence or kind differs");
        const family = evidence.family;
        if (evidence.type === "frame-sent") {
          journalCheck(typeof evidence.requestId === "string" && /^[1-9][0-9]*$/.test(evidence.requestId) &&
            !sent.has(evidence.requestId) && !pending.has(family) && typeof evidence.selector === "string" &&
            typeof evidence.inputSha256 === "string" && SHA256.test(evidence.inputSha256), "invalid frame send");
          sent.add(evidence.requestId);
          pending.set(family, { id: evidence.requestId, selector: evidence.selector });
        } else if (evidence.type === "frame-complete" || evidence.type === "frame-incomplete") {
          const frame = pending.get(family);
          journalCheck(frame && frame.id === evidence.requestId && frame.selector === evidence.selector, "unmatched frame result");
          pending.delete(family);
        }
      }
      entries.set(header.name, { ...header, filename, offset });
      offset += header.bytes;
      head = createHash("sha256").update(bytes.subarray(start, offset)).digest("hex");
    }
  }
  journalCheck(manifest.records === entries.size && manifest.head === head, "journal completion differs");
  return entries;
}

/**
 * Reopen a completed execution and verify its persisted checkpoint list. Qualification
 * callers bind the terminal digest to independent run evidence and require a journal.
 */
export function verifyAuditExecutionReceipts(directory: string, options?: {
  terminalSha256?: string; journalManifestSha256?: string; requireJournal?: boolean;
}) {
  directory = path.resolve(directory);
  physical(directory, true);
  const id = path.basename(directory);
  journalCheck(/^audit-[0-9a-f-]{36}$/.test(id), "invalid execution directory name");
  const files = fs.readdirSync(directory);
  const outcomes = ["outcome", "failure"] as const;
  const terminals = outcomes.filter(name => files.includes(name + ".json"));
  journalCheck(terminals.length === 1, "exactly one terminal receipt is required");
  const terminal = terminals[0]!;
  const filename = path.join(directory, terminal + ".json");
  physical(filename);
  const terminalBytes = fs.readFileSync(filename);
  const terminalDigest = digest(terminalBytes);
  journalCheck(options?.terminalSha256 === undefined || options.terminalSha256 === terminalDigest.sha256, "terminal digest differs");
  const checkpoints = receiptObject(terminalBytes, id).checkpoints;
  journalCheck(Array.isArray(checkpoints), "missing checkpoint list");
  const root = path.join(directory, JOURNAL_DIRECTORY);
  let evidence: JournalManifest | undefined;
  let journalManifest: Checkpoint | undefined;
  let journal = new Map<string, ReplayEntry>();
  if (files.includes(JOURNAL_DIRECTORY)) {
    physical(root, true);
    const manifestPath = path.join(root, "manifest.json");
    const bytes = readJournalFile(manifestPath, JOURNAL_LIMIT);
    journalManifest = { path: manifestPath, ...digest(bytes) };
    journalCheck(options?.journalManifestSha256 === undefined ||
      options.journalManifestSha256 === journalManifest.sha256, "manifest digest differs");
    const manifest: JournalManifest = JSON.parse(bytes.toString("utf8"));
    journalCheck(manifest?.terminal?.name === terminal && sameDigest(terminalDigest, manifest.terminal), "terminal seal differs");
    journal = replayJournal(root, id, manifest);
    evidence = manifest;
  } else {
    journalCheck(!options?.requireJournal && options?.journalManifestSha256 === undefined, "journal is required");
  }

  const receipts = new Map<string, Checkpoint>();
  let sequence = 0;
  for (const checkpoint of checkpoints) {
    journalCheck(checkpoint && typeof checkpoint.path === "string", "invalid checkpoint");
    const name = path.basename(checkpoint.path, ".json");
    journalCheck(RECEIPT_NAME.test(name) && checkpoint.path === path.join(directory, name + ".json") &&
      !receipts.has(name) && !outcomes.some(value => value === name), "invalid or duplicate checkpoint path");
    const entry = journal.get(name);
    if (entry) {
      journalCheck(entry.sequence === ++sequence && sameDigest(entry, checkpoint) && !files.includes(name + ".json"),
        "journal checkpoint reference differs");
    } else {
      journalCheck(!evidence || !JOURNAL_NAME.test(name), "missing journal record");
      physical(checkpoint.path);
      journalCheck(sameDigest(describeAuditFile(checkpoint.path), checkpoint), "checkpoint digest differs");
    }
    receipts.set(name, checkpoint);
  }
  journalCheck(sequence === journal.size, "unreferenced journal record");

  return {
    terminal,
    terminalDigest,
    checkpoints,
    journal: evidence && { manifest: journalManifest!, segments: evidence.segments, records: evidence.records },
    read(name: string) {
      const checkpoint = receipts.get(name);
      journalCheck(checkpoint, "unknown checkpoint");
      const entry = journal.get(name);
      let bytes: Buffer;
      if (entry) {
        physical(entry.filename);
        const file = fs.openSync(entry.filename, "r");
        try {
          bytes = Buffer.alloc(entry.bytes);
          readExactly(file, bytes, entry.offset);
        } finally {
          fs.closeSync(file);
        }
      } else {
        physical(checkpoint.path);
        bytes = fs.readFileSync(checkpoint.path);
      }
      journalCheck(sameDigest(digest(bytes), checkpoint), "checkpoint changed after replay");
      return bytes;
    },
  };
}

export async function observeAuditSource(inventory: ProjectInventorySnapshot) {
  const root = fs.realpathSync(inventory.scanRoot);
  // Without a root-local Git marker, an export inside another Git worktree
  // must never inherit that surrounding repository's commit or status.
  let gitIdentity: Awaited<ReturnType<typeof readRepositoryIdentity>>["identity"] | null = null;
  let gitStateError: string | null = null;
  if (fs.existsSync(path.join(root, ".git"))) {
    try { gitIdentity = (await readRepositoryIdentity(root)).identity; }
    catch (error) { gitStateError = String(error); }
  }
  return {
    candidateGitSha: gitIdentity?.commit ?? null,
    gitClean: gitIdentity ? !gitIdentity.workingTreeDirty : null,
    gitStateError,
    inventory: inventory.files.map(entry => {
      const filename = path.join(root, entry.relativePath);
      try {
        const real = fs.realpathSync(filename);
        if (path.relative(filename, real) !== "" || !fs.lstatSync(filename).isFile()) {
          throw new Error("File identity changed or resolves through a link");
        }
        const observed = describeAuditFile(filename);
        return { ...observed, path: entry.relativePath, scannedBytes: entry.sizeBytes,
          sizeAgrees: observed.bytes === entry.sizeBytes };
      } catch (error) {
        return { path: entry.relativePath, scannedBytes: entry.sizeBytes, bytes: null, sha256: null, error: String(error) };
      }
    }),
    excludedDirectories: inventory.excludedDirectorySummary,
    skippedFileCount: inventory.skippedFileCount,
    warnings: inventory.warnings,
  };
}

// The parser historically ignores unknown arguments. Never persist them
// verbatim, including values that might have accompanied unknown flags.
export function observedAuditArguments(argv: readonly string[]) {
  const flags = new Set(["--target", "--types", "--include", "--format", "--fail-on", "--out", "--retry-of", "--kit-archive", "--kit-package-root", "--source-export", "--source-snapshot", "--require-source"]);
  let exact = true;
  const args: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]!;
    if (value === "--android") args.push(value);
    else if (flags.has(value) && index + 1 < argv.length) args.push(value, argv[++index]!);
    else { exact = false; args.push("[REDACTED]"); }
  }
  return { args, exact };
}
