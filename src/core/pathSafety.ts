import path from "node:path";

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
