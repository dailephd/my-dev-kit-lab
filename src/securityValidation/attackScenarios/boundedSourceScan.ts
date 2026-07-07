import fs from "node:fs";
import { collectFilesForGlobs } from "../../core/fileGlobs.js";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 4 — shared bounded, deterministic source-file scan helper.
//
// Reused by secretLeakageScenario and networkAssumptionScenario. Both need
// "read a bounded, deterministic set of source-ish files, skip large/binary
// content" and nothing more — collectFilesForGlobs() already provides
// deterministic ordering and standard exclusions (node_modules, dist, build,
// coverage, .git, lab-output, .my-dev-kit); this layer adds a size cap and a
// small file-content allowlist filter for scenario-specific exclusions.
// ---------------------------------------------------------------------------

// Default bounded glob set: project manifests/config plus first-party source
// and scripts. Deliberately excludes tests/, benchmarks/, examples/ — those
// commonly contain intentionally fake secret-shaped fixtures (including this
// project's own security payload corpus test suite) that would otherwise be
// permanent false positives against this project's own repo.
export const DEFAULT_SOURCE_SCAN_GLOBS: readonly string[] = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "tsconfig.json",
  "tsconfig.*.json",
  ".env",
  ".env.*",
  "src/**/*",
  "scripts/**/*",
];

// Files that are deliberately excluded from scan output even though they
// match a glob above — e.g. the payload corpus itself, which intentionally
// contains fake-secret-shaped strings for Batch 2's test corpus.
const KNOWN_SYNTHETIC_FIXTURE_FILES = new Set<string>(["src/securityValidation/attackScenarios/payloadCorpus.ts"]);

// Skip files larger than this to keep the scan bounded and fast; source
// files this large are not expected in this project.
const MAX_SCANNABLE_FILE_BYTES = 1_000_000;

// A single NUL character, used as a cheap binary-file heuristic below.
// Built via fromCharCode rather than a "\0" string escape to avoid any
// literal control byte ending up in this source file.
const NUL_CHAR = String.fromCharCode(0);

export type ScannedFile = {
  relativePath: string;
  absolutePath: string;
  content: string;
};

// Returns file contents for the bounded glob set, skipping known synthetic
// fixtures, oversized files, and anything unreadable as UTF-8 text (treated
// as binary and skipped, not an error). Stable, deterministic order.
export function collectBoundedSourceFiles(
  targetRoot: string,
  globs: readonly string[] = DEFAULT_SOURCE_SCAN_GLOBS
): ScannedFile[] {
  // collectFilesForGlobs() throws for the *entire* call if any single glob's
  // base path doesn't exist (e.g. no .env file, no tsconfig.*.json match) —
  // resolve each glob independently so one missing/inapplicable glob doesn't
  // silently zero out results for all the others.
  const candidateMap = new Map<string, string>();
  for (const glob of globs) {
    let matches: { absolutePath: string; relativePath: string }[];
    try {
      matches = collectFilesForGlobs(targetRoot, [glob]);
    } catch {
      // This glob's base path doesn't exist for this target — a legitimate
      // "nothing to scan for this pattern" outcome, not an error.
      continue;
    }
    for (const m of matches) {
      candidateMap.set(m.relativePath, m.absolutePath);
    }
  }
  const candidates = [...candidateMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([relativePath, absolutePath]) => ({ relativePath, absolutePath }));

  const files: ScannedFile[] = [];
  for (const candidate of candidates) {
    const normalizedRel = candidate.relativePath.replace(/\\/g, "/");
    if (KNOWN_SYNTHETIC_FIXTURE_FILES.has(normalizedRel)) continue;

    let stat;
    try {
      stat = fs.statSync(candidate.absolutePath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_SCANNABLE_FILE_BYTES) continue;

    try {
      const content = fs.readFileSync(candidate.absolutePath, "utf8");
      if (content.indexOf(NUL_CHAR) !== -1) continue;
      files.push({ relativePath: normalizedRel, absolutePath: candidate.absolutePath, content });
    } catch {
      continue;
    }
  }

  return files;
}

// Returns the 1-based line number containing `index` within `content`.
export function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}
