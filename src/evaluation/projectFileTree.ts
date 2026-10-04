import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ProjectFileTree, ProjectFileTreeEntry } from "./types.js";

const EXCLUDED_SEGMENTS = new Set(["node_modules", "dist", "build", "coverage", "lab-output", ".git", "__pycache__"]);

export function isExcludedProjectPath(relativePath: string): boolean {
  return relativePath.split(/[\\/]/).some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

export function inferFileLanguage(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".ts") return "typescript";
  if (extension === ".js") return "javascript";
  if (extension === ".py") return "python";
  if (extension === ".json") return "json";
  if (extension === ".md") return "markdown";
  return undefined;
}

export function inferFileRole(relativePath: string, kind: "file" | "directory"): ProjectFileTreeEntry["role"] {
  const normalized = relativePath.replace(/\\/g, "/");
  const basename = path.posix.basename(normalized).toLowerCase();
  if (/(^|\/)(tests?|__tests__)(\/|$)/.test(normalized) || /\.test\.[tj]s$/.test(basename) || basename.startsWith("test_")) {
    return "test";
  }
  if (/(^|\/)(src|python|py)(\/|$)/.test(normalized)) {
    return "source";
  }
  if (basename === "readme.md" || basename.endsWith(".md")) {
    return "docs";
  }
  if (
    ["package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts", "vitest.config.js", "requirements.txt", "pyproject.toml"].includes(
      basename
    )
  ) {
    return "config";
  }
  if (normalized.includes("contracts/")) {
    return "contract";
  }
  return kind === "directory" ? "other" : "other";
}

export function countFileLines(filePath: string): number {
  const content = readFileSync(filePath, "utf8");
  if (content.length === 0) {
    return 0;
  }
  return content.split(/\r?\n/).length;
}

export type ProjectFileTreeOptions = {
  /**
   * Repository-relative regular files that are the only files allowed to appear in, or be opened for, the tree
   * (for example a local subject's Batch 1 eligible files). When supplied the target is not walked.
   */
  allowedRelativeFiles?: readonly string[];
};

type AllowedTreeNode = { children: Map<string, AllowedTreeNode>; isFile: boolean };

function buildAllowedFileTree(root: string, allowedRelativeFiles: readonly string[]): ProjectFileTree {
  const top: AllowedTreeNode = { children: new Map(), isFile: false };
  for (const allowed of allowedRelativeFiles) {
    const relativePath = allowed.replace(/\\/g, "/");
    if (isExcludedProjectPath(relativePath)) continue;
    let node = top;
    const segments = relativePath.split("/");
    segments.forEach((segment, index) => {
      let child = node.children.get(segment);
      if (!child) {
        child = { children: new Map(), isFile: index === segments.length - 1 };
        node.children.set(segment, child);
      }
      node = child;
    });
  }

  const entries: ProjectFileTreeEntry[] = [];
  const walk = (node: AllowedTreeNode, prefix: string): void => {
    const names = [...node.children.keys()].sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const child = node.children.get(name) as AllowedTreeNode;
      const relativePath = prefix === "" ? name : `${prefix}/${name}`;
      if (child.isFile) {
        entries.push({
          path: relativePath,
          kind: "file",
          role: inferFileRole(relativePath, "file"),
          language: inferFileLanguage(relativePath),
          lines: countFileLines(path.join(root, ...relativePath.split("/")))
        });
      } else {
        entries.push({ path: relativePath, kind: "directory", role: inferFileRole(relativePath, "directory") });
        walk(child, relativePath);
      }
    }
  };
  walk(top, "");
  return { entries };
}

export function buildProjectFileTree(projectRoot: string, options: ProjectFileTreeOptions = {}): ProjectFileTree {
  const root = path.resolve(projectRoot);
  if (options.allowedRelativeFiles !== undefined) {
    return buildAllowedFileTree(root, options.allowedRelativeFiles);
  }
  const entries: ProjectFileTreeEntry[] = [];

  function walk(currentDir: string) {
    const dirEntries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of dirEntries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(root, fullPath).replace(/\\/g, "/");
      if (isExcludedProjectPath(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        entries.push({
          path: relativePath,
          kind: "directory",
          role: inferFileRole(relativePath, "directory")
        });
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      entries.push({
        path: relativePath,
        kind: "file",
        role: inferFileRole(relativePath, "file"),
        language: inferFileLanguage(relativePath),
        lines: countFileLines(fullPath)
      });
    }
  }

  statSync(root);
  walk(root);
  return { entries };
}
