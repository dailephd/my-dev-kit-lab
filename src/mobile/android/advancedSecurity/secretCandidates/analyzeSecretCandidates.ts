import type { SecurityFinding } from "../../../../securityValidation/types.js";
import { makeAndroidFinding } from "../../audit/androidFinding.js";
import { buildAndroidSourceLocation, type AndroidSourceLocation } from "../sourceLocation.js";
import { makeCandidateEvidence, type CandidateEvidence } from "../candidateEvidence.js";
import { fingerprintCandidateValue, redactedPreviewForCandidate } from "../redaction.js";
import type { SensitiveDataCategory } from "../sensitiveCategories.js";
import type { AndroidSecretsSigningRuleId } from "../ruleIds.js";
import { matchPrivateKeyBlocks, matchSensitiveAssignments, type SecretFileKind } from "./matchSecretCandidates.js";
import { isReferenceSyntax, shouldSuppressEntirely } from "./suppressValue.js";
import type { SecretScanFile } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 4 — secret-candidate analysis.
//
// This is the boundary where raw values from matchSecretCandidates.ts are
// redacted/fingerprinted (Batch 1 owners) and converted into CandidateEvidence
// or SecurityFinding — the raw value never survives past this function.
// Conservative by construction: only a non-empty, non-placeholder, non-
// reference literal paired with an explicit sensitive identifier ever
// becomes a finding; everything else is fully suppressed or downgraded to
// CandidateEvidence, per agents.txt Batch 4 sections 9.5/9.7/9.9.
// ---------------------------------------------------------------------------

export type AnalyzeSecretCandidatesResult = {
  candidates: CandidateEvidence[];
  findings: SecurityFinding[];
};

function fileKindFor(relativePath: string): SecretFileKind {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".kt") || lower.endsWith(".kts") || lower.endsWith(".java") || lower.endsWith(".gradle") || lower.endsWith(".gradle.kts")) {
    return "code";
  }
  if (lower.endsWith(".properties") || lower.endsWith(".yaml") || lower.endsWith(".yml") || lower.endsWith(".toml")) {
    return "config-unquoted";
  }
  // .xml/.json use quoted-form matching (JSON always quotes; XML attribute
  // values are quoted by construction).
  return "config-quotable";
}

type IdentifierClassification = { ruleId: AndroidSecretsSigningRuleId; sensitiveDataCategory: SensitiveDataCategory };

function classifyIdentifier(identifier: string): IdentifierClassification {
  const normalized = identifier.toLowerCase().replace(/[-_]/g, "");
  if (["storepassword", "keypassword", "signingpassword"].includes(normalized)) {
    return { ruleId: "android-signing-password-literal", sensitiveDataCategory: "signing-password" };
  }
  if (["databasepassword", "dbpassword"].includes(normalized)) {
    return { ruleId: "android-secret-token-password-candidate", sensitiveDataCategory: "database-credential" };
  }
  if (["password", "passwd", "pwd"].includes(normalized)) {
    return { ruleId: "android-secret-token-password-candidate", sensitiveDataCategory: "password" };
  }
  if (normalized === "clientsecret") {
    return { ruleId: "android-secret-token-password-candidate", sensitiveDataCategory: "oauth-client-secret" };
  }
  if (normalized === "accesstoken") {
    return { ruleId: "android-secret-token-password-candidate", sensitiveDataCategory: "access-token" };
  }
  if (normalized === "bearertoken") {
    return { ruleId: "android-secret-token-password-candidate", sensitiveDataCategory: "bearer-token" };
  }
  if (normalized === "authtoken") {
    return { ruleId: "android-secret-token-password-candidate", sensitiveDataCategory: "access-token" };
  }
  if (normalized === "apisecret") {
    return { ruleId: "android-secret-token-password-candidate", sensitiveDataCategory: "cloud-secret-key" };
  }
  // Bare "secret" and any other sensitive-pattern match not covered above.
  return { ruleId: "android-secret-hardcoded-candidate", sensitiveDataCategory: "unknown-sensitive-value" };
}

export function analyzeSecretCandidateFile(targetRoot: string, file: SecretScanFile): AnalyzeSecretCandidatesResult {
  const candidates: CandidateEvidence[] = [];
  const findings: SecurityFinding[] = [];
  const fileKind = fileKindFor(file.relativePath);

  for (const block of matchPrivateKeyBlocks(file.content)) {
    const location = buildAndroidSourceLocation(targetRoot, file.absolutePath, { line: block.line });
    const fingerprint = fingerprintCandidateValue(block.rawBlock);
    if (!block.terminated) {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-secret-private-key-candidate",
          category: "android-secret-candidates",
          confidence: "medium",
          modulePath: file.modulePath,
          location,
          summary: `Unterminated ${block.headerLabel} block found; treated conservatively`,
          rawValue: block.rawBlock,
          resolutionState: "malformed",
          staticAnalysisLimitations: ["Block was not terminated by a matching END marker within the bounded scan window; content was not validated as a real key."],
        })
      );
      continue;
    }
    findings.push(
      makeAndroidFinding({
        ruleId: "android-secret-private-key-candidate",
        title: `Private key material found (${block.headerLabel})`,
        severity: "major",
        confidence: "high",
        description: `A ${block.headerLabel} block was found in target-contained text. This is high-confidence structural evidence of committed private key material; the key was not opened, parsed, or validated.`,
        manifestPath: file.relativePath,
        identity: fingerprint,
        location: { line: block.line },
        evidenceDetails: [`redactedPreview=${redactedPreviewForCandidate(block.rawBlock, { maxLength: 40 })}`],
        recommendation: "Remove the private key from source control immediately and rotate the corresponding credential/certificate.",
      })
    );
  }

  for (const match of matchSensitiveAssignments(file.content, fileKind)) {
    if (shouldSuppressEntirely(match.rawValue)) continue;

    const location: AndroidSourceLocation = buildAndroidSourceLocation(targetRoot, file.absolutePath, { line: match.line });
    const classification = classifyIdentifier(match.identifier);

    if (isReferenceSyntax(match.rawValue)) {
      candidates.push(
        makeCandidateEvidence({
          ruleId: classification.ruleId,
          category: classification.ruleId === "android-signing-password-literal" ? "android-signing-configuration" : "android-secret-candidates",
          confidence: "low",
          modulePath: file.modulePath,
          location,
          summary: `"${match.identifier}" is assigned an environment/property/placeholder reference, not a literal value`,
          rawValue: match.rawValue,
          resolutionState: "not-applicable",
          staticAnalysisLimitations: ["Reference syntax was detected; the resolved value was not evaluated and is not treated as a hardcoded credential."],
        })
      );
      continue;
    }

    const fingerprint = fingerprintCandidateValue(match.rawValue);
    findings.push(
      makeAndroidFinding({
        ruleId: classification.ruleId,
        title: `Hardcoded ${match.identifier} literal found`,
        severity: "major",
        confidence: "high",
        description: `The identifier "${match.identifier}" is assigned a literal, non-placeholder value. This is high-confidence static evidence of a hardcoded credential; it is not proof the credential is currently valid or in active use.`,
        manifestPath: file.relativePath,
        identity: fingerprint,
        location: { line: match.line },
        evidenceDetails: [`identifier=${match.identifier}`, `redactedPreview=${redactedPreviewForCandidate(match.rawValue)}`],
        recommendation: "Remove the hardcoded credential, rotate it, and load it from a secure secrets mechanism instead.",
      })
    );
  }

  return { candidates, findings };
}
