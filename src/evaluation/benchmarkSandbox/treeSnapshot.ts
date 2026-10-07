import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BenchmarkSandboxError } from "./errors.js";

export type TreeSnapshotEntry = {
  /** Project-relative POSIX path. */
  path: string;
  sha256: string;
  size: number;
};

export function sha256OfBuffer(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Lists every regular file below `root` as sorted project-relative POSIX paths. Entries whose name is in
 * `excludedNames` are skipped at any depth. A symbolic link or junction anywhere else is rejected rather
 * than followed (a link could point outside the project), as is any entry that is neither a file nor a
 * directory.
 */
export async function scanProjectTree(root: string, excludedNames: readonly string[]): Promise<string[]> {
  const excluded = new Set(excludedNames);
  const files: string[] = [];

  async function walk(absoluteDir: string, relativeDir: string): Promise<void> {
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      if (excluded.has(entry.name)) continue;
      const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new BenchmarkSandboxError("SYMLINK_REJECTED", `symbolic link or junction at ${relativePath}`);
      }
      if (entry.isDirectory()) {
        await walk(path.join(absoluteDir, entry.name), relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        throw new BenchmarkSandboxError("UNSUPPORTED_ENTRY", `unsupported entry type at ${relativePath}`);
      }
    }
  }

  await walk(root, "");
  return files.sort(compareCodeUnits);
}

/** Deterministic content identity of a project tree: sorted paths with sha256 and size of every file. */
export async function snapshotProjectTree(
  root: string,
  options: { excludedNames: readonly string[] }
): Promise<TreeSnapshotEntry[]> {
  const files = await scanProjectTree(root, options.excludedNames);
  const entries: TreeSnapshotEntry[] = [];
  for (const relativePath of files) {
    const data = await readFile(path.join(root, ...relativePath.split("/")));
    entries.push({ path: relativePath, sha256: sha256OfBuffer(data), size: data.length });
  }
  return entries;
}

/** Aggregate digest over sorted "path<TAB>sha256<LF>" lines (same convention as the staleness source state). */
export function digestTreeSnapshot(entries: readonly TreeSnapshotEntry[]): string {
  const serialized = entries.map((entry) => `${entry.path}\t${entry.sha256}\n`).join("");
  return createHash("sha256").update(Buffer.from(serialized, "utf8")).digest("hex");
}
