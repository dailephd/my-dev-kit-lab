import type { MobileConfidence } from "../../types.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 1 — Android Gradle metadata model foundation.
//
// Normalized contract populated by the Gradle-file parser added in a later
// batch. No Gradle file parsing and no Gradle execution happen here.
// ---------------------------------------------------------------------------

export type AndroidGradleWrapperInfo = {
  present: boolean;
  wrapperPropertiesPath?: string;
  versionEvidence?: string;
};

export type AndroidGradleModuleInfo = {
  path: string;
  buildFilePath?: string;
  isApplication?: boolean;
  isLibrary?: boolean;
  namespace?: string;
  applicationId?: string;
  versionCode?: number | string;
  versionName?: string;
  minSdk?: number | string;
  targetSdk?: number | string;
  compileSdk?: number | string;
  buildTypes: string[];
  composeEnabled?: boolean;
  sourceSetEvidence: string[];
  testSourceSetEvidence: string[];
  unsupportedExpressions: string[];
};

export type AndroidGradlePluginEvidence = {
  androidGradlePluginEvidence?: string;
  kotlinAndroidPluginEvidence?: string;
};

export type AndroidGradleMetadata = {
  wrapper: AndroidGradleWrapperInfo;
  settingsFiles: string[];
  rootBuildFiles: string[];
  moduleBuildFiles: string[];
  pluginEvidence: AndroidGradlePluginEvidence;
  modules: AndroidGradleModuleInfo[];
  metadataConfidence: MobileConfidence;
  parseWarnings: string[];
  unsupportedExpressions: string[];
};
