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
