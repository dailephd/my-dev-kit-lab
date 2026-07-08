import path from "node:path";
import { resolveLocalProjectTarget } from "../../core/localProjectTarget.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 1 — audit target model.
//
// Reuses the existing, already-tested resolveLocalProjectTarget() helper
// (src/core/localProjectTarget.ts, shared with security-validation target
// resolution) for path existence/directory/Windows-path-with-spaces
// handling, rather than duplicating that logic. This module only adapts the
// shared result into the AuditTarget shape and adds the audit-specific
// safeReportOutputRoot guarantee.
// ---------------------------------------------------------------------------

export type AuditTarget = {
  rootPath: string;
  displayName: string;
  // Always true for a successfully-constructed AuditTarget — resolution
  // throws before construction if the path does not exist or is not a
  // directory (see resolveLocalProjectTarget). Kept as explicit fields
  // because the audit config/target schema calls for them.
  exists: boolean;
  isDirectory: boolean;
  packageJsonPath: string | null;
  gitRoot: string | null;
  isSelf: boolean;
  // Always under the tool root's reports/ tree, never under the target
  // root — audits must never write into the target project by default.
  safeReportOutputRoot: string;
};

// Resolves and validates an audit target. Throws a descriptive Error (no
// stack trace wrapper) for a missing path or a non-directory path. Does not
// modify the target in any way.
export function resolveAuditTarget(targetPathArg: string | undefined, toolRoot: string): AuditTarget {
  const metadata = resolveLocalProjectTarget(targetPathArg, toolRoot);
  const displayName = metadata.packageName ?? path.basename(metadata.targetRoot);

  return {
    rootPath: metadata.targetRoot,
    displayName,
    exists: true,
    isDirectory: true,
    packageJsonPath: metadata.hasPackageJson ? path.join(metadata.targetRoot, "package.json") : null,
    gitRoot: metadata.hasGit ? metadata.targetRoot : null,
    isSelf: metadata.isSelf,
    safeReportOutputRoot: path.join(path.resolve(toolRoot), "reports", "audits"),
  };
}
