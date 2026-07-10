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
  AndroidPermissionDeclaration,
  AndroidUsesFeatureDeclaration,
  AndroidManifestApplicationAttributes,
  AndroidManifestModel,
} from "./android/manifest/types.js";

export type {
  AndroidGradleWrapperInfo,
  AndroidGradleModuleInfo,
  AndroidGradlePluginEvidence,
  AndroidGradleMetadata,
} from "./android/gradle/types.js";

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
  AndroidReportModel,
} from "./android/report/model.js";
export { toAndroidReportModel, serializeAndroidReportModel } from "./android/report/model.js";
