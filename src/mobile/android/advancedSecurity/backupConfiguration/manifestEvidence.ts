import { readFileSync } from "node:fs";
import path from "node:path";
import type { AndroidManifestParseEntry, AndroidManifestSourceSetKind } from "../../manifest/parseAndroidManifest.js";
import type { AndroidManifestSourceLocation } from "../../manifest/types.js";
import { parseAndroidResourceReference } from "../resourceReference.js";
import { resolveAndroidXmlResourceReference, type AndroidResourceCandidate, type AndroidResourceResolutionResult } from "../resourceResolution.js";
import { parseBackupRules } from "./parseBackupRules.js";
import type { BackupRulesParseResult } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 3 — manifest-level backup/data-extraction/debuggable/testOnly
// evidence extraction. Mirrors Batch 2's manifestEvidence.ts layering
// (classify raw attribute values, resolve @xml/... references through the
// Batch 1 resolver, parse the resolved file) rather than a new pattern.
// ---------------------------------------------------------------------------

export type ManifestBooleanAttributeState = "explicit-true" | "explicit-false" | "missing" | "malformed";
export type ManifestBooleanAttributeEvidence = { state: ManifestBooleanAttributeState; raw?: string };

// Generic over the specific parse-result type so fullBackupContentRef and
// dataExtractionRulesRef (both @xml/... resource references) share one
// union shape instead of two near-duplicates within this batch.
export type XmlResourceReferenceEvidence<TParseResult> =
  | { state: "absent" }
  | { state: "placeholder"; raw: string }
  | { state: "malformed"; raw: string; reason: string }
  | { state: "unsupported-type"; raw: string; resourceType: string }
  | { state: "package-qualified"; raw: string; packageQualifier: string }
  | { state: "module-unknown"; raw: string }
  | { state: "resolved"; raw: string; modulePath: string; candidate: AndroidResourceCandidate; parseResult: TParseResult }
  | { state: "ambiguous"; raw: string; modulePath: string; candidates: Array<{ candidate: AndroidResourceCandidate; parseResult: TParseResult }> }
  | { state: "missing"; raw: string; modulePath: string; searchedSourceSets: string[] };

export type FullBackupContentEvidence =
  | { state: "legacy-literal-true"; raw: string }
  | { state: "legacy-literal-false"; raw: string }
  | XmlResourceReferenceEvidence<BackupRulesParseResult>;

export type ManifestBackupEvidence = {
  manifestPath: string;
  modulePath?: string;
  sourceSetKind: AndroidManifestSourceSetKind;
  applicationLocation?: AndroidManifestSourceLocation;
  allowBackup: ManifestBooleanAttributeEvidence;
  debuggable: ManifestBooleanAttributeEvidence;
  testOnly: ManifestBooleanAttributeEvidence;
  fullBackupContent: FullBackupContentEvidence;
  dataExtractionRules: XmlResourceReferenceEvidence<BackupRulesParseResult>;
};

function classifyBooleanAttribute(value: boolean | undefined, raw: string | undefined): ManifestBooleanAttributeEvidence {
  if (value === true) return { state: "explicit-true", raw: raw ?? "true" };
  if (value === false) return { state: "explicit-false", raw: raw ?? "false" };
  if (raw !== undefined) return { state: "malformed", raw };
  return { state: "missing" };
}

function parseBackupRulesFile(absolutePath: string): BackupRulesParseResult {
  let xmlText: string;
  try {
    xmlText = readFileSync(absolutePath, "utf8");
  } catch (error) {
    return { state: "malformed-xml", reason: error instanceof Error ? error.message : "Unable to read the resolved backup rules file" };
  }
  return parseBackupRules(xmlText);
}

function classifyResolution(raw: string, resolution: AndroidResourceResolutionResult, targetRoot: string): XmlResourceReferenceEvidence<BackupRulesParseResult> {
  switch (resolution.state) {
    case "resolved": {
      const candidate = resolution.candidates[0];
      return {
        state: "resolved",
        raw,
        modulePath: resolution.modulePath,
        candidate,
        parseResult: parseBackupRulesFile(path.join(targetRoot, candidate.relativePath)),
      };
    }
    case "ambiguous":
      return {
        state: "ambiguous",
        raw,
        modulePath: resolution.modulePath,
        candidates: resolution.candidates.map((candidate) => ({
          candidate,
          parseResult: parseBackupRulesFile(path.join(targetRoot, candidate.relativePath)),
        })),
      };
    case "missing":
      return { state: "missing", raw, modulePath: resolution.modulePath, searchedSourceSets: resolution.searchedSourceSets };
    case "malformed-reference":
      return { state: "malformed", raw, reason: resolution.reason };
    case "unsupported-reference":
      // Unreachable in practice — see Batch 2's manifestEvidence.ts for the
      // identical rationale (this function only calls the resolver once a
      // "parsed" xml-type reference is confirmed).
      return { state: "unsupported-type", raw, resourceType: "type" in resolution.parsed ? resolution.parsed.type : "unknown" };
  }
}

function classifyXmlReference(
  targetRoot: string,
  entry: AndroidManifestParseEntry,
  raw: string | undefined
): XmlResourceReferenceEvidence<BackupRulesParseResult> {
  if (raw === undefined) return { state: "absent" };

  const parsedRef = parseAndroidResourceReference(raw);
  if (parsedRef.state === "placeholder") return { state: "placeholder", raw };
  if (parsedRef.state === "malformed") return { state: "malformed", raw, reason: parsedRef.reason };
  if (parsedRef.state === "empty") return { state: "malformed", raw, reason: "Reference is empty" };
  if (parsedRef.state === "unsupported-type") return { state: "unsupported-type", raw, resourceType: parsedRef.type };
  if (parsedRef.state === "package-qualified") return { state: "package-qualified", raw, packageQualifier: parsedRef.packageQualifier };
  if (entry.modulePath === undefined) return { state: "module-unknown", raw };

  const moduleAbsolutePath = path.join(targetRoot, entry.modulePath);
  const resolution = resolveAndroidXmlResourceReference(targetRoot, moduleAbsolutePath, raw);
  return classifyResolution(raw, resolution, targetRoot);
}

function classifyFullBackupContent(targetRoot: string, entry: AndroidManifestParseEntry): FullBackupContentEvidence {
  const raw = entry.manifest.application.fullBackupContentRef;
  if (raw === "true") return { state: "legacy-literal-true", raw };
  if (raw === "false") return { state: "legacy-literal-false", raw };
  return classifyXmlReference(targetRoot, entry, raw);
}

// Extracts and classifies backup/data-extraction/debuggable/testOnly
// evidence for one already-parsed manifest. `targetRoot` must be the
// absolute Android target root.
export function extractManifestBackupEvidence(targetRoot: string, entry: AndroidManifestParseEntry): ManifestBackupEvidence {
  const app = entry.manifest.application;
  return {
    manifestPath: entry.manifestPath,
    modulePath: entry.modulePath,
    sourceSetKind: entry.sourceSetKind,
    applicationLocation: app.location,
    allowBackup: classifyBooleanAttribute(app.allowBackup, app.allowBackupRaw),
    debuggable: classifyBooleanAttribute(app.debuggable, app.debuggableRaw),
    testOnly: classifyBooleanAttribute(app.testOnly, app.testOnlyRaw),
    fullBackupContent: classifyFullBackupContent(targetRoot, entry),
    dataExtractionRules: classifyXmlReference(targetRoot, entry, app.dataExtractionRulesRef),
  };
}
