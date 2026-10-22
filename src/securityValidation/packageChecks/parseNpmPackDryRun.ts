// Parse the file list from npm pack --dry-run output.
// npm pack --dry-run does not support --json on all npm versions,
// so we parse the human-readable text output.

export type NpmPackDryRunParseResult = {
  files: string[];
  totalSize?: string;
  parseError?: string;
};

// Extract the indented file list from npm pack --dry-run text output.
// Format emitted by npm v7+:
//   npm notice
//   npm notice 📦  my-dev-kit-lab@0.1.0
//   npm notice === Tarball Contents ===
//   npm notice 1.2kB  README.md
//   npm notice === Tarball Details ===
//   ...
export function parseNpmPackDryRun(stdout: string): NpmPackDryRunParseResult {
  if (!stdout.trim()) {
    return { files: [], parseError: "npm pack --dry-run produced no output" };
  }

  if (/^[\[{]/.test(stdout.trim())) {
    const parsed = parseNpmPackJsonEntry(stdout);
    if (!parsed.entry) return { files: [], parseError: parsed.parseError };
    // JSON paths are package-relative, unlike text tarball paths. Add the
    // archive root exactly once so a real nested package/ directory cannot
    // masquerade as a root entrypoint in the existing detectors.
    return { files: parsed.entry.files.map((file) => `package/${file}`) };
  }

  const files: string[] = [];
  let inContents = false;
  let totalSize: string | undefined;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine
      .replace(/^npm notice\s*/i, "")
      .replace(/npm warn.*$/i, "")
      .trim();

    if (/^(?:===\s*)?tarball contents(?:\s*===)?$/i.test(line)) {
      inContents = true;
      continue;
    }
    if (/^(?:===\s*)?tarball details(?:\s*===)?$/i.test(line)) {
      inContents = false;
      continue;
    }

    if (inContents && line) {
      // Strip leading size info (e.g., "1.2kB  README.md" → "README.md")
      const match = line.match(/^[\d.]+\s*[kKmMgGbB]+\s+(.+)$/);
      if (match?.[1]) {
        files.push(match[1].trim());
      } else return { files: [], parseError: "Malformed npm tarball contents line" };
    }

    const totalMatch = line.match(/total files\s*:\s*(\d+)/i) ?? line.match(/unpacked size\s*:\s*([\d.]+\s*[kKmMgGbB]+)/i);
    if (totalMatch?.[1]) {
      totalSize = totalMatch[1];
    }
  }

  if (files.length === 0) {
    return {
      files,
      totalSize,
      parseError: "npm pack --dry-run: no files detected in tarball contents section",
    };
  }

  if (files.some((file) => !safeInventoryPath(file))) {
    return { files: [], parseError: "npm pack contains an unsafe file path" };
  }
  return { files, totalSize };
}

export type NpmPackJsonEntry = {
  name?: string;
  version?: string;
  filename?: string;
  // Package-relative, slash-normalized, validated paths.
  files: string[];
};

export type NpmPackJsonEntryResult = { entry?: NpmPackJsonEntry; parseError?: string };

// Validated single-package entry from `npm pack --json` (or --dry-run --json) output, accepting both
// the npm 11 array shape and the npm 12 identity-keyed object shape. Exactly one package with a
// nonempty, safe file list is required; anything else is an error, never an empty success.
export function parseNpmPackJsonEntry(stdout: string): NpmPackJsonEntryResult {
  try {
    const packages = packageInventories(JSON.parse(stdout));
    const inventory = packages?.length === 1 ? packages[0] : null;
    if (!isPlainObject(inventory) || !Array.isArray(inventory.files) || !inventory.files.length) {
      return { parseError: "npm pack JSON must contain exactly one nonempty package inventory" };
    }
    const files: string[] = [];
    for (const file of inventory.files) {
      if (!file || typeof file.path !== "string" || !safeInventoryPath(file.path)) {
        return { parseError: "npm pack JSON contains a malformed or unsafe file path" };
      }
      files.push(file.path.replace(/\\/g, "/").replace(/^(\.\/)+/, ""));
    }
    const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
    return { entry: { name: text(inventory.name), version: text(inventory.version), filename: text(inventory.filename), files } };
  } catch {
    return { parseError: "npm pack JSON is unparseable" };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The package inventories in `npm pack --json` output. npm 11 and earlier print an array of package
// objects; npm 12 prints one object keyed by package identity whose values are the package objects.
// Anything else (including a bare package object, or a keyed object holding non-objects) is not a
// recognized shape and yields null, so it can never be read as an empty or successful package.
function packageInventories(output: unknown): unknown[] | null {
  if (Array.isArray(output)) return output;
  if (!isPlainObject(output)) return null;
  const packages = Object.values(output);
  return packages.every(isPlainObject) ? packages : null;
}

function safeInventoryPath(file: string): boolean {
  const normalized = file.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  return Boolean(normalized) && !normalized.startsWith("/") &&
    !/[\x00-\x1f\x7f:]/.test(normalized) &&
    normalized.split("/").every((part) => Boolean(part) && part !== "." && part !== "..");
}
