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
  // Optional Semgrep-only process deadline; does not change rule timeouts.
  semgrepCommandTimeoutMs?: number;
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
  "__pycache__/",
  "*.pyc",
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

// Windows native Semgrep startup can exceed the shared one-minute deadline.
// Keep this allowance local to Semgrep, bounded, and independently cancellable.
export function resolveSemgrepCommandTimeoutMs(
  config: Pick<SecurityValidationConfig, "commandTimeoutMs" | "semgrepCommandTimeoutMs">,
  platform: NodeJS.Platform = process.platform
): number {
  const timeoutMs = config.semgrepCommandTimeoutMs ??
    (platform === "win32" ? 300_000 : config.commandTimeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Semgrep process timeout must be a positive finite duration.");
  }
  return platform === "win32" ? Math.min(timeoutMs, 300_000) : timeoutMs;
}
