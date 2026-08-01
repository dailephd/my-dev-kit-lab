import type { SecurityFinding } from "../types.js";

export const REQUIRED_PACKAGE_CONTENTS = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "dist/scripts/run-final-demo.js",
  "dist/src/index.js",
  "package.json",
] as const;

function normalizeTarballPath(file: string): string {
  const normalized = file.replace(/\\/g, "/");
  return normalized.startsWith("package/")
    ? normalized.slice("package/".length)
    : normalized;
}

export function detectMissingRequiredContents(options: {
  files: string[];
  requiredFiles?: readonly string[];
  checkId: string;
}): { missing: string[]; findings: SecurityFinding[] } {
  const present = new Set(options.files.map(normalizeTarballPath));
  const required = [...(options.requiredFiles ?? REQUIRED_PACKAGE_CONTENTS)]
    .map(normalizeTarballPath)
    .sort((left, right) => left.localeCompare(right));
  const missing = required.filter((file) => !present.has(file));

  const findings = missing.map((file, index): SecurityFinding => ({
    id: `${options.checkId}-required-missing-${index}`,
    title: `Required file missing from npm tarball: package/${file}`,
    severity: "blocker",
    category: "package-content",
    description: `The required release file 'package/${file}' is absent from the npm package inventory`,
    evidence: `Missing required path: package/${file}`,
    affectedFiles: [file],
    recommendation: `Include '${file}' in the package files allowlist or restore the expected build output`,
    releaseImpact: "Blocker: the npm package is incomplete and must not be published",
  }));

  return { missing, findings };
}
