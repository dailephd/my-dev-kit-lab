// ---------------------------------------------------------------------------
// v0.3.0 Batch 3 — code-rot detector aggregator.
//
// Single import surface for src/audits/core/auditRegistry.ts's
// DEFAULT_AUDIT_REGISTRY. Keeps the registry file from needing to know each
// detector's individual file path.
// ---------------------------------------------------------------------------

export { STALE_COMMAND_REFERENCE_DETECTOR } from "./detectors/staleCommandReferenceDetector.js";
export { DOCS_CODE_MISMATCH_DETECTOR } from "./detectors/docsCodeMismatchDetector.js";
export { PACKAGE_RELEASE_ROT_DETECTOR } from "./detectors/packageReleaseRotDetector.js";
export { DUPLICATE_IMPLEMENTATION_DETECTOR } from "./detectors/duplicateImplementationDetector.js";
export { DEAD_CODE_CANDIDATE_DETECTOR } from "./detectors/deadCodeCandidateDetector.js";
export { TEST_ROT_DETECTOR } from "./detectors/testRotDetector.js";
export { ARCHITECTURE_DRIFT_DETECTOR } from "./detectors/architectureDriftDetector.js";
export { DEPENDENCY_ENVIRONMENT_ROT_DETECTOR } from "./detectors/dependencyEnvironmentRotDetector.js";
export { CROSS_PLATFORM_ROT_DETECTOR } from "./detectors/crossPlatformRotDetector.js";
export { SECURITY_VALIDATION_ASSUMPTION_ROT_DETECTOR } from "./detectors/securityValidationAssumptionRotDetector.js";
