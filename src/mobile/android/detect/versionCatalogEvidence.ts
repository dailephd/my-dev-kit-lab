// ---------------------------------------------------------------------------
// v0.4.0 Batch 2 — bounded gradle/libs.versions.toml plugin-alias evidence.
//
// This is deliberately not a general TOML parser: it only line-scans the
// `[plugins]`/`[libraries]` sections for aliases whose declared id/module
// statically mentions an Android/Kotlin-Android/Compose plugin or library.
// Anything else in the catalog (bundles, rich versions, references) is left
// unresolved, matching the "bounded evidence only" requirement for this
// batch — a full catalog resolver belongs to a later batch if ever needed.
// ---------------------------------------------------------------------------

export type VersionCatalogEvidence = {
  androidPluginAliasEvidence: string[];
  kotlinAndroidPluginAliasEvidence: string[];
  composeAliasEvidence: string[];
};

const ALIAS_LINE_PATTERN = /^([A-Za-z0-9_-]+)\s*=\s*(\{.*\}|".*")\s*$/;

export function extractVersionCatalogEvidence(text: string): VersionCatalogEvidence {
  const androidPluginAliasEvidence: string[] = [];
  const kotlinAndroidPluginAliasEvidence: string[] = [];
  const composeAliasEvidence: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(ALIAS_LINE_PATTERN);
    if (!match) continue;
    const [, alias, body] = match;

    if (body.includes("com.android.application") || body.includes("com.android.library")) {
      androidPluginAliasEvidence.push(alias);
    }
    if (body.includes("org.jetbrains.kotlin.android")) {
      kotlinAndroidPluginAliasEvidence.push(alias);
    }
    if (/compose/i.test(body) || /androidx\.compose/i.test(body)) {
      composeAliasEvidence.push(alias);
    }
  }

  return {
    androidPluginAliasEvidence: androidPluginAliasEvidence.sort((a, b) => a.localeCompare(b)),
    kotlinAndroidPluginAliasEvidence: kotlinAndroidPluginAliasEvidence.sort((a, b) => a.localeCompare(b)),
    composeAliasEvidence: composeAliasEvidence.sort((a, b) => a.localeCompare(b)),
  };
}
