// ---------------------------------------------------------------------------
// v0.4.1 Batch 3 — public exports for the standalone Android backup/data-
// extraction audit. Mirrors Batch 2's networkSecurity/index.ts convention.
// ---------------------------------------------------------------------------

export { parseBackupRules } from "./parseBackupRules.js";
export { extractManifestBackupEvidence } from "./manifestEvidence.js";
export type { ManifestBackupEvidence, ManifestBooleanAttributeEvidence, FullBackupContentEvidence, XmlResourceReferenceEvidence } from "./manifestEvidence.js";
export { analyzeManifestBackupConfiguration } from "./analyzeBackupConfiguration.js";
export type { AnalyzeBackupConfigurationResult } from "./analyzeBackupConfiguration.js";
export { auditAndroidBackupConfiguration, ANDROID_BACKUP_CONFIGURATION_AUDIT_CHECK_ID } from "./checkResult.js";
export type {
  BackupRulesParseResult,
  FullBackupContentModel,
  DataExtractionRulesModel,
  DataExtractionRuleSet,
  BackupRuleEntry,
  BackupDomainValue,
} from "./types.js";
