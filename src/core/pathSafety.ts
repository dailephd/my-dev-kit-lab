import path from "node:path";
import { lstat, realpath } from "node:fs/promises";

/** Verify an existing directory beneath a caller-authorized boundary without following
 * symbolic links/junctions in that boundary or its relative path. Rejects unavailable
 * paths. Also usable with a separate writable boundary; does not confer ownership.
 */
export async function verifyDirectoryWithinRoot(root: string, directory: string): Promise<string> {
  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = resolveWithinRoot(resolvedRoot, directory);
  const segments = path.relative(resolvedRoot, resolvedDirectory).split(path.sep).filter(Boolean);
  let current = resolvedRoot;
  for (const segment of ["", ...segments]) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Unverified runtime directory: ${current}`);
    }
  }
  const realRoot = await realpath(resolvedRoot);
  const realDirectory = await realpath(resolvedDirectory);
  resolveWithinRoot(realRoot, realDirectory);
  return realDirectory;
}

export function resolveWithinRoot(root: string, relativeOrAbsolutePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativeOrAbsolutePath);
  const relative = path.relative(resolvedRoot, resolvedPath);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Resolved path escapes target root: ${relativeOrAbsolutePath}`);
  }

  return resolvedPath;
}

export function relativeWithinRoot(root: string, filePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(filePath);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`File path escapes target root: ${filePath}`);
  }
  return relative.replace(/\\/g, "/");
}
