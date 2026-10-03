import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { relativeWithinRoot, resolveWithinRoot } from "./pathSafety.js";

const excludedDirNames = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  "lab-output",
  ".my-dev-kit",
  ".my-dev-kit-v1",
  ".my-dev-kit-lab",
  "__pycache__"
]);

function isTempFile(relPath: string): boolean {
  return (
    relPath.endsWith(".tmp") ||
    relPath.endsWith(".temp") ||
    relPath.endsWith(".log") ||
    relPath.endsWith(".pyc") ||
    relPath.endsWith("~")
  );
}

function walkFiles(dir: string, root: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = relativeWithinRoot(root, fullPath);
    if (entry.isDirectory()) {
      if (excludedDirNames.has(entry.name)) {
        continue;
      }
      files.push(...walkFiles(fullPath, root));
      continue;
    }
    if (!isTempFile(relPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function baseDirectoryFromGlob(globPattern: string): string {
  const normalized = globPattern.replace(/\\/g, "/");
  const wildcardIndex = normalized.search(/[*?]/);
  if (wildcardIndex === -1) {
    return normalized;
  }
  const prefix = normalized.slice(0, wildcardIndex);
  const trimmed = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return trimmed || ".";
}

function matchesGlob(relPath: string, globPattern: string): boolean {
  const normalizedPath = relPath.replace(/\\/g, "/");
  const normalizedGlob = globPattern.replace(/\\/g, "/");
  if (normalizedGlob === "**/*") {
    return true;
  }
  const baseDir = baseDirectoryFromGlob(normalizedGlob);

  if (normalizedGlob.endsWith("/**/*")) {
    const prefix = baseDir === "." ? "" : `${baseDir}/`;
    return normalizedPath.startsWith(prefix);
  }

  if (normalizedGlob.includes("*")) {
    const placeholder = "__DOUBLE_STAR__";
    const escaped = normalizedGlob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, placeholder)
      .replace(/\*/g, "[^/]*")
      .replaceAll(placeholder, ".*");
    return new RegExp(`^${escaped}$`).test(normalizedPath);
  }

  return normalizedPath === normalizedGlob;
}

export function collectFilesForGlobs(targetRoot: string, globs: string[]): { absolutePath: string; relativePath: string }[] {
  const resolvedRoot = path.resolve(targetRoot);
  const fileMap = new Map<string, string>();

  for (const globPattern of globs) {
    if (!globPattern || typeof globPattern !== "string") {
      throw new Error("Invalid glob pattern.");
    }
    const baseDir = resolveWithinRoot(resolvedRoot, baseDirectoryFromGlob(globPattern));
    let baseStats;
    try {
      baseStats = statSync(baseDir);
    } catch {
      throw new Error(`Glob base directory does not exist: ${globPattern}`);
    }

    const candidateFiles = baseStats.isDirectory() ? walkFiles(baseDir, resolvedRoot) : [baseDir];
    for (const candidate of candidateFiles) {
      const relPath = relativeWithinRoot(resolvedRoot, candidate);
      if (matchesGlob(relPath, globPattern)) {
        fileMap.set(relPath, candidate);
      }
    }
  }

  return [...fileMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([relativePath, absolutePath]) => ({ relativePath, absolutePath }));
}

/**
 * Pure counterpart of `collectFilesForGlobs` for a caller-supplied, already validated list of repository-relative
 * file paths. It applies the same glob matching and the same walk exclusions (excluded directory names below the
 * glob base directory, temp files) and the same ordering, but never touches the filesystem, so the caller decides
 * which files may be opened at all. Unlike the walking variant it does not require the base directory to exist.
 */
export function selectRelativePathsForGlobs(relativePaths: readonly string[], globs: readonly string[]): string[] {
  const selected = new Set<string>();

  for (const globPattern of globs) {
    if (!globPattern || typeof globPattern !== "string") {
      throw new Error("Invalid glob pattern.");
    }
    const baseDir = baseDirectoryFromGlob(globPattern);
    if (baseDir.split("/").includes("..") || path.isAbsolute(baseDir)) {
      throw new Error(`Resolved path escapes target root: ${globPattern}`);
    }
    const normalizedBase = baseDir === "." ? "" : baseDir.replace(/\/+$/, "");

    for (const relativePath of relativePaths) {
      const normalizedPath = relativePath.replace(/\\/g, "/");
      if (normalizedPath === normalizedBase) {
        // An exact file base is used as-is by the walking variant (no walk exclusions apply).
        if (matchesGlob(normalizedPath, globPattern)) selected.add(normalizedPath);
        continue;
      }
      if (normalizedBase !== "" && !normalizedPath.startsWith(`${normalizedBase}/`)) continue;
      const belowBase = normalizedBase === "" ? normalizedPath : normalizedPath.slice(normalizedBase.length + 1);
      const directorySegments = belowBase.split("/").slice(0, -1);
      if (directorySegments.some((segment) => excludedDirNames.has(segment))) continue;
      if (isTempFile(normalizedPath)) continue;
      if (matchesGlob(normalizedPath, globPattern)) selected.add(normalizedPath);
    }
  }

  return [...selected].sort((a, b) => a.localeCompare(b));
}
