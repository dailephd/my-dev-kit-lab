import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 2 — bounded source inspection for Compose/View UI evidence.
//
// Scans a small, capped number of source files under given source roots for
// lexical markers (@Composable, androidx.compose imports, traditional View
// APIs). This is not semantic parsing — it is a bounded grep-style scan with
// hard file-count and file-size caps so detection stays fast and safe on
// large or adversarial repositories.
// ---------------------------------------------------------------------------

const MAX_FILES_SCANNED = 40;
const MAX_FILE_SIZE_BYTES = 200_000;

const COMPOSE_SOURCE_PATTERN = /@Composable|androidx\.compose/;
const VIEW_SOURCE_PATTERN = /\bandroid\.view\.View\b|\bandroid\.widget\.|findViewById|\bViewBinding\b/;

export type SourceUiEvidence = {
  composeSourceEvidence: boolean;
  viewSourceEvidence: boolean;
  filesScanned: number;
};

function collectSourceFiles(root: string, extensions: string[], budget: { remaining: number }): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    if (budget.remaining <= 0) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (budget.remaining <= 0) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
        files.push(fullPath);
        budget.remaining -= 1;
      }
    }
  };
  visit(root);
  return files;
}

// Scans up to MAX_FILES_SCANNED Kotlin/Java files across the given source
// roots (already resolved absolute directories) for bounded Compose/View
// lexical evidence. Missing directories are ignored, not treated as errors.
export function scanSourceRootsForUiEvidence(sourceRootAbsolutePaths: string[]): SourceUiEvidence {
  const budget = { remaining: MAX_FILES_SCANNED };
  const files: string[] = [];

  for (const root of sourceRootAbsolutePaths) {
    if (budget.remaining <= 0) break;
    try {
      if (!statSync(root).isDirectory()) continue;
    } catch {
      continue;
    }
    files.push(...collectSourceFiles(root, [".kt", ".java"], budget));
  }

  let composeSourceEvidence = false;
  let viewSourceEvidence = false;
  let filesScanned = 0;

  for (const file of files) {
    let stat;
    try {
      stat = statSync(file);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_SIZE_BYTES) continue;

    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    filesScanned += 1;

    if (!composeSourceEvidence && COMPOSE_SOURCE_PATTERN.test(content)) {
      composeSourceEvidence = true;
    }
    if (!viewSourceEvidence && VIEW_SOURCE_PATTERN.test(content)) {
      viewSourceEvidence = true;
    }
  }

  return { composeSourceEvidence, viewSourceEvidence, filesScanned };
}
