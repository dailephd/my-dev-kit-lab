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
      } else {
        // Fallback: take the whole line if size pattern doesn't match
        files.push(line);
      }
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

  return { files, totalSize };
}
