import fs from "node:fs";
import path from "node:path";
import type { ProjectInventorySnapshot } from "./projectInventory.js";

// ---------------------------------------------------------------------------
// v0.3.2 Batch 1 -- lightweight Python project/package metadata detection.
//
// Not owned by sourceOfTruth.ts: that module's PackageTruth/CommandTruth/
// CiTruth family is specifically about my-dev-kit-lab's OWN npm/package.json
// conventions (this tool's source of truth about itself), whereas this
// module inspects the TARGET project under audit -- which may be an
// external, non-npm, Python project. Same spirit as projectInventory.ts and
// collectSourceFacts.ts: pure data collection, no AuditIssue, no target
// mutation, no subprocess execution.
//
// Presence-only plus conservative single-line text extraction -- no TOML/INI
// parser dependency is added (none exists in this repo yet), no Python/pip/
// poetry/tox/uv command is ever run, and no dependency resolution is
// attempted. `projectName` is populated only when a simple, unambiguous
// `name = "..."` (or `'...'`) pattern is found; anything more structurally
// complex is left as null rather than guessed at.
// ---------------------------------------------------------------------------

export type PythonProjectMetadataSnapshot = {
  hasPyprojectToml: boolean;
  hasRequirementsTxt: boolean;
  hasSetupPy: boolean;
  hasSetupCfg: boolean;
  hasToxIni: boolean;
  hasPytestIni: boolean;
  // True when pytest.ini exists, or a pytest configuration section was
  // detected inside pyproject.toml ([tool.pytest.ini_options]) or setup.cfg
  // ([tool:pytest]).
  hasPytestConfiguration: boolean;
  projectName: string | null;
  warnings: string[];
};

const PYPROJECT_PROJECT_NAME_PATTERN = /^\s*name\s*=\s*["']([^"']+)["']\s*$/m;
const PYPROJECT_PYTEST_SECTION_PATTERN = /^\s*\[tool\.pytest\.ini_options\]\s*$/m;
const SETUP_CFG_PYTEST_SECTION_PATTERN = /^\s*\[tool:pytest\]\s*$/m;
const INI_SECTION_HEADER_PATTERN = /^\s*\[([^\]]+)\]\s*$/;
const INI_NAME_KEY_PATTERN = /^\s*name\s*=\s*(.+?)\s*$/;

// Extracts the `name = ...` value from a setup.cfg-style [metadata] section
// via a simple line scan (no INI parser dependency) -- stops at the next
// "[section]" header or end of file.
function extractSetupCfgProjectName(content: string): string | null {
  const lines = content.split(/\r\n|\r|\n/);
  let inMetadataSection = false;
  for (const line of lines) {
    const sectionMatch = line.match(INI_SECTION_HEADER_PATTERN);
    if (sectionMatch) {
      inMetadataSection = sectionMatch[1].trim().toLowerCase() === "metadata";
      continue;
    }
    if (!inMetadataSection) continue;
    const nameMatch = line.match(INI_NAME_KEY_PATTERN);
    if (nameMatch) return nameMatch[1];
  }
  return null;
}

export function collectPythonProjectMetadata(
  targetRoot: string,
  inventory: ProjectInventorySnapshot
): PythonProjectMetadataSnapshot {
  const warnings: string[] = [];
  const knownPaths = new Set(inventory.files.map((f) => f.relativePath));
  const has = (name: string) => knownPaths.has(name);

  const hasPyprojectToml = has("pyproject.toml");
  const hasRequirementsTxt = has("requirements.txt");
  const hasSetupPy = has("setup.py");
  const hasSetupCfg = has("setup.cfg");
  const hasToxIni = has("tox.ini");
  const hasPytestIni = has("pytest.ini");

  let projectName: string | null = null;
  let pytestSectionDetected = false;

  if (hasPyprojectToml) {
    const content = readSafely(targetRoot, "pyproject.toml", warnings);
    if (content !== null) {
      const nameMatch = content.match(PYPROJECT_PROJECT_NAME_PATTERN);
      if (nameMatch) projectName = nameMatch[1];
      if (PYPROJECT_PYTEST_SECTION_PATTERN.test(content)) pytestSectionDetected = true;
    }
  }

  if (hasSetupCfg) {
    const content = readSafely(targetRoot, "setup.cfg", warnings);
    if (content !== null) {
      if (projectName === null) {
        projectName = extractSetupCfgProjectName(content);
      }
      if (SETUP_CFG_PYTEST_SECTION_PATTERN.test(content)) pytestSectionDetected = true;
    }
  }

  return {
    hasPyprojectToml,
    hasRequirementsTxt,
    hasSetupPy,
    hasSetupCfg,
    hasToxIni,
    hasPytestIni,
    hasPytestConfiguration: hasPytestIni || pytestSectionDetected,
    projectName,
    warnings,
  };
}

function readSafely(targetRoot: string, relativePath: string, warnings: string[]): string | null {
  try {
    return fs.readFileSync(path.join(targetRoot, relativePath), "utf8");
  } catch (err) {
    warnings.push(`Could not read ${relativePath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
