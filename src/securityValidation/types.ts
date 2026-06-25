// Core types for the my-dev-kit-lab security-validation framework.
// These types describe the vocabulary for checks, findings, results, and verdicts
// used by dependency checks (Prompt 3), CLI adversarial tests (Prompts 4–5),
// static scans (Prompt 6), fuzz smoke tests (Prompt 7), and the release report (Prompt 8).

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

export type SecuritySeverity =
  | "blocker"
  | "major"
  | "minor"
  | "informational"
  | "skipped";

export const SECURITY_SEVERITIES: readonly SecuritySeverity[] = [
  "blocker",
  "major",
  "minor",
  "informational",
  "skipped",
];

// ---------------------------------------------------------------------------
// Release verdict
// ---------------------------------------------------------------------------

export type ReleaseVerdict =
  | "ready-for-release-preparation"
  | "not-ready-security-blocker-remains"
  | "ready-except-optional-manual-checks"
  | "inconclusive-audit-environment-incomplete";

export const RELEASE_VERDICTS: readonly ReleaseVerdict[] = [
  "ready-for-release-preparation",
  "not-ready-security-blocker-remains",
  "ready-except-optional-manual-checks",
  "inconclusive-audit-environment-incomplete",
];

// ---------------------------------------------------------------------------
// Check status and category
// ---------------------------------------------------------------------------

export type SecurityCheckStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "warning";

export const SECURITY_CHECK_STATUSES: readonly SecurityCheckStatus[] = [
  "passed",
  "failed",
  "skipped",
  "warning",
];

export type SecurityCheckCategory =
  | "static-scan"
  | "dependency-audit"
  | "package-content"
  | "cli-adversarial"
  | "fuzz-smoke"
  | "network-boundary"
  | "secret-leakage"
  | "artifact-safety"
  | "report-generation";

export const SECURITY_CHECK_CATEGORIES: readonly SecurityCheckCategory[] = [
  "static-scan",
  "dependency-audit",
  "package-content",
  "cli-adversarial",
  "fuzz-smoke",
  "network-boundary",
  "secret-leakage",
  "artifact-safety",
  "report-generation",
];

// ---------------------------------------------------------------------------
// Finding
// ---------------------------------------------------------------------------

export type SecurityFinding = {
  id: string;
  title: string;
  severity: SecuritySeverity;
  category: SecurityCheckCategory;
  description: string;
  evidence?: string;
  affectedFiles?: string[];
  recommendation?: string;
  releaseImpact: string;
};

// ---------------------------------------------------------------------------
// Command execution result
// ---------------------------------------------------------------------------

export type CommandExecutionResult = {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  skipped: boolean;
  skippedReason?: string;
};

// ---------------------------------------------------------------------------
// Security check result
// ---------------------------------------------------------------------------

export type SecurityCheckResult = {
  id: string;
  name: string;
  category: SecurityCheckCategory;
  status: SecurityCheckStatus;
  severity: SecuritySeverity;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  findings: SecurityFinding[];
  skippedReason?: string;
  command?: string;
  commandCwd?: string;
  exitCode?: number | null;
  stdoutSummary?: string;
  stderrSummary?: string;
  stdoutPath?: string;
  stderrPath?: string;
  artifactPaths?: string[];
};

// ---------------------------------------------------------------------------
// Validation summary
// ---------------------------------------------------------------------------

export type SecurityValidationSummary = {
  // Tool identity
  toolRoot: string;
  toolPackageName: string;
  toolPackageVersion: string;
  // Target project
  targetRoot: string;
  targetDescription: string;
  packageName: string;
  packageVersion: string;
  auditedBranch: string;
  auditedCommit: string;
  isSelf: boolean;
  startedAt: string;
  finishedAt: string;
  checks: SecurityCheckResult[];
  findings: SecurityFinding[];
  verdict: ReleaseVerdict;
  recommendedNextStep: string;
};
