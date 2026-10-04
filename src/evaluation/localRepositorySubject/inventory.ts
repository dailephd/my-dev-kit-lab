import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../core/pathSafety.js";
import { classifyGitIgnoredPaths } from "./gitRepository.js";
import { compareCodeUnits } from "./types.js";
import type { LocalRepositorySubjectInventoryCounts } from "./types.js";

export type InventoryEntryStats = {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
  size: number;
};

/**
 * Filesystem capabilities the inventory may use. Deliberately offers no way to read file contents, so size and
 * type classification is metadata-only by construction.
 */
export type LocalRepositorySubjectFsIo = {
  lstat(absolutePath: string): Promise<InventoryEntryStats>;
  readdir(absolutePath: string): Promise<string[]>;
};

export const defaultLocalRepositorySubjectFsIo: LocalRepositorySubjectFsIo = {
  lstat: (absolutePath) => lstat(absolutePath),
  readdir: (absolutePath) => readdir(absolutePath),
};

export type LocalRepositorySubjectInventory = {
  /** Eligible regular files (repository-relative, forward-slash), sorted, with byte sizes. Runtime evidence only. */
  eligibleFiles: { path: string; size: number }[];
  /** Runtime-only classification sets; never persisted. */
  ignoredFiles: Set<string>;
  oversizedFiles: Set<string>;
  counts: LocalRepositorySubjectInventoryCounts;
};

function isNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Validates, for one declared source root, that it is contained, exists, is a directory, and neither is nor passes
 * through a symlink. Returns labelled error strings (empty when valid).
 */
export async function validateSourceRootOnDisk(
  repositoryRoot: string,
  canonicalRoot: string,
  label: string,
  io: LocalRepositorySubjectFsIo
): Promise<string[]> {
  if (canonicalRoot === ".") return [];
  try {
    resolveWithinRoot(repositoryRoot, canonicalRoot);
  } catch {
    return [`${label}: resolves outside the selected repository (${JSON.stringify(canonicalRoot)}).`];
  }
  let current = repositoryRoot;
  const segments = canonicalRoot.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stats: InventoryEntryStats;
    try {
      stats = await io.lstat(current);
    } catch (error) {
      if (isNotFound(error)) return [`${label}: source root does not exist (${JSON.stringify(canonicalRoot)}).`];
      return [`${label}: source root could not be inspected (${JSON.stringify(canonicalRoot)}).`];
    }
    if (stats.isSymbolicLink()) {
      return [`${label}: source root is or passes through a symlink (${JSON.stringify(canonicalRoot)}).`];
    }
    if (index === segments.length - 1 && !stats.isDirectory()) {
      return [`${label}: source root is not a directory (${JSON.stringify(canonicalRoot)}).`];
    }
  }
  return [];
}

/**
 * Walks the union of source roots without following links and without reading contents. Symlinks and non-regular
 * entries are counted and excluded; `.git` is never traversed. Result is deterministic (code-unit order).
 */
async function walkSourceRoots(
  repositoryRoot: string,
  canonicalRoots: readonly string[],
  io: LocalRepositorySubjectFsIo
): Promise<{ regularFiles: Map<string, number>; symlinkCount: number; otherExcludedCount: number }> {
  const regularFiles = new Map<string, number>();
  const visitedDirectories = new Set<string>();
  let symlinkCount = 0;
  let otherExcludedCount = 0;

  const walkDirectory = async (relativeDirectory: string): Promise<void> => {
    if (visitedDirectories.has(relativeDirectory)) return;
    visitedDirectories.add(relativeDirectory);
    const absoluteDirectory = relativeDirectory === "." ? repositoryRoot : path.join(repositoryRoot, relativeDirectory);
    const names = (await io.readdir(absoluteDirectory)).slice().sort(compareCodeUnits);
    for (const name of names) {
      if (name === ".git") continue;
      const relativePath = relativeDirectory === "." ? name : `${relativeDirectory}/${name}`;
      const stats = await io.lstat(path.join(absoluteDirectory, name));
      if (stats.isSymbolicLink()) {
        symlinkCount += 1;
      } else if (stats.isDirectory()) {
        await walkDirectory(relativePath);
      } else if (stats.isFile()) {
        if (!regularFiles.has(relativePath)) regularFiles.set(relativePath, stats.size);
      } else {
        otherExcludedCount += 1;
      }
    }
  };

  for (const root of [...canonicalRoots].sort(compareCodeUnits)) {
    await walkDirectory(root);
  }
  return { regularFiles, symlinkCount, otherExcludedCount };
}

/**
 * Builds the safety inventory: walk, ask Git which files are ignored, then classify remaining regular files by
 * size from filesystem metadata only. Categories are exclusive (ignored, then oversized, else eligible).
 */
export async function buildLocalRepositorySubjectInventory(
  repositoryRoot: string,
  canonicalRoots: readonly string[],
  maxFileBytes: number,
  io: LocalRepositorySubjectFsIo = defaultLocalRepositorySubjectFsIo
): Promise<LocalRepositorySubjectInventory> {
  const walked = await walkSourceRoots(repositoryRoot, canonicalRoots, io);
  const candidatePaths = [...walked.regularFiles.keys()].sort(compareCodeUnits);
  const ignoredByGit = await classifyGitIgnoredPaths(repositoryRoot, candidatePaths);

  const eligibleFiles: { path: string; size: number }[] = [];
  const ignoredFiles = new Set<string>();
  const oversizedFiles = new Set<string>();
  let eligibleByteCount = 0;
  for (const filePath of candidatePaths) {
    const size = walked.regularFiles.get(filePath) as number;
    if (ignoredByGit.has(filePath)) {
      ignoredFiles.add(filePath);
    } else if (size > maxFileBytes) {
      oversizedFiles.add(filePath);
    } else {
      eligibleFiles.push({ path: filePath, size });
      eligibleByteCount += size;
    }
  }
  return {
    eligibleFiles,
    ignoredFiles,
    oversizedFiles,
    counts: {
      eligibleFileCount: eligibleFiles.length,
      eligibleByteCount,
      gitIgnoredCount: ignoredFiles.size,
      oversizedCount: oversizedFiles.size,
      symlinkCount: walked.symlinkCount,
      otherExcludedCount: walked.otherExcludedCount,
    },
  };
}
