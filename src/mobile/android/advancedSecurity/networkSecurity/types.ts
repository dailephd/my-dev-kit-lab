import type { XmlSourceLocation } from "../../manifest/xml/parseXml.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 2 — bounded Network Security Config parse-tree model.
//
// Local to Android advanced security (not a generic XML-tree extension —
// src/mobile/android/manifest/xml/parseXml.ts stays platform-agnostic).
// Locations are line/column only (XmlSourceLocation); the file path/module/
// source-set identity is attached by the caller once a file is resolved
// (see manifestEvidence.ts), not duplicated onto every node here.
//
// This is a parse-tree model only — no policy interpretation happens here
// (see deriveEffectiveNetworkPolicy.ts for inheritance/effective-value
// derivation).
// ---------------------------------------------------------------------------

export type NscTrustAnchorSourceKind = "system" | "user" | "raw-resource" | "unknown";

export type NscCertificatesEntry = {
  srcRaw?: string;
  sourceKind: NscTrustAnchorSourceKind;
  rawResourceName?: string;
  overridePins?: boolean;
  overridePinsRaw?: string;
  location: XmlSourceLocation;
};

export type NscTrustAnchors = {
  certificates: NscCertificatesEntry[];
  location: XmlSourceLocation;
};

export type NscPinEntry = {
  digestRaw?: string;
  digestSupported: boolean;
  // Bounded preview only — pin digests are not secrets, but raw XML content
  // must never be copied unbounded into candidate/finding evidence.
  valuePreview: string;
  malformed: boolean;
  malformedReason?: string;
  location: XmlSourceLocation;
};

export type NscPinSet = {
  expirationRaw?: string;
  expirationMalformed: boolean;
  pins: NscPinEntry[];
  location: XmlSourceLocation;
};

export type NscDomainEntry = {
  textRaw: string;
  normalized: string;
  includeSubdomains?: boolean;
  includeSubdomainsRaw?: string;
  malformed: boolean;
  location: XmlSourceLocation;
};

export type NscDomainConfig = {
  cleartextTrafficPermitted?: boolean;
  cleartextTrafficPermittedRaw?: string;
  domains: NscDomainEntry[];
  trustAnchors?: NscTrustAnchors;
  pinSet?: NscPinSet;
  nested: NscDomainConfig[];
  location: XmlSourceLocation;
  unsupportedChildren: string[];
  // Set when recursion was stopped at MAX_DOMAIN_CONFIG_DEPTH — deeper
  // <domain-config> children exist in the source but were not parsed.
  nestingTruncated: boolean;
};

export type NscBaseConfig = {
  cleartextTrafficPermitted?: boolean;
  cleartextTrafficPermittedRaw?: string;
  trustAnchors?: NscTrustAnchors;
  pinSet?: NscPinSet;
  location: XmlSourceLocation;
};

export type NscDebugOverrides = {
  trustAnchors?: NscTrustAnchors;
  location: XmlSourceLocation;
};

export type NetworkSecurityConfigParseResult =
  | {
      state: "parsed";
      baseConfig?: NscBaseConfig;
      domainConfigs: NscDomainConfig[];
      debugOverrides?: NscDebugOverrides;
      warnings: string[];
    }
  | { state: "malformed-xml"; reason: string; location?: XmlSourceLocation }
  | { state: "unsupported-root"; rootTagName: string };

export const MAX_DOMAIN_CONFIG_DEPTH = 10;
