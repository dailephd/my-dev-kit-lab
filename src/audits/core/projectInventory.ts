import fs from "node:fs";
import path from "node:path";
import { relativeWithinRoot } from "../../core/pathSafety.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 2 — deterministic project inventory scanner.
//
// Pure data collection: this module classifies files and produces counts. It
// deliberately never returns an AuditIssue -- that begins in a later
// detector batch. Reused pattern from src/core/pathSafety.ts for path
// normalization/containment (relativeWithinRoot already forward-slash
// normalizes, matching the "path separators normalize consistently"
// requirement), but this scanner is its own walker rather than reusing
// src/core/fileGlobs.ts's private walkFiles(), because inventory needs a
// different, broader exclusion set (notably "reports", which fileGlobs.ts's
// scanner does not exclude) and a wider default surface (docs, tests, CI,
// package, config -- not just src/scripts).
// ---------------------------------------------------------------------------

export const INVENTORY_FILE_CATEGORIES = [
  "source",
  "tests",
  "docs",
  "package",
  "config",
  "scripts",
  "ci",
  "generated",
  "report",
  "unknown",
] as const;
export type InventoryFileCategory = (typeof INVENTORY_FILE_CATEGORIES)[number];

// Directory names excluded from traversal entirely -- never descended into.
const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "reports",
  "lab-output",
  ".my-dev-kit",
  ".my-dev-kit-v1",
  ".my-dev-kit-lab",
  "__pycache__",
  ".idea",
  ".vscode",
  // Vitest's own local cache directory (gitignored) -- generated tool
  // output, same category as coverage/.
  ".vitest",
]);

// OS/editor noise filenames, mirroring .gitignore's own conventions.
const EXCLUDED_FILE_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
function isNoiseFile(basename: string): boolean {
  return EXCLUDED_FILE_NAMES.has(basename) || basename.endsWith(".swp") || basename.endsWith("~");
}

// Known package/manifest filenames -> "package" category.
const PACKAGE_FILE_NAMES = new Set([
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "npm-shrinkwrap.json",
  "LICENSE",
  ".npmrc",
]);

// Known binary/media extensions -- never read for content (line count, etc).
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".pdf",
  ".zip",
  ".tgz",
  ".tar",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".wasm",
  ".db",
  ".sqlite",
]);

const KNOWN_SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
]);

// A file this large or larger is skipped entirely (not even stat'd into the
// inventory) -- protects against pathological huge-file scan cost.
const DEFAULT_HARD_SKIP_FILE_BYTES = 20_000_000;
// A file this large or larger is still inventoried (category, size, etc.)
// but never read for line-count -- keeps content reads bounded.
const DEFAULT_MAX_FILE_BYTES_FOR_LINE_COUNT = 500_000;
// Bytes read (at most) when sniffing for a NUL byte to detect binary content
// for files without a known binary extension.
const BINARY_SNIFF_BYTES = 512;

export type InventoryFileEntry = {
  // Relative to scanRoot, forward-slash normalized, case preserved.
  relativePath: string;
  // Same path, lowercased -- used internally for case-insensitive matching
  // consistency across platforms (Windows filesystems are case-insensitive).
  normalizedPath: string;
  extension: string;
  category: InventoryFileCategory;
  sizeBytes: number;
  likelyGenerated: boolean;
  likelyConfig: boolean;
  likelyDocs: boolean;
  likelyTest: boolean;
  likelySource: boolean;
  lineCount?: number;
};

export type ExcludedDirectorySummaryEntry = {
  name: string;
  occurrences: number;
};

export type ProjectInventorySnapshot = {
  targetRoot: string;
  scanRoot: string;
  totalFileCount: number;
  totalScannedFileCount: number;
  skippedFileCount: number;
  filesByCategory: Record<InventoryFileCategory, number>;
  filesByExtension: Record<string, number>;
  packageFiles: InventoryFileEntry[];
  docsFiles: InventoryFileEntry[];
  sourceFiles: InventoryFileEntry[];
  testFiles: InventoryFileEntry[];
  scriptFiles: InventoryFileEntry[];
  ciFiles: InventoryFileEntry[];
  excludedDirectorySummary: ExcludedDirectorySummaryEntry[];
  warnings: string[];
  // Full deterministic file list (sorted by relativePath). Later Batch 2
  // consumers (sourceOfTruth.ts) and later-batch detectors reuse this
  // instead of re-walking the filesystem.
  files: InventoryFileEntry[];
};

export type ScanProjectInventoryOptions = {
  hardSkipFileBytes?: number;
  maxFileBytesForLineCount?: number;
};

export function scanProjectInventory(
  targetRoot: string,
  options: ScanProjectInventoryOptions = {}
): ProjectInventorySnapshot {
  const resolvedRoot = path.resolve(targetRoot);
  const hardSkipFileBytes = options.hardSkipFileBytes ?? DEFAULT_HARD_SKIP_FILE_BYTES;
  const maxFileBytesForLineCount = options.maxFileBytesForLineCount ?? DEFAULT_MAX_FILE_BYTES_FOR_LINE_COUNT;

  const warnings: string[] = [];
  const excludedDirCounts = new Map<string, number>();
  const files: InventoryFileEntry[] = [];

  let totalFileCount = 0;
  let skippedFileCount = 0;
  let oversizedSkipCount = 0;

  walk(resolvedRoot);

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  if (oversizedSkipCount > 0) {
    warnings.push(
      `Skipped ${oversizedSkipCount} oversized file(s) (>= ${hardSkipFileBytes} bytes): possible generated bundle or binary artifact.`
    );
  }

  const filesByCategory = countByCategory(files);
  const filesByExtension = countByExtension(files);

  const excludedDirectorySummary = [...excludedDirCounts.entries()]
    .map(([name, occurrences]) => ({ name, occurrences }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    targetRoot: resolvedRoot,
    scanRoot: resolvedRoot,
    totalFileCount,
    totalScannedFileCount: files.length,
    skippedFileCount,
    filesByCategory,
    filesByExtension,
    packageFiles: files.filter((f) => f.category === "package"),
    docsFiles: files.filter((f) => f.category === "docs"),
    sourceFiles: files.filter((f) => f.category === "source"),
    testFiles: files.filter((f) => f.category === "tests"),
    scriptFiles: files.filter((f) => f.category === "scripts"),
    ciFiles: files.filter((f) => f.category === "ci"),
    excludedDirectorySummary,
    warnings,
    files,
  };

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      warnings.push(`Could not read directory: ${dir} (${err instanceof Error ? err.message : String(err)})`);
      return;
    }

    // Sort entries so traversal order (and therefore file discovery order
    // before the final sort-by-relativePath) is stable across platforms
    // regardless of the OS's own readdir ordering.
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of sorted) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) {
          excludedDirCounts.set(entry.name, (excludedDirCounts.get(entry.name) ?? 0) + 1);
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        // Skip symlinks and other special entries -- not part of Batch 2 scope.
        continue;
      }

      if (isNoiseFile(entry.name)) {
        continue;
      }

      totalFileCount += 1;

      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch (err) {
        skippedFileCount += 1;
        warnings.push(`Could not stat file: ${fullPath} (${err instanceof Error ? err.message : String(err)})`);
        continue;
      }

      if (stat.size >= hardSkipFileBytes) {
        skippedFileCount += 1;
        oversizedSkipCount += 1;
        continue;
      }

      const relativePath = relativeWithinRoot(resolvedRoot, fullPath);
      const extension = path.extname(entry.name).toLowerCase();
      const category = classifyFile(relativePath, entry.name, extension);

      const entryResult: InventoryFileEntry = {
        relativePath,
        normalizedPath: relativePath.toLowerCase(),
        extension,
        category,
        sizeBytes: stat.size,
        likelyGenerated: category === "generated" || category === "report",
        likelyConfig: category === "config" || category === "package",
        likelyDocs: category === "docs",
        likelyTest: category === "tests",
        likelySource: category === "source" || category === "scripts",
      };

      if (!BINARY_EXTENSIONS.has(extension) && stat.size <= maxFileBytesForLineCount) {
        const lineCount = tryCountLines(fullPath, warnings);
        if (lineCount !== undefined) {
          entryResult.lineCount = lineCount;
        }
      }

      files.push(entryResult);
    }
  }
}

function classifyFile(relativePath: string, basename: string, extension: string): InventoryFileCategory {
  if (PACKAGE_FILE_NAMES.has(basename)) return "package";

  if (relativePath.startsWith(".github/workflows/") && (extension === ".yml" || extension === ".yaml")) {
    return "ci";
  }

  if (isTestFile(relativePath, basename)) return "tests";

  // Top-level scripts/ directory -- classified before generic "source" so
  // scripts (which are also .ts/.js) land in their own category.
  if (relativePath.startsWith("scripts/")) return "scripts";

  if (extension === ".md" || extension === ".mdx" || relativePath.startsWith("docs/")) return "docs";

  if (isConfigFile(relativePath, basename, extension)) return "config";

  if (isStrayReportFile(basename)) return "report";

  if (extension === ".map") return "generated";

  if (KNOWN_SOURCE_EXTENSIONS.has(extension)) return "source";

  return "unknown";
}

function isTestFile(relativePath: string, basename: string): boolean {
  if (relativePath.startsWith("tests/") || relativePath.includes("/tests/")) return true;
  return /\.(test|spec)\.[jt]sx?$/.test(basename);
}

function isConfigFile(relativePath: string, basename: string, extension: string): boolean {
  if (/^tsconfig(\..+)?\.json$/.test(basename)) return true;
  if (/^vitest\.config\.[jt]s$/.test(basename) || basename === "vitest.workspace.ts") return true;
  if (/^\.eslintrc(\..+)?$/.test(basename) || /^eslint\.config\.[jt]s$/.test(basename)) return true;
  if (basename === ".editorconfig" || basename === ".gitignore" || basename === ".npmignore") return true;
  // Root-level dotfile configs (e.g. .prettierrc, .babelrc) not already
  // covered above -- deliberately conservative (root-only, not recursive)
  // to avoid misclassifying dotfiles inside fixture/benchmark projects.
  if (!relativePath.includes("/") && basename.startsWith(".")) return true;
  if (extension === ".json" && basename.toLowerCase().includes("config")) return true;
  return false;
}

function isStrayReportFile(basename: string): boolean {
  return /-security-validation\.(txt|json)$/.test(basename) || /-audit\.(txt|json)$/.test(basename);
}

function tryCountLines(fullPath: string, warnings: string[]): number | undefined {
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(fullPath);
  } catch (err) {
    warnings.push(`Could not read file for line count: ${fullPath} (${err instanceof Error ? err.message : String(err)})`);
    return undefined;
  }

  const sniffLength = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < sniffLength; i++) {
    if (buffer[i] === 0) {
      // NUL byte present -- treat as binary, skip line counting.
      return undefined;
    }
  }

  if (buffer.length === 0) return 0;
  const text = buffer.toString("utf8");
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lines += 1;
  }
  return lines;
}

function countByCategory(files: readonly InventoryFileEntry[]): Record<InventoryFileCategory, number> {
  const counts = Object.fromEntries(INVENTORY_FILE_CATEGORIES.map((c) => [c, 0])) as Record<
    InventoryFileCategory,
    number
  >;
  for (const file of files) {
    counts[file.category] += 1;
  }
  return counts;
}

function countByExtension(files: readonly InventoryFileEntry[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const key = file.extension || "(none)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sortedEntries = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(sortedEntries);
}
