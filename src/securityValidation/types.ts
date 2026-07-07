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
// Verdict impact (v0.2.2 Batch 6)
//
// Declared by an AttackScenario (attackScenario.ts) as static metadata,
// carried through AttackResult and toSecurityCheckResult() into
// SecurityCheckResult.verdictImpact, and read directly by
// verdict.ts's categorizeCheck() — this is the single source of truth for
// "what kind of blocker is this scenario if it fails", replacing the
// previously hand-maintained SCENARIO_BLOCKER_IMPACT map in verdict.ts.
// Defined here (not in attackScenario.ts or verdict.ts) so both can import it
// without creating a circular dependency between the scenario layer and the
// verdict layer. A subset of verdict.ts's broader VerdictReasonCategory —
// only the values a scenario's static declaration can meaningfully assert.
// ---------------------------------------------------------------------------

export type VerdictImpact =
  | "release-blocker"
  | "target-project-blocker"
  | "tool-framework-blocker"
  | "adversarial-scenario-failure"
  | "informational-evidence";

export const VERDICT_IMPACTS: readonly VerdictImpact[] = [
  "release-blocker",
  "target-project-blocker",
  "tool-framework-blocker",
  "adversarial-scenario-failure",
  "informational-evidence",
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
  // v0.2.2 Batch 6 — carried through from an AttackScenario's declared
  // verdictImpact (via AttackResult) so verdict.ts can categorize the check
  // without owning a separate scenario-id map. Undefined for non-scenario
  // checks and for scenarios that don't declare an impact.
  verdictImpact?: VerdictImpact;
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
  // v0.2.2 Batch 2 — structured attack-scenario results (empty array when no
  // attack-scenario-shaped checks were selected). Each result is also folded
  // into `checks`/`findings` via toSecurityCheckResult() for verdict purposes.
  attackResults: import("./attackScenarios/attackResult.js").AttackResult[];
  // v0.2.2 Batch 5 — additive verdict-reasoning fields. Optional so any
  // existing test/consumer that constructs a summary without them is
  // unaffected.
  verdictReasonSummary?: import("./validate/verdict.js").VerdictReasonSummary;
  // True when selectedChecks includes all of the classic release-gate check
  // groups (deps/package/static/cli-adversarial/fuzz) — i.e. this run was
  // not narrowed away from the traditional full gate. Attack-scenario checks
  // (boundary/subprocess/secrets/network) are additional coverage and don't
  // affect this flag, since they were never part of the pre-v0.2.2 gate.
  isFullReleaseGate?: boolean;
};
