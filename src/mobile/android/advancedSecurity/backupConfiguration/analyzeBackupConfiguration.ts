import path from "node:path";
import type { SecurityFinding } from "../../../../securityValidation/types.js";
import type { AndroidManifestParseEntry } from "../../manifest/parseAndroidManifest.js";
import { makeAndroidFinding } from "../../audit/androidFinding.js";
import { buildAndroidSourceLocation, type AndroidSourceLocation } from "../sourceLocation.js";
import { makeCandidateEvidence, type CandidateEvidence } from "../candidateEvidence.js";
import { extractManifestBackupEvidence, type ManifestBackupEvidence, type XmlResourceReferenceEvidence } from "./manifestEvidence.js";
import type { BackupRuleEntry, BackupRulesParseResult } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 3 — conservative backup/data-extraction analysis.
//
// Mirrors Batch 2's analyzeNetworkSecurity.ts conservatism: only explicit
// allowBackup="true" combined with high-confidence broad-inclusion evidence
// ever escalates to a "major" finding; allowBackup="true" alone is "minor"
// (agents.txt Batch 3 section 9.17); missing/malformed/ambiguous/unresolved
// backup rules are always CandidateEvidence, never a finding.
// ---------------------------------------------------------------------------

export type AnalyzeBackupConfigurationResult = {
  evidence: ManifestBackupEvidence;
  candidates: CandidateEvidence[];
  findings: SecurityFinding[];
  evidenceText: string[];
};

function loc(targetRoot: string, absolutePath: string, position?: { line?: number; column?: number }): AndroidSourceLocation {
  return buildAndroidSourceLocation(targetRoot, absolutePath, position);
}

// A conservative, narrow "broad inclusion" signal: the entire root, or an
// entire sensitive domain with no path narrowing ("." — the whole domain).
function isBroadInclude(rule: BackupRuleEntry): boolean {
  if (rule.kind !== "include" || rule.malformed) return false;
  if (rule.domain === "root" || rule.domain === "device_root") return true;
  const sensitiveDomains = new Set(["sharedpref", "database", "external", "device_sharedpref", "device_database", "device_external"]);
  return rule.domain !== undefined && sensitiveDomains.has(rule.domain) && rule.path === ".";
}

function analyzeRuleEntries(
  rules: BackupRuleEntry[],
  ruleId: "android-backup-full-backup-content" | "android-backup-data-extraction-rules",
  scopeLabel: string,
  sourceAbsolutePath: string,
  targetRoot: string,
  modulePath: string | undefined,
  sourceRelativePath: string
): { candidates: CandidateEvidence[]; evidenceText: string[]; hasBroadInclude: boolean } {
  const candidates: CandidateEvidence[] = [];
  const evidenceText: string[] = [];
  let hasBroadInclude = false;

  for (const rule of rules) {
    const location = loc(targetRoot, sourceAbsolutePath, { line: rule.location.line, column: rule.location.column });
    if (rule.malformed) {
      candidates.push(
        makeCandidateEvidence({
          ruleId,
          category: "android-backup-configuration",
          confidence: "low",
          modulePath,
          location,
          summary: `Malformed ${scopeLabel} rule: ${rule.malformedReason}`,
          rawValue: `${rule.domainRaw ?? ""} ${rule.path ?? ""}`.trim(),
          resolutionState: "malformed",
        })
      );
      continue;
    }

    if (rule.domain === undefined) {
      candidates.push(
        makeCandidateEvidence({
          ruleId,
          category: "android-backup-configuration",
          confidence: "low",
          modulePath,
          location,
          summary: `Unsupported backup domain value in ${scopeLabel}: "${rule.domainRaw}"`,
          rawValue: rule.domainRaw,
          resolutionState: "unsupported",
        })
      );
      continue;
    }

    if (rule.kind === "exclude") {
      evidenceText.push(`${sourceRelativePath}: ${scopeLabel} restrictive exclusion — domain=${rule.domain}, path=${rule.path}`);
      continue;
    }

    if (isBroadInclude(rule)) {
      hasBroadInclude = true;
      candidates.push(
        makeCandidateEvidence({
          ruleId,
          category: "android-backup-configuration",
          confidence: "medium",
          modulePath,
          location,
          summary: `Broad ${scopeLabel} inclusion: domain=${rule.domain}, path=${rule.path}`,
          rawValue: `${rule.domain}:${rule.path}`,
          resolutionState: "resolved",
          staticAnalysisLimitations: [
            "Domain/path naming is conservative evidence only; it does not prove the included data is actually sensitive or that a backup is ever performed.",
          ],
        })
      );
    }
  }

  return { candidates, evidenceText, hasBroadInclude };
}

function analyzeBackupRulesParseResult(
  parseResult: BackupRulesParseResult,
  ruleId: "android-backup-full-backup-content" | "android-backup-data-extraction-rules",
  sourceRelativePath: string,
  targetRoot: string,
  modulePath: string | undefined
): { candidates: CandidateEvidence[]; evidenceText: string[]; hasBroadCloudOrLegacyInclude: boolean } {
  const sourceAbsolutePath = path.join(targetRoot, sourceRelativePath);

  if (parseResult.state === "malformed-xml") {
    return {
      candidates: [
        makeCandidateEvidence({
          ruleId,
          category: "android-backup-configuration",
          confidence: "medium",
          modulePath,
          location: loc(targetRoot, sourceAbsolutePath, parseResult.location ? { line: parseResult.location.line, column: parseResult.location.column } : undefined),
          summary: `Referenced backup rules file is malformed XML: ${parseResult.reason}`,
          rawValue: parseResult.reason,
          resolutionState: "malformed",
        }),
      ],
      evidenceText: [],
      hasBroadCloudOrLegacyInclude: false,
    };
  }

  if (parseResult.state === "unsupported-root") {
    return {
      candidates: [
        makeCandidateEvidence({
          ruleId,
          category: "android-backup-configuration",
          confidence: "medium",
          modulePath,
          location: loc(targetRoot, sourceAbsolutePath),
          summary: `Referenced XML file has an unsupported root element <${parseResult.rootTagName}>`,
          rawValue: parseResult.rootTagName,
          resolutionState: "unsupported",
        }),
      ],
      evidenceText: [],
      hasBroadCloudOrLegacyInclude: false,
    };
  }

  if (parseResult.state === "parsed-full-backup-content") {
    const result = analyzeRuleEntries(parseResult.model.rules, ruleId, "full-backup-content", sourceAbsolutePath, targetRoot, modulePath, sourceRelativePath);
    return { candidates: result.candidates, evidenceText: result.evidenceText, hasBroadCloudOrLegacyInclude: result.hasBroadInclude };
  }

  // parsed-data-extraction-rules
  const cloudResult = parseResult.model.cloudBackup
    ? analyzeRuleEntries(parseResult.model.cloudBackup.rules, ruleId, "cloud-backup", sourceAbsolutePath, targetRoot, modulePath, sourceRelativePath)
    : { candidates: [], evidenceText: [], hasBroadInclude: false };
  const transferResult = parseResult.model.deviceTransfer
    ? analyzeRuleEntries(parseResult.model.deviceTransfer.rules, ruleId, "device-transfer", sourceAbsolutePath, targetRoot, modulePath, sourceRelativePath)
    : { candidates: [], evidenceText: [], hasBroadInclude: false };

  // Device-transfer broadness stays a review candidate only — it is local
  // device-to-device transfer, not cloud exfiltration, so it never
  // contributes to the allowBackup-level "major" escalation.
  return {
    candidates: [...cloudResult.candidates, ...transferResult.candidates],
    evidenceText: [...cloudResult.evidenceText, ...transferResult.evidenceText],
    hasBroadCloudOrLegacyInclude: cloudResult.hasBroadInclude,
  };
}

function analyzeXmlReferenceEvidence(
  evidence: XmlResourceReferenceEvidence<BackupRulesParseResult>,
  ruleId: "android-backup-full-backup-content" | "android-backup-data-extraction-rules",
  targetRoot: string,
  manifestAbsolutePath: string,
  modulePath: string | undefined,
  applicationLocation: { line?: number; column?: number } | undefined
): { candidates: CandidateEvidence[]; evidenceText: string[]; hasBroadInclude: boolean } {
  switch (evidence.state) {
    case "absent":
      return { candidates: [], evidenceText: [], hasBroadInclude: false };
    case "resolved": {
      const result = analyzeBackupRulesParseResult(evidence.parseResult, ruleId, evidence.candidate.relativePath, targetRoot, modulePath);
      return { candidates: result.candidates, evidenceText: result.evidenceText, hasBroadInclude: result.hasBroadCloudOrLegacyInclude };
    }
    case "ambiguous": {
      const candidates: CandidateEvidence[] = [
        makeCandidateEvidence({
          ruleId,
          category: "android-backup-configuration",
          confidence: "low",
          modulePath,
          location: loc(targetRoot, manifestAbsolutePath, applicationLocation),
          summary: `Backup rules reference "${evidence.raw}" resolved to ${evidence.candidates.length} ambiguous candidates across source sets; no candidate was arbitrarily selected`,
          rawValue: evidence.raw,
          resolutionState: "unresolved",
        }),
      ];
      let hasBroadInclude = false;
      for (const candidate of evidence.candidates) {
        const result = analyzeBackupRulesParseResult(candidate.parseResult, ruleId, candidate.candidate.relativePath, targetRoot, modulePath);
        candidates.push(...result.candidates);
        hasBroadInclude = hasBroadInclude || result.hasBroadCloudOrLegacyInclude;
      }
      return { candidates, evidenceText: [], hasBroadInclude };
    }
    case "missing":
      return {
        candidates: [
          makeCandidateEvidence({
            ruleId,
            category: "android-backup-configuration",
            confidence: "low",
            modulePath,
            location: loc(targetRoot, manifestAbsolutePath, applicationLocation),
            summary: `Backup rules reference "${evidence.raw}" did not resolve to any file in the searched source sets`,
            rawValue: evidence.raw,
            resolutionState: "missing",
            staticAnalysisLimitations: ["A missing referenced rules file is not automatically a vulnerability; runtime behavior cannot be proven statically."],
          }),
        ],
        evidenceText: [],
        hasBroadInclude: false,
      };
    case "placeholder":
      return {
        candidates: [
          makeCandidateEvidence({
            ruleId,
            category: "android-backup-configuration",
            confidence: "low",
            modulePath,
            location: loc(targetRoot, manifestAbsolutePath, applicationLocation),
            summary: "Backup rules reference is an unresolved build-time placeholder",
            rawValue: evidence.raw,
            resolutionState: "unresolved",
          }),
        ],
        evidenceText: [],
        hasBroadInclude: false,
      };
    case "malformed":
      return {
        candidates: [
          makeCandidateEvidence({
            ruleId,
            category: "android-backup-configuration",
            confidence: "low",
            modulePath,
            location: loc(targetRoot, manifestAbsolutePath, applicationLocation),
            summary: `Backup rules reference is malformed: ${evidence.reason}`,
            rawValue: evidence.raw,
            resolutionState: "malformed",
          }),
        ],
        evidenceText: [],
        hasBroadInclude: false,
      };
    case "unsupported-type":
    case "package-qualified":
    case "module-unknown":
      return {
        candidates: [
          makeCandidateEvidence({
            ruleId,
            category: "android-backup-configuration",
            confidence: "low",
            modulePath,
            location: loc(targetRoot, manifestAbsolutePath, applicationLocation),
            summary:
              evidence.state === "module-unknown"
                ? "Backup rules reference could not be resolved because this manifest's module could not be determined"
                : `Backup rules reference is not a resolvable target-contained @xml/... resource (${evidence.state})`,
            rawValue: evidence.raw,
            resolutionState: "unsupported",
          }),
        ],
        evidenceText: [],
        hasBroadInclude: false,
      };
  }
}

// Analyzes one already-parsed manifest's backup/data-extraction evidence.
// Standalone until a later integration batch.
export function analyzeManifestBackupConfiguration(targetRoot: string, entry: AndroidManifestParseEntry): AnalyzeBackupConfigurationResult {
  const evidence = extractManifestBackupEvidence(targetRoot, entry);
  const candidates: CandidateEvidence[] = [];
  const findings: SecurityFinding[] = [];
  const evidenceText: string[] = [];
  const modulePath = entry.modulePath;
  const manifestAbsolutePath = path.join(targetRoot, entry.manifestPath);
  const applicationLocation = evidence.applicationLocation;

  let hasBroadInclude = false;

  // fullBackupContent — legacy literal states never touch the resource
  // resolver/parser (there is no file to analyze).
  const fullBackupContent = evidence.fullBackupContent;
  if (fullBackupContent.state === "legacy-literal-true" || fullBackupContent.state === "legacy-literal-false") {
    evidenceText.push(`${entry.manifestPath}: fullBackupContent is a legacy literal (${fullBackupContent.raw})`);
  } else {
    const result = analyzeXmlReferenceEvidence(fullBackupContent, "android-backup-full-backup-content", targetRoot, manifestAbsolutePath, modulePath, applicationLocation);
    candidates.push(...result.candidates);
    evidenceText.push(...result.evidenceText);
    hasBroadInclude = hasBroadInclude || result.hasBroadInclude;
  }

  const dataExtractionResult = analyzeXmlReferenceEvidence(
    evidence.dataExtractionRules,
    "android-backup-data-extraction-rules",
    targetRoot,
    manifestAbsolutePath,
    modulePath,
    applicationLocation
  );
  candidates.push(...dataExtractionResult.candidates);
  evidenceText.push(...dataExtractionResult.evidenceText);
  hasBroadInclude = hasBroadInclude || dataExtractionResult.hasBroadInclude;

  // allowBackup analysis — the only source of an actual SecurityFinding in
  // this analyzer (agents.txt Batch 3 section 9.7/9.17).
  if (evidence.allowBackup.state === "explicit-true") {
    findings.push(
      makeAndroidFinding({
        ruleId: "android-backup-allow-backup",
        title: hasBroadInclude
          ? "Application allows backup with a broad backup-rule inclusion"
          : "Application manifest explicitly permits backup (android:allowBackup=\"true\")",
        severity: hasBroadInclude ? "major" : "minor",
        confidence: hasBroadInclude ? "high" : "medium",
        description: hasBroadInclude
          ? "The manifest sets android:allowBackup=\"true\" and the resolved backup rules include a broad root/domain inclusion with no narrowing. This is high-confidence static evidence of a broad backup surface; it does not prove any specific file is actually backed up or that backup ever runs."
          : "The manifest sets android:allowBackup=\"true\" with no broad-rule evidence found. This alone is not a vulnerability — it is the platform's own default behavior when the attribute is unset on old targetSdk versions, and is a common, legitimate configuration.",
        manifestPath: entry.manifestPath,
        location: applicationLocation,
        evidenceDetails: [`source=manifest-attribute`, `broadRuleEvidence=${hasBroadInclude}`],
        recommendation: hasBroadInclude
          ? "Narrow the backup rules to exclude sensitive domains, or set android:allowBackup=\"false\" if backup is not required."
          : "Review whether backup should remain enabled and whether backup rules narrow the included data appropriately.",
      })
    );
  } else if (evidence.allowBackup.state === "malformed") {
    candidates.push(
      makeCandidateEvidence({
        ruleId: "android-backup-allow-backup",
        category: "android-backup-configuration",
        confidence: "low",
        modulePath,
        location: loc(targetRoot, manifestAbsolutePath, applicationLocation),
        summary: "android:allowBackup has an unresolved or malformed value",
        rawValue: evidence.allowBackup.raw,
        resolutionState: "malformed",
      })
    );
  } else if (evidence.allowBackup.state === "explicit-false") {
    evidenceText.push(`${entry.manifestPath}: allowBackup is explicitly false (restrictive)`);
  }

  return { evidence, candidates, findings, evidenceText };
}
