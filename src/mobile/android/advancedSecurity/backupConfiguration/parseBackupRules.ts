import { findChildren, parseXmlDocument, type XmlElement } from "../../manifest/xml/parseXml.js";
import {
  BACKUP_DOMAIN_VALUES,
  MAX_BACKUP_RULES_PER_SCOPE,
  type BackupDomainValue,
  type BackupRuleEntry,
  type BackupRulesParseResult,
  type DataExtractionRuleSet,
  type DataExtractionRulesModel,
  type FullBackupContentModel,
} from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 3 — dependency-free parser for the legacy
// <full-backup-content> and newer <data-extraction-rules> XML formats.
//
// Builds on the existing bounded XML tree parser
// (src/mobile/android/manifest/xml/parseXml.ts), mirroring Batch 2's
// parseNetworkSecurityConfig.ts layering — no second XML tokenizer. Parses
// exactly one already-resolved, target-contained file; never merges files,
// never evaluates resource overlays, never invokes Gradle/Android SDK/
// network. Malformed XML or an unsupported root never throws.
// ---------------------------------------------------------------------------

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

function isBackupDomainValue(value: string): value is BackupDomainValue {
  return (BACKUP_DOMAIN_VALUES as readonly string[]).includes(value);
}

function parseRuleEntry(kind: "include" | "exclude", element: XmlElement): BackupRuleEntry {
  const domainRaw = getUnprefixedAttribute(element, "domain");
  const path = getUnprefixedAttribute(element, "path");
  const requireFlagsRaw = getUnprefixedAttribute(element, "requireFlags");

  const domain = domainRaw !== undefined && isBackupDomainValue(domainRaw) ? domainRaw : undefined;
  const malformed = domainRaw === undefined || path === undefined || path.length === 0;
  const malformedReason = domainRaw === undefined ? "Missing domain attribute" : path === undefined || path.length === 0 ? "Missing or empty path attribute" : undefined;

  return {
    kind,
    domainRaw,
    domain,
    path,
    requireFlagsRaw,
    location: element.location,
    malformed,
    malformedReason,
  };
}

function parseRuleEntries(scopeElement: XmlElement): BackupRuleEntry[] {
  const includeEntries = findChildren(scopeElement, "include").map((el) => parseRuleEntry("include", el));
  const excludeEntries = findChildren(scopeElement, "exclude").map((el) => parseRuleEntry("exclude", el));
  // Preserves document order (include/exclude interleaving is semantically
  // meaningful in the real format) rather than grouping by kind — includes
  // are collected first only because findChildren is kind-specific; the
  // caller should not assume this array reflects source order for mixed
  // kinds beyond what findChildren naturally preserves per kind.
  return [...includeEntries, ...excludeEntries].slice(0, MAX_BACKUP_RULES_PER_SCOPE);
}

function parseFullBackupContent(root: XmlElement, warnings: string[]): FullBackupContentModel {
  const knownChildren = new Set(["include", "exclude"]);
  const unsupportedChildren = root.children.filter((child) => !knownChildren.has(child.localName)).map((child) => `<${child.tagName}> at line ${child.location.line}`);
  const rules = parseRuleEntries(root);
  if (rules.length >= MAX_BACKUP_RULES_PER_SCOPE) {
    warnings.push(`<full-backup-content> rule count reached the bounded maximum of ${MAX_BACKUP_RULES_PER_SCOPE}; further rules were not processed.`);
  }
  return { rules, unsupportedChildren };
}

function parseDataExtractionRuleSet(element: XmlElement): DataExtractionRuleSet {
  const disableResult = parseBooleanAttribute(element, "disableIfNoEncryptionCapabilities");
  return {
    disableIfNoEncryptionCapabilities: disableResult.value,
    disableIfNoEncryptionCapabilitiesRaw: disableResult.raw,
    rules: parseRuleEntries(element),
    location: element.location,
  };
}

function parseDataExtractionRules(root: XmlElement, warnings: string[]): DataExtractionRulesModel {
  const knownChildren = new Set(["cloud-backup", "device-transfer"]);
  const unsupportedChildren = root.children.filter((child) => !knownChildren.has(child.localName)).map((child) => `<${child.tagName}> at line ${child.location.line}`);

  const cloudBackupEl = findChildren(root, "cloud-backup")[0];
  if (findChildren(root, "cloud-backup").length > 1) {
    warnings.push("Multiple <cloud-backup> elements found; only the first was used.");
  }
  const deviceTransferEl = findChildren(root, "device-transfer")[0];
  if (findChildren(root, "device-transfer").length > 1) {
    warnings.push("Multiple <device-transfer> elements found; only the first was used.");
  }

  return {
    cloudBackup: cloudBackupEl ? parseDataExtractionRuleSet(cloudBackupEl) : undefined,
    deviceTransfer: deviceTransferEl ? parseDataExtractionRuleSet(deviceTransferEl) : undefined,
    unsupportedChildren,
  };
}

// Parses either legacy full-backup-content or data-extraction-rules XML
// text, selecting the semantic model by the document's actual root element.
// Never throws for ordinary malformed external input.
export function parseBackupRules(xmlText: string): BackupRulesParseResult {
  const parsed = parseXmlDocument(xmlText);
  if (!parsed.ok) {
    return { state: "malformed-xml", reason: parsed.error.message, location: parsed.error.location };
  }

  const root = parsed.root;
  const warnings: string[] = parsed.warnings.map((w) => `${w.message} (line ${w.location.line})`);

  if (root.localName === "full-backup-content") {
    return { state: "parsed-full-backup-content", model: parseFullBackupContent(root, warnings), warnings };
  }
  if (root.localName === "data-extraction-rules") {
    return { state: "parsed-data-extraction-rules", model: parseDataExtractionRules(root, warnings), warnings };
  }
  return { state: "unsupported-root", rootTagName: root.tagName };
}
