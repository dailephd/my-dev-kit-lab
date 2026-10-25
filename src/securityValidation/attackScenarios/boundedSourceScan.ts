import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 4 — shared bounded, deterministic source-file scan helper.
//
// Reused by secretLeakageScenario and networkAssumptionScenario. Both need
// "read a bounded, deterministic set of source-ish files, skip large/binary
// content". Discovery here must refuse links BEFORE traversal or content reads;
// the general fileGlobs walker follows a linked glob base. Preserve its standard
// directory/temp exclusions, with a size cap and synthetic-fixture exclusion.
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

export type SourceProvenanceIssue = { relativePath: string; reason: string };

const EXCLUDED_SOURCE_DIRECTORIES = new Set([
  "node_modules", "dist", "build", "coverage", ".git", "lab-output",
  ".my-dev-kit", ".my-dev-kit-v1", ".my-dev-kit-lab", "__pycache__"
]);

const samePhysicalPath = (a: string, b: string): boolean => process.platform === "win32"
  ? a.toLowerCase() === b.toLowerCase() : a === b;

// Returns file contents for the bounded glob set, skipping known synthetic
// fixtures, oversized files, and anything unreadable as UTF-8 text (treated
// as binary and skipped, not an error). Stable, deterministic order.
export function collectBoundedSourceFiles(
  targetRoot: string,
  globs: readonly string[] = DEFAULT_SOURCE_SCAN_GLOBS,
  provenanceIssues: SourceProvenanceIssue[] = [],
  reviewedPaths: readonly string[] = []
): ScannedFile[] {
  const root = path.resolve(targetRoot);
  const issueMap = new Map<string, string>();
  const relative = (file: string): string => path.relative(root, file).replace(/\\/g, "/") || ".";
  const refuse = (file: string, reason: string): undefined => {
    issueMap.set(relative(file), reason);
    return undefined;
  };
  // lstat every component, including the scan root, before realpath or reads.
  // This rejects junctions/symlinks, physical aliases and multiply-linked files.
  // Rechecking before a read narrows races; it is not a race-free OS sandbox.
  function inspect(file: string): fs.Stats | undefined {
    const rel = path.relative(root, file);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      return refuse(root, "path-outside-scan-root");
    }
    let current = root;
    let stat: fs.Stats | undefined;
    for (const segment of ["", ...rel.split(path.sep).filter(Boolean)]) {
      if (segment) current = path.join(current, segment);
      try {
        stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) return refuse(current, "symlink-or-junction");
        if (!stat.isDirectory() && !stat.isFile()) return refuse(current, "non-regular-path");
        if (stat.isFile() && stat.nlink > 1) return refuse(current, "multiply-linked-source");
        if (!samePhysicalPath(fs.realpathSync.native(current), current)) {
          return refuse(current, "physical-path-alias");
        }
      } catch (error) {
        // Missing optional files are normal for generic external targets.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") refuse(current, "unreadable-path");
        return undefined;
      }
    }
    return stat;
  }
  // Absence is normal in unrelated targets; an existing reviewed path that is
  // not a direct regular file must not disappear into an empty directory scan.
  for (const reviewed of reviewedPaths) {
    const file = path.resolve(root, reviewed);
    const stat = inspect(file);
    if (stat && !stat.isFile()) refuse(file, "non-regular-reviewed-source");
  }
  const candidateMap = new Map<string, string>();
  for (const glob of globs) {
    const pattern = glob.replace(/\\/g, "/");
    const wildcard = pattern.search(/[*?]/);
    const prefix = wildcard < 0 ? pattern : pattern.slice(0, wildcard);
    const base = wildcard < 0 ? prefix : prefix.slice(0, prefix.lastIndexOf("/") + 1) || ".";
    const recursive = pattern.slice(base === "." ? 0 : base.length).includes("/");
    function visit(file: string): void {
      const stat = inspect(file);
      if (!stat) return;
      const rel = relative(file);
      if (stat.isDirectory()) {
        let entries: string[];
        try { entries = fs.readdirSync(file).sort(); }
        catch { refuse(file, "unreadable-directory"); return; }
        for (const name of entries) {
          if (EXCLUDED_SOURCE_DIRECTORIES.has(name)) continue;
          const child = path.join(file, name);
          // Root-level wildcard globs must not traverse unrelated directories.
          if (recursive || path.matchesGlob(relative(child), pattern)) visit(child);
        }
      } else if (path.matchesGlob(rel, pattern) && !/\.(?:tmp|temp|log|pyc)$|~$/.test(rel)) {
        candidateMap.set(rel, file);
      }
    }
    visit(path.resolve(root, base));
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
      stat = inspect(candidate.absolutePath);
    } catch {
      continue;
    }
    if (!stat?.isFile()) continue;
    if (stat.size > MAX_SCANNABLE_FILE_BYTES) {
      refuse(candidate.absolutePath, "oversized-source");
      continue;
    }

    try {
      const content = fs.readFileSync(candidate.absolutePath, "utf8");
      if (content.indexOf(NUL_CHAR) !== -1) {
        refuse(candidate.absolutePath, "binary-source");
        continue;
      }
      files.push({ relativePath: normalizedRel, absolutePath: candidate.absolutePath, content });
    } catch {
      refuse(candidate.absolutePath, "unreadable-source");
    }
  }
  provenanceIssues.push(...[...issueMap.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([relativePath, reason]) => ({ relativePath, reason })));
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
