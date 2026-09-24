import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { relativeWithinRoot, resolveWithinRoot } from "../core/pathSafety.js";
import type { MeasuredCommandResult } from "../core/runMeasuredCommand.js";

export const INDEX_SNAPSHOT_SCHEMA_VERSION = "my-dev-kit-lab-index-snapshot-v1";

const SUPPORTED_MANIFEST_ARTIFACT_KIND = "my-dev-kit-v1-manifest";
const SUPPORTED_MANIFEST_VERSION_PATTERN = /^1\./;
const MANIFEST_FILE = "manifest.json";
const MAX_ARTIFACT_ENTRIES = 512;
const MAX_UNRESOLVED_ENTRIES = 50;
const MAX_REPORTED_PATH_LENGTH = 260;
const HASH_CONCURRENCY = 32;

export type IndexSnapshotStatus = "complete" | "partial" | "unavailable";

export type IndexSnapshotUnavailableCode =
  | "manifest-missing"
  | "manifest-unreadable"
  | "manifest-unsupported"
  | "manifest-target-mismatch"
  | "symbol-index-missing"
  | "symbol-index-unreadable"
  | "symbol-index-unsupported"
  | "indexed-file-count-mismatch"
  | "snapshot-capture-failed";

export type IndexSnapshotUnresolvedReason = "invalid-path" | "outside-target-or-source-roots" | "missing" | "not-a-file" | "unreadable";

/**
 * One file the my-dev-kit index proves it indexed. `sha256` is the content identity for later
 * equality comparison; `modifiedAt` and `sizeBytes` are metadata only and never content identity.
 */
export type IndexSnapshotFileV1 = {
  /** Target-relative, forward-slash path exactly as the index lists it. */
  path: string;
  sha256: string;
  sizeBytes: number;
  modifiedAt: string;
};

export type IndexSnapshotUnresolvedFileV1 = {
  path: string;
  reason: IndexSnapshotUnresolvedReason;
};

/** Generated index artifact inventory entry: relative to the index directory, no contents. */
export type IndexSnapshotArtifactV1 = {
  path: string;
  sizeBytes: number;
};

export type IndexSnapshotV1 = {
  schemaVersion: typeof INDEX_SNAPSHOT_SCHEMA_VERSION;
  /**
   * `complete`: every indexed file was hashed. `partial`: the indexed set is known but some
   * entries could not be hashed (see `unresolvedFiles`). `unavailable`: the required upstream
   * contract could not be interpreted; no indexed-file claim is made.
   */
  status: IndexSnapshotStatus;
  unavailable: { code: IndexSnapshotUnavailableCode; message: string } | null;
  manifest: {
    path: string;
    artifactKind: string;
    schemaVersion: string;
    createdAt: string | null;
    symbolIndexPath: string;
    symbolIndexSchemaVersion: string;
  } | null;
  /** The current my-dev-kit manifest and index build output do not expose the tool version. */
  tool: { name: "my-dev-kit"; version: string | null; availability: "available" | "unavailable"; reason: string | null };
  indexCommand: { commandString: string; executable: string; args: string[] };
  indexedFileCount: number;
  files: IndexSnapshotFileV1[];
  unresolvedFileCount: number;
  unresolvedFiles: IndexSnapshotUnresolvedFileV1[];
  artifacts: IndexSnapshotArtifactV1[];
  artifactsTruncated: boolean;
};

type ManifestContract = {
  manifestArtifactKind: string;
  manifestVersion: string;
  createdAt: string | null;
  symbolIndexRelativePath: string;
  manifestFileCount: number | null;
  sourceRoots: string[];
  projectRoot: string;
};

type Failure = { ok: false; code: IndexSnapshotUnavailableCode; message: string };

const TOOL_VERSION_UNAVAILABLE = {
  name: "my-dev-kit" as const,
  version: null,
  availability: "unavailable" as const,
  reason: "The my-dev-kit index manifest and index command output do not expose the tool version.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Locale- and platform-independent ordering so snapshots never depend on enumeration order. */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedText(value: string): string {
  return value.length > MAX_REPORTED_PATH_LENGTH ? `${value.slice(0, MAX_REPORTED_PATH_LENGTH)}...` : value;
}

/**
 * Policy: validates the manifest against the supported my-dev-kit contract and the expected
 * target. Pure; performs no filesystem access.
 */
export function interpretIndexManifest(
  manifest: unknown,
  expected: { sourceRoots: readonly string[] }
): { ok: true; contract: ManifestContract } | Failure {
  const unsupported = (message: string): Failure => ({ ok: false, code: "manifest-unsupported", message });
  if (!isRecord(manifest)) {
    return unsupported("Index manifest is not a JSON object.");
  }
  if (manifest.artifactKind !== SUPPORTED_MANIFEST_ARTIFACT_KIND) {
    return unsupported(`Index manifest artifactKind is not ${SUPPORTED_MANIFEST_ARTIFACT_KIND}.`);
  }
  if (typeof manifest.version !== "string" || !SUPPORTED_MANIFEST_VERSION_PATTERN.test(manifest.version)) {
    return unsupported("Index manifest version is missing or not a supported 1.x version.");
  }
  const artifacts = manifest.artifacts;
  const symbolIndexPath = isRecord(artifacts) ? artifacts.symbolIndex : undefined;
  if (typeof symbolIndexPath !== "string" || symbolIndexPath.length === 0) {
    return unsupported("Index manifest does not name a symbolIndex artifact.");
  }
  if (typeof manifest.projectRoot !== "string" || manifest.projectRoot.length === 0) {
    return unsupported("Index manifest does not record a projectRoot.");
  }
  const sourceRoots = manifest.sourceRoots;
  if (!Array.isArray(sourceRoots) || !sourceRoots.every((root) => typeof root === "string")) {
    return unsupported("Index manifest does not record sourceRoots.");
  }
  const sameSourceRoots =
    sourceRoots.length === expected.sourceRoots.length && sourceRoots.every((root, index) => root === expected.sourceRoots[index]);
  if (!sameSourceRoots) {
    return {
      ok: false,
      code: "manifest-target-mismatch",
      message: `Index manifest source roots [${sourceRoots.join(", ")}] do not match [${expected.sourceRoots.join(", ")}].`,
    };
  }
  const summary = manifest.summary;
  const manifestFileCount = isRecord(summary) && typeof summary.fileCount === "number" ? summary.fileCount : null;
  return {
    ok: true,
    contract: {
      manifestArtifactKind: manifest.artifactKind,
      manifestVersion: manifest.version,
      createdAt: typeof manifest.createdAt === "string" ? manifest.createdAt : null,
      symbolIndexRelativePath: symbolIndexPath,
      manifestFileCount,
      sourceRoots: [...sourceRoots],
      projectRoot: manifest.projectRoot,
    },
  };
}

/**
 * Policy: extracts the exact indexed-file path list from a symbol-index artifact. The count the
 * index declares must agree with the list; duplicates are rejected rather than merged.
 */
export function interpretSymbolIndexFiles(
  symbolIndex: unknown,
  manifestFileCount: number | null
): { ok: true; schemaVersion: string; paths: string[] } | Failure {
  const unsupported = (message: string): Failure => ({ ok: false, code: "symbol-index-unsupported", message });
  if (!isRecord(symbolIndex)) {
    return unsupported("Symbol index is not a JSON object.");
  }
  if (typeof symbolIndex.schemaVersion !== "string") {
    return unsupported("Symbol index does not record a schemaVersion.");
  }
  const files = symbolIndex.files;
  if (!Array.isArray(files)) {
    return unsupported("Symbol index does not list indexed files.");
  }
  const paths: string[] = [];
  for (const entry of files) {
    if (!isRecord(entry) || typeof entry.path !== "string" || entry.path.length === 0) {
      return unsupported("Symbol index contains a file entry without a path.");
    }
    paths.push(entry.path);
  }
  if (new Set(paths).size !== paths.length) {
    return unsupported("Symbol index lists the same file path more than once.");
  }
  const declaredCounts = [symbolIndex.fileCount, manifestFileCount].filter((count): count is number => typeof count === "number");
  if (declaredCounts.some((count) => count !== paths.length)) {
    return {
      ok: false,
      code: "indexed-file-count-mismatch",
      message: `Symbol index lists ${paths.length} files but the index declares ${declaredCounts.join("/")}.`,
    };
  }
  return { ok: true, schemaVersion: symbolIndex.schemaVersion, paths };
}

/**
 * Policy: normalizes an index-listed path to a target-relative forward-slash path and confirms it
 * stays inside the target and one of the configured source roots. Pure.
 */
export function resolveIndexedFilePath(
  targetRoot: string,
  sourceRoots: readonly string[],
  listedPath: string
): { ok: true; relativePath: string } | { ok: false; reason: IndexSnapshotUnresolvedReason } {
  const forward = listedPath.replace(/\\/g, "/");
  if (forward.length === 0 || forward.includes("\0") || forward.startsWith("/") || /^[A-Za-z]:/.test(forward)) {
    return { ok: false, reason: "invalid-path" };
  }
  try {
    const absolute = resolveWithinRoot(targetRoot, forward);
    const relativePath = relativeWithinRoot(targetRoot, absolute);
    if (relativePath.length === 0) {
      return { ok: false, reason: "invalid-path" };
    }
    const insideSourceRoot = sourceRoots.some((sourceRoot) => {
      try {
        relativeWithinRoot(resolveWithinRoot(targetRoot, sourceRoot), absolute);
        return true;
      } catch {
        return false;
      }
    });
    return insideSourceRoot ? { ok: true, relativePath } : { ok: false, reason: "outside-target-or-source-roots" };
  } catch {
    return { ok: false, reason: "outside-target-or-source-roots" };
  }
}

async function hashFile(absolutePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(absolutePath)) {
    const buffer = chunk as Buffer;
    sizeBytes += buffer.length;
    hash.update(buffer);
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

async function snapshotIndexedFile(
  targetRoot: string,
  realTargetRoot: string,
  relativePath: string
): Promise<{ ok: true; file: IndexSnapshotFileV1 } | { ok: false; reason: IndexSnapshotUnresolvedReason }> {
  const absolutePath = path.resolve(targetRoot, relativePath);
  try {
    // A symlink must not carry the read outside the target.
    const realPath = await realpath(absolutePath);
    try {
      relativeWithinRoot(realTargetRoot, realPath);
    } catch {
      return { ok: false, reason: "outside-target-or-source-roots" };
    }
    const stats = await stat(realPath);
    if (!stats.isFile()) {
      return { ok: false, reason: "not-a-file" };
    }
    const { sha256, sizeBytes } = await hashFile(realPath);
    return { ok: true, file: { path: relativePath, sha256, sizeBytes, modifiedAt: stats.mtime.toISOString() } };
  } catch (error) {
    return { ok: false, reason: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable" };
  }
}

async function enumerateIndexArtifacts(indexDir: string): Promise<{ artifacts: IndexSnapshotArtifactV1[]; truncated: boolean }> {
  const artifacts: IndexSnapshotArtifactV1[] = [];
  let truncated = false;
  const pending = [indexDir];
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile()) {
        if (artifacts.length >= MAX_ARTIFACT_ENTRIES) {
          truncated = true;
          continue;
        }
        artifacts.push({ path: relativeWithinRoot(indexDir, absolutePath), sizeBytes: (await stat(absolutePath)).size });
      }
    }
  }
  artifacts.sort((left, right) => compareCodeUnits(left.path, right.path));
  return { artifacts, truncated };
}

async function readJson(filePath: string): Promise<{ ok: true; value: unknown } | { ok: false; missing: boolean; message: string }> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return { ok: false, missing, message: missing ? "file does not exist" : `file could not be read: ${(error as Error).message}` };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, missing: false, message: `file is not valid JSON: ${(error as Error).message}` };
  }
}

function unavailableSnapshot(command: MeasuredCommandResult, failure: Failure, manifest: IndexSnapshotV1["manifest"] = null): IndexSnapshotV1 {
  return {
    schemaVersion: INDEX_SNAPSHOT_SCHEMA_VERSION,
    status: "unavailable",
    unavailable: { code: failure.code, message: boundedText(failure.message) },
    manifest,
    tool: { ...TOOL_VERSION_UNAVAILABLE },
    indexCommand: summarizeIndexCommand(command),
    indexedFileCount: 0,
    files: [],
    unresolvedFileCount: 0,
    unresolvedFiles: [],
    artifacts: [],
    artifactsTruncated: false,
  };
}

function summarizeIndexCommand(command: MeasuredCommandResult): IndexSnapshotV1["indexCommand"] {
  return { commandString: command.commandString, executable: command.executable, args: [...command.args] };
}

/**
 * Captures bounded index-build evidence from an already built index: which files the index lists,
 * their SHA-256 content identity, and the generated artifact inventory. Reads only the index
 * directory and the listed files inside the target; runs no my-dev-kit command and never throws —
 * an uninterpretable index yields an explicit `unavailable` snapshot instead of a guessed one.
 * Performs no comparison and assigns no freshness.
 */
export async function captureIndexSnapshot(options: {
  indexDir: string;
  targetRoot: string;
  sourceRoots: readonly string[];
  command: MeasuredCommandResult;
}): Promise<IndexSnapshotV1> {
  const { indexDir, targetRoot, sourceRoots, command } = options;
  try {
    const manifestRead = await readJson(path.join(indexDir, MANIFEST_FILE));
    if (!manifestRead.ok) {
      return unavailableSnapshot(command, {
        ok: false,
        code: manifestRead.missing ? "manifest-missing" : "manifest-unreadable",
        message: `Index manifest ${manifestRead.message}.`,
      });
    }
    const manifest = interpretIndexManifest(manifestRead.value, { sourceRoots });
    if (!manifest.ok) {
      return unavailableSnapshot(command, manifest);
    }
    const { contract } = manifest;

    const realTargetRoot = await realpath(targetRoot);
    let manifestRoot: string;
    try {
      manifestRoot = await realpath(contract.projectRoot);
    } catch {
      manifestRoot = path.resolve(contract.projectRoot);
    }
    if (path.relative(realTargetRoot, manifestRoot) !== "") {
      return unavailableSnapshot(command, {
        ok: false,
        code: "manifest-target-mismatch",
        message: "Index manifest projectRoot does not match the target root.",
      });
    }

    let symbolIndexFile: string;
    try {
      symbolIndexFile = resolveWithinRoot(indexDir, contract.symbolIndexRelativePath);
    } catch {
      return unavailableSnapshot(command, {
        ok: false,
        code: "manifest-unsupported",
        message: "Index manifest symbolIndex path escapes the index directory.",
      });
    }
    const symbolIndexRead = await readJson(symbolIndexFile);
    if (!symbolIndexRead.ok) {
      return unavailableSnapshot(command, {
        ok: false,
        code: symbolIndexRead.missing ? "symbol-index-missing" : "symbol-index-unreadable",
        message: `Symbol index ${symbolIndexRead.message}.`,
      });
    }
    const symbolIndex = interpretSymbolIndexFiles(symbolIndexRead.value, contract.manifestFileCount);
    const manifestSummary: IndexSnapshotV1["manifest"] = {
      path: MANIFEST_FILE,
      artifactKind: contract.manifestArtifactKind,
      schemaVersion: contract.manifestVersion,
      createdAt: contract.createdAt,
      symbolIndexPath: relativeWithinRoot(indexDir, symbolIndexFile),
      symbolIndexSchemaVersion: symbolIndex.ok ? symbolIndex.schemaVersion : "unknown",
    };
    if (!symbolIndex.ok) {
      return unavailableSnapshot(command, symbolIndex, manifestSummary);
    }

    const resolved = symbolIndex.paths.map((listed) => ({ listed, resolution: resolveIndexedFilePath(targetRoot, sourceRoots, listed) }));
    const unresolved: IndexSnapshotUnresolvedFileV1[] = [];
    const toHash: string[] = [];
    for (const { listed, resolution } of resolved) {
      if (resolution.ok) {
        toHash.push(resolution.relativePath);
      } else {
        unresolved.push({ path: boundedText(listed), reason: resolution.reason });
      }
    }

    const files: IndexSnapshotFileV1[] = [];
    for (let start = 0; start < toHash.length; start += HASH_CONCURRENCY) {
      const batch = toHash.slice(start, start + HASH_CONCURRENCY);
      const results = await Promise.all(batch.map((relativePath) => snapshotIndexedFile(targetRoot, realTargetRoot, relativePath)));
      results.forEach((result, position) => {
        if (result.ok) {
          files.push(result.file);
        } else {
          unresolved.push({ path: boundedText(batch[position]), reason: result.reason });
        }
      });
    }
    files.sort((left, right) => compareCodeUnits(left.path, right.path));
    unresolved.sort((left, right) => compareCodeUnits(left.path, right.path) || compareCodeUnits(left.reason, right.reason));

    const inventory = await enumerateIndexArtifacts(indexDir);
    return {
      schemaVersion: INDEX_SNAPSHOT_SCHEMA_VERSION,
      status: unresolved.length === 0 ? "complete" : "partial",
      unavailable: null,
      manifest: manifestSummary,
      tool: { ...TOOL_VERSION_UNAVAILABLE },
      indexCommand: summarizeIndexCommand(command),
      indexedFileCount: symbolIndex.paths.length,
      files,
      unresolvedFileCount: unresolved.length,
      unresolvedFiles: unresolved.slice(0, MAX_UNRESOLVED_ENTRIES),
      artifacts: inventory.artifacts,
      artifactsTruncated: inventory.truncated,
    };
  } catch (error) {
    return unavailableSnapshot(command, {
      ok: false,
      code: "snapshot-capture-failed",
      message: `Index snapshot capture failed: ${(error as Error).message}`,
    });
  }
}
