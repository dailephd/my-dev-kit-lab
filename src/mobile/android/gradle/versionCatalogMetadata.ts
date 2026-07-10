// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — bounded gradle/libs.versions.toml version resolution.
//
// Extends Batch 2's alias-name-only evidence (detect/versionCatalogEvidence.ts)
// with just enough section-aware parsing to resolve a plugin/library alias to
// its declared `id`/`module` and version literal (including one level of
// `version.ref` indirection into the `[versions]` table). This is still not
// a general TOML parser: bundles, rich-version constraints, and nested
// tables beyond [versions]/[plugins]/[libraries] are not resolved.
// ---------------------------------------------------------------------------

export type CatalogEntry = { id?: string; module?: string; version?: string; versionRef?: string };
export type ParsedVersionCatalog = {
  versions: Record<string, string>;
  plugins: Record<string, CatalogEntry>;
  libraries: Record<string, CatalogEntry>;
};

const SECTION_HEADER_PATTERN = /^\[(versions|plugins|libraries|bundles)\]\s*$/;
const SIMPLE_VERSION_PATTERN = /^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"\s*$/;
const TABLE_ENTRY_PATTERN = /^([A-Za-z0-9_-]+)\s*=\s*\{([^}]*)\}\s*$/;

function parseEntryBody(body: string): CatalogEntry {
  const entry: CatalogEntry = {};
  const idMatch = body.match(/\bid\s*=\s*"([^"]*)"/);
  if (idMatch) entry.id = idMatch[1];
  const moduleMatch = body.match(/\bmodule\s*=\s*"([^"]*)"/);
  if (moduleMatch) entry.module = moduleMatch[1];
  const versionRefMatch = body.match(/\bversion\.ref\s*=\s*"([^"]*)"/);
  if (versionRefMatch) {
    entry.versionRef = versionRefMatch[1];
  } else {
    const versionMatch = body.match(/\bversion\s*=\s*"([^"]*)"/);
    if (versionMatch) entry.version = versionMatch[1];
  }
  return entry;
}

// Parses gradle/libs.versions.toml text into [versions]/[plugins]/[libraries]
// maps. Unknown sections (e.g. [bundles]) and malformed lines are ignored
// rather than causing a parse failure.
export function parseVersionCatalog(text: string): ParsedVersionCatalog {
  const versions: Record<string, string> = {};
  const plugins: Record<string, CatalogEntry> = {};
  const libraries: Record<string, CatalogEntry> = {};

  let currentSection: "versions" | "plugins" | "libraries" | "bundles" | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const sectionMatch = line.match(SECTION_HEADER_PATTERN);
    if (sectionMatch) {
      currentSection = sectionMatch[1] as typeof currentSection;
      continue;
    }
    if (!currentSection) continue;

    if (currentSection === "versions") {
      const match = line.match(SIMPLE_VERSION_PATTERN);
      if (match) versions[match[1]] = match[2];
      continue;
    }

    if (currentSection === "plugins" || currentSection === "libraries") {
      const tableMatch = line.match(TABLE_ENTRY_PATTERN);
      if (tableMatch) {
        const [, alias, body] = tableMatch;
        (currentSection === "plugins" ? plugins : libraries)[alias] = parseEntryBody(body);
        continue;
      }
      const simpleMatch = line.match(SIMPLE_VERSION_PATTERN);
      if (simpleMatch) {
        // A bare `alias = "id:group:version"` shorthand form (used mainly
        // for libraries) — preserved as the module string, unresolved
        // further, since splitting it safely requires assumptions this
        // batch does not make.
        (currentSection === "plugins" ? plugins : libraries)[simpleMatch[1]] = { module: simpleMatch[2] };
      }
    }
  }

  return { versions, plugins, libraries };
}

// Resolves a catalog entry's version literal, following one level of
// version.ref indirection into the [versions] table. Returns undefined
// (unresolved) rather than guessing when the reference is missing.
export function resolveCatalogVersion(catalog: ParsedVersionCatalog, entry: CatalogEntry): string | undefined {
  if (entry.version) return entry.version;
  if (entry.versionRef) return catalog.versions[entry.versionRef];
  return undefined;
}

// Converts a Gradle version-catalog accessor path (e.g. from
// `libs.plugins.android.application`, the `android.application` suffix) back
// to its kebab-case alias key convention (`android-application`), the
// inverse of the accessor-generation convention used elsewhere in this
// codebase (see detect/detectAndroidProject.ts's catalogAliasToAccessorSuffix).
export function accessorSuffixToCatalogAlias(accessorSuffix: string): string {
  return accessorSuffix.replace(/\./g, "-");
}
