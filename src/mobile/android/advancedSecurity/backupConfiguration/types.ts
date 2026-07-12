import type { XmlSourceLocation } from "../../manifest/xml/parseXml.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 3 — bounded backup/data-extraction XML parse-tree model.
//
// Covers both the legacy <full-backup-content> format (API <=30, still
// widely used) and the newer <data-extraction-rules> format (API 31+,
// separates <cloud-backup> from <device-transfer>). Local to Android
// advanced security, mirroring Batch 2's networkSecurity/types.ts pattern —
// not pushed into the generic XML tree model. Locations are line/column
// only; file/module/source-set identity is attached by the caller once a
// file is resolved (see manifestEvidence.ts).
// ---------------------------------------------------------------------------

export const BACKUP_DOMAIN_VALUES = [
  "root",
  "file",
  "database",
  "sharedpref",
  "external",
  "device_root",
  "device_file",
  "device_database",
  "device_sharedpref",
  "device_external",
] as const;
export type BackupDomainValue = (typeof BACKUP_DOMAIN_VALUES)[number];

export type BackupRuleKind = "include" | "exclude";

export type BackupRuleEntry = {
  kind: BackupRuleKind;
  domainRaw?: string;
  domain?: BackupDomainValue;
  path?: string;
  requireFlagsRaw?: string;
  location: XmlSourceLocation;
  malformed: boolean;
  malformedReason?: string;
};

export type FullBackupContentModel = {
  rules: BackupRuleEntry[];
  unsupportedChildren: string[];
};

export type DataExtractionRuleSet = {
  disableIfNoEncryptionCapabilities?: boolean;
  disableIfNoEncryptionCapabilitiesRaw?: string;
  rules: BackupRuleEntry[];
  location: XmlSourceLocation;
};

export type DataExtractionRulesModel = {
  cloudBackup?: DataExtractionRuleSet;
  deviceTransfer?: DataExtractionRuleSet;
  unsupportedChildren: string[];
};

export type BackupRulesParseResult =
  | { state: "parsed-full-backup-content"; model: FullBackupContentModel; warnings: string[] }
  | { state: "parsed-data-extraction-rules"; model: DataExtractionRulesModel; warnings: string[] }
  | { state: "malformed-xml"; reason: string; location?: XmlSourceLocation }
  | { state: "unsupported-root"; rootTagName: string };

// Defensive bound on the number of rule entries processed from one file —
// mirrors Batch 2's MAX_DOMAIN_CONFIG_DEPTH bound philosophy (never let a
// pathological fixture/target cause unbounded work).
export const MAX_BACKUP_RULES_PER_SCOPE = 500;
