import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";

/**
 * Narrow v0.6.3 lifecycle-preparation helper: copies one already-produced my-dev-kit index
 * directory byte-for-byte to a new sibling directory so an upstream incremental refresh can run
 * in place against the copy while the original baseline stays immutable change authority.
 *
 * Both paths must resolve inside `runOwnedRoot` (textually and, for the destination parent, by
 * real path), the destination must not exist, symlinks in the source are refused, and the copy
 * is verified file-for-file by SHA-256. Index contents are never edited. Any failure throws.
 */
export async function cloneIncrementalChangeStalenessIndexDirectory(runOwnedRoot: string, sourceDir: string, destinationDir: string): Promise<void> {
  const root = path.resolve(runOwnedRoot);
  const source = resolveWithinRoot(root, path.resolve(sourceDir));
  const destination = resolveWithinRoot(root, path.resolve(destinationDir));

  if (!existsSync(source)) {
    throw new Error(`Index clone source does not exist: ${source}.`);
  }
  if (existsSync(destination)) {
    throw new Error(`Index clone destination already exists; refusing to overwrite: ${destination}.`);
  }
  const relativeToSource = path.relative(source, destination);
  if (relativeToSource === "" || (!relativeToSource.startsWith("..") && !path.isAbsolute(relativeToSource))) {
    throw new Error(`Index clone destination ${destination} must not be inside the source ${source}.`);
  }

  const sourceFiles = await listRegularFiles(source);

  // The destination parent must be real-path contained by the real run-owned root (no symlink escape).
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true });
  const [realParent, realRoot] = await Promise.all([realpath(parent), realpath(root)]);
  const parentRelative = path.relative(realRoot, realParent);
  if (parentRelative === ".." || parentRelative.startsWith(`..${path.sep}`) || path.isAbsolute(parentRelative)) {
    throw new Error(`Index clone destination parent escapes the run-owned root via a symbolic link: ${parent}.`);
  }

  await cp(source, destination, { recursive: true, errorOnExist: true, force: false, dereference: false });

  const copiedFiles = await listRegularFiles(destination);
  if (copiedFiles.length !== sourceFiles.length || copiedFiles.some((file, index) => file !== sourceFiles[index])) {
    throw new Error(`Index clone is incomplete: ${destination} does not contain exactly the files of ${source}.`);
  }
  for (const file of sourceFiles) {
    const [left, right] = await Promise.all([sha256(path.join(source, file)), sha256(path.join(destination, file))]);
    if (left !== right) {
      throw new Error(`Index clone content differs for ${file}.`);
    }
  }
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

/** Sorted POSIX-relative regular files; refuses symlinks and other non-regular entries. */
async function listRegularFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) {
        throw new Error(`Index directory contains a symbolic link, which is not copied: ${full}.`);
      }
      if (stat.isDirectory()) {
        await walk(full);
      } else if (stat.isFile()) {
        files.push(path.relative(root, full).replace(/\\/g, "/"));
      } else {
        throw new Error(`Index directory contains a non-regular entry: ${full}.`);
      }
    }
  }
  await walk(root);
  return files.sort();
}
