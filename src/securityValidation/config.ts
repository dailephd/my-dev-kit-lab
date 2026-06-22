import path from "path";

// Default configuration for security-validation checks.
// All generated artifacts go under reports/security/ which is gitignored.
// Optional tools (OSV-Scanner) are marked skipped, not failed, when unavailable.

export type SecurityValidationConfig = {
  reportDir: string;
  rawOutputDir: string;
  forbiddenPackagePatterns: string[];
  allowedPackageExceptions: string[];
  commandTimeoutMs: number;
  requireOsvScanner: boolean;
};

// Patterns that should not appear in the npm tarball.
// These represent generated lab artifacts, secrets, and machine-specific files
// that are safe in the repo but must not be published.
const DEFAULT_FORBIDDEN_PATTERNS: string[] = [
  "lab-output/",
  ".my-dev-kit/",
  "reports/security/",
  "reports/security/raw/",
  ".env",
  ".env.",
  "*.pem",
  "*.key",
  "*.p12",
  "*.tgz",
  "*.tar",
  "node_modules/",
  "coverage/",
  "tmp/",
  "temp/",
  "smoke/",
  "docs/coding_generation_guideline.md",
  "docs/DOCUMENTATION_AUDIT_REPORT.txt",
  "docs/EXPERIMENT_REPORT_MIGRATION_PLAN.md",
  "docs/FINAL_BATCH_HANDOFF.txt",
  "docs/FINAL_VERIFICATION_REPORT.txt",
  "docs/PUBLIC_RELEASE_CHECKLIST.md",
  "docs/REAL_AGENT_BENCHMARK_CAMPAIGN_REPORT.txt",
];

export const DEFAULT_SECURITY_CONFIG: SecurityValidationConfig = {
  reportDir: path.join("reports", "security"),
  rawOutputDir: path.join("reports", "security", "raw"),
  forbiddenPackagePatterns: DEFAULT_FORBIDDEN_PATTERNS,
  allowedPackageExceptions: [],
  commandTimeoutMs: 60_000,
  requireOsvScanner: false,
};
