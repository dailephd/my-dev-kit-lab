import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileSnapshot = {
  relativePath: string;
  absolutePath: string;
  contentHash: string;
};

export type TempWorkspace = {
  /** Root of the entire workspace temp tree. */
  root: string;
  /** Simulated source directory — must remain unmodified. */
  sourceDir: string;
  /** Declared output directory — CLI may write here. */
  outputDir: string;
  /** Index artifact directory — CLI may write here when --index is used. */
  indexDir: string;
  /** A directory OUTSIDE the workspace root — sentinel for escape detection. */
  outsideDir: string;
  /**
   * Disposable outer enclosure holding the whole workspace. Only set when the
   * workspace was created with `nestDepth`; every path a traversal can reach
   * from the workspace is then confined to this directory.
   */
  enclosureDir?: string;
  /** Clean up all temp directories. */
  cleanup: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Workspace creation
// ---------------------------------------------------------------------------

export type TempWorkspaceOptions = {
  /**
   * Nest the workspace this many short directories below a NEW disposable
   * enclosure so a relative traversal of up to that many parent components
   * stays inside the enclosure. The sentinel outsideDir is created inside the
   * enclosure as well.
   */
  nestDepth?: number;
};

export function createTempWorkspace(
  prefix = "adv-cli-",
  options: TempWorkspaceOptions = {}
): TempWorkspace {
  let enclosureDir: string | undefined;
  let root: string;
  let outsideDir: string;
  if (options.nestDepth === undefined) {
    root = mkdtempSync(path.join(os.tmpdir(), prefix));
    // Create outside dir as a sibling of root (not inside it).
    outsideDir = mkdtempSync(path.join(os.tmpdir(), `${prefix}outside-`));
  } else {
    enclosureDir = mkdtempSync(path.join(os.tmpdir(), `${prefix}encl-`));
    const nest = Array.from({ length: options.nestDepth }, (_, i) => `d${i + 1}`);
    root = path.join(enclosureDir, ...nest, "ws");
    outsideDir = path.join(enclosureDir, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
  }
  const sourceDir = path.join(root, "source");
  const outputDir = path.join(root, "output");
  const indexDir = path.join(root, "index");

  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(indexDir, { recursive: true });

  // Populate source dir with sentinel files that must not be modified.
  writeFileSync(path.join(sourceDir, "index.ts"), "export const x = 1;\n", "utf8");
  writeFileSync(path.join(sourceDir, "utils.ts"), "export function noop() {}\n", "utf8");
  writeFileSync(
    path.join(sourceDir, "package.json"),
    JSON.stringify({ name: "sentinel-pkg", version: "1.0.0" }, null, 2) + "\n",
    "utf8"
  );

  // Place a sentinel file in outsideDir to verify it is not touched.
  writeFileSync(
    path.join(outsideDir, "outside-sentinel.txt"),
    "must-not-be-modified\n",
    "utf8"
  );

  return {
    root,
    sourceDir,
    outputDir,
    indexDir,
    outsideDir,
    enclosureDir,
    cleanup: async () => {
      if (enclosureDir) {
        await rm(enclosureDir, { recursive: true, force: true });
        return;
      }
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outsideDir, { recursive: true, force: true }),
      ]);
    },
  };
}

// ---------------------------------------------------------------------------
// File snapshotting
// ---------------------------------------------------------------------------

function hashFile(filePath: string): string {
  try {
    const content = readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return "<unreadable>";
  }
}

export function snapshotDir(dir: string): FileSnapshot[] {
  const snapshots: FileSnapshot[] = [];
  collectSnapshots(dir, dir, snapshots);
  return snapshots.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function collectSnapshots(
  baseDir: string,
  currentDir: string,
  out: FileSnapshot[]
): void {
  let entries: string[];
  try {
    entries = readdirSync(currentDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(currentDir, entry);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      collectSnapshots(baseDir, abs, out);
    } else if (stat.isFile()) {
      out.push({
        relativePath: path.relative(baseDir, abs),
        absolutePath: abs,
        contentHash: hashFile(abs),
      });
    }
  }
}

/**
 * Strict snapshot of a whole tree: records directories and links as well as
 * files, never follows links, and THROWS when any entry cannot be inspected.
 * Used where an unreadable tree must not be mistaken for an unchanged one.
 */
export function snapshotTreeStrict(dir: string): FileSnapshot[] {
  const snapshots: FileSnapshot[] = [];
  collectStrict(dir, dir, snapshots);
  return snapshots.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function collectStrict(baseDir: string, currentDir: string, out: FileSnapshot[]): void {
  for (const entry of readdirSync(currentDir)) {
    const abs = path.join(currentDir, entry);
    const stat = lstatSync(abs);
    const relativePath = path.relative(baseDir, abs);
    if (stat.isSymbolicLink()) {
      out.push({ relativePath, absolutePath: abs, contentHash: `<link:${readlinkSync(abs)}>` });
    } else if (stat.isDirectory()) {
      out.push({ relativePath, absolutePath: abs, contentHash: "<dir>" });
      collectStrict(baseDir, abs, out);
    } else if (stat.isFile()) {
      out.push({
        relativePath,
        absolutePath: abs,
        contentHash: createHash("sha256").update(readFileSync(abs)).digest("hex"),
      });
    } else {
      out.push({ relativePath, absolutePath: abs, contentHash: "<special>" });
    }
  }
}

// ---------------------------------------------------------------------------
// Diff detection
// ---------------------------------------------------------------------------

export type SnapshotDiff = {
  added: string[];
  removed: string[];
  modified: string[];
};

export function diffSnapshots(before: FileSnapshot[], after: FileSnapshot[]): SnapshotDiff {
  const beforeMap = new Map(before.map((s) => [s.relativePath, s.contentHash]));
  const afterMap = new Map(after.map((s) => [s.relativePath, s.contentHash]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const [rel, hash] of afterMap) {
    if (!beforeMap.has(rel)) {
      added.push(rel);
    } else if (beforeMap.get(rel) !== hash) {
      modified.push(rel);
    }
  }
  for (const rel of beforeMap.keys()) {
    if (!afterMap.has(rel)) {
      removed.push(rel);
    }
  }

  return { added, removed, modified };
}

// ---------------------------------------------------------------------------
// Write-escape detection
// ---------------------------------------------------------------------------

/**
 * Returns any files found in `checkDir` that are NOT underneath any of the
 * `allowedDirs`. Used to detect writes outside declared output paths.
 */
export function findWritesOutside(
  checkDir: string,
  allowedDirs: string[]
): string[] {
  const normalizedAllowed = allowedDirs.map((d) => path.resolve(d) + path.sep);
  const escaped: string[] = [];
  collectEscapedFiles(checkDir, normalizedAllowed, escaped);
  return escaped;
}

function collectEscapedFiles(
  dir: string,
  allowedDirs: string[],
  out: string[]
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    const normalizedAbs = path.resolve(abs);
    const isAllowed = allowedDirs.some(
      (allowed) =>
        normalizedAbs === allowed.slice(0, -1) ||
        normalizedAbs.startsWith(allowed)
    );
    if (!isAllowed) {
      if (stat.isDirectory()) {
        collectEscapedFiles(abs, allowedDirs, out);
      } else {
        out.push(normalizedAbs);
      }
    } else if (stat.isDirectory()) {
      collectEscapedFiles(abs, allowedDirs, out);
    }
  }
}

/**
 * Returns files in `dir` that were not present in the `beforeSnapshot`.
 * Simple alternative to `findWritesOutside` when checking one directory.
 */
export function findNewFiles(
  dir: string,
  beforeSnapshot: FileSnapshot[]
): string[] {
  const afterSnapshot = snapshotDir(dir);
  const diff = diffSnapshots(beforeSnapshot, afterSnapshot);
  return diff.added.map((rel) => path.join(dir, rel));
}
