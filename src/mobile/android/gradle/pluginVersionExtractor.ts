import { accessorSuffixToCatalogAlias, resolveCatalogVersion, type ParsedVersionCatalog } from "./versionCatalogMetadata.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — bounded Android Gradle Plugin / Kotlin Android plugin
// version extraction.
//
// Supports three static forms, in order of preference: (1) a direct
// `id("...") version "X"` / `id '...' version '...'` declaration, (2) the
// legacy `classpath "com.android.tools.build:gradle:X"` buildscript form,
// and (3) a version-catalog `alias(libs.plugins.<accessor>)` reference
// resolved against a parsed catalog. No remote resolution is ever performed.
// ---------------------------------------------------------------------------

export type PluginVersionResult = { version?: string; raw?: string };

function extractDirectIdVersion(text: string, pluginId: string): string | undefined {
  const escaped = pluginId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`id\\s*\\(?\\s*['"]${escaped}['"]\\s*\\)?\\s*version\\s*['"]([^'"]+)['"]`);
  return text.match(pattern)?.[1];
}

function extractClasspathVersion(text: string, groupArtifact: string): string | undefined {
  const escaped = groupArtifact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`classpath\\s*['"]${escaped}:([^'"]+)['"]`);
  return text.match(pattern)?.[1];
}

function extractCatalogAliasVersion(text: string, pluginId: string, catalog: ParsedVersionCatalog | undefined): string | undefined {
  if (!catalog) return undefined;
  for (const match of text.matchAll(/alias\(\s*libs\.plugins\.([\w.]+)\s*\)/g)) {
    const alias = accessorSuffixToCatalogAlias(match[1]);
    const entry = catalog.plugins[alias];
    if (entry?.id === pluginId) {
      return resolveCatalogVersion(catalog, entry);
    }
  }
  return undefined;
}

// Resolves a plugin's version from root/module build-file text plus an
// optional parsed version catalog. `classpathGroupArtifact` is only relevant
// for the Android Gradle Plugin's legacy buildscript-classpath form.
export function resolvePluginVersion(
  text: string,
  pluginId: string,
  catalog: ParsedVersionCatalog | undefined,
  classpathGroupArtifact?: string
): PluginVersionResult {
  const direct = extractDirectIdVersion(text, pluginId);
  if (direct) return { version: direct };

  if (classpathGroupArtifact) {
    const classpath = extractClasspathVersion(text, classpathGroupArtifact);
    if (classpath) return { version: classpath };
  }

  const catalogVersion = extractCatalogAliasVersion(text, pluginId, catalog);
  if (catalogVersion) return { version: catalogVersion };

  return {};
}
