import type { MobileConfidence } from "../../types.js";
import type { VersionCatalogEvidence } from "../detect/versionCatalogEvidence.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 1 — Android Gradle metadata model foundation.
// v0.4.0 Batch 4 — narrow additive inherited-contract corrections needed by
// static Gradle metadata extraction (see agents.txt Batch 4 section 6.6).
// Every change is a new optional field or a new optional array — no existing
// field, type, or enum value was removed or retyped, so all Batch 1–3 object
// literals remain valid:
//   - AndroidGradleWrapperInfo gained distributionUrl/distributionType/
//     checksumPropertyPresent/gradlewPresent/gradlewBatPresent/warnings so
//     wrapper completeness can be represented without claiming authenticity
//     (section 7.2).
//   - AndroidGradleModuleInfo gained a "Raw" companion field for each
//     resolvable metadata value (namespaceRaw, applicationIdRaw, etc.) so an
//     unresolved/dynamic expression can be preserved distinctly from a
//     resolved literal — the same pattern Batch 3 used for
//     AndroidManifestComponent.exportedRaw (sections 7.7–7.9, 7.15).
//   - AndroidGradlePluginEvidence gained version/versionRaw fields for the
//     Android Gradle Plugin and Kotlin Android plugin, plus
//     composePluginEvidence (section 7.6).
//   - AndroidGradleMetadata gained optional rootProjectName,
//     versionCatalogEvidence (reusing Batch 2's VersionCatalogEvidence type
//     rather than duplicating it), and conflicts (section 7.14).
// ---------------------------------------------------------------------------

export type AndroidGradleDistributionType = "bin" | "all" | "unknown";

export type AndroidGradleWrapperInfo = {
  present: boolean;
  wrapperPropertiesPath?: string;
  versionEvidence?: string;
  distributionUrl?: string;
  distributionType?: AndroidGradleDistributionType;
  checksumPropertyPresent?: boolean;
  gradlewPresent?: boolean;
  gradlewBatPresent?: boolean;
  warnings?: string[];
};

export type AndroidGradleModuleInfo = {
  path: string;
  buildFilePath?: string;
  isApplication?: boolean;
  isLibrary?: boolean;
  namespace?: string;
  namespaceRaw?: string;
  applicationId?: string;
  applicationIdRaw?: string;
  versionCode?: number | string;
  versionCodeRaw?: string;
  versionName?: string;
  versionNameRaw?: string;
  minSdk?: number | string;
  minSdkRaw?: string;
  targetSdk?: number | string;
  targetSdkRaw?: string;
  compileSdk?: number | string;
  compileSdkRaw?: string;
  buildTypes: string[];
  // v0.4.1 Batch 3 — bounded literal evidence for each named build-type
  // block (Groovy and Kotlin DSL). Additive/optional: `buildTypes` above is
  // unchanged (names only) so every existing consumer/literal is unaffected.
  buildTypeDetails?: AndroidGradleBuildTypeInfo[];
  composeEnabled?: boolean;
  sourceSetEvidence: string[];
  testSourceSetEvidence: string[];
  unsupportedExpressions: string[];
};

// v0.4.1 Batch 3 — literal/reference/dynamic/missing state for one boolean-
// or reference-shaped Gradle build-type field. Mirrors the existing
// Raw-companion-field convention above (e.g. namespaceRaw) rather than a new
// vocabulary: "literal-true"/"literal-false" when a bare boolean literal was
// found, "dynamic" when a non-empty but non-boolean expression was found
// (variable reference, function call, etc. — never evaluated), "missing"
// when the key was not found at all in the build-type block.
export type AndroidGradleLiteralBooleanState = "literal-true" | "literal-false" | "dynamic" | "missing";

export type AndroidGradleBuildTypeInfo = {
  name: string;
  debuggable?: boolean;
  debuggableRaw?: string;
  debuggableState: AndroidGradleLiteralBooleanState;
  minifyEnabled?: boolean;
  minifyEnabledRaw?: string;
  minifyEnabledState: AndroidGradleLiteralBooleanState;
  shrinkResources?: boolean;
  shrinkResourcesRaw?: string;
  shrinkResourcesState: AndroidGradleLiteralBooleanState;
  // signingConfig/matchingFallbacks/initWith are inherently reference
  // expressions in real Gradle files (e.g. `signingConfigs.getByName("release")`)
  // — never plain string/int literals — so only a bounded raw excerpt is
  // preserved, never a resolved value. This is release metadata only; it
  // must never be treated as signing-leak evidence (that is Batch 4 scope).
  signingConfigRef?: string;
  matchingFallbacksRaw?: string;
  initWithRaw?: string;
};

export type AndroidGradlePluginEvidence = {
  androidGradlePluginEvidence?: string;
  androidGradlePluginVersion?: string;
  androidGradlePluginVersionRaw?: string;
  kotlinAndroidPluginEvidence?: string;
  kotlinAndroidPluginVersion?: string;
  kotlinAndroidPluginVersionRaw?: string;
  composePluginEvidence?: string;
};

export type AndroidGradleMetadataConflict = {
  field: string;
  modulePath: string;
  values: { value: string; sourceFile: string }[];
  note: string;
};

export type AndroidGradleMetadata = {
  wrapper: AndroidGradleWrapperInfo;
  settingsFiles: string[];
  rootBuildFiles: string[];
  moduleBuildFiles: string[];
  rootProjectName?: string;
  pluginEvidence: AndroidGradlePluginEvidence;
  modules: AndroidGradleModuleInfo[];
  versionCatalogEvidence?: VersionCatalogEvidence;
  conflicts?: AndroidGradleMetadataConflict[];
  metadataConfidence: MobileConfidence;
  parseWarnings: string[];
  unsupportedExpressions: string[];
};
