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

export { createTempWorkspace, snapshotDir, diffSnapshots, findWritesOutside, findNewFiles } from "./cliAdversarial/tempWorkspace.js";
export type { TempWorkspace, FileSnapshot, SnapshotDiff } from "./cliAdversarial/tempWorkspace.js";
export { getAdversarialCliTarget, buildCliCommand } from "./cliAdversarial/adversarialCliConfig.js";
export type { AdversarialCliTarget } from "./cliAdversarial/adversarialCliConfig.js";
export { ALL_PATH_TEST_INPUTS, PATH_TRAVERSAL_CASES, ABSOLUTE_PATH_CASES, SPACES_PATH_CASES, METACHAR_PATH_CASES, UNICODE_PATH_CASES, LONG_NAME_CASES, MISSING_PATH_CASES } from "./cliAdversarial/pathCases.js";
export type { PathTestInput, PathInputCategory } from "./cliAdversarial/pathCases.js";
export { runAdversarialCheck, skippedCheck, makeFinding } from "./cliAdversarial/runAdversarialCheck.js";
export type { AdversarialCommandResult, AdversarialCheckInput } from "./cliAdversarial/runAdversarialCheck.js";
export { checkRootPathTraversal, checkOutPathTraversal, checkIndexPathTraversal, checkPathWithSpaces, checkUnicodePath, checkSafeAbsolutePath, checkHarnessEscapeDetection } from "./cliAdversarial/pathBoundaryChecks.js";
export { checkSourceFilesNotModified, checkWritesLimitedToOutput, checkIndexWriteContainment, checkArtifactCleanupSafe } from "./cliAdversarial/readOnlyBoundaryChecks.js";

export type { MalformedArtifactCase } from "./cliAdversarial/malformedArtifactFixtures.js";
export { MALFORMED_MANIFEST_CASES, MALFORMED_CODE_GRAPH_CASES, UNSUPPORTED_SCHEMA_VERSION_CASES, placeMalformedArtifact, placeMalformedManifest, placeMalformedCodeGraph, placeUnsupportedSchemaManifest } from "./cliAdversarial/malformedArtifactFixtures.js";
export { checkMalformedManifest, checkAllMalformedManifestCases, checkMalformedCodeGraph, checkUnsupportedSchemaVersion, checkMissingIndexDirectory } from "./cliAdversarial/malformedArtifactChecks.js";
export { checkJsonOutputIsParseable, checkStderrNotInStdout, checkFailureProducesJsonError, checkProgressNotInJsonStdout } from "./cliAdversarial/jsonStdoutChecks.js";
export { DOT_LABEL_TEST_CASES, escapeDotLabel, checkSubprocessNoShellInterpolation, checkDotLabelEscaping } from "./cliAdversarial/subprocessSafetyChecks.js";
export { checkHugeSourceFile, checkManyFiles, checkDeeplyNestedSource } from "./cliAdversarial/dataVolumeChecks.js";

export { runCodeqlCheck } from "./staticScans/codeql.js";
export { runSemgrepCheck, parseSemgrepJson } from "./staticScans/semgrep.js";
export type { SemgrepFinding, ParsedSemgrepOutput } from "./staticScans/semgrep.js";

export { createPrng, randomInt, randomChoice, randomString, randomJsonValue, randomJsonString, mutateJson, validManifestJson, validCodeGraphJson } from "./fuzz/randomInput.js";
export type { Prng, MutationStrategy } from "./fuzz/randomInput.js";
export { ALL_MUTATION_STRATEGIES, PATH_TRAVERSAL_INPUTS } from "./fuzz/randomInput.js";
export { runFuzzTarget, runAllFuzzTargets } from "./fuzz/fuzzHarness.js";
export type { FuzzResult, FuzzCrash, FuzzTarget, FuzzHarnessOptions } from "./fuzz/fuzzHarness.js";
export { ALL_FUZZ_TARGETS, manifestReaderTarget, codeGraphReaderTarget, dotLabelEscapingTarget, pathNormalizationTarget, sourceWindowingTarget } from "./fuzz/fuzzTargets.js";

export { calculateVerdict, verdictToHumanLabel } from "./validate/verdict.js";
export { resolveValidationTarget, reportFilenamePrefix, targetDescription } from "./validate/resolveTarget.js";
export type { SecurityValidationTarget } from "./validate/resolveTarget.js";
export { runSecurityValidation } from "./validate/runSecurityValidation.js";
export type { RunSecurityValidationOptions } from "./validate/runSecurityValidation.js";
export { renderTextReport, renderJsonReport } from "./report/renderSecurityReport.js";
export type { SecurityReport, SecurityReportMetadata, SecurityReportSection } from "./report/securityReportTypes.js";
