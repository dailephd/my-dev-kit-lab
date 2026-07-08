import fs from "node:fs";
import path from "node:path";
import type { ProjectInventorySnapshot } from "./projectInventory.js";
import { splitLines } from "./textLines.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 2 — source-of-truth collector.
//
// Reads package.json/package-lock.json/docs/CI-workflow/config *facts* only.
// Never executes a command, never calls security:validate or an experiment
// command, and never produces an AuditIssue -- this is data collection for
// later detector batches to consume, same spirit as projectInventory.ts.
// Reuses the already-computed ProjectInventorySnapshot for file discovery
// (docs/ci/test file lists) rather than re-walking the filesystem.
// ---------------------------------------------------------------------------

export const SCRIPT_GROUPS = ["build", "test", "security", "experiment", "audit", "docs", "release", "other"] as const;
export type ScriptGroup = (typeof SCRIPT_GROUPS)[number];

export type PackageTruth = {
  name: string | null;
  version: string | null;
  description: string | null;
  bin: Record<string, string> | string | null;
  main: string | null;
  module: string | null;
  types: string | null;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string> | null;
  engines: Record<string, string> | null;
  files: string[] | null;
  packageManagerHint: string | null;
};

export type LockfileTruth = {
  present: boolean;
  rootName: string | null;
  rootVersion: string | null;
  lockfileVersion: number | null;
  // null when there is no basis for comparison (no lockfile, or no package
  // name to compare against) -- this is a metadata signal only, never an
  // AuditIssue, per Batch 2 scope.
  packageManagerConsistent: boolean | null;
};

export type CommandTruth = {
  scriptsByGroup: Record<ScriptGroup, string[]>;
  allScriptNames: string[];
};

export type DocsFileTruth = {
  relativePath: string;
  title: string | null;
  mentionsAudit: boolean;
  mentionsSecurityValidation: boolean;
  mentionsExperiments: boolean;
  mentionsReleasePublish: boolean;
  mentionsPlannedCommands: boolean;
  mentionsCurrentCommands: boolean;
};

export type DocsTruth = {
  files: DocsFileTruth[];
  hasReadme: boolean;
  hasChangelog: boolean;
};

export type CiWorkflowTruth = {
  relativePath: string;
  name: string | null;
  nodeVersionsReferenced: string[];
  packageManagerCommandsReferenced: string[];
  npmScriptsReferenced: string[];
};

export type CiTruth = {
  workflows: CiWorkflowTruth[];
};

export type BuildToolingTruth = {
  hasTsconfig: boolean;
  tsconfigPaths: string[];
  hasVitestConfig: boolean;
  vitestConfigPaths: string[];
  hasEslintConfig: boolean;
  eslintConfigPaths: string[];
  hasBuildScript: boolean;
  hasTypecheckScript: boolean;
  hasTestScript: boolean;
};

export type TestTruth = {
  totalTestFileCount: number;
  auditTestFileCount: number;
  securityTestFileCount: number;
  experimentTestFileCount: number;
  testFilesByTopLevelArea: Record<string, number>;
};

export type SecurityTruth = {
  hasSecurityValidateScript: boolean;
  hasSecurityDepsScript: boolean;
  hasSecurityPackageScript: boolean;
  hasSecurityCodeqlScript: boolean;
  hasSecuritySemgrepScript: boolean;
  hasTestSecurityScript: boolean;
  hasSecurityValidationSourceDir: boolean;
};

export type ExperimentTruth = {
  hasExperimentListScript: boolean;
  hasExperimentDescribeScript: boolean;
  hasExperimentRunScript: boolean;
  hasExperimentsSourceDir: boolean;
};

export type SourceOfTruthSnapshot = {
  targetRoot: string;
  package: PackageTruth | null;
  lockfile: LockfileTruth;
  commands: CommandTruth;
  docs: DocsTruth;
  ci: CiTruth;
  buildTooling: BuildToolingTruth;
  tests: TestTruth;
  security: SecurityTruth;
  experiment: ExperimentTruth;
  warnings: string[];
};

const MAX_DOCS_READ_BYTES = 200_000;
const MAX_CI_READ_BYTES = 100_000;

export function collectSourceOfTruth(targetRoot: string, inventory: ProjectInventorySnapshot): SourceOfTruthSnapshot {
  const resolvedRoot = path.resolve(targetRoot);
  const warnings: string[] = [];

  const pkg = readPackageTruth(resolvedRoot, warnings);
  const lockfile = readLockfileTruth(resolvedRoot, pkg, warnings);
  const commands = classifyCommands(pkg);
  const docs = readDocsTruth(resolvedRoot, inventory, warnings);
  const ci = readCiTruth(resolvedRoot, inventory, warnings);
  const buildTooling = readBuildToolingTruth(inventory, pkg);
  const tests = readTestTruth(inventory);
  const security = readSecurityTruth(resolvedRoot, pkg);
  const experiment = readExperimentTruth(resolvedRoot, pkg);

  return {
    targetRoot: resolvedRoot,
    package: pkg,
    lockfile,
    commands,
    docs,
    ci,
    buildTooling,
    tests,
    security,
    experiment,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Package truth
// ---------------------------------------------------------------------------

type RawPackageJson = {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  bin?: unknown;
  main?: unknown;
  module?: unknown;
  types?: unknown;
  typings?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  engines?: unknown;
  files?: unknown;
  packageManager?: unknown;
};

function readPackageTruth(targetRoot: string, warnings: string[]): PackageTruth | null {
  const pkgPath = path.join(targetRoot, "package.json");
  let raw: RawPackageJson;
  try {
    raw = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as RawPackageJson;
  } catch {
    return null;
  }

  try {
    return {
      name: typeof raw.name === "string" ? raw.name : null,
      version: typeof raw.version === "string" ? raw.version : null,
      description: typeof raw.description === "string" ? raw.description : null,
      bin: isRecordOfStrings(raw.bin) || typeof raw.bin === "string" ? (raw.bin as Record<string, string> | string) : null,
      main: typeof raw.main === "string" ? raw.main : null,
      module: typeof raw.module === "string" ? raw.module : null,
      types: typeof raw.types === "string" ? raw.types : typeof raw.typings === "string" ? raw.typings : null,
      scripts: isRecordOfStrings(raw.scripts) ? raw.scripts : {},
      dependencies: isRecordOfStrings(raw.dependencies) ? raw.dependencies : {},
      devDependencies: isRecordOfStrings(raw.devDependencies) ? raw.devDependencies : {},
      peerDependencies: isRecordOfStrings(raw.peerDependencies) ? raw.peerDependencies : null,
      engines: isRecordOfStrings(raw.engines) ? raw.engines : null,
      files: Array.isArray(raw.files) ? raw.files.filter((f): f is string => typeof f === "string") : null,
      packageManagerHint: typeof raw.packageManager === "string" ? raw.packageManager : null,
    };
  } catch (err) {
    warnings.push(`Could not fully parse package.json fields: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

// ---------------------------------------------------------------------------
// Lockfile truth
// ---------------------------------------------------------------------------

type RawPackageLock = {
  name?: unknown;
  version?: unknown;
  lockfileVersion?: unknown;
  packages?: Record<string, { name?: unknown; version?: unknown } | undefined>;
};

function readLockfileTruth(targetRoot: string, pkg: PackageTruth | null, warnings: string[]): LockfileTruth {
  const lockPath = path.join(targetRoot, "package-lock.json");
  let raw: RawPackageLock;
  try {
    raw = JSON.parse(fs.readFileSync(lockPath, "utf8")) as RawPackageLock;
  } catch {
    return { present: false, rootName: null, rootVersion: null, lockfileVersion: null, packageManagerConsistent: null };
  }

  try {
    const rootPackageEntry = raw.packages?.[""];
    const rootName = typeof raw.name === "string" ? raw.name : typeof rootPackageEntry?.name === "string" ? rootPackageEntry.name : null;
    const rootVersion =
      typeof raw.version === "string" ? raw.version : typeof rootPackageEntry?.version === "string" ? rootPackageEntry.version : null;
    const lockfileVersion = typeof raw.lockfileVersion === "number" ? raw.lockfileVersion : null;

    const packageManagerConsistent =
      pkg?.name != null && rootName != null ? pkg.name === rootName && pkg.version === rootVersion : null;

    return { present: true, rootName, rootVersion, lockfileVersion, packageManagerConsistent };
  } catch (err) {
    warnings.push(`Could not fully parse package-lock.json fields: ${err instanceof Error ? err.message : String(err)}`);
    return { present: true, rootName: null, rootVersion: null, lockfileVersion: null, packageManagerConsistent: null };
  }
}

// ---------------------------------------------------------------------------
// Command/script truth
// ---------------------------------------------------------------------------

function classifyScriptGroup(scriptName: string): ScriptGroup {
  const name = scriptName.toLowerCase();
  if (name.startsWith("security") || name === "test:security" || name.startsWith("test:fuzz")) return "security";
  if (name.startsWith("experiment")) return "experiment";
  if (name === "audit" || name.startsWith("audit:")) return "audit";
  if (name === "test" || name.startsWith("test:")) return "test";
  if (name === "build" || name === "typecheck" || name === "clean" || name.includes("build")) return "build";
  if (name.includes("doc")) return "docs";
  if (name.includes("release") || name.includes("publish") || name.includes("pack") || name.includes("version")) {
    return "release";
  }
  return "other";
}

function classifyCommands(pkg: PackageTruth | null): CommandTruth {
  const scriptsByGroup = Object.fromEntries(SCRIPT_GROUPS.map((g) => [g, [] as string[]])) as Record<
    ScriptGroup,
    string[]
  >;
  if (!pkg) {
    return { scriptsByGroup, allScriptNames: [] };
  }

  const allScriptNames = Object.keys(pkg.scripts).sort((a, b) => a.localeCompare(b));
  for (const name of allScriptNames) {
    scriptsByGroup[classifyScriptGroup(name)].push(name);
  }
  return { scriptsByGroup, allScriptNames };
}

// ---------------------------------------------------------------------------
// Docs truth
// ---------------------------------------------------------------------------

function readDocsTruth(targetRoot: string, inventory: ProjectInventorySnapshot, warnings: string[]): DocsTruth {
  const files: DocsFileTruth[] = [];
  let hasReadme = false;
  let hasChangelog = false;

  for (const entry of inventory.docsFiles) {
    const basename = path.basename(entry.relativePath).toLowerCase();
    if (basename === "readme.md") hasReadme = true;
    if (basename === "changelog.md") hasChangelog = true;

    const fullPath = path.join(targetRoot, entry.relativePath);
    let content = "";
    try {
      if (entry.sizeBytes <= MAX_DOCS_READ_BYTES) {
        content = fs.readFileSync(fullPath, "utf8");
      }
    } catch (err) {
      warnings.push(`Could not read docs file: ${entry.relativePath} (${err instanceof Error ? err.message : String(err)})`);
    }

    const titleMatch = content.match(/^#\s+(.+)$/m);
    files.push({
      relativePath: entry.relativePath,
      title: titleMatch ? titleMatch[1].trim() : null,
      mentionsAudit: /\baudit\b/i.test(content),
      mentionsSecurityValidation: /security[- ]?valid|security:validate/i.test(content),
      mentionsExperiments: /\bexperiment/i.test(content),
      mentionsReleasePublish: /\b(release|publish|npm publish)\b/i.test(content),
      mentionsPlannedCommands: /\bplanned\b/i.test(content),
      mentionsCurrentCommands: /\bcurrent\b/i.test(content),
    });
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files, hasReadme, hasChangelog };
}

// ---------------------------------------------------------------------------
// CI/workflow truth
// ---------------------------------------------------------------------------

function readCiTruth(targetRoot: string, inventory: ProjectInventorySnapshot, warnings: string[]): CiTruth {
  const workflows: CiWorkflowTruth[] = [];

  for (const entry of inventory.ciFiles) {
    const fullPath = path.join(targetRoot, entry.relativePath);
    let content = "";
    try {
      if (entry.sizeBytes <= MAX_CI_READ_BYTES) {
        content = fs.readFileSync(fullPath, "utf8");
      }
    } catch (err) {
      warnings.push(`Could not read workflow file: ${entry.relativePath} (${err instanceof Error ? err.message : String(err)})`);
    }

    workflows.push({
      relativePath: entry.relativePath,
      name: parseWorkflowName(content),
      nodeVersionsReferenced: parseNodeVersions(content),
      packageManagerCommandsReferenced: parsePackageManagerCommands(content),
      npmScriptsReferenced: parseNpmScriptsReferenced(content),
    });
  }

  workflows.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { workflows };
}

function parseWorkflowName(content: string): string | null {
  const match = content.match(/^name:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function parseNodeVersions(content: string): string[] {
  const versions = new Set<string>();

  // Inline form: node-version: 20
  for (const match of content.matchAll(/node-version:\s*["']?([\w.]+)["']?\s*$/gm)) {
    versions.add(match[1]);
  }

  // List form:
  //   node-version:
  //     - 20
  //     - 22
  // v0.3.0 Batch 6 — use the canonical splitLines() helper instead of a raw
  // string split on a newline character, so CRLF-authored workflow files
  // (trailing carriage-return on every line) don't silently break the
  // list-item regex below (see src/audits/core/textLines.ts's header
  // comment). A bare split here is also exactly what
  // crossPlatformRotDetector.ts's raw-split-detection check flags in any
  // other src/audits/ file.
  const lines = splitLines(content);
  for (let i = 0; i < lines.length; i++) {
    if (/node-version:\s*$/.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        const listItem = lines[j].match(/^\s*-\s*["']?([\w.]+)["']?\s*$/);
        if (!listItem) break;
        versions.add(listItem[1]);
      }
    }
  }

  return [...versions].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function parsePackageManagerCommands(content: string): string[] {
  const commands = new Set<string>();
  for (const match of content.matchAll(/\bnpm (ci|install|publish|pack|audit|outdated)\b/g)) {
    commands.add(`npm ${match[1]}`);
  }
  for (const match of content.matchAll(/\bnpx [\w.:-]+/g)) {
    commands.add(match[0].trim());
  }
  return [...commands].sort((a, b) => a.localeCompare(b));
}

function parseNpmScriptsReferenced(content: string): string[] {
  const scripts = new Set<string>();
  for (const match of content.matchAll(/\bnpm run ([\w:.-]+)/g)) {
    scripts.add(match[1]);
  }
  return [...scripts].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Build tooling truth
// ---------------------------------------------------------------------------

function readBuildToolingTruth(inventory: ProjectInventorySnapshot, pkg: PackageTruth | null): BuildToolingTruth {
  const tsconfigPaths = inventory.files
    .filter((f) => /^tsconfig(\..+)?\.json$/.test(path.basename(f.relativePath)))
    .map((f) => f.relativePath)
    .sort((a, b) => a.localeCompare(b));

  const vitestConfigPaths = inventory.files
    .filter((f) => /^vitest\.config\.[jt]s$/.test(path.basename(f.relativePath)) || path.basename(f.relativePath) === "vitest.workspace.ts")
    .map((f) => f.relativePath)
    .sort((a, b) => a.localeCompare(b));

  const eslintConfigPaths = inventory.files
    .filter(
      (f) =>
        /^\.eslintrc(\..+)?$/.test(path.basename(f.relativePath)) || /^eslint\.config\.[jt]s$/.test(path.basename(f.relativePath))
    )
    .map((f) => f.relativePath)
    .sort((a, b) => a.localeCompare(b));

  const scripts = pkg?.scripts ?? {};
  return {
    hasTsconfig: tsconfigPaths.length > 0,
    tsconfigPaths,
    hasVitestConfig: vitestConfigPaths.length > 0,
    vitestConfigPaths,
    hasEslintConfig: eslintConfigPaths.length > 0,
    eslintConfigPaths,
    hasBuildScript: "build" in scripts,
    hasTypecheckScript: "typecheck" in scripts,
    hasTestScript: "test" in scripts,
  };
}

// ---------------------------------------------------------------------------
// Test truth
// ---------------------------------------------------------------------------

function readTestTruth(inventory: ProjectInventorySnapshot): TestTruth {
  const testFilesByTopLevelArea: Record<string, number> = {};
  let auditTestFileCount = 0;
  let securityTestFileCount = 0;
  let experimentTestFileCount = 0;

  for (const file of inventory.testFiles) {
    const match = file.relativePath.match(/^tests\/([^/]+)\//);
    const area = match ? match[1] : "other";
    testFilesByTopLevelArea[area] = (testFilesByTopLevelArea[area] ?? 0) + 1;

    if (area === "audits") auditTestFileCount += 1;
    if (area === "security") securityTestFileCount += 1;
    if (area === "experiments") experimentTestFileCount += 1;
  }

  const orderedAreas = Object.fromEntries(
    Object.entries(testFilesByTopLevelArea).sort(([a], [b]) => a.localeCompare(b))
  );

  return {
    totalTestFileCount: inventory.testFiles.length,
    auditTestFileCount,
    securityTestFileCount,
    experimentTestFileCount,
    testFilesByTopLevelArea: orderedAreas,
  };
}

// ---------------------------------------------------------------------------
// Security / experiment truth (script + directory presence only)
// ---------------------------------------------------------------------------

function readSecurityTruth(targetRoot: string, pkg: PackageTruth | null): SecurityTruth {
  const scripts = pkg?.scripts ?? {};
  return {
    hasSecurityValidateScript: "security:validate" in scripts,
    hasSecurityDepsScript: "security:deps" in scripts,
    hasSecurityPackageScript: "security:package" in scripts,
    hasSecurityCodeqlScript: "security:codeql" in scripts,
    hasSecuritySemgrepScript: "security:semgrep" in scripts,
    hasTestSecurityScript: "test:security" in scripts,
    hasSecurityValidationSourceDir: dirExists(path.join(targetRoot, "src", "securityValidation")),
  };
}

function readExperimentTruth(targetRoot: string, pkg: PackageTruth | null): ExperimentTruth {
  const scripts = pkg?.scripts ?? {};
  return {
    hasExperimentListScript: "experiment:list" in scripts,
    hasExperimentDescribeScript: "experiment:describe" in scripts,
    hasExperimentRunScript: "experiment:run" in scripts,
    hasExperimentsSourceDir: dirExists(path.join(targetRoot, "src", "experiments")),
  };
}

function dirExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}
