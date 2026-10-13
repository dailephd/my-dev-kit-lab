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
    try {
      const inventory: unknown = JSON.parse(stdout);
      if (!Array.isArray(inventory) || inventory.length !== 1 ||
          !inventory[0] || !Array.isArray(inventory[0].files) || !inventory[0].files.length) {
        return { files: [], parseError: "npm pack JSON must contain exactly one nonempty package inventory" };
      }
      const files: string[] = [];
      for (const file of inventory[0].files) {
        if (!file || typeof file.path !== "string" || !safeInventoryPath(file.path)) {
          return { files: [], parseError: "npm pack JSON contains a malformed or unsafe file path" };
        }
        // JSON paths are package-relative, unlike text tarball paths. Add the
        // archive root exactly once so a real nested package/ directory cannot
        // masquerade as a root entrypoint in the existing detectors.
        files.push(`package/${file.path.replace(/\\/g, "/").replace(/^(\.\/)+/, "")}`);
      }
      return { files };
    } catch {
      return { files: [], parseError: "npm pack JSON is unparseable" };
    }
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

function safeInventoryPath(file: string): boolean {
  const normalized = file.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  return Boolean(normalized) && !normalized.startsWith("/") &&
    !/[\x00-\x1f\x7f:]/.test(normalized) &&
    normalized.split("/").every((part) => Boolean(part) && part !== "." && part !== "..");
}
