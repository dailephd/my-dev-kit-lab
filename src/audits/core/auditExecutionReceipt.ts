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

export function reserveAuditExecution(workspace: string, target: string, retryOf?: string, isSelf = false) {
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
  let stage = "initialization";
  const checkpoints: ReturnType<typeof describeAuditFile>[] = [];
  function write(name: string, value: unknown) {
    const filename = path.join(directory, name + ".json");
    const fd = fs.openSync(filename, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ schemaVersion: "1.0.0", executionId: id, evidence: value,
        ...(name === "outcome" || name === "failure" ? { checkpoints } : {}) }, null, 2) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    checkpoints.push(describeAuditFile(filename));
  }
  return {
    id, directory, retryOf: retryOf ?? null, write,
    setStage(value: string) { stage = value; },
    get stage() { return stage; },
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
