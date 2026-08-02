import type { SecurityFinding } from "../types.js";
import type { PackageContentRequirement } from "./packageContentPolicy.js";

function normalizeTarballPath(file: string): string {
  const normalized = file.replace(/\\/g, "/");
  return normalized.startsWith("package/")
    ? normalized.slice("package/".length)
    : normalized;
}

export function detectMissingRequiredContents(options: {
  files: string[];
  requirements: readonly PackageContentRequirement[];
  checkId: string;
}): { missing: PackageContentRequirement[]; findings: SecurityFinding[] } {
  const present = new Set(options.files.map(normalizeTarballPath));
  const required = [...options.requirements]
    .map((requirement) => ({ ...requirement, expectedPath: normalizeTarballPath(requirement.expectedPath) }))
    .sort((left, right) => `${left.expectedPath}\u0000${left.declaringMetadataField}`.localeCompare(`${right.expectedPath}\u0000${right.declaringMetadataField}`));
  const missing = required.filter((requirement) => {
    const expected = requirement.expectedPath.replace(/\/$/, "");
    return !present.has(expected) && ![...present].some((file) => file.startsWith(`${expected}/`));
  });

  const findings = missing.map((requirement, index): SecurityFinding => ({
    id: `${options.checkId}-required-missing-${index}`,
    title: `Required file missing from npm tarball: package/${requirement.expectedPath}`,
    severity: "blocker",
    category: "package-content",
    description: `The required release file 'package/${requirement.expectedPath}' is absent from the npm package inventory; requirement declared by ${requirement.declaringMetadataField}`,
    evidence: `Missing required path: package/${requirement.expectedPath}; policy source: ${requirement.policySource}`,
    affectedFiles: [requirement.expectedPath],
    recommendation: `Include '${requirement.expectedPath}' in the package inventory or correct ${requirement.declaringMetadataField}`,
    releaseImpact: "Blocker: the npm package is incomplete and must not be published",
  }));

  return { missing, findings };
}
