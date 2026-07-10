// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — bounded settings.gradle(.kts) metadata beyond Batch 2's
// module-include parsing.
//
// Only extracts a direct `rootProject.name = "..."` / `rootProject.name "..."`
// literal and detects included-build/plugin-management/dependency-resolution
// presence as evidence — never evaluates the referenced build's contents.
// ---------------------------------------------------------------------------

export type SettingsMetadata = {
  rootProjectName?: string;
  hasPluginManagement: boolean;
  hasDependencyResolutionManagement: boolean;
  hasVersionCatalogDeclaration: boolean;
  includedBuilds: string[];
};

const ROOT_PROJECT_NAME_PATTERN = /rootProject\.name\s*=?\s*['"]([^'"]+)['"]/;

export function parseSettingsMetadata(text: string): SettingsMetadata {
  const rootProjectName = text.match(ROOT_PROJECT_NAME_PATTERN)?.[1];
  const includedBuilds = [...text.matchAll(/includeBuild\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

  return {
    rootProjectName,
    hasPluginManagement: /\bpluginManagement\s*\{/.test(text),
    hasDependencyResolutionManagement: /\bdependencyResolutionManagement\s*\{/.test(text),
    hasVersionCatalogDeclaration: /\bversionCatalogs\s*\{/.test(text) || /\bcreate\(\s*['"]libs['"]/.test(text),
    includedBuilds: includedBuilds.sort((a, b) => a.localeCompare(b)),
  };
}
