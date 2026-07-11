import fs from "node:fs";
import { collectFilesForGlobs } from "../../../../core/fileGlobs.js";
import type { SecretScanDiscoveryResult, SecretScanFile, SecretScanSkippedFile } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 4 — bounded, deterministic file discovery for the secret-
// candidate scanner.
//
// Reuses the existing target-contained glob collector
// (src/core/fileGlobs.ts's collectFilesForGlobs, which itself uses
// src/core/pathSafety.ts for containment) for traversal — no second
// traversal engine. Adds narrow, documented bounds (size cap, binary
// detection) co-located here because no existing shared utility exposes
// structured skip evidence (the closest existing owner,
// src/securityValidation/attackScenarios/boundedSourceScan.ts, silently
// drops oversized/unreadable/binary files with no skip record, and is owned
// by an unrelated security-validation feature, not Android).
// ---------------------------------------------------------------------------

// Extension-based recursive globs plus explicit root-level literals — the
// existing glob matcher's "**/*.ext" form requires at least one path
// separator, so genuinely root-level files (e.g. local.properties sitting
// directly in the target root) need an explicit literal entry too.
export const SECRET_SCAN_GLOBS: readonly string[] = [
  "**/*.kt",
  "**/*.kts",
  "**/*.java",
  "**/*.xml",
  "**/*.gradle",
  "**/*.gradle.kts",
  "**/*.properties",
  "**/*.json",
  "**/*.yaml",
  "**/*.yml",
  "**/*.toml",
  "gradle.properties",
  "local.properties",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
];

// Path segments excluded beyond src/core/fileGlobs.ts's own directory
// exclusions (node_modules/dist/build/coverage/.git/lab-output/.my-dev-kit),
// matching the wider Android-appropriate set already used by
// src/mobile/android/detect/traversal.ts.
const EXCLUDED_PATH_SEGMENTS = [".gradle/", "out/", "reports/", ".idea/", ".vscode/", ".vs/"];

function isExcludedPath(relativePath: string): boolean {
  const normalized = `${relativePath.replace(/\\/g, "/")}/`;
  return EXCLUDED_PATH_SEGMENTS.some((segment) => normalized === segment || normalized.startsWith(segment) || normalized.includes(`/${segment}`));
}

// Documented, co-located bounds (no existing shared constant applies here).
export const MAX_SECRET_SCAN_FILE_BYTES = 1_000_000;
export const MAX_SECRET_SCAN_FILE_COUNT = 5_000;

const NUL_CHAR = String.fromCharCode(0);

function inferModulePath(relativePath: string, knownModulePaths: readonly string[]): string | undefined {
  const normalized = relativePath.replace(/\\/g, "/");
  let best: string | undefined;
  for (const modulePath of knownModulePaths) {
    const prefix = `${modulePath.replace(/\\/g, "/")}/`;
    if (normalized.startsWith(prefix) && (best === undefined || modulePath.length > best.length)) {
      best = modulePath;
    }
  }
  return best;
}

// Discovers a bounded, deterministic set of target-contained text files
// eligible for secret-candidate scanning. Never throws for missing glob base
// paths (per-glob isolation, same rationale as boundedSourceScan.ts), never
// reads beyond the size cap, and reports every skip with a structured
// reason rather than silently dropping files.
export function discoverSecretSourceFiles(targetRoot: string, knownModulePaths: readonly string[] = []): SecretScanDiscoveryResult {
  const candidateMap = new Map<string, string>();
  for (const glob of SECRET_SCAN_GLOBS) {
    let matches: { absolutePath: string; relativePath: string }[];
    try {
      matches = collectFilesForGlobs(targetRoot, [glob]);
    } catch {
      continue;
    }
    for (const match of matches) {
      const normalizedRel = match.relativePath.replace(/\\/g, "/");
      if (isExcludedPath(normalizedRel)) continue;
      candidateMap.set(normalizedRel, match.absolutePath);
    }
  }

  const candidates = [...candidateMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_SECRET_SCAN_FILE_COUNT)
    .map(([relativePath, absolutePath]) => ({ relativePath, absolutePath }));

  const files: SecretScanFile[] = [];
  const skipped: SecretScanSkippedFile[] = [];

  for (const candidate of candidates) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(candidate.absolutePath);
    } catch (error) {
      skipped.push({ relativePath: candidate.relativePath, reason: "unreadable", detail: error instanceof Error ? error.message : undefined });
      continue;
    }

    // Symlinks are not followed outside the target: resolve the real path
    // and re-check containment before ever reading content.
    let realAbsolutePath = candidate.absolutePath;
    if (stat.isSymbolicLink()) {
      try {
        realAbsolutePath = fs.realpathSync(candidate.absolutePath);
      } catch {
        skipped.push({ relativePath: candidate.relativePath, reason: "unreadable", detail: "broken symlink" });
        continue;
      }
      const normalizedRoot = targetRoot.replace(/\\/g, "/");
      const normalizedReal = realAbsolutePath.replace(/\\/g, "/");
      if (!normalizedReal.startsWith(normalizedRoot)) {
        skipped.push({ relativePath: candidate.relativePath, reason: "unreadable", detail: "symlink escapes target root" });
        continue;
      }
      try {
        stat = fs.statSync(realAbsolutePath);
      } catch (error) {
        skipped.push({ relativePath: candidate.relativePath, reason: "unreadable", detail: error instanceof Error ? error.message : undefined });
        continue;
      }
    }

    if (!stat.isFile()) continue;
    if (stat.size > MAX_SECRET_SCAN_FILE_BYTES) {
      skipped.push({ relativePath: candidate.relativePath, reason: "oversized", detail: `${stat.size} bytes exceeds ${MAX_SECRET_SCAN_FILE_BYTES}` });
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(realAbsolutePath, "utf8");
    } catch (error) {
      skipped.push({ relativePath: candidate.relativePath, reason: "unreadable", detail: error instanceof Error ? error.message : undefined });
      continue;
    }
    if (content.indexOf(NUL_CHAR) !== -1) {
      skipped.push({ relativePath: candidate.relativePath, reason: "binary-like" });
      continue;
    }

    files.push({
      relativePath: candidate.relativePath,
      absolutePath: candidate.absolutePath,
      modulePath: inferModulePath(candidate.relativePath, knownModulePaths),
      content,
    });
  }

  return { files, skipped };
}
