import type { AndroidManifestParseEntry } from "../../manifest/parseAndroidManifest.js";
import type { AndroidManifestSourceLocation } from "../../manifest/types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 3 — manifest-level debuggable/testOnly evidence extraction
// for the release-configuration analyzer. Deliberately narrow (only these
// two boolean attributes, no resource resolution) — kept separate from
// backupConfiguration/manifestEvidence.ts (which also classifies these same
// two attributes as part of its wider extraction) so this module has one
// clear responsibility and does not pull in backup XML resolution as an
// unrelated side effect.
// ---------------------------------------------------------------------------

export type ManifestBooleanAttributeState = "explicit-true" | "explicit-false" | "missing" | "malformed";
export type ManifestBooleanAttributeEvidence = { state: ManifestBooleanAttributeState; raw?: string };

export type ManifestReleaseEvidence = {
  manifestPath: string;
  modulePath?: string;
  applicationLocation?: AndroidManifestSourceLocation;
  debuggable: ManifestBooleanAttributeEvidence;
  testOnly: ManifestBooleanAttributeEvidence;
};

function classifyBooleanAttribute(value: boolean | undefined, raw: string | undefined): ManifestBooleanAttributeEvidence {
  if (value === true) return { state: "explicit-true", raw: raw ?? "true" };
  if (value === false) return { state: "explicit-false", raw: raw ?? "false" };
  if (raw !== undefined) return { state: "malformed", raw };
  return { state: "missing" };
}

export function extractManifestReleaseEvidence(entry: AndroidManifestParseEntry): ManifestReleaseEvidence {
  const app = entry.manifest.application;
  return {
    manifestPath: entry.manifestPath,
    modulePath: entry.modulePath,
    applicationLocation: app.location,
    debuggable: classifyBooleanAttribute(app.debuggable, app.debuggableRaw),
    testOnly: classifyBooleanAttribute(app.testOnly, app.testOnlyRaw),
  };
}
