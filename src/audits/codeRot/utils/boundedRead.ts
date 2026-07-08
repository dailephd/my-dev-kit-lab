import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 4 — shared bounded file-read helper.
//
// Every Batch 3 detector duplicated its own local readBoundedText() helper.
// Batch 4 factors the identical logic out once so the seven new detectors
// don't each re-implement it. Behavior is unchanged: returns null (never
// throws) for an oversized file or an unreadable path.
// ---------------------------------------------------------------------------

export function readBoundedFileText(
  root: string,
  relativePath: string,
  sizeBytes: number,
  maxBytes: number
): string | null {
  if (sizeBytes > maxBytes) return null;
  try {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
  } catch {
    return null;
  }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
