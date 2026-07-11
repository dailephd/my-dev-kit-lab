import type { SecurityFinding } from "../../../../securityValidation/types.js";
import { makeAndroidFinding } from "../../audit/androidFinding.js";
import { makeCandidateEvidence, type CandidateEvidence } from "../candidateEvidence.js";
import { buildAndroidSourceLocation } from "../sourceLocation.js";
import type { AndroidSensitiveDataRuleId } from "../ruleIds.js";
import { classifyDirectExpression } from "../sensitiveData/classifyDirectExpression.js";
import { classifySensitiveIdentifier } from "../sensitiveData/classifySensitiveIdentifier.js";
import { splitIdentifierWords } from "../sensitiveData/classifySensitiveIdentifier.js";
import type { SecretScanFile } from "../secretCandidates/types.js";
import { collectStorageEvidence } from "./collectStorageEvidence.js";
import type { StorageMatch } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — sensitive-storage analysis: turns raw StorageMatch
// evidence into CandidateEvidence / SecurityFinding. This is the only layer
// that reads raw key/value expression text — everything downstream is
// redacted via makeCandidateEvidence/makeAndroidFinding.
// ---------------------------------------------------------------------------

export type AnalyzeSensitiveStorageResult = { candidates: CandidateEvidence[]; findings: SecurityFinding[] };

const SENSITIVE_FILE_NAME_WORDS = new Set([
  "credentials",
  "password",
  "passwords",
  "token",
  "tokens",
  "secret",
  "secrets",
  "session",
  "auth",
  "cookies",
  "privatekey",
  "account",
  "userprofile",
]);

function literalOf(expression: string | undefined): string | undefined {
  if (expression === undefined) return undefined;
  const classification = classifyDirectExpression(expression);
  return classification.kind === "string-literal" ? classification.literalValue : undefined;
}

function isIdentifierExpression(expression: string | undefined): string | undefined {
  if (expression === undefined) return undefined;
  const classification = classifyDirectExpression(expression);
  return classification.kind === "identifier" || classification.kind === "member-access" ? expression.replace(/^.*\./, "") : undefined;
}

function fileNameLooksSensitive(pathHint: string | undefined): boolean {
  const literal = literalOf(pathHint);
  const candidate = literal ?? pathHint;
  if (!candidate) return false;
  const words = splitIdentifierWords(candidate.replace(/\.[a-z0-9]+$/i, ""));
  return words.some((word) => SENSITIVE_FILE_NAME_WORDS.has(word));
}

function hasWorldMode(modeExpression: string | undefined): boolean {
  return modeExpression !== undefined && /MODE_WORLD_READABLE|MODE_WORLD_WRITEABLE/.test(modeExpression);
}

function hasPrivateMode(modeExpression: string | undefined): boolean {
  return modeExpression !== undefined && /MODE_PRIVATE/.test(modeExpression) && !hasWorldMode(modeExpression);
}

function sensitiveIdentifierFor(expression: string | undefined): ReturnType<typeof classifySensitiveIdentifier> {
  if (expression === undefined) return undefined;
  const literal = literalOf(expression);
  if (literal !== undefined) return classifySensitiveIdentifier(literal);
  const identifier = isIdentifierExpression(expression);
  return identifier !== undefined ? classifySensitiveIdentifier(identifier) : undefined;
}

export function analyzeSensitiveStorageFile(targetRoot: string, file: SecretScanFile): AnalyzeSensitiveStorageResult {
  const candidates: CandidateEvidence[] = [];
  const findings: SecurityFinding[] = [];
  const matches = collectStorageEvidence(file.content);

  const location = (m: StorageMatch) => buildAndroidSourceLocation(targetRoot, file.absolutePath, { line: m.line });
  const limitations = ["Bounded lexical source analysis; does not evaluate runtime storage contents, filesystem permissions, or scoped-storage behavior for a specific device or API level."];

  const finding = (ruleId: AndroidSensitiveDataRuleId, title: string, m: StorageMatch, evidenceDetails: string[], severity: "major" | "minor" = "major") =>
    findings.push(
      makeAndroidFinding({
        ruleId,
        title,
        severity,
        confidence: "high",
        description: `${title}. Static source evidence only; does not prove data was stored at runtime or that another application can access it.`,
        manifestPath: file.relativePath,
        identity: `${m.api}:${m.line}`,
        location: { line: m.line },
        evidenceDetails,
        recommendation: "Avoid storing sensitive data in plaintext; use EncryptedSharedPreferences/EncryptedFile or an equivalent platform-provided encryption wrapper.",
      })
    );

  const candidate = (
    ruleId: AndroidSensitiveDataRuleId,
    m: StorageMatch,
    summary: string,
    rawValue: string | undefined,
    confidence: "low" | "medium" | "high",
    resolutionState: "resolved" | "unresolved" | "not-applicable" = "resolved"
  ) =>
    candidates.push(
      makeCandidateEvidence({
        ruleId,
        category: "android-sensitive-storage",
        confidence,
        modulePath: file.modulePath,
        location: location(m),
        summary,
        rawValue,
        resolutionState,
        staticAnalysisLimitations: limitations,
      })
    );

  for (const m of matches) {
    if (m.kind === "shared-preferences-get") {
      if (hasWorldMode(m.modeExpression)) {
        finding("android-sensitive-preferences", "SharedPreferences opened with a world-readable/world-writable mode", m, [`mode=${m.modeExpression}`]);
      } else if (hasPrivateMode(m.modeExpression)) {
        candidate("android-sensitive-preferences", m, "SharedPreferences opened with MODE_PRIVATE (restrictive, not encryption)", m.modeExpression, "low", "not-applicable");
      } else if (m.modeExpression !== undefined && classifyDirectExpression(m.modeExpression).kind !== "string-literal") {
        candidate("android-sensitive-preferences", m, "SharedPreferences mode is dynamic or unresolved", m.modeExpression, "low", "unresolved");
      }
      continue;
    }

    if (m.kind === "shared-preferences-write") {
      const sensitive = sensitiveIdentifierFor(m.keyExpression);
      if (!sensitive || m.valueExpression === undefined) continue;
      const valueClassification = classifyDirectExpression(m.valueExpression);
      if (valueClassification.kind === "string-literal") {
        finding("android-sensitive-preferences", `Direct ${sensitive.sensitiveDataCategory} written to plaintext SharedPreferences`, m, [`key=${m.keyExpression}`]);
      } else {
        candidate("android-sensitive-preferences", m, `Sensitive key "${m.keyExpression}" written with a dynamic SharedPreferences value`, m.valueExpression, "medium", "unresolved");
      }
      continue;
    }

    if (m.kind === "datastore-write") {
      const sensitive = sensitiveIdentifierFor(m.keyExpression);
      if (!sensitive) continue;
      candidate("android-sensitive-preferences", m, `Sensitive DataStore key "${m.keyExpression}" written`, m.valueExpression, "medium", "unresolved");
      continue;
    }

    if (m.kind === "internal-file-write") {
      if (hasWorldMode(m.modeExpression)) {
        finding("android-sensitive-unsafe-file-database-storage", "Internal file opened with a world-readable/world-writable mode", m, [`mode=${m.modeExpression}`]);
        continue;
      }
      const nameSensitive = fileNameLooksSensitive(m.pathHint) || (m.receiver !== "(unresolved)" && Boolean(sensitiveIdentifierFor(m.receiver)));
      const valueSensitive = sensitiveIdentifierFor(m.valueExpression);
      if (!nameSensitive && !valueSensitive) continue;
      const valueClassification = m.valueExpression !== undefined ? classifyDirectExpression(m.valueExpression) : undefined;
      if (valueSensitive && valueClassification?.kind === "string-literal") {
        finding("android-sensitive-unsafe-file-database-storage", "Direct sensitive value written to a plaintext internal file", m, [`file=${m.pathHint ?? m.receiver}`]);
      } else {
        candidate("android-sensitive-unsafe-file-database-storage", m, "Sensitive internal file write candidate", m.valueExpression ?? m.pathHint, "medium", "unresolved");
      }
      continue;
    }

    if (m.kind === "external-file-write") {
      const isPublic = /getExternalStorageDirectory|getExternalStoragePublicDirectory/.test(m.api);
      const isCache = /ExternalCacheDir/.test(m.api);
      const nameSensitive = fileNameLooksSensitive(m.pathHint);
      if (!nameSensitive) continue;
      if (isPublic) {
        finding("android-sensitive-external-storage", "Sensitive-looking path written to shared public external storage", m, [`path=${m.pathHint}`]);
      } else if (isCache) {
        candidate("android-sensitive-external-storage", m, "Sensitive-looking path written to external cache", m.pathHint, "medium");
      } else {
        candidate("android-sensitive-external-storage", m, "Sensitive-looking path written to app-specific external storage", m.pathHint, "medium");
      }
      continue;
    }

    if (m.kind === "database-write") {
      if (m.api === "ContentValues.put") {
        const sensitive = sensitiveIdentifierFor(m.keyExpression);
        if (!sensitive) continue;
        const valueClassification = m.valueExpression !== undefined ? classifyDirectExpression(m.valueExpression) : undefined;
        if (valueClassification?.kind === "string-literal") {
          finding("android-sensitive-unsafe-file-database-storage", "Direct sensitive value inserted into a local database column", m, [`column=${m.keyExpression}`]);
        } else {
          candidate("android-sensitive-unsafe-file-database-storage", m, `Sensitive database column "${m.keyExpression}" candidate`, m.valueExpression, "medium", "unresolved");
        }
      } else if (m.api === "execSQL" && m.valueExpression !== undefined) {
        const words = splitIdentifierWords(m.valueExpression);
        if (words.some((word) => classifySensitiveIdentifier(word))) {
          candidate("android-sensitive-unsafe-file-database-storage", m, "Sensitive-looking column name referenced in a raw SQL statement", m.valueExpression, "low");
        }
      }
      continue;
    }

    if (m.kind === "encrypted-storage-reference") {
      candidate("android-sensitive-preferences", m, `Protective encrypted-storage API referenced: ${m.api}`, m.api, "low", "not-applicable");
      continue;
    }
  }

  return { candidates, findings };
}
