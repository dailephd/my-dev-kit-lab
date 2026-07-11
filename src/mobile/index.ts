export type { MobilePlatform, MobileConfidence, MobileValidationCapability, MobileProfile } from "./types.js";
export { MOBILE_PLATFORMS, MOBILE_CONFIDENCE_LEVELS, MOBILE_VALIDATION_CAPABILITIES } from "./types.js";

export { ANDROID_PLATFORM, ANDROID_PROFILE_ID, createAndroidProfile, isAndroidProfile } from "./android/profile.js";

export type {
  AndroidProjectKind,
  AndroidUiToolkit,
  AndroidModuleDetection,
  AndroidDetectionResult,
} from "./android/detection.js";
export { ANDROID_PROJECT_KINDS, ANDROID_UI_TOOLKITS } from "./android/detection.js";

export { detectAndroidProject } from "./android/detect/detectAndroidProject.js";
export { detectAndroidTarget } from "./android/detect/androidTargetDetection.js";
export type { AndroidTargetDetectionResult } from "./android/detect/androidTargetDetection.js";
export { parseDeclaredModules } from "./android/detect/settingsModules.js";
export type { ParsedSettingsModules } from "./android/detect/settingsModules.js";
export { extractBuildFileEvidence } from "./android/detect/buildFileEvidence.js";
export type { BuildFileEvidence } from "./android/detect/buildFileEvidence.js";
export { extractVersionCatalogEvidence } from "./android/detect/versionCatalogEvidence.js";
export type { VersionCatalogEvidence } from "./android/detect/versionCatalogEvidence.js";
export {
  classifyModule,
  classifyModuleUiToolkit,
  combineProjectKind,
  combineProjectUiToolkit,
  combineProjectConfidence,
} from "./android/detect/classify.js";

export type {
  AndroidGradleWrapperMetadataPlaceholder,
  AndroidReleaseMetadataPlaceholder,
  AndroidEnvironmentCapabilities,
  AndroidTargetMetadata,
} from "./android/targetMetadata.js";
export { createAndroidTargetMetadata } from "./android/targetMetadata.js";

export type {
  AndroidManifestSourceLocation,
  AndroidIntentFilterData,
  AndroidIntentFilter,
  AndroidManifestComponentKind,
  AndroidManifestComponent,
  AndroidPermissionSourceElement,
  AndroidPermissionDeclaration,
  AndroidUsesFeatureDeclaration,
  AndroidManifestApplicationAttributes,
  AndroidManifestModel,
} from "./android/manifest/types.js";

export {
  parseAndroidManifestSource,
  parseAndroidManifestFile,
  parseAllAndroidManifests,
} from "./android/manifest/parseAndroidManifest.js";
export type { AndroidManifestSourceSetKind, AndroidManifestParseEntry } from "./android/manifest/parseAndroidManifest.js";

export { parseXmlDocument, findChildren, getAttribute, ANDROID_NAMESPACE_URI } from "./android/manifest/xml/parseXml.js";
export type { XmlElement, XmlAttribute, XmlSourceLocation, XmlParseResult } from "./android/manifest/xml/parseXml.js";

export type {
  AndroidGradleDistributionType,
  AndroidGradleWrapperInfo,
  AndroidGradleModuleInfo,
  AndroidGradlePluginEvidence,
  AndroidGradleMetadataConflict,
  AndroidGradleMetadata,
} from "./android/gradle/types.js";

export { parseWrapperProperties } from "./android/gradle/wrapperMetadata.js";
export type { ParsedWrapperProperties } from "./android/gradle/wrapperMetadata.js";
export { parseVersionCatalog, resolveCatalogVersion, accessorSuffixToCatalogAlias } from "./android/gradle/versionCatalogMetadata.js";
export type { CatalogEntry, ParsedVersionCatalog } from "./android/gradle/versionCatalogMetadata.js";
export { extractModuleGradleMetadata } from "./android/gradle/moduleMetadataExtractor.js";
export type { ModuleMetadataExtractionResult } from "./android/gradle/moduleMetadataExtractor.js";
export { resolvePluginVersion } from "./android/gradle/pluginVersionExtractor.js";
export type { PluginVersionResult } from "./android/gradle/pluginVersionExtractor.js";
export { parseSettingsMetadata } from "./android/gradle/settingsMetadata.js";
export type { SettingsMetadata } from "./android/gradle/settingsMetadata.js";
export { readAndroidGradleMetadata } from "./android/gradle/readAndroidGradleMetadata.js";
export { buildAndroidGradleMetadataCheckResult } from "./android/gradle/gradleMetadataCheckResult.js";
export { buildAndroidReleaseMetadataSummary } from "./android/gradle/releaseMetadataSummary.js";
export type { AndroidReleaseMetadataSummary } from "./android/gradle/releaseMetadataSummary.js";

export { ALLOWLISTED_OPERATION_IDS, isAllowlistedOperationId, GRADLE_OPERATIONS } from "./android/gradle/validate/operations.js";
export type { GradleOperationId, GradleOperationDefinition } from "./android/gradle/validate/operations.js";
export { buildGradleCommandPlan } from "./android/gradle/validate/planner.js";
export type { GradleCommandPlan, GradleCommandPlanRejection, GradleCommandPlanResult } from "./android/gradle/validate/planner.js";
export { createRealGradleCommandExecutor } from "./android/gradle/validate/executor.js";
export type { GradleCommandExecutor } from "./android/gradle/validate/executor.js";
export { parseGradleTaskNames, isGradleTaskAvailable } from "./android/gradle/validate/taskListParser.js";
export { buildTargetMutationReport, isExpectedAndroidGeneratedPath, captureTargetSnapshot } from "./android/gradle/validate/targetMutation.js";
export type { TargetMutationReport, TargetSnapshot } from "./android/gradle/validate/targetMutation.js";
export { buildGradleOperationCheckResult } from "./android/gradle/validate/operationCheckResult.js";
export { runOptionalGradleValidation } from "./android/gradle/validate/runOptionalGradleValidation.js";
export type { RunOptionalGradleValidationOptions } from "./android/gradle/validate/runOptionalGradleValidation.js";

export type {
  AndroidCheckStatus,
  AndroidCheckCategory,
  AndroidCheckRequirementLevel,
  AndroidCheckSkipInfo,
  AndroidCheckResult,
} from "./android/validation/checkResult.js";
export {
  ANDROID_CHECK_STATUSES,
  ANDROID_NON_PASSING_STATUSES,
  ANDROID_CHECK_CATEGORIES,
  isPassingAndroidStatus,
} from "./android/validation/checkResult.js";

export type {
  AndroidToolMetadata,
  AndroidPlayReadinessSummaryPlaceholder,
  AndroidValidationResult,
  AndroidVerdictPlaceholder,
} from "./android/validation/result.js";
export {
  ANDROID_VALIDATION_SCHEMA_VERSION,
  ANDROID_VALIDATION_ARTIFACT_TYPE,
  ANDROID_VERDICT_NOT_CALCULATED,
} from "./android/validation/result.js";

export type {
  AndroidReportMetadata,
  AndroidReportSummarySection,
  AndroidReportModuleSummary,
  AndroidReportModel,
  ToAndroidReportModelOptions,
} from "./android/report/model.js";
export { toAndroidReportModel, serializeAndroidReportModel } from "./android/report/model.js";
export { renderAndroidTextReport } from "./android/report/renderAndroidReport.js";
export { writeAndroidReportFiles } from "./android/report/writeAndroidReportFiles.js";
export type { WriteAndroidReportFilesOptions, WriteAndroidReportFilesResult } from "./android/report/writeAndroidReportFiles.js";

export { makeAndroidFinding } from "./android/audit/androidFinding.js";
export type { AndroidFindingInput } from "./android/audit/androidFinding.js";
export { buildAndroidManifestCheckResult } from "./android/audit/checkResultBuilder.js";
export type { BuildAndroidManifestCheckResultInput } from "./android/audit/checkResultBuilder.js";
export { auditAndroidPermissions } from "./android/audit/permissionAudit.js";
export { auditAndroidExportedComponents } from "./android/audit/exportedComponentAudit.js";
export { auditAndroidIntentFilters } from "./android/audit/intentFilterAudit.js";
export { auditAndroidDeepLinks } from "./android/audit/deepLinkAudit.js";

export type {
  AndroidPlayReadinessItemStatus,
  AndroidPlayReadinessItem,
  AndroidPlayReadinessChecklist,
} from "./android/validate/playReadinessChecklist.js";
export { ANDROID_PLAY_READINESS_ITEM_STATUSES, buildAndroidPlayReadinessChecklist } from "./android/validate/playReadinessChecklist.js";
export { calculateAndroidVerdict, androidVerdictToHumanLabel } from "./android/validate/androidVerdict.js";
export type { CalculateAndroidVerdictInput, CalculateAndroidVerdictResult } from "./android/validate/androidVerdict.js";
export {
  buildAndroidDetectionCheckResult,
  buildAndroidManifestParsingCheckResult,
  buildAndroidTargetImmutabilityCheckResult,
} from "./android/validate/detectionAndImmutabilityCheckResults.js";
export { validateAndroidTarget } from "./android/validate/validateAndroidTarget.js";
export type { ValidateAndroidTargetOptions } from "./android/validate/validateAndroidTarget.js";
