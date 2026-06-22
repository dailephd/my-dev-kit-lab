export type {
  SecuritySeverity,
  ReleaseVerdict,
  SecurityCheckStatus,
  SecurityCheckCategory,
  SecurityFinding,
  CommandExecutionResult,
  SecurityCheckResult,
  SecurityValidationSummary,
} from "./types.js";

export {
  SECURITY_SEVERITIES,
  RELEASE_VERDICTS,
  SECURITY_CHECK_STATUSES,
  SECURITY_CHECK_CATEGORIES,
} from "./types.js";

export type { SecurityValidationConfig } from "./config.js";
export { DEFAULT_SECURITY_CONFIG } from "./config.js";

export type { TestMatrixEntry, TestMatrixImplementationStatus } from "./testMatrix.js";
export { SECURITY_TEST_MATRIX } from "./testMatrix.js";

export { runSecurityCommand, skippedResult, resolveNpmCommand } from "./commandRunner.js";
export { writeCheckResult } from "./artifacts.js";

export { parseNpmAudit } from "./dependencies/parseNpmAudit.js";
export { parseNpmLs } from "./dependencies/parseNpmLs.js";
export { parseNpmOutdated } from "./dependencies/parseNpmOutdated.js";
export { runOsvScanner } from "./dependencies/runOsvScanner.js";
export { runDependencyChecks } from "./dependencies/runDependencyChecks.js";

export { parseNpmPackDryRun } from "./packageChecks/parseNpmPackDryRun.js";
export { detectForbiddenContents } from "./packageChecks/forbiddenPackageContents.js";
export { runPackageChecks } from "./packageChecks/runPackageChecks.js";
