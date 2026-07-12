import { collectFilesForGlobs } from "../../../../core/fileGlobs.js";
import type { KeystoreCandidateFile } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 4 — committed keystore-file candidate discovery.
//
// Reuses the existing target-contained glob collector (src/core/fileGlobs.ts)
// for traversal — no second traversal engine. Discovery is by file
// path/extension ONLY: this module never opens, reads, or inspects file
// contents (per agents.txt Batch 4 section 9.16).
// ---------------------------------------------------------------------------

const KEYSTORE_EXTENSIONS = [".jks", ".keystore", ".p12", ".pfx"] as const;

const KEYSTORE_GLOBS: readonly string[] = ["**/*.jks", "**/*.keystore", "**/*.p12", "**/*.pfx"];

const EXCLUDED_PATH_SEGMENTS = [".gradle/", "build/", "out/", "reports/"];

function isExcludedPath(relativePath: string): boolean {
  const normalized = `${relativePath.replace(/\\/g, "/")}/`;
  return EXCLUDED_PATH_SEGMENTS.some((segment) => normalized.includes(`/${segment}`) || normalized.startsWith(segment));
}

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

// Discovers target-contained files whose extension matches a conventional
// Android/Java signing-container format. Path/metadata only — content is
// never read, opened, or validated.
export function discoverKeystoreCandidates(targetRoot: string, knownModulePaths: readonly string[] = []): KeystoreCandidateFile[] {
  const candidateMap = new Map<string, string>();
  for (const glob of KEYSTORE_GLOBS) {
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

  return [...candidateMap.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((relativePath) => ({
      relativePath,
      modulePath: inferModulePath(relativePath, knownModulePaths),
      extension: KEYSTORE_EXTENSIONS.find((ext) => relativePath.toLowerCase().endsWith(ext)) ?? "",
    }));
}
