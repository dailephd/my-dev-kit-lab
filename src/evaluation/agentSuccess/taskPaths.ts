import path from "node:path";

export type ProjectPathIssueCode =
  | "PATH_NOT_STRING"
  | "PATH_EMPTY"
  | "PATH_NUL"
  | "PATH_ABSOLUTE"
  | "PATH_DRIVE"
  | "PATH_DOT"
  | "PATH_TRAVERSAL"
  | "PATH_GIT_SEGMENT"
  | "PATH_TRAILING_SLASH";

export type NormalizedProjectPath = { ok: true; path: string } | { ok: false; code: ProjectPathIssueCode };

/**
 * Normalizes a project-relative file path to POSIX form, or reports why it is unsafe. Shared by the task
 * contract and the patch policy so both apply exactly the same path rules.
 *
 * Rejected: non-strings, empty, NUL, absolute (POSIX or UNC style), drive-qualified, "." alone, any ".."
 * segment (before or after normalization), any ".git" segment (case-insensitive), a trailing slash.
 */
export function normalizeProjectRelativePath(raw: unknown): NormalizedProjectPath {
  if (typeof raw !== "string") return { ok: false, code: "PATH_NOT_STRING" };
  if (raw.trim() === "") return { ok: false, code: "PATH_EMPTY" };
  if (raw.includes("\0")) return { ok: false, code: "PATH_NUL" };
  const slashed = raw.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(slashed)) return { ok: false, code: "PATH_DRIVE" };
  if (slashed.startsWith("/")) return { ok: false, code: "PATH_ABSOLUTE" };
  if (slashed.split("/").some((segment) => segment === "..")) return { ok: false, code: "PATH_TRAVERSAL" };
  if (slashed.endsWith("/")) return { ok: false, code: "PATH_TRAILING_SLASH" };
  const normalized = path.posix.normalize(slashed);
  if (normalized === ".") return { ok: false, code: "PATH_DOT" };
  if (normalized === ".." || normalized.startsWith("../")) return { ok: false, code: "PATH_TRAVERSAL" };
  if (normalized.split("/").some((segment) => segment.toLowerCase() === ".git")) {
    return { ok: false, code: "PATH_GIT_SEGMENT" };
  }
  return { ok: true, path: normalized };
}
