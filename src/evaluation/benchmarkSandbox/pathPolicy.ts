import { realpath } from "node:fs/promises";
import path from "node:path";

/** Sandbox identities become one directory name beneath the caller's runtime root. */
export const SANDBOX_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Directory/file names never copied into a sandbox and never part of its baseline. `.git` would import the
 * canonical history; the rest are generated or Lab-internal outputs that are not benchmark source.
 */
export const BENCHMARK_SANDBOX_EXCLUDED_NAMES: readonly string[] = Object.freeze([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "lab-output",
  ".my-dev-kit-context",
  ".my-dev-kit-orchestrator"
]);

/**
 * Physical path of a path that may not exist yet: the realpath of the deepest existing ancestor plus the
 * not-yet-created remainder. Resolving physically (not lexically) is what makes overlap checks hold across
 * links, junctions, and Windows drive aliases.
 */
export async function resolvePhysicalPath(candidate: string): Promise<string> {
  const resolved = path.resolve(candidate);
  const remainder: string[] = [];
  let current = resolved;
  for (;;) {
    try {
      const physical = await realpath(current);
      return remainder.length === 0 ? physical : path.join(physical, ...remainder.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const parent = path.dirname(current);
      if ((code !== "ENOENT" && code !== "ENOTDIR") || parent === current) return resolved;
      remainder.push(path.basename(current));
      current = parent;
    }
  }
}

/** True when `candidate` equals `root` or lies beneath it. Both arguments must already be physical paths. */
export function isSameOrInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === "") return true;
  return !(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}
