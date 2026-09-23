import { createHash } from "node:crypto";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// v0.4.6 Batch 5 -- pure, independently-testable helpers for
// scripts/verify-packed-package.mjs. Kept as a real TypeScript module
// (rather than inline in the .mjs entrypoint) so it compiles into
// dist/scripts/verifyPackedPackageHelpers.js and can be imported both by
// the acceptance script (dynamic import from dist/, after a build) and
// directly by focused tests, matching the existing scripts/verify-benchmarks.ts
// convention in this repository.
// ---------------------------------------------------------------------------

export function findExactlyOneTarball(filenames: string[]): string {
  const tarballs = filenames.filter((name) => name.endsWith(".tgz"));
  if (tarballs.length === 0) {
    throw new Error("npm pack produced no .tgz file in the pack destination directory.");
  }
  if (tarballs.length > 1) {
    throw new Error(
      `npm pack destination contains ${tarballs.length} .tgz files; expected exactly one: ${tarballs.join(", ")}`
    );
  }
  return tarballs[0];
}

export type InstalledPackageJson = {
  name?: string;
  version?: string;
  engines?: { node?: string };
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type ExpectedPackageIdentity = {
  name: string;
  version: string;
  enginesNode: string | undefined;
  binName: string;
  binTarget: string | undefined;
};

export function validateInstalledPackageIdentity(
  installedPackageJson: InstalledPackageJson,
  expected: ExpectedPackageIdentity
): string[] {
  const problems: string[] = [];
  if (installedPackageJson.name !== expected.name) {
    problems.push(`name mismatch: expected "${expected.name}", got "${installedPackageJson.name}"`);
  }
  if (installedPackageJson.version !== expected.version) {
    problems.push(`version mismatch: expected "${expected.version}", got "${installedPackageJson.version}"`);
  }
  if (installedPackageJson.engines?.node !== expected.enginesNode) {
    problems.push(
      `engines.node mismatch: expected "${expected.enginesNode}", got "${installedPackageJson.engines?.node}"`
    );
  }
  const actualBinTarget = installedPackageJson.bin?.[expected.binName];
  if (actualBinTarget !== expected.binTarget) {
    problems.push(`bin.${expected.binName} mismatch: expected "${expected.binTarget}", got "${actualBinTarget}"`);
  }
  return problems;
}

export function validatePlaywrightRuntimeDependency(
  installedPackageJson: InstalledPackageJson,
  expectedVersion: string
): string[] {
  const problems: string[] = [];
  if (installedPackageJson.dependencies?.playwright !== expectedVersion) {
    problems.push(`dependencies.playwright mismatch: expected "${expectedVersion}", got "${installedPackageJson.dependencies?.playwright}"`);
  }
  if (installedPackageJson.devDependencies?.playwright !== undefined) {
    problems.push("playwright must not remain in devDependencies");
  }
  return problems;
}

export function missingRequiredTarballPaths(files: Iterable<string>, required: readonly string[]): string[] {
  const available = new Set(Array.from(files, (file) => file.replace(/\\/g, "/")));
  return required.filter((file) => !available.has(file));
}

export function validateManifestRelativePaths(
  manifest: { artifacts?: Array<{ path?: string }> },
  runRoot = "runRoot"
): string[] {
  const problems: string[] = [];
  for (const artifact of manifest.artifacts ?? []) {
    if (!artifact.path) continue;
    const artifactPath = artifact.path;
    if (path.posix.isAbsolute(artifactPath) || /^[A-Za-z]:/.test(artifactPath) || artifactPath.includes("\\")) {
      problems.push(`manifest path is not relative POSIX: ${artifactPath}`);
      continue;
    }
    const resolved = path.posix.normalize(path.posix.join("/", artifactPath));
    if (artifactPath === ".." || artifactPath.startsWith("../") || resolved === "/" || resolved.startsWith("/../") || resolved === "/..") {
      problems.push(`manifest path escapes ${runRoot}: ${artifactPath}`);
    }
  }
  return problems;
}

// v0.5.2 Batch 6 -- warm-index real-agent campaign gallery acceptance.
const EXPECTED_WARM_CAMPAIGN_GALLERY_ITEM_IDS = [
  "warm-index-campaign-report",
  "warm-index-campaign-plots",
  "warm-index-execution"
];

type WarmIndexCampaignGalleryManifestItem = {
  id?: string;
  htmlPath?: string;
  summaryPath?: string;
  runsPath?: string;
  screenshotPath?: string;
  artifactPaths?: string[];
};

function isBoundedRelativePath(value: string): boolean {
  return !path.win32.isAbsolute(value) && !path.posix.isAbsolute(value) && !/^[A-Za-z]:/.test(value) && !value.includes("\\");
}

/**
 * Proves the narrow warm-index campaign gallery contract from Batch 5/6: exactly the three
 * expected item ids, in order, and every path field/artifactPaths entry a bounded relative POSIX
 * path that never links detailed per-agent evidence (agents/) or provider stdout/stderr/telemetry.
 */
export function validateWarmIndexCampaignGalleryManifest(manifest: { items?: WarmIndexCampaignGalleryManifestItem[] }): string[] {
  const problems: string[] = [];
  const items = manifest.items ?? [];
  const ids = items.map((item) => item.id);
  if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_WARM_CAMPAIGN_GALLERY_ITEM_IDS)) {
    problems.push(`expected gallery item ids ${JSON.stringify(EXPECTED_WARM_CAMPAIGN_GALLERY_ITEM_IDS)}, got ${JSON.stringify(ids)}`);
  }
  for (const item of items) {
    const pathFields: Array<[string, string | undefined]> = [
      ["htmlPath", item.htmlPath],
      ["summaryPath", item.summaryPath],
      ["runsPath", item.runsPath],
      ["screenshotPath", item.screenshotPath]
    ];
    for (const [field, value] of pathFields) {
      if (!value) continue;
      if (!isBoundedRelativePath(value)) {
        problems.push(`item ${item.id} field ${field} is not a bounded relative POSIX path: ${value}`);
      }
      if (/agents\//.test(value) || /\bstdout\b|\bstderr\b|telemetry/i.test(value)) {
        problems.push(`item ${item.id} field ${field} links detailed/forensic agent evidence: ${value}`);
      }
    }
    for (const artifactPath of item.artifactPaths ?? []) {
      if (!isBoundedRelativePath(artifactPath)) {
        problems.push(`item ${item.id} artifactPaths entry is not a bounded relative POSIX path: ${artifactPath}`);
      }
      if (/agents\//.test(artifactPath) || /\bstdout\b|\bstderr\b|telemetry/i.test(artifactPath)) {
        problems.push(`item ${item.id} artifactPaths entry links detailed/forensic agent evidence: ${artifactPath}`);
      }
    }
  }
  return problems;
}

export type DirectorySnapshotEntry = [relativePath: string, sha256: string];

// Deterministic recursive snapshot: sorted relative POSIX-style paths ->
// SHA-256 content hash, for every regular file under root.
export async function snapshotDirectory(root: string): Promise<DirectorySnapshotEntry[]> {
  const entries: DirectorySnapshotEntry[] = [];
  async function walk(dir: string): Promise<void> {
    const dirEntries = await readdir(dir, { withFileTypes: true });
    for (const entry of dirEntries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = path.relative(root, fullPath).split(path.sep).join("/");
        const content = await readFile(fullPath);
        const hash = createHash("sha256").update(content).digest("hex");
        entries.push([relPath, hash]);
      }
    }
  }
  await walk(root);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries;
}

export function diffSnapshots(before: DirectorySnapshotEntry[], after: DirectorySnapshotEntry[]): string[] {
  const beforeMap = new Map(before);
  const afterMap = new Map(after);
  const changes: string[] = [];
  for (const [relPath, hash] of beforeMap) {
    if (!afterMap.has(relPath)) {
      changes.push(`removed: ${relPath}`);
    } else if (afterMap.get(relPath) !== hash) {
      changes.push(`modified: ${relPath}`);
    }
  }
  for (const [relPath] of afterMap) {
    if (!beforeMap.has(relPath)) {
      changes.push(`added: ${relPath}`);
    }
  }
  return changes;
}
