import { readFileSync } from "node:fs";
import path from "node:path";
import type { AndroidManifestParseEntry, AndroidManifestSourceSetKind } from "../../manifest/parseAndroidManifest.js";
import type { AndroidManifestSourceLocation } from "../../manifest/types.js";
import { parseAndroidResourceReference } from "../resourceReference.js";
import { resolveAndroidXmlResourceReference, type AndroidResourceCandidate, type AndroidResourceResolutionResult } from "../resourceResolution.js";
import { parseNetworkSecurityConfig } from "./parseNetworkSecurityConfig.js";
import type { NetworkSecurityConfigParseResult } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 2 — manifest-level cleartext/Network Security Config evidence
// extraction. Bridges already-parsed manifest data (src/mobile/android/
// manifest/) to the Batch 1 @xml/... resolver and this batch's NSC parser,
// classifying raw attribute values without reinterpreting an absent value as
// explicitly safe or unsafe.
// ---------------------------------------------------------------------------

export type UsesCleartextTrafficEvidence =
  | { state: "explicit-true"; raw: string }
  | { state: "explicit-false"; raw: string }
  | { state: "missing" }
  | { state: "malformed"; raw: string };

export type NetworkSecurityConfigReferenceEvidence =
  | { state: "absent" }
  | { state: "placeholder"; raw: string }
  | { state: "malformed"; raw: string; reason: string }
  | { state: "unsupported-type"; raw: string; resourceType: string }
  | { state: "package-qualified"; raw: string; packageQualifier: string }
  | { state: "module-unknown"; raw: string }
  | { state: "resolved"; raw: string; modulePath: string; candidate: AndroidResourceCandidate; parseResult: NetworkSecurityConfigParseResult }
  | {
      state: "ambiguous";
      raw: string;
      modulePath: string;
      candidates: Array<{ candidate: AndroidResourceCandidate; parseResult: NetworkSecurityConfigParseResult }>;
    }
  | { state: "missing"; raw: string; modulePath: string; searchedSourceSets: string[] };

export type ManifestNetworkSecurityEvidence = {
  manifestPath: string;
  modulePath?: string;
  sourceSetKind: AndroidManifestSourceSetKind;
  applicationLocation?: AndroidManifestSourceLocation;
  usesCleartextTraffic: UsesCleartextTrafficEvidence;
  networkSecurityConfig: NetworkSecurityConfigReferenceEvidence;
};

function classifyUsesCleartextTraffic(entry: AndroidManifestParseEntry): UsesCleartextTrafficEvidence {
  const app = entry.manifest.application;
  if (app.usesCleartextTraffic === true) return { state: "explicit-true", raw: app.usesCleartextTrafficRaw ?? "true" };
  if (app.usesCleartextTraffic === false) return { state: "explicit-false", raw: app.usesCleartextTrafficRaw ?? "false" };
  if (app.usesCleartextTrafficRaw !== undefined) return { state: "malformed", raw: app.usesCleartextTrafficRaw };
  return { state: "missing" };
}

function parseNetworkSecurityConfigFile(absolutePath: string): NetworkSecurityConfigParseResult {
  let xmlText: string;
  try {
    xmlText = readFileSync(absolutePath, "utf8");
  } catch (error) {
    return { state: "malformed-xml", reason: error instanceof Error ? error.message : "Unable to read the resolved Network Security Config file" };
  }
  return parseNetworkSecurityConfig(xmlText);
}

function classifyResolution(raw: string, resolution: AndroidResourceResolutionResult, targetRoot: string): NetworkSecurityConfigReferenceEvidence {
  switch (resolution.state) {
    case "resolved": {
      const candidate = resolution.candidates[0];
      return {
        state: "resolved",
        raw,
        modulePath: resolution.modulePath,
        candidate,
        parseResult: parseNetworkSecurityConfigFile(path.join(targetRoot, candidate.relativePath)),
      };
    }
    case "ambiguous":
      return {
        state: "ambiguous",
        raw,
        modulePath: resolution.modulePath,
        candidates: resolution.candidates.map((candidate) => ({
          candidate,
          parseResult: parseNetworkSecurityConfigFile(path.join(targetRoot, candidate.relativePath)),
        })),
      };
    case "missing":
      return { state: "missing", raw, modulePath: resolution.modulePath, searchedSourceSets: resolution.searchedSourceSets };
    case "malformed-reference":
      return { state: "malformed", raw, reason: resolution.reason };
    case "unsupported-reference":
      // Unreachable in practice: this function only calls the resolver once
      // parseAndroidResourceReference has already confirmed a "parsed"
      // (xml-type) reference, so the resolver's own unsupported-reference
      // branch (package-qualified/non-xml) cannot trigger from this path.
      // Handled defensively rather than asserted unreachable.
      return {
        state: "unsupported-type",
        raw,
        resourceType: "type" in resolution.parsed ? resolution.parsed.type : "unknown",
      };
  }
}

// Extracts and classifies cleartext-traffic/Network Security Config evidence
// for one already-parsed manifest. `targetRoot` must be the absolute Android
// target root (the same root the manifest/resource resolver operate within).
export function extractManifestNetworkSecurityEvidence(targetRoot: string, entry: AndroidManifestParseEntry): ManifestNetworkSecurityEvidence {
  const usesCleartextTraffic = classifyUsesCleartextTraffic(entry);
  const raw = entry.manifest.application.networkSecurityConfigRef;

  let networkSecurityConfig: NetworkSecurityConfigReferenceEvidence;
  if (raw === undefined) {
    networkSecurityConfig = { state: "absent" };
  } else {
    const parsedRef = parseAndroidResourceReference(raw);
    if (parsedRef.state === "placeholder") {
      networkSecurityConfig = { state: "placeholder", raw };
    } else if (parsedRef.state === "malformed") {
      networkSecurityConfig = { state: "malformed", raw, reason: parsedRef.reason };
    } else if (parsedRef.state === "empty") {
      networkSecurityConfig = { state: "malformed", raw, reason: "Reference is empty" };
    } else if (parsedRef.state === "unsupported-type") {
      networkSecurityConfig = { state: "unsupported-type", raw, resourceType: parsedRef.type };
    } else if (parsedRef.state === "package-qualified") {
      networkSecurityConfig = { state: "package-qualified", raw, packageQualifier: parsedRef.packageQualifier };
    } else if (entry.modulePath === undefined) {
      networkSecurityConfig = { state: "module-unknown", raw };
    } else {
      const moduleAbsolutePath = path.join(targetRoot, entry.modulePath);
      const resolution = resolveAndroidXmlResourceReference(targetRoot, moduleAbsolutePath, raw);
      networkSecurityConfig = classifyResolution(raw, resolution, targetRoot);
    }
  }

  return {
    manifestPath: entry.manifestPath,
    modulePath: entry.modulePath,
    sourceSetKind: entry.sourceSetKind,
    applicationLocation: entry.manifest.application.location,
    usesCleartextTraffic,
    networkSecurityConfig,
  };
}
