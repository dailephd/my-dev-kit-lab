import fs from "node:fs";
import path from "node:path";
import type { SecurityFinding } from "../types.js";

export const LAB_SELF_REQUIRED_PACKAGE_CONTENTS = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "dist/scripts/run-final-demo.js",
  "dist/src/index.js",
  "package.json",
] as const;

export type PackagePolicyMode = "self" | "external";

export type PackagePolicyTarget = {
  targetRoot: string;
  packageName: string | null;
  packageVersion: string | null;
  isSelf: boolean;
};

export type PackageContentRequirement = {
  expectedPath: string;
  declaringMetadataField: string;
  policySource: string;
};

type PackageJsonContract = {
  name?: unknown;
  version?: unknown;
  bin?: unknown;
  main?: unknown;
  module?: unknown;
  types?: unknown;
  typings?: unknown;
  exports?: unknown;
  files?: unknown;
};

export type PackageContentPolicyResult = {
  mode: PackagePolicyMode;
  source: string;
  requirements: PackageContentRequirement[];
  findings: SecurityFinding[];
};

type FindingInput = Omit<SecurityFinding, "packagePolicy"> & {
  expectedPath?: string;
  declaringMetadataField?: string;
  observedPackedFileEvidence: string;
};

function normalizePackedPath(raw: string): string {
  const slash = raw.replace(/\\/g, "/");
  const unprefixed = slash.startsWith("package/") ? slash.slice("package/".length) : slash;
  return unprefixed.replace(/^\.\//, "");
}

function normalizeDeclaredPath(raw: string): { path?: string; error?: string } {
  const value = raw.trim().replace(/\\/g, "/");
  if (!value) return { error: "the declared path is empty" };
  if (/^(?:[a-zA-Z]:\/|\/|\\\\)/.test(value)) {
    return { error: "the declared path is absolute" };
  }
  const normalized = path.posix.normalize(value.replace(/^\.\//, ""));
  if (normalized === ".." || normalized.startsWith("../")) {
    return { error: "the declared path escapes the package root" };
  }
  return { path: normalized };
}

function withPolicy(
  target: PackagePolicyTarget,
  mode: PackagePolicyMode,
  source: string,
  input: FindingInput,
): SecurityFinding {
  const { expectedPath, declaringMetadataField, observedPackedFileEvidence, ...finding } = input;
  return {
    ...finding,
    packagePolicy: {
      mode,
      source,
      targetRoot: target.targetRoot,
      packageName: target.packageName,
      packageVersion: target.packageVersion,
      ...(expectedPath === undefined ? {} : { expectedPath }),
      ...(declaringMetadataField === undefined ? {} : { declaringMetadataField }),
      observedPackedFileEvidence,
      affectsReleaseReadiness: finding.severity === "blocker" || finding.severity === "major",
    },
  };
}

function entrypointLeaves(value: unknown, field: string): Array<{ value: unknown; field: string }> {
  if (typeof value === "string") return [{ value, field }];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value === undefined ? [] : [{ value, field }];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    entrypointLeaves(child, `${field}.${key}`),
  );
}

function isGlob(value: string): boolean {
  return /[*?\[\]{}]/.test(value);
}

function isValidPackageName(value: string): boolean {
  const segment = "[a-z0-9~][a-z0-9._~-]*";
  return new RegExp(`^(?:${segment}|@${segment}/${segment})$`).test(value);
}

function isValidPackageVersion(value: string): boolean {
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
}

function globMatches(value: string, candidate: string): boolean {
  const escaped = value.replace(/[.+^$()|\\]/g, "\\$&").replace(/\*\*/g, "\u0000");
  const pattern = escaped
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${pattern}$`).test(candidate);
}

function requirementKey(requirement: PackageContentRequirement): string {
  return `${requirement.expectedPath}\u0000${requirement.declaringMetadataField}`;
}

export function buildPackageContentPolicy(options: {
  target: PackagePolicyTarget;
  packedFiles: string[];
  checkId: string;
}): PackageContentPolicyResult {
  const { target, checkId } = options;
  const mode: PackagePolicyMode = target.isSelf ? "self" : "external";
  const source = target.isSelf
    ? "my-dev-kit-lab mandatory self-package contract"
    : "external target package.json and npm pack inventory";
  const present = new Set(options.packedFiles.map(normalizePackedPath));
  const findings: SecurityFinding[] = [];

  for (const [index, rawPath] of [...options.packedFiles].sort().entries()) {
    const slashPath = rawPath.replace(/\\/g, "/");
    const packageRelative = slashPath.startsWith("package/") ? slashPath.slice("package/".length) : slashPath;
    const normalized = path.posix.normalize(packageRelative);
    if (/^(?:[a-zA-Z]:\/|\/|\\\\)/.test(packageRelative) || normalized === ".." || normalized.startsWith("../")) {
      findings.push(withPolicy(target, mode, source, {
        id: `${checkId}-packed-path-unsafe-${index}`,
        title: `Unsafe path in npm package inventory: ${rawPath}`,
        severity: "blocker",
        category: "package-content",
        description: "Packed file paths must remain relative to the package root",
        evidence: `Observed packed path: ${rawPath}`,
        affectedFiles: [rawPath],
        recommendation: "Remove the absolute or escaping path from the package inventory",
        releaseImpact: "Blocker: the package boundary is unsafe",
        expectedPath: rawPath,
        observedPackedFileEvidence: `Unsafe packed path observed among ${present.size} file(s)`,
      }));
    }
  }

  if (target.isSelf) {
    return {
      mode,
      source,
      requirements: LAB_SELF_REQUIRED_PACKAGE_CONTENTS.map((expectedPath) => ({
        expectedPath,
        declaringMetadataField: "lab self-package contract",
        policySource: source,
      })),
      findings,
    };
  }

  const packageJsonPath = path.join(target.targetRoot, "package.json");
  let contract: PackageJsonContract;
  try {
    contract = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJsonContract;
  } catch (error) {
    findings.push(withPolicy(target, mode, source, {
      id: `${checkId}-external-package-json-unreadable`,
      title: "External target package.json is unreadable",
      severity: "blocker",
      category: "package-content",
      description: "External package requirements cannot be derived without readable package metadata",
      evidence: error instanceof Error ? error.message : String(error),
      affectedFiles: ["package.json"],
      recommendation: "Provide a readable, valid package.json before package validation",
      releaseImpact: "Blocker: the external package contract cannot be established",
      expectedPath: "package.json",
      declaringMetadataField: "package.json",
      observedPackedFileEvidence: present.has("package.json") ? "package.json is packed but source metadata is unreadable" : "package.json is not packed",
    }));
    return { mode, source, requirements: [], findings };
  }

  for (const [field, value] of [["name", contract.name], ["version", contract.version]] as const) {
    const valid = typeof value === "string" && value.trim() !== "" && (
      field === "name" ? isValidPackageName(value) : isValidPackageVersion(value)
    );
    if (!valid) {
      findings.push(withPolicy(target, mode, source, {
        id: `${checkId}-external-package-${field}-invalid`,
        title: `External target package ${field} is invalid`,
        severity: "blocker",
        category: "package-content",
        description: `package.json must declare a nonempty string ${field}`,
        evidence: `Observed ${field}: ${JSON.stringify(value)}`,
        affectedFiles: ["package.json"],
        recommendation: `Declare a valid package.json ${field}`,
        releaseImpact: "Blocker: package identity is incomplete",
        declaringMetadataField: `package.json#${field}`,
        observedPackedFileEvidence: `${present.size} packed file(s) observed`,
      }));
    }
  }

  const requirements: PackageContentRequirement[] = [{
    expectedPath: "package.json",
    declaringMetadataField: "npm universal package metadata",
    policySource: source,
  }];
  const entrypoints: Array<{ value: unknown; field: string }> = [];
  if (typeof contract.bin === "string") entrypoints.push({ value: contract.bin, field: "package.json#bin" });
  else if (contract.bin && typeof contract.bin === "object" && !Array.isArray(contract.bin)) {
    for (const [name, value] of Object.entries(contract.bin as Record<string, unknown>)) {
      entrypoints.push({ value, field: `package.json#bin.${name}` });
    }
  } else if (contract.bin !== undefined) entrypoints.push({ value: contract.bin, field: "package.json#bin" });
  for (const field of ["main", "module", "types", "typings"] as const) {
    if (contract[field] !== undefined) entrypoints.push({ value: contract[field], field: `package.json#${field}` });
  }
  entrypoints.push(...entrypointLeaves(contract.exports, "package.json#exports"));

  for (const entrypoint of entrypoints) {
    if (typeof entrypoint.value !== "string") {
      findings.push(withPolicy(target, mode, source, {
        id: `${checkId}-external-entrypoint-malformed-${findings.length}`,
        title: `External target entrypoint is malformed: ${entrypoint.field}`,
        severity: "blocker",
        category: "package-content",
        description: "Declared runtime and public entrypoints must be statically resolvable package-relative strings",
        evidence: `Observed value: ${JSON.stringify(entrypoint.value)}`,
        affectedFiles: ["package.json"],
        recommendation: `Replace ${entrypoint.field} with a package-relative string path or supported conditional object`,
        releaseImpact: "Blocker: a declared target entrypoint cannot be validated",
        declaringMetadataField: entrypoint.field,
        observedPackedFileEvidence: `${present.size} packed file(s) observed`,
      }));
      continue;
    }
    const normalized = normalizeDeclaredPath(entrypoint.value);
    if (!normalized.path) {
      findings.push(withPolicy(target, mode, source, {
        id: `${checkId}-external-entrypoint-unsafe-${findings.length}`,
        title: `External target entrypoint is unsafe: ${entrypoint.field}`,
        severity: "blocker",
        category: "package-content",
        description: normalized.error ?? "The declared entrypoint is not package-relative",
        evidence: `Declared value: ${entrypoint.value}`,
        affectedFiles: ["package.json"],
        recommendation: `Declare ${entrypoint.field} as a normal package-relative path`,
        releaseImpact: "Blocker: package entrypoint safety cannot be established",
        declaringMetadataField: entrypoint.field,
        observedPackedFileEvidence: `${present.size} packed file(s) observed`,
      }));
      continue;
    }
    requirements.push({ expectedPath: normalized.path, declaringMetadataField: entrypoint.field, policySource: source });
  }

  if (contract.files !== undefined && !Array.isArray(contract.files)) {
    findings.push(withPolicy(target, mode, source, {
      id: `${checkId}-external-files-malformed`,
      title: "External target package files policy is malformed",
      severity: "major",
      category: "package-content",
      description: "package.json#files must be an array when present",
      evidence: `Observed files: ${JSON.stringify(contract.files)}`,
      affectedFiles: ["package.json"],
      recommendation: "Use an array of package inclusion paths or patterns",
      releaseImpact: "Major: package inclusion intent is ambiguous",
      declaringMetadataField: "package.json#files",
      observedPackedFileEvidence: `${present.size} packed file(s) observed`,
    }));
  } else if (Array.isArray(contract.files)) {
    for (const [index, raw] of contract.files.entries()) {
      const field = `package.json#files[${index}]`;
      if (typeof raw !== "string" || raw.trim() === "") {
        findings.push(withPolicy(target, mode, source, {
          id: `${checkId}-external-files-unsupported-${index}`,
          title: `External target files entry is unsupported: ${field}`,
          severity: "informational",
          category: "package-content",
          description: "The files inclusion entry is not a nonempty string and was not guessed",
          evidence: `Observed value: ${JSON.stringify(raw)}`,
          affectedFiles: ["package.json"],
          recommendation: "Use an explicit package-relative path or supported glob",
          releaseImpact: "Informational: review the unsupported inclusion entry",
          declaringMetadataField: field,
          observedPackedFileEvidence: `${present.size} packed file(s) observed`,
        }));
        continue;
      }
      if (raw.startsWith("!")) {
        findings.push(withPolicy(target, mode, source, {
          id: `${checkId}-external-files-negative-${index}`,
          title: `External target files exclusion retained as npm policy: ${raw}`,
          severity: "informational",
          category: "package-content",
          description: "Negative files patterns are interpreted by npm; the checker relies on the generated packed inventory rather than guessing",
          evidence: `Declared by ${field}`,
          affectedFiles: ["package.json"],
          recommendation: "Review the npm-generated inventory for the intended exclusion",
          releaseImpact: "Informational: npm remains authoritative for this exclusion",
          declaringMetadataField: field,
          observedPackedFileEvidence: `${present.size} packed file(s) observed`,
        }));
        continue;
      }
      const normalized = normalizeDeclaredPath(raw);
      if (!normalized.path) {
        findings.push(withPolicy(target, mode, source, {
          id: `${checkId}-external-files-unsafe-${index}`,
          title: `External target files entry is unsafe: ${field}`,
          severity: "blocker",
          category: "package-content",
          description: normalized.error ?? "The files entry is not package-relative",
          evidence: `Declared value: ${raw}`,
          affectedFiles: ["package.json"],
          recommendation: "Use a safe package-relative inclusion path",
          releaseImpact: "Blocker: package inclusion policy escapes its boundary",
          declaringMetadataField: field,
          observedPackedFileEvidence: `${present.size} packed file(s) observed`,
        }));
        continue;
      }
      if (isGlob(normalized.path)) {
        if (/[\[\]{}]/.test(normalized.path)) {
          findings.push(withPolicy(target, mode, source, {
            id: `${checkId}-external-files-glob-unsupported-${index}`,
            title: `External target files glob is unsupported: ${raw}`,
            severity: "informational",
            category: "package-content",
            description: "Character-class and brace glob syntax is left to npm; the checker relies on the generated inventory rather than guessing",
            evidence: `Declared by ${field}`,
            affectedFiles: ["package.json"],
            recommendation: "Review the npm-generated inventory for this inclusion pattern",
            releaseImpact: "Informational: npm remains authoritative for this unsupported glob",
            declaringMetadataField: field,
            observedPackedFileEvidence: `${present.size} packed file(s) observed`,
          }));
          continue;
        }
        if (![...present].some((file) => globMatches(normalized.path!, file))) {
          findings.push(withPolicy(target, mode, source, {
            id: `${checkId}-external-files-glob-empty-${index}`,
            title: `External target files glob matched no packed content: ${raw}`,
            severity: "informational",
            category: "package-content",
            description: "npm produced no packed file matching this declared inclusion glob",
            evidence: `Declared by ${field}`,
            affectedFiles: ["package.json"],
            recommendation: "Confirm the glob is intentional or update the package inclusion policy",
            releaseImpact: "Informational: the declared glob contributes no packed files",
            declaringMetadataField: field,
            observedPackedFileEvidence: `${present.size} packed file(s) observed; no match for ${normalized.path}`,
          }));
        }
        continue;
      }
      const sourcePath = path.join(target.targetRoot, ...normalized.path.split("/"));
      if (!fs.existsSync(sourcePath)) continue;
      const stat = fs.statSync(sourcePath);
      if (stat.isDirectory()) {
        const hasSourceContent = fs.readdirSync(sourcePath).length > 0;
        if (!hasSourceContent) continue;
      }
      requirements.push({ expectedPath: normalized.path, declaringMetadataField: field, policySource: source });
    }
  }

  const deduped = [...new Map(requirements.map((item) => [requirementKey(item), item])).values()]
    .sort((left, right) => requirementKey(left).localeCompare(requirementKey(right)));
  return { mode, source, requirements: deduped, findings };
}

export function attachPackagePolicyContext(options: {
  finding: SecurityFinding;
  target: PackagePolicyTarget;
  mode: PackagePolicyMode;
  source: string;
  expectedPath?: string;
  declaringMetadataField?: string;
  observedPackedFileEvidence: string;
}): SecurityFinding {
  return withPolicy(options.target, options.mode, options.source, {
    ...options.finding,
    ...(options.expectedPath === undefined ? {} : { expectedPath: options.expectedPath }),
    ...(options.declaringMetadataField === undefined ? {} : { declaringMetadataField: options.declaringMetadataField }),
    observedPackedFileEvidence: options.observedPackedFileEvidence,
  });
}
