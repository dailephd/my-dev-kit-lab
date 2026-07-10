// ---------------------------------------------------------------------------
// v0.4.0 Batch 2 — bounded, deterministic build.gradle(.kts) evidence
// extraction.
//
// Extracts only the lexical signals needed for detection and classification
// (plugin ids, namespace, applicationId, Compose build-feature/dependency
// evidence). This is not a Gradle metadata parser (that is Batch 4's scope):
// values that cannot be statically read as a literal are preserved as
// "unresolved" evidence rather than guessed.
// ---------------------------------------------------------------------------

export type BuildFileEvidence = {
  androidApplicationPlugin: boolean;
  androidLibraryPlugin: boolean;
  kotlinAndroidPlugin: boolean;
  namespace?: string;
  namespaceUnresolved: boolean;
  applicationId?: string;
  applicationIdUnresolved: boolean;
  composeBuildFeatureEvidence: boolean;
  composeDependencyEvidence: boolean;
  composePluginEvidence: boolean;
};

const ANDROID_APPLICATION_PLUGIN_PATTERN = /(['"`])com\.android\.application\1|id\s*\(\s*['"`]com\.android\.application['"`]\s*\)/;
const ANDROID_LIBRARY_PLUGIN_PATTERN = /(['"`])com\.android\.library\1|id\s*\(\s*['"`]com\.android\.library['"`]\s*\)/;
const KOTLIN_ANDROID_PLUGIN_PATTERN =
  /(['"`])org\.jetbrains\.kotlin\.android\1|kotlin\s*\(\s*['"`]android['"`]\s*\)|(['"`])kotlin-android\2/;

const NAMESPACE_LITERAL_PATTERN = /\bnamespace\s*[=]?\s*['"]([^'"]+)['"]/;
const NAMESPACE_UNRESOLVED_PATTERN = /\bnamespace\s*[=]?\s*(?!['"])[^\s\n]/;
const APPLICATION_ID_LITERAL_PATTERN = /\bapplicationId\s*[=]?\s*['"]([^'"]+)['"]/;
const APPLICATION_ID_UNRESOLVED_PATTERN = /\bapplicationId\s*[=]?\s*(?!['"])[^\s\n]/;

const COMPOSE_BUILD_FEATURE_PATTERN = /\bcompose\s*[=]?\s*true\b/;
const COMPOSE_DEPENDENCY_PATTERN = /androidx\.compose|compose-bom|compose\.(?:ui|material|material3|runtime|foundation)/;
const COMPOSE_PLUGIN_PATTERN = /org\.jetbrains\.kotlin\.plugin\.compose|com\.android\.compose|compose-compiler/;

export function extractBuildFileEvidence(text: string): BuildFileEvidence {
  const namespaceLiteral = text.match(NAMESPACE_LITERAL_PATTERN);
  const applicationIdLiteral = text.match(APPLICATION_ID_LITERAL_PATTERN);

  return {
    androidApplicationPlugin: ANDROID_APPLICATION_PLUGIN_PATTERN.test(text),
    androidLibraryPlugin: ANDROID_LIBRARY_PLUGIN_PATTERN.test(text),
    kotlinAndroidPlugin: KOTLIN_ANDROID_PLUGIN_PATTERN.test(text),
    namespace: namespaceLiteral?.[1],
    namespaceUnresolved: !namespaceLiteral && NAMESPACE_UNRESOLVED_PATTERN.test(text),
    applicationId: applicationIdLiteral?.[1],
    applicationIdUnresolved: !applicationIdLiteral && APPLICATION_ID_UNRESOLVED_PATTERN.test(text),
    composeBuildFeatureEvidence: COMPOSE_BUILD_FEATURE_PATTERN.test(text),
    composeDependencyEvidence: COMPOSE_DEPENDENCY_PATTERN.test(text),
    composePluginEvidence: COMPOSE_PLUGIN_PATTERN.test(text),
  };
}
