import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import type { AndroidDetectionResult } from "../detection.js";
import { extractVersionCatalogEvidence } from "../detect/versionCatalogEvidence.js";
import type { MobileConfidence } from "../../types.js";
import { parseWrapperProperties } from "./wrapperMetadata.js";
import { parseVersionCatalog, type ParsedVersionCatalog } from "./versionCatalogMetadata.js";
import { extractModuleGradleMetadata } from "./moduleMetadataExtractor.js";
import { resolvePluginVersion } from "./pluginVersionExtractor.js";
import { parseSettingsMetadata } from "./settingsMetadata.js";
import type { AndroidGradleMetadata, AndroidGradleMetadataConflict, AndroidGradleModuleInfo, AndroidGradlePluginEvidence } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — static Android Gradle metadata extraction entry point.
//
// Static, deterministic, read-only, network-free, and independent of Gradle
// execution/Java/Android SDK availability — consumes only the Batch 2
// AndroidDetectionResult (settings/build/wrapper/catalog file paths and
// module records) plus direct filesystem reads of those same files.
// ---------------------------------------------------------------------------

function readTextSafe(absolutePath: string): string | undefined {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

const ANDROID_APPLICATION_PLUGIN_ID = "com.android.application";
const ANDROID_LIBRARY_PLUGIN_ID = "com.android.library";
const KOTLIN_ANDROID_PLUGIN_ID = "org.jetbrains.kotlin.android";
const AGP_CLASSPATH_GROUP_ARTIFACT = "com.android.tools.build:gradle";

export function readAndroidGradleMetadata(targetRoot: string, detection: AndroidDetectionResult): AndroidGradleMetadata {
  const resolvedRoot = path.resolve(targetRoot);
  const parseWarnings: string[] = [];
  const unsupportedExpressions: string[] = [];

  // ---- Wrapper ---------------------------------------------------------------
  const wrapperPropertiesPath = "gradle/wrapper/gradle-wrapper.properties";
  let wrapperPropertiesExists = false;
  try {
    resolveWithinRoot(resolvedRoot, wrapperPropertiesPath);
    wrapperPropertiesExists = true;
  } catch {
    wrapperPropertiesExists = false;
  }
  const wrapperText = wrapperPropertiesExists ? readTextSafe(path.join(resolvedRoot, wrapperPropertiesPath)) : undefined;
  const gradlewPresent = readTextSafe(path.join(resolvedRoot, "gradlew")) !== undefined;
  const gradlewBatPresent = readTextSafe(path.join(resolvedRoot, "gradlew.bat")) !== undefined;

  const wrapperWarnings: string[] = [];
  let wrapper: AndroidGradleMetadata["wrapper"];
  if (wrapperText !== undefined) {
    const parsed = parseWrapperProperties(wrapperText);
    wrapperWarnings.push(...parsed.warnings);
    if (!gradlewPresent && !gradlewBatPresent) {
      wrapperWarnings.push("gradle-wrapper.properties exists but neither gradlew nor gradlew.bat was found.");
    }
    wrapper = {
      present: detection.hasGradleWrapper,
      wrapperPropertiesPath,
      versionEvidence: parsed.gradleVersion,
      distributionUrl: parsed.distributionUrl,
      distributionType: parsed.distributionType,
      checksumPropertyPresent: parsed.checksumPropertyPresent,
      gradlewPresent,
      gradlewBatPresent,
      warnings: wrapperWarnings,
    };
  } else {
    if (gradlewPresent || gradlewBatPresent) {
      wrapperWarnings.push("gradlew/gradlew.bat found but gradle-wrapper.properties is missing or unreadable.");
    }
    wrapper = {
      present: detection.hasGradleWrapper,
      gradlewPresent,
      gradlewBatPresent,
      warnings: wrapperWarnings,
    };
  }
  parseWarnings.push(...wrapperWarnings);

  // ---- Settings ---------------------------------------------------------------
  let rootProjectName: string | undefined;
  for (const settingsPath of detection.gradleSettingsFiles) {
    const text = readTextSafe(path.join(resolvedRoot, settingsPath));
    if (!text) continue;
    const parsed = parseSettingsMetadata(text);
    if (parsed.rootProjectName && !rootProjectName) rootProjectName = parsed.rootProjectName;
    if (parsed.includedBuilds.length > 0) {
      parseWarnings.push(`${settingsPath}: included build(s) present as unsupported/external evidence: ${parsed.includedBuilds.join(", ")}`);
    }
  }

  // ---- Version catalog ---------------------------------------------------------
  let versionCatalogEvidence: ReturnType<typeof extractVersionCatalogEvidence> | undefined;
  let parsedCatalog: ParsedVersionCatalog | undefined;
  if (detection.versionCatalogFiles.length > 0) {
    const catalogText = readTextSafe(path.join(resolvedRoot, detection.versionCatalogFiles[0]));
    if (catalogText) {
      versionCatalogEvidence = extractVersionCatalogEvidence(catalogText);
      parsedCatalog = parseVersionCatalog(catalogText);
    }
  }

  // ---- Root build files: plugin/AGP/Kotlin version evidence --------------------
  const pluginEvidence: AndroidGradlePluginEvidence = {};
  for (const rootBuildFilePath of detection.rootBuildFiles) {
    const text = readTextSafe(path.join(resolvedRoot, rootBuildFilePath));
    if (!text) continue;

    const hasDirectAgpTextEvidence = text.includes(ANDROID_APPLICATION_PLUGIN_ID) || text.includes(ANDROID_LIBRARY_PLUGIN_ID);
    if (!pluginEvidence.androidGradlePluginVersion) {
      const agpVersion = resolvePluginVersion(text, ANDROID_APPLICATION_PLUGIN_ID, parsedCatalog, AGP_CLASSPATH_GROUP_ARTIFACT);
      if (agpVersion.version) pluginEvidence.androidGradlePluginVersion = agpVersion.version;
    }
    if (!pluginEvidence.androidGradlePluginEvidence && (hasDirectAgpTextEvidence || pluginEvidence.androidGradlePluginVersion)) {
      pluginEvidence.androidGradlePluginEvidence = hasDirectAgpTextEvidence
        ? `Android Gradle Plugin referenced in ${rootBuildFilePath}`
        : `Android Gradle Plugin referenced via version-catalog alias in ${rootBuildFilePath}`;
    }
    const hasDirectKotlinTextEvidence = text.includes(KOTLIN_ANDROID_PLUGIN_ID);
    if (!pluginEvidence.kotlinAndroidPluginVersion) {
      const kotlinVersion = resolvePluginVersion(text, KOTLIN_ANDROID_PLUGIN_ID, parsedCatalog);
      if (kotlinVersion.version) pluginEvidence.kotlinAndroidPluginVersion = kotlinVersion.version;
    }
    if (!pluginEvidence.kotlinAndroidPluginEvidence && (hasDirectKotlinTextEvidence || pluginEvidence.kotlinAndroidPluginVersion)) {
      pluginEvidence.kotlinAndroidPluginEvidence = hasDirectKotlinTextEvidence
        ? `Kotlin Android plugin referenced in ${rootBuildFilePath}`
        : `Kotlin Android plugin referenced via version-catalog alias in ${rootBuildFilePath}`;
    }
  }
  if (versionCatalogEvidence && versionCatalogEvidence.composeAliasEvidence.length > 0) {
    pluginEvidence.composePluginEvidence = `Version-catalog Compose alias(es): ${versionCatalogEvidence.composeAliasEvidence.join(", ")}`;
  }
  if (!pluginEvidence.androidGradlePluginVersion && pluginEvidence.androidGradlePluginEvidence) {
    unsupportedExpressions.push("Android Gradle Plugin version could not be statically resolved.");
  }

  // ---- Modules ------------------------------------------------------------------
  const moduleBuildFiles: string[] = [];
  const modules: AndroidGradleModuleInfo[] = [];
  const applicationIdsByModule: { modulePath: string; value: string; sourceFile: string }[] = [];

  for (const module of detection.modules) {
    const buildFileCandidates = [`${module.path}/build.gradle.kts`, `${module.path}/build.gradle`];
    const buildFileRelPath = buildFileCandidates.find((candidate) => readTextSafe(path.join(resolvedRoot, candidate)) !== undefined);
    if (!buildFileRelPath) {
      modules.push({
        path: module.path,
        buildTypes: [],
        sourceSetEvidence: [],
        testSourceSetEvidence: [],
        unsupportedExpressions: [],
      });
      continue;
    }
    moduleBuildFiles.push(buildFileRelPath);
    const text = readTextSafe(path.join(resolvedRoot, buildFileRelPath)) ?? "";
    const extracted = extractModuleGradleMetadata(text);

    const javaSourceRoots = detection.javaSourceRoots.filter((p) => p.startsWith(`${module.path}/`));
    const kotlinSourceRoots = detection.kotlinSourceRoots.filter((p) => p.startsWith(`${module.path}/`));
    const unitTestRoots = detection.unitTestSourceRoots.filter((p) => p.startsWith(`${module.path}/`));
    const instrumentedTestRoots = detection.instrumentedTestSourceRoots.filter((p) => p.startsWith(`${module.path}/`));

    modules.push({
      path: module.path,
      buildFilePath: buildFileRelPath,
      ...extracted.info,
      sourceSetEvidence: [...extracted.info.sourceSetEvidence, ...javaSourceRoots, ...kotlinSourceRoots].sort((a, b) => a.localeCompare(b)),
      testSourceSetEvidence: [...unitTestRoots, ...instrumentedTestRoots].sort((a, b) => a.localeCompare(b)),
    });

    if (extracted.info.applicationId) {
      applicationIdsByModule.push({ modulePath: module.path, value: extracted.info.applicationId, sourceFile: buildFileRelPath });
    }
    unsupportedExpressions.push(...extracted.info.unsupportedExpressions.map((e) => `${buildFileRelPath}: ${e}`));
  }

  // ---- Conflicts ------------------------------------------------------------------
  const conflicts: AndroidGradleMetadataConflict[] = [];
  const applicationModulePaths = new Set(detection.applicationModules);
  const applicationIdConflictEntries = applicationIdsByModule.filter((e) => applicationModulePaths.has(e.modulePath));
  const distinctApplicationModuleIds = new Set(applicationIdConflictEntries.map((e) => e.value));
  if (distinctApplicationModuleIds.size > 1) {
    conflicts.push({
      field: "applicationId",
      modulePath: [...applicationModulePaths].sort((a, b) => a.localeCompare(b)).join(", "),
      values: applicationIdConflictEntries.map((e) => ({ value: e.value, sourceFile: e.sourceFile })),
      note: `${distinctApplicationModuleIds.size} distinct applicationId values found across application modules; no primary value was selected.`,
    });
  }

  // ---- Confidence ------------------------------------------------------------------
  const hasAnyResolvedModuleMetadata = modules.some((m) => m.namespace || m.applicationId || m.minSdk || m.targetSdk || m.compileSdk);
  const hasUnresolvedEvidence = unsupportedExpressions.length > 0 || conflicts.length > 0;
  let metadataConfidence: MobileConfidence = "unknown";
  if (hasAnyResolvedModuleMetadata) {
    metadataConfidence = hasUnresolvedEvidence ? "medium" : "high";
  } else if (moduleBuildFiles.length > 0) {
    metadataConfidence = "low";
  }

  return {
    wrapper,
    settingsFiles: detection.gradleSettingsFiles,
    rootBuildFiles: detection.rootBuildFiles,
    moduleBuildFiles: moduleBuildFiles.sort((a, b) => a.localeCompare(b)),
    rootProjectName,
    pluginEvidence,
    modules: modules.sort((a, b) => a.path.localeCompare(b.path)),
    versionCatalogEvidence,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
    metadataConfidence,
    parseWarnings: [...new Set(parseWarnings)],
    unsupportedExpressions: [...new Set(unsupportedExpressions)].sort((a, b) => a.localeCompare(b)),
  };
}

