import { findChildren, parseXmlDocument, type XmlElement } from "../../manifest/xml/parseXml.js";
import {
  MAX_DOMAIN_CONFIG_DEPTH,
  type NetworkSecurityConfigParseResult,
  type NscBaseConfig,
  type NscCertificatesEntry,
  type NscDebugOverrides,
  type NscDomainConfig,
  type NscDomainEntry,
  type NscPinEntry,
  type NscPinSet,
  type NscTrustAnchorSourceKind,
  type NscTrustAnchors,
} from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 2 — dependency-free Network Security Config XML parser.
//
// Builds on the existing bounded XML tree parser
// (src/mobile/android/manifest/xml/parseXml.ts) rather than creating a
// second tokenizer — this file only adds NSC-specific semantic parsing on
// top of the generic XmlElement tree, per agents.txt Batch 2 section 12.
//
// Parses exactly one already-resolved, target-contained file. Never merges
// multiple files, never evaluates resource overlays, never invokes Gradle/
// Android SDK/network. Malformed XML or an unsupported root never throws —
// both map to a structured, non-"parsed" result state.
// ---------------------------------------------------------------------------

const MAX_PIN_VALUE_PREVIEW_LENGTH = 128;
const SUPPORTED_PIN_DIGESTS = new Set(["SHA-256"]);

function getUnprefixedAttribute(element: XmlElement, localName: string): string | undefined {
  return element.attributes.find((attr) => attr.prefix === undefined && attr.localName === localName)?.value;
}

type BooleanAttrResult = { value?: boolean; raw?: string };

function parseBooleanAttribute(element: XmlElement, localName: string): BooleanAttrResult {
  const raw = getUnprefixedAttribute(element, localName);
  if (raw === undefined) return {};
  if (raw === "true") return { value: true, raw };
  if (raw === "false") return { value: false, raw };
  return { raw };
}

function boundedPreview(value: string, maxLength: number = MAX_PIN_VALUE_PREVIEW_LENGTH): string {
  const normalized = value.replace(/\s+/g, "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}... [truncated, ${normalized.length} chars total]`;
}

function classifyCertificateSource(srcRaw: string | undefined): { sourceKind: NscTrustAnchorSourceKind; rawResourceName?: string } {
  if (srcRaw === "system") return { sourceKind: "system" };
  if (srcRaw === "user") return { sourceKind: "user" };
  if (srcRaw?.startsWith("@raw/")) return { sourceKind: "raw-resource", rawResourceName: srcRaw.slice("@raw/".length) };
  return { sourceKind: "unknown" };
}

function parseTrustAnchors(element: XmlElement): NscTrustAnchors {
  const certificates: NscCertificatesEntry[] = findChildren(element, "certificates").map((certEl) => {
    const srcRaw = getUnprefixedAttribute(certEl, "src");
    const { sourceKind, rawResourceName } = classifyCertificateSource(srcRaw);
    const overridePinsResult = parseBooleanAttribute(certEl, "overridePins");
    return {
      srcRaw,
      sourceKind,
      rawResourceName,
      overridePins: overridePinsResult.value,
      overridePinsRaw: overridePinsResult.raw,
      location: certEl.location,
    };
  });
  return { certificates, location: element.location };
}

function parsePinEntry(pinEl: XmlElement): NscPinEntry {
  const digestRaw = getUnprefixedAttribute(pinEl, "digest");
  const digestSupported = digestRaw !== undefined && SUPPORTED_PIN_DIGESTS.has(digestRaw);
  const rawText = pinEl.textContent.trim();
  const malformed = rawText.length === 0 || digestRaw === undefined;
  const malformedReason = rawText.length === 0 ? "Pin element has no text content" : digestRaw === undefined ? "Pin element is missing a digest attribute" : undefined;
  return {
    digestRaw,
    digestSupported,
    valuePreview: boundedPreview(rawText),
    malformed,
    malformedReason,
    location: pinEl.location,
  };
}

function parsePinSet(element: XmlElement): NscPinSet {
  const expirationRaw = getUnprefixedAttribute(element, "expiration");
  // A syntactically valid expiration is YYYY-MM-DD; anything else is
  // preserved verbatim and flagged malformed rather than guessed at.
  const expirationMalformed = expirationRaw !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(expirationRaw);
  const pins = findChildren(element, "pin").map(parsePinEntry);
  return { expirationRaw, expirationMalformed, pins, location: element.location };
}

function normalizeDomainText(raw: string): string {
  let normalized = raw.trim().toLowerCase();
  if (normalized.endsWith(".") && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function parseDomainEntry(domainEl: XmlElement): NscDomainEntry {
  const includeSubdomainsResult = parseBooleanAttribute(domainEl, "includeSubdomains");
  const textRaw = domainEl.textContent;
  const normalized = normalizeDomainText(textRaw);
  return {
    textRaw,
    normalized,
    includeSubdomains: includeSubdomainsResult.value,
    includeSubdomainsRaw: includeSubdomainsResult.raw,
    malformed: normalized.length === 0,
    location: domainEl.location,
  };
}

const DOMAIN_CONFIG_KNOWN_CHILDREN = new Set(["domain", "trust-anchors", "pin-set", "domain-config"]);

function parseDomainConfig(element: XmlElement, depth: number, warnings: string[]): NscDomainConfig {
  const cleartextResult = parseBooleanAttribute(element, "cleartextTrafficPermitted");
  const domains = findChildren(element, "domain").map(parseDomainEntry);
  const trustAnchorsEl = findChildren(element, "trust-anchors")[0];
  const pinSetEl = findChildren(element, "pin-set")[0];

  const unsupportedChildren = element.children.filter((child) => !DOMAIN_CONFIG_KNOWN_CHILDREN.has(child.localName)).map((child) => `<${child.tagName}> at line ${child.location.line}`);

  const nestedElements = findChildren(element, "domain-config");
  let nestingTruncated = false;
  let nested: NscDomainConfig[] = [];
  if (nestedElements.length > 0) {
    if (depth >= MAX_DOMAIN_CONFIG_DEPTH) {
      nestingTruncated = true;
      warnings.push(`<domain-config> nesting exceeds the bounded depth of ${MAX_DOMAIN_CONFIG_DEPTH} at line ${element.location.line}; deeper nodes were not parsed.`);
    } else {
      nested = nestedElements.map((child) => parseDomainConfig(child, depth + 1, warnings));
    }
  }

  return {
    cleartextTrafficPermitted: cleartextResult.value,
    cleartextTrafficPermittedRaw: cleartextResult.raw,
    domains,
    trustAnchors: trustAnchorsEl ? parseTrustAnchors(trustAnchorsEl) : undefined,
    pinSet: pinSetEl ? parsePinSet(pinSetEl) : undefined,
    nested,
    location: element.location,
    unsupportedChildren,
    nestingTruncated,
  };
}

function parseBaseConfig(element: XmlElement): NscBaseConfig {
  const cleartextResult = parseBooleanAttribute(element, "cleartextTrafficPermitted");
  const trustAnchorsEl = findChildren(element, "trust-anchors")[0];
  const pinSetEl = findChildren(element, "pin-set")[0];
  return {
    cleartextTrafficPermitted: cleartextResult.value,
    cleartextTrafficPermittedRaw: cleartextResult.raw,
    trustAnchors: trustAnchorsEl ? parseTrustAnchors(trustAnchorsEl) : undefined,
    pinSet: pinSetEl ? parsePinSet(pinSetEl) : undefined,
    location: element.location,
  };
}

function parseDebugOverrides(element: XmlElement): NscDebugOverrides {
  const trustAnchorsEl = findChildren(element, "trust-anchors")[0];
  return { trustAnchors: trustAnchorsEl ? parseTrustAnchors(trustAnchorsEl) : undefined, location: element.location };
}

// Parses Network Security Config XML text. Never throws for ordinary
// malformed external input — always returns a structured result.
export function parseNetworkSecurityConfig(xmlText: string): NetworkSecurityConfigParseResult {
  const parsed = parseXmlDocument(xmlText);
  if (!parsed.ok) {
    return { state: "malformed-xml", reason: parsed.error.message, location: parsed.error.location };
  }

  const root = parsed.root;
  if (root.localName !== "network-security-config") {
    return { state: "unsupported-root", rootTagName: root.tagName };
  }

  const warnings: string[] = parsed.warnings.map((w) => `${w.message} (line ${w.location.line})`);

  const baseConfigEl = findChildren(root, "base-config")[0];
  if (findChildren(root, "base-config").length > 1) {
    warnings.push(`Multiple <base-config> elements found; only the first was used.`);
  }
  const debugOverridesEl = findChildren(root, "debug-overrides")[0];
  if (findChildren(root, "debug-overrides").length > 1) {
    warnings.push(`Multiple <debug-overrides> elements found; only the first was used.`);
  }
  const domainConfigEls = findChildren(root, "domain-config");

  const knownRootChildren = new Set(["base-config", "domain-config", "debug-overrides"]);
  for (const child of root.children) {
    if (!knownRootChildren.has(child.localName)) {
      warnings.push(`Unsupported <${child.tagName}> element at line ${child.location.line} was not parsed.`);
    }
  }

  return {
    state: "parsed",
    baseConfig: baseConfigEl ? parseBaseConfig(baseConfigEl) : undefined,
    domainConfigs: domainConfigEls.map((el) => parseDomainConfig(el, 0, warnings)),
    debugOverrides: debugOverridesEl ? parseDebugOverrides(debugOverridesEl) : undefined,
    warnings,
  };
}
