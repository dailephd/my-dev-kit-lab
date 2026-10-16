import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";

// Fail-closed path and media validation for gallery source artifacts. Source artifacts are untrusted
// filesystem inputs: a reference is accepted only when it is a safe run-root-relative POSIX path whose
// physically resolved target is an ordinary supported file inside the verified source root.

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

export type GalleryMediaKind = "video" | "screenshot" | "markdown" | "text" | "json";

export const GALLERY_MEDIA_EXTENSIONS: Record<GalleryMediaKind, readonly string[]> = {
  video: [".webm"],
  screenshot: [".png", ".jpg", ".jpeg", ".webp"],
  markdown: [".md"],
  text: [".txt", ".srt", ".vtt", ".html"],
  json: [".json"]
};

/** True only for a non-empty relative POSIX path with no traversal, drive, UNC, scheme, NUL or encoding tricks. */
export function isSafeRelativeArtifactPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return false;
  if (CONTROL_PATTERN.test(value) || value.includes("\\") || value.includes("%")) return false;
  if (value.startsWith("/") || SCHEME_PATTERN.test(value)) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Validates a link value for the gallery HTML. A gallery link is output-relative, so a leading "../" run is
 * legitimate (the artifact lives in a verified source root outside the gallery directory); any other
 * traversal, absolute form, scheme or malformed segment is rejected. Returns the percent-encoded href or null.
 */
export function safeGalleryHref(value: unknown, allowedExtensions?: readonly string[]): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  if (CONTROL_PATTERN.test(value) || value.includes("\\") || value.includes("%")) return null;
  if (value.startsWith("/") || SCHEME_PATTERN.test(value)) return null;
  const segments = value.split("/");
  let index = 0;
  while (segments[index] === "..") index += 1;
  const rest = segments.slice(index);
  if (rest.length === 0 || rest.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  if (allowedExtensions) {
    const ext = path.posix.extname(rest[rest.length - 1] as string).toLowerCase();
    if (!allowedExtensions.includes(ext)) return null;
  }
  return [...segments.slice(0, index), ...rest.map((segment) => encodeURIComponent(segment))].join("/");
}

export type VerifiedArtifact = { ok: true; absolutePath: string } | { ok: false; reason: string };

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function sniff(file: string, kind: GalleryMediaKind, ext: string): Promise<boolean> {
  if (kind === "markdown" || kind === "text" || kind === "json") return true;
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, 12, 0);
    if (bytesRead < 4) return false;
    if (kind === "video") return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
    if (ext === ".png") return buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    if (ext === ".jpg" || ext === ".jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (ext === ".webp") return bytesRead >= 12 && buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP";
    return false;
  } finally {
    await handle.close();
  }
}

/** Resolves and verifies one run-root-relative artifact reference. Never throws; failure carries a reason. */
export async function verifyArtifactFile(realRoot: string, reference: unknown, kind: GalleryMediaKind): Promise<VerifiedArtifact> {
  if (!isSafeRelativeArtifactPath(reference)) return { ok: false, reason: "the recorded path is not a safe run-root-relative path" };
  const ext = path.posix.extname(reference).toLowerCase();
  if (!GALLERY_MEDIA_EXTENSIONS[kind].includes(ext)) return { ok: false, reason: `the file type ${ext || "(none)"} is not supported for ${kind}` };
  try {
    const real = await realpath(path.resolve(realRoot, ...reference.split("/")));
    if (!within(realRoot, real)) return { ok: false, reason: "the file resolves outside the source root" };
    const info = await stat(real);
    if (!info.isFile()) return { ok: false, reason: "the path is not an ordinary file" };
    if (!(await sniff(real, kind, ext))) return { ok: false, reason: `the file content is not a valid ${ext.slice(1)} ${kind}` };
    return { ok: true, absolutePath: real };
  } catch {
    return { ok: false, reason: "the file is missing or unreadable" };
  }
}

/** Output-relative POSIX link text for a verified file, or null when no relative path exists (for example another drive). */
export function outputRelativePath(realOutDir: string, absoluteFile: string): string | null {
  const relative = path.relative(realOutDir, absoluteFile);
  if (relative === "" || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

/** Explicit user-supplied source text must be a local filesystem path, never a URL. */
export function looksLikeUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(value) && !/^[a-zA-Z]:[\/]/.test(value);
}
