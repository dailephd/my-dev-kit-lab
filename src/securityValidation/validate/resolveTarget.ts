import path from "node:path";
import { resolveLocalProjectTarget } from "../../core/localProjectTarget.js";

// Describes the project being validated (the "target") and the tool running
// the validation (the "tool root", which is always my-dev-kit-lab).
// When --target is omitted the target is the tool root itself (self-validation).
export type SecurityValidationTarget = {
  targetRoot: string;
  toolRoot: string;
  packageName: string | null;
  packageVersion: string | null;
  hasPackageJson: boolean;
  hasSecurityTestScript: boolean;
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
  return resolveLocalProjectTarget(targetPathArg, toolRoot);
}

// Returns the prefix to use for report filenames based on target metadata.
// For self-validation: "v<version>" (preserves existing behavior).
// For external targets: "<sanitized-name>-v<version>" or "<sanitized-dirname>".
export function reportFilenamePrefix(target: SecurityValidationTarget): string {
  if (target.isSelf && target.packageVersion) {
    return `v${target.packageVersion}`;
  }
  const rawName = target.packageName ?? path.basename(target.targetRoot);
  // Remove npm scope prefix (@scope/name -> name), then sanitize for filenames.
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
