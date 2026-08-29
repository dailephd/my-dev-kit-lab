import { existsSync } from "node:fs";
import path from "node:path";
import { resolveWithinRoot } from "../core/pathSafety.js";
import type { LabExecutionContext } from "./labExecutionContext.js";

/**
 * Safely resolves a package-relative path (e.g. "benchmarks/contracts/foo.json")
 * against resourceRoot. Rejects empty/absolute/traversal inputs and missing files
 * so command owners never depend on process.cwd() to find bundled resources.
 */
export function resolvePackageResource(
  contextOrResourceRoot: LabExecutionContext | string,
  resourceRelativePath: string
): string {
  const resourceRoot =
    typeof contextOrResourceRoot === "string" ? contextOrResourceRoot : contextOrResourceRoot.resourceRoot;

  if (!resourceRelativePath || resourceRelativePath.trim().length === 0) {
    throw new Error("Package resource path must not be empty.");
  }
  if (path.isAbsolute(resourceRelativePath)) {
    throw new Error(`Package resource path must be relative, not absolute: ${resourceRelativePath}`);
  }

  const resolvedPath = resolveWithinRoot(resourceRoot, resourceRelativePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Required package resource not found: ${resourceRelativePath} (resolved: ${resolvedPath})`);
  }

  return resolvedPath;
}
