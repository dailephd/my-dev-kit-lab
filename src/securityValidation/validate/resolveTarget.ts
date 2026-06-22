import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";

// Describes the project being validated (the "target") and the tool running
// the validation (the "tool root", which is always my-dev-kit-lab).
// When --target is omitted the target is the tool root itself (self-validation).
export type SecurityValidationTarget = {
  targetRoot: string;
  toolRoot: string;
  packageName: string | null;
  packageVersion: string | null;
  hasPackageJson: boolean;
  hasLockfile: boolean;
  branch: string | null;
  commit: string | null;
  hasGit: boolean;
  // true when targetRoot === toolRoot (normal self-validation mode)
  isSelf: boolean;
};

// Resolves and validates a target project path.
// Throws a descriptive Error (no stack trace wrapper) for bad paths.
export function resolveValidationTarget(
  targetPathArg: string | undefined,
  toolRoot: string
): SecurityValidationTarget {
  let targetRoot: string;

  if (!targetPathArg) {
    targetRoot = toolRoot;
  } else {
    targetRoot = path.isAbsolute(targetPathArg)
      ? targetPathArg
      : path.resolve(process.cwd(), targetPathArg);

    if (!fs.existsSync(targetRoot)) {
      throw new Error(`Target path does not exist: ${targetRoot}`);
    }
    const stat = fs.statSync(targetRoot);
    if (!stat.isDirectory()) {
      throw new Error(`Target path is not a directory: ${targetRoot}`);
    }
  }

  const isSelf = path.resolve(targetRoot) === path.resolve(toolRoot);

  // Target package metadata
  let packageName: string | null = null;
  let packageVersion: string | null = null;
  let hasPackageJson = false;

  try {
    const pkgRaw = fs.readFileSync(path.join(targetRoot, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { name?: string; version?: string };
    hasPackageJson = true;
    packageName = pkg.name ?? null;
    packageVersion = pkg.version ?? null;
  } catch {
    // No package.json or unreadable — not an error, will surface as finding
  }

  const hasLockfile =
    fs.existsSync(path.join(targetRoot, "package-lock.json")) ||
    fs.existsSync(path.join(targetRoot, "yarn.lock")) ||
    fs.existsSync(path.join(targetRoot, "pnpm-lock.yaml"));

  // Target git metadata
  let branch: string | null = null;
  let commit: string | null = null;
  let hasGit = false;

  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: targetRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    commit = execSync("git rev-parse --short HEAD", {
      cwd: targetRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    hasGit = true;
  } catch {
    // No git or git not available in target — not an error
  }

  return {
    targetRoot,
    toolRoot,
    packageName,
    packageVersion,
    hasPackageJson,
    hasLockfile,
    branch,
    commit,
    hasGit,
    isSelf,
  };
}

// Returns the prefix to use for report filenames based on target metadata.
// For self-validation: "v<version>" (preserves existing behavior).
// For external targets: "<sanitized-name>-v<version>" or "<sanitized-dirname>".
export function reportFilenamePrefix(target: SecurityValidationTarget): string {
  if (target.isSelf && target.packageVersion) {
    return `v${target.packageVersion}`;
  }
  const rawName = target.packageName ?? path.basename(target.targetRoot);
  // Remove npm scope prefix (@scope/name → name), then sanitize for filenames
  const nameWithoutScope = rawName.replace(/^@[^/]+\//, "");
  const sanitized = nameWithoutScope
    .replace(/[^a-z0-9._-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const versionSuffix = target.packageVersion ? `-v${target.packageVersion}` : "";
  return `${sanitized}${versionSuffix}`;
}

// Returns a human-readable description of the target for report headers.
export function targetDescription(target: SecurityValidationTarget): string {
  if (target.isSelf) return "self (my-dev-kit-lab)";
  const name = target.packageName ?? path.basename(target.targetRoot);
  const version = target.packageVersion ? `@${target.packageVersion}` : "";
  return `${name}${version} (${target.targetRoot})`;
}
