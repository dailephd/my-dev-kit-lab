// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — fixed OWASP Dependency-Check command planning.
//
// One fixed operation. No caller-provided flags, no database updates, no
// NVD API key. `--noupdate` is always present; the additional
// `--disable*` flags are fixed and only prevent additional network-capable
// analyzers (Node/Yarn/pnpm audit, RetireJS, known-exploited feed) from
// running, matching the "no unauthorized network access" boundary.
// ---------------------------------------------------------------------------

export const DEPENDENCY_CHECK_REPORT_FILE_NAME = "dependency-check-report.json";

export function sanitizeDependencyCheckProjectName(rawName: string): string {
  const sanitized = rawName.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100);
  return sanitized.length > 0 ? sanitized : "android-target";
}

export function buildDependencyCheckArgs(projectName: string, targetRoot: string, outDir: string): string[] {
  return [
    "--project",
    sanitizeDependencyCheckProjectName(projectName),
    "--scan",
    targetRoot,
    "--format",
    "JSON",
    "--out",
    outDir,
    "--noupdate",
    "--disableAssembly",
    "--disableNodeAudit",
    "--disableYarnAudit",
    "--disablePnpmAudit",
    "--disableRetireJS",
    "--disableKnownExploited",
  ];
}
