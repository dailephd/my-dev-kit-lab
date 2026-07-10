import { readFileSync } from "node:fs";
import path from "node:path";
import type { MobileConfidence } from "../../types.js";
import type { AndroidDetectionResult, AndroidModuleDetection, AndroidProjectKind } from "../detection.js";
import { extractBuildFileEvidence } from "./buildFileEvidence.js";
import { parseDeclaredModules } from "./settingsModules.js";
import { extractVersionCatalogEvidence } from "./versionCatalogEvidence.js";
import { scanSourceRootsForUiEvidence } from "./sourceEvidence.js";
import { walkAndroidCandidateFiles } from "./traversal.js";
import {
  classifyModule,
  classifyModuleUiToolkit,
  combineProjectConfidence,
  combineProjectKind,
  combineProjectUiToolkit,
} from "./classify.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 2 — Android project detector entry point.
//
// Static, deterministic, read-only, network-free. Does not invoke Gradle, the
// Android SDK, or a Java toolchain. Populates the Batch 1
// AndroidDetectionResult contract only — manifest content parsing, full
// Gradle metadata, and verdict calculation are later batches' scope.
// ---------------------------------------------------------------------------

function dirOf(relativeFilePath: string): string {
  const dir = path.posix.dirname(relativeFilePath.replace(/\\/g, "/"));
  return dir === "." ? "" : dir;
}

function baseNameOf(relativeFilePath: string): string {
  return path.posix.basename(relativeFilePath.replace(/\\/g, "/"));
}

function joinRelative(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

function catalogAliasToAccessorSuffix(alias: string): string {
  return alias.replace(/-/g, ".");
}

function readTextSafe(absolutePath: string): string | undefined {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

export function detectAndroidProject(targetRoot: string): AndroidDetectionResult {
  const resolvedRoot = path.resolve(targetRoot);
  const { relativeFilePaths, skippedSymlinks } = walkAndroidCandidateFiles(resolvedRoot);
  const fileSet = new Set(relativeFilePaths);
  const warnings: string[] = [];

  for (const skipped of skippedSymlinks) {
    warnings.push(`Skipped directory symlink (not followed): ${skipped}`);
  }

  // ---- Root-level evidence -------------------------------------------------
  const rootBuildFiles = relativeFilePaths
    .filter((p) => dirOf(p) === "" && (baseNameOf(p) === "build.gradle" || baseNameOf(p) === "build.gradle.kts"))
    .sort((a, b) => a.localeCompare(b));

  const gradleSettingsFiles = relativeFilePaths
    .filter((p) => dirOf(p) === "" && (baseNameOf(p) === "settings.gradle" || baseNameOf(p) === "settings.gradle.kts"))
    .sort((a, b) => a.localeCompare(b));

  if (gradleSettingsFiles.length > 1) {
    warnings.push(
      `Multiple root settings files found (${gradleSettingsFiles.join(", ")}); using "${gradleSettingsFiles[0]}" as the primary evidence source.`
    );
  }

  const hasGradleWrapper =
    fileSet.has("gradlew") || fileSet.has("gradlew.bat") || fileSet.has("gradle/wrapper/gradle-wrapper.properties");

  const versionCatalogFiles = relativeFilePaths.filter((p) => p === "gradle/libs.versions.toml");

  const catalogEvidence = versionCatalogFiles.length > 0
    ? extractVersionCatalogEvidence(readTextSafe(path.join(resolvedRoot, versionCatalogFiles[0])) ?? "")
    : { androidPluginAliasEvidence: [], kotlinAndroidPluginAliasEvidence: [], composeAliasEvidence: [] };

  // ---- Module discovery ------------------------------------------------------
  const structuralModuleDirs = new Set<string>();
  for (const p of relativeFilePaths) {
    const name = baseNameOf(p);
    if (name === "build.gradle" || name === "build.gradle.kts") {
      const dir = dirOf(p);
      if (dir !== "") structuralModuleDirs.add(dir);
    }
  }

  let declaredModulePaths: string[] = [];
  let unsupportedDeclarations: string[] = [];
  if (gradleSettingsFiles.length > 0) {
    const settingsText = readTextSafe(path.join(resolvedRoot, gradleSettingsFiles[0])) ?? "";
    const parsed = parseDeclaredModules(settingsText);
    declaredModulePaths = parsed.declaredModulePaths;
    unsupportedDeclarations = parsed.unsupportedDeclarations;
  }
  for (const declaration of unsupportedDeclarations) {
    warnings.push(`Unsupported or dynamic module declaration in settings file (preserved, not evaluated): ${declaration}`);
  }

  const declaredOnlyDirs = declaredModulePaths.filter((dir) => !structuralModuleDirs.has(dir));
  for (const dir of declaredOnlyDirs) {
    warnings.push(`Module "${dir}" is declared in the settings file but no build.gradle(.kts) was found for it.`);
  }

  const allModuleDirs = [...new Set([...structuralModuleDirs, ...declaredModulePaths])].sort((a, b) => a.localeCompare(b));

  // ---- Per-module evidence and classification --------------------------------
  const modules: AndroidModuleDetection[] = [];
  const javaSourceRoots: string[] = [];
  const kotlinSourceRoots: string[] = [];
  const unitTestSourceRoots: string[] = [];
  const instrumentedTestSourceRoots: string[] = [];
  const manifestPaths: string[] = [];

  let androidGradlePluginEvidence: string | undefined;
  let kotlinAndroidPluginEvidence: string | undefined;
  let namespaceEvidence: string | undefined;
  let applicationIdEvidence: string | undefined;

  for (const moduleDir of allModuleDirs) {
    const buildFileRelPath = [`${moduleDir}/build.gradle.kts`, `${moduleDir}/build.gradle`].find((p) => fileSet.has(p));
    const buildFileText = buildFileRelPath ? readTextSafe(path.join(resolvedRoot, buildFileRelPath)) ?? "" : undefined;
    const buildEvidence = buildFileText !== undefined ? extractBuildFileEvidence(buildFileText) : undefined;

    const hasCatalogAliasEvidence =
      buildFileText !== undefined &&
      [...catalogEvidence.androidPluginAliasEvidence, ...catalogEvidence.kotlinAndroidPluginAliasEvidence].some((alias) =>
        buildFileText.includes(`libs.plugins.${catalogAliasToAccessorSuffix(alias)}`)
      );

    const manifestRelPath = `${moduleDir}/src/main/AndroidManifest.xml`;
    const hasManifest = fileSet.has(manifestRelPath);
    const moduleManifestPaths = hasManifest ? [manifestRelPath] : [];

    const javaRootPrefix = `${moduleDir}/src/main/java/`;
    const kotlinRootPrefix = `${moduleDir}/src/main/kotlin/`;
    const unitTestPrefix = `${moduleDir}/src/test/`;
    const instrumentedTestPrefix = `${moduleDir}/src/androidTest/`;
    const resLayoutPrefix = `${moduleDir}/src/main/res/layout`;

    // Language is classified by file extension found under each directory,
    // not by directory name alone — Kotlin sources are conventionally placed
    // under src/main/java in some older project layouts, so a "java"-named
    // directory containing only .kt files is a Kotlin source root, not a
    // Java one (agents.txt Batch 2 section 7.9).
    const javaRootHasJavaFiles = relativeFilePaths.some((p) => p.startsWith(javaRootPrefix) && p.endsWith(".java"));
    const javaRootHasKotlinFiles = relativeFilePaths.some((p) => p.startsWith(javaRootPrefix) && p.endsWith(".kt"));
    const kotlinRootHasKotlinFiles = relativeFilePaths.some((p) => p.startsWith(kotlinRootPrefix) && p.endsWith(".kt"));
    const kotlinRootHasJavaFiles = relativeFilePaths.some((p) => p.startsWith(kotlinRootPrefix) && p.endsWith(".java"));
    const hasJavaRoot = javaRootHasJavaFiles || kotlinRootHasJavaFiles;
    const hasKotlinRoot = javaRootHasKotlinFiles || kotlinRootHasKotlinFiles;
    const hasUnitTestRoot = relativeFilePaths.some((p) => p.startsWith(unitTestPrefix));
    const hasInstrumentedTestRoot = relativeFilePaths.some((p) => p.startsWith(instrumentedTestPrefix));
    const hasResLayout = relativeFilePaths.some((p) => p.startsWith(resLayoutPrefix) && p.endsWith(".xml"));

    if (javaRootHasJavaFiles) javaSourceRoots.push(`${moduleDir}/src/main/java`);
    if (kotlinRootHasJavaFiles) javaSourceRoots.push(`${moduleDir}/src/main/kotlin`);
    if (kotlinRootHasKotlinFiles) kotlinSourceRoots.push(`${moduleDir}/src/main/kotlin`);
    if (javaRootHasKotlinFiles) kotlinSourceRoots.push(`${moduleDir}/src/main/java`);
    if (hasUnitTestRoot) unitTestSourceRoots.push(`${moduleDir}/src/test`);
    if (hasInstrumentedTestRoot) instrumentedTestSourceRoots.push(`${moduleDir}/src/androidTest`);
    manifestPaths.push(...moduleManifestPaths);

    const sourceUiEvidence = scanSourceRootsForUiEvidence(
      [javaRootHasJavaFiles || javaRootHasKotlinFiles ? path.join(resolvedRoot, moduleDir, "src", "main", "java") : undefined,
       kotlinRootHasKotlinFiles || kotlinRootHasJavaFiles ? path.join(resolvedRoot, moduleDir, "src", "main", "kotlin") : undefined]
        .filter((p): p is string => Boolean(p))
    );

    const classification = classifyModule({
      hasAndroidApplicationPlugin: buildEvidence?.androidApplicationPlugin ?? false,
      hasAndroidLibraryPlugin: buildEvidence?.androidLibraryPlugin ?? false,
      hasCatalogAndroidPluginAliasEvidence: hasCatalogAliasEvidence,
      namespace: buildEvidence?.namespace,
      applicationId: buildEvidence?.applicationId,
      hasManifest,
      hasSrcRoots: hasJavaRoot || hasKotlinRoot,
      hasResDir: relativeFilePaths.some((p) => p.startsWith(`${moduleDir}/src/main/res/`)),
      hasGenericBuildFile: buildFileText !== undefined,
    });

    const uiClassification = classifyModuleUiToolkit({
      composeBuildFeatureEvidence: buildEvidence?.composeBuildFeatureEvidence ?? false,
      composeDependencyEvidence: buildEvidence?.composeDependencyEvidence ?? false,
      composePluginEvidence: buildEvidence?.composePluginEvidence ?? false,
      composeSourceEvidence: sourceUiEvidence.composeSourceEvidence,
      hasResLayout,
      viewSourceEvidence: sourceUiEvidence.viewSourceEvidence,
    });

    if (buildEvidence?.androidApplicationPlugin && !androidGradlePluginEvidence) {
      androidGradlePluginEvidence = `com.android.application (${buildFileRelPath})`;
    }
    if (buildEvidence?.androidLibraryPlugin && !androidGradlePluginEvidence) {
      androidGradlePluginEvidence = `com.android.library (${buildFileRelPath})`;
    }
    if (buildEvidence?.kotlinAndroidPlugin && !kotlinAndroidPluginEvidence) {
      kotlinAndroidPluginEvidence = `org.jetbrains.kotlin.android (${buildFileRelPath})`;
    }
    if (buildEvidence?.namespace && !namespaceEvidence) {
      namespaceEvidence = buildEvidence.namespace;
    }
    if (buildEvidence?.applicationId && !applicationIdEvidence) {
      applicationIdEvidence = buildEvidence.applicationId;
    }

    modules.push({
      path: moduleDir,
      kind: classification.kind,
      manifestPaths: moduleManifestPaths,
      namespaceEvidence: buildEvidence?.namespace,
      applicationIdEvidence: buildEvidence?.applicationId,
      confidence: classification.confidence,
      evidence: classification.evidence,
      uiToolkit: uiClassification.uiToolkit,
    });
  }

  // ---- Project-level aggregation ---------------------------------------------
  const applicationModules = modules.filter((m) => m.kind === "application").map((m) => m.path).sort((a, b) => a.localeCompare(b));
  const libraryModules = modules.filter((m) => m.kind === "library").map((m) => m.path).sort((a, b) => a.localeCompare(b));

  const hasUnresolvedAndroidEvidence =
    declaredOnlyDirs.length > 0 || (rootBuildFiles.length > 0 && modules.some((m) => m.kind === "unknown"));

  let projectKind: AndroidProjectKind = combineProjectKind(
    modules.map((m) => ({ kind: m.kind, uiToolkit: m.uiToolkit ?? "uncertain" })),
    hasUnresolvedAndroidEvidence
  );

  // A single confirmed application/library module whose manifest is entirely
  // missing is Android-specific evidence with an incomplete structure, not a
  // confidently confirmed Android project — downgrade to "partial" rather
  // than reporting a false-confident "application"/"library" classification
  // (agents.txt Batch 2 section 12.3). Multi-module/mixed projects where only
  // some modules lack a manifest keep their combined kind; the missing
  // manifest is still surfaced via partialOrUnsupportedStructure below.
  const androidModules = modules.filter((m) => m.kind === "application" || m.kind === "library");
  const allAndroidModulesMissingManifest = androidModules.length > 0 && androidModules.every((m) => m.manifestPaths.length === 0);
  if (allAndroidModulesMissingManifest && (projectKind === "application" || projectKind === "library")) {
    projectKind = "partial";
  }

  const uiToolkit = combineProjectUiToolkit(modules.map((m) => ({ kind: m.kind, uiToolkit: m.uiToolkit ?? "uncertain" })));

  const hasNonAndroidEvidenceOnly = rootBuildFiles.length > 0 || modules.some((m) => m.kind === "non-android");
  const confidence: MobileConfidence = combineProjectConfidence(
    projectKind,
    modules.filter((m) => m.kind === "application" || m.kind === "library" || m.kind === "unknown").map((m) => m.confidence ?? "unknown"),
    hasNonAndroidEvidenceOnly
  );

  const androidModulesMissingManifest = modules.filter(
    (m) => (m.kind === "application" || m.kind === "library") && m.manifestPaths.length === 0
  );
  for (const module of androidModulesMissingManifest) {
    warnings.push(`No AndroidManifest.xml found for Android module "${module.path}".`);
  }

  const partialOrUnsupportedStructure =
    projectKind === "partial" || androidModulesMissingManifest.length > 0 || unsupportedDeclarations.length > 0 || declaredOnlyDirs.length > 0;

  const evidence: string[] = [];
  if (applicationModules.length > 0) evidence.push(`${applicationModules.length} application module(s) found: ${applicationModules.join(", ")}`);
  if (libraryModules.length > 0) evidence.push(`${libraryModules.length} library module(s) found: ${libraryModules.join(", ")}`);
  if (hasGradleWrapper) evidence.push("Gradle wrapper present");
  if (gradleSettingsFiles.length > 0) evidence.push(`Gradle settings file(s): ${gradleSettingsFiles.join(", ")}`);
  if (catalogEvidence.androidPluginAliasEvidence.length > 0) {
    evidence.push(`Version-catalog Android plugin alias(es): ${catalogEvidence.androidPluginAliasEvidence.join(", ")}`);
  }
  if (catalogEvidence.composeAliasEvidence.length > 0) {
    evidence.push(`Version-catalog Compose alias(es): ${catalogEvidence.composeAliasEvidence.join(", ")}`);
  }

  return {
    detected: projectKind !== "non-android",
    confidence,
    evidence,
    projectKind,
    uiToolkit,
    hasGradleWrapper,
    gradleSettingsFiles,
    rootBuildFiles,
    versionCatalogFiles,
    modules,
    applicationModules,
    libraryModules,
    manifestPaths: [...new Set(manifestPaths)].sort((a, b) => a.localeCompare(b)),
    javaSourceRoots: [...new Set(javaSourceRoots)].sort((a, b) => a.localeCompare(b)),
    kotlinSourceRoots: [...new Set(kotlinSourceRoots)].sort((a, b) => a.localeCompare(b)),
    unitTestSourceRoots: [...new Set(unitTestSourceRoots)].sort((a, b) => a.localeCompare(b)),
    instrumentedTestSourceRoots: [...new Set(instrumentedTestSourceRoots)].sort((a, b) => a.localeCompare(b)),
    androidGradlePluginEvidence,
    kotlinAndroidPluginEvidence,
    namespaceEvidence,
    applicationIdEvidence,
    partialOrUnsupportedStructure,
    warnings,
  };
}
