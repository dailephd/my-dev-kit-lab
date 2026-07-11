import fs from "node:fs";
import path from "node:path";
import type { SecurityFinding } from "../../../../securityValidation/types.js";
import type { AndroidGradleModuleInfo } from "../../gradle/types.js";
import { makeAndroidFinding } from "../../audit/androidFinding.js";
import { buildAndroidSourceLocation, type AndroidSourceLocation } from "../sourceLocation.js";
import { makeCandidateEvidence, type CandidateEvidence } from "../candidateEvidence.js";
import { extractSigningConfigurations } from "./extractSigningConfigurations.js";
import type { AndroidGradleSigningConfigInfo, KeystoreCandidateFile, SigningCredentialValue } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 4 — signing-configuration analysis and correlation.
//
// Conservative by construction: only a literal (never reference/dynamic)
// storePassword/keyPassword, or an explicit release build-type referencing
// signingConfigs.debug, ever becomes a "major" SecurityFinding. Environment/
// property references are informational metadata only. Library modules are
// downgraded to candidate evidence rather than receiving application
// release-signing conclusions (agents.txt Batch 4 sections 9.12-9.18/9.21).
// ---------------------------------------------------------------------------

export type AnalyzeSigningConfigurationResult = {
  candidates: CandidateEvidence[];
  findings: SecurityFinding[];
  evidenceText: string[];
};

function loc(targetRoot: string, absolutePath: string, position?: { line?: number; column?: number }): AndroidSourceLocation {
  return buildAndroidSourceLocation(targetRoot, absolutePath, position);
}

function analyzeCredential(
  fieldLabel: "storePassword" | "keyPassword",
  value: SigningCredentialValue,
  configName: string,
  modulePath: string | undefined,
  location: AndroidSourceLocation,
  buildFileRelativePath: string
): { candidates: CandidateEvidence[]; findings: SecurityFinding[]; evidenceText: string[]; hasLiteral: boolean } {
  if (value.state === "literal" && value.fingerprint !== undefined) {
    return {
      candidates: [],
      findings: [
        makeAndroidFinding({
          ruleId: "android-signing-password-literal",
          title: `Literal ${fieldLabel} in signing configuration "${configName}"`,
          severity: "major",
          confidence: "high",
          description: `The signing configuration "${configName}" sets a literal ${fieldLabel} value. This is high-confidence static evidence of a hardcoded signing credential; it is not proof the credential unlocks any specific keystore.`,
          manifestPath: buildFileRelativePath,
          identity: value.fingerprint,
          location: { line: location.line },
          evidenceDetails: [`signingConfig=${configName}`, `field=${fieldLabel}`, `redactedPreview=${value.redactedPreview}`],
          recommendation: "Remove the literal credential and load it from an environment variable or a local, untracked properties file instead.",
        }),
      ],
      evidenceText: [],
      hasLiteral: true,
    };
  }

  if (value.state === "environment-reference" || value.state === "gradle-property-reference" || value.state === "local-property-reference") {
    return {
      candidates: [],
      findings: [],
      evidenceText: [`${configName}.${fieldLabel} is a ${value.state} (informational, not a hardcoded credential)`],
      hasLiteral: false,
    };
  }

  if (value.state === "variable-reference" || value.state === "method-call" || value.state === "dynamic") {
    return {
      candidates: [
        makeCandidateEvidence({
          ruleId: "android-signing-password-literal",
          category: "android-signing-configuration",
          confidence: "low",
          modulePath,
          location,
          summary: `Signing configuration "${configName}"'s ${fieldLabel} is a dynamic/unresolved expression`,
          rawValue: value.rawExpression,
          resolutionState: "unresolved",
        }),
      ],
      findings: [],
      evidenceText: [],
      hasLiteral: false,
    };
  }

  return { candidates: [], findings: [], evidenceText: [], hasLiteral: false };
}

function analyzeStoreFile(
  targetRoot: string,
  config: AndroidGradleSigningConfigInfo,
  modulePath: string | undefined,
  moduleDirRelative: string,
  location: AndroidSourceLocation
): { candidates: CandidateEvidence[]; evidenceText: string[] } {
  const { storeFile } = config;
  if (storeFile.state === "missing") return { candidates: [], evidenceText: [`${config.name}.storeFile is not set`] };
  if (storeFile.state !== "literal" || storeFile.literalValue === undefined) {
    return {
      candidates: [
        makeCandidateEvidence({
          ruleId: "android-signing-keystore-candidate",
          category: "android-signing-configuration",
          confidence: "low",
          modulePath,
          location,
          summary: `Signing configuration "${config.name}"'s storeFile is a dynamic/unresolved expression`,
          rawValue: storeFile.rawExpression,
          resolutionState: "unresolved",
        }),
      ],
      evidenceText: [],
    };
  }

  const literalPath = storeFile.literalValue;
  if (path.isAbsolute(literalPath)) {
    return {
      candidates: [
        makeCandidateEvidence({
          ruleId: "android-signing-path-leakage",
          category: "android-signing-configuration",
          confidence: "medium",
          modulePath,
          location,
          summary: `Signing configuration "${config.name}" references an absolute local storeFile path`,
          rawValue: literalPath,
          resolutionState: "resolved",
          staticAnalysisLimitations: ["The absolute path may reveal local workstation directory structure; it was not resolved or opened."],
        }),
      ],
      evidenceText: [],
    };
  }

  const resolvedAbsolute = path.join(targetRoot, moduleDirRelative, literalPath);
  const exists = fileExistsSafely(resolvedAbsolute);
  if (!exists) {
    return {
      candidates: [
        makeCandidateEvidence({
          ruleId: "android-signing-keystore-candidate",
          category: "android-signing-configuration",
          confidence: "low",
          modulePath,
          location,
          summary: `Signing configuration "${config.name}" references a keystore file that was not found in the target`,
          rawValue: literalPath,
          resolutionState: "missing",
          staticAnalysisLimitations: ["A missing referenced keystore is review evidence, not proof that signing is broken."],
        }),
      ],
      evidenceText: [],
    };
  }
  return { candidates: [], evidenceText: [`${config.name}.storeFile resolves to a target-contained file: ${literalPath}`] };
}

function fileExistsSafely(absolutePath: string): boolean {
  try {
    return fs.existsSync(absolutePath);
  } catch {
    return false;
  }
}

function extractReleaseSigningConfigName(signingConfigRef: string): string | undefined {
  const getByNameMatch = signingConfigRef.match(/signingConfigs\.getByName\(\s*["'](\w[\w-]*)["']\s*\)/);
  if (getByNameMatch) return getByNameMatch[1];
  const dotMatch = signingConfigRef.match(/signingConfigs\.(\w[\w-]*)/);
  if (dotMatch) return dotMatch[1];
  const namedMatch = signingConfigRef.match(/signingConfigs\.named\(\s*["'](\w[\w-]*)["']\s*\)/);
  if (namedMatch) return namedMatch[1];
  return undefined;
}

export function analyzeModuleSigningConfiguration(
  targetRoot: string,
  gradleModule: AndroidGradleModuleInfo,
  buildFileText: string,
  allKeystoreCandidates: readonly KeystoreCandidateFile[]
): AnalyzeSigningConfigurationResult {
  const candidates: CandidateEvidence[] = [];
  const findings: SecurityFinding[] = [];
  const evidenceText: string[] = [];
  const modulePath = gradleModule.path;
  const isLibraryOnlyModule = gradleModule.isLibrary === true && gradleModule.isApplication !== true;
  const buildFileRelativePath = gradleModule.buildFilePath ?? modulePath;
  const buildFileAbsolutePath = path.join(targetRoot, buildFileRelativePath);
  const location = loc(targetRoot, buildFileAbsolutePath);

  const signingConfigs = extractSigningConfigurations(buildFileText);
  const literalCredentialConfigNames = new Set<string>();

  for (const config of signingConfigs) {
    const storePasswordResult = analyzeCredential("storePassword", config.storePassword, config.name, modulePath, location, buildFileRelativePath);
    const keyPasswordResult = analyzeCredential("keyPassword", config.keyPassword, config.name, modulePath, location, buildFileRelativePath);
    const storeFileResult = analyzeStoreFile(targetRoot, config, modulePath, modulePath, location);

    if (storePasswordResult.hasLiteral || keyPasswordResult.hasLiteral) literalCredentialConfigNames.add(config.name);

    if (isLibraryOnlyModule) {
      // Downgrade findings to candidates for library-only modules — never
      // suppress the evidence entirely, just its release-signing weight.
      for (const finding of [...storePasswordResult.findings, ...keyPasswordResult.findings]) {
        candidates.push(
          makeCandidateEvidence({
            ruleId: finding.id.split("--")[0] as CandidateEvidence["ruleId"],
            category: "android-signing-configuration",
            confidence: "low",
            modulePath,
            location,
            summary: `${finding.title} (library module — not an installable application)`,
            rawValue: undefined,
            resolutionState: "not-applicable",
          })
        );
      }
    } else {
      findings.push(...storePasswordResult.findings, ...keyPasswordResult.findings);
    }
    candidates.push(...storePasswordResult.candidates, ...keyPasswordResult.candidates, ...storeFileResult.candidates);
    evidenceText.push(...storePasswordResult.evidenceText, ...keyPasswordResult.evidenceText, ...storeFileResult.evidenceText);

    // keyAlias is metadata only — never a finding/candidate by itself.
    if (config.keyAlias.state === "literal") {
      evidenceText.push(`${config.name}.keyAlias=${config.keyAlias.literalValue}`);
    }
  }

  // --- release build-type <-> signingConfig correlation ---
  const releaseBuildTypes = (gradleModule.buildTypeDetails ?? []).filter((bt) => bt.name === "release");
  for (const buildType of releaseBuildTypes) {
    if (buildType.signingConfigRef === undefined) continue;
    const referencedName = extractReleaseSigningConfigName(buildType.signingConfigRef);

    if (referencedName === undefined) {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-signing-debug-in-release",
          category: "android-signing-configuration",
          confidence: "low",
          modulePath,
          location,
          summary: `Release build type's signingConfig is a dynamic/unresolved expression: ${buildType.signingConfigRef}`,
          rawValue: buildType.signingConfigRef,
          resolutionState: "unresolved",
        })
      );
      continue;
    }

    if (referencedName === "debug") {
      const debugFinding = makeAndroidFinding({
        ruleId: "android-signing-debug-in-release",
        title: 'Release build type explicitly uses signingConfigs.debug',
        severity: "major",
        confidence: "high",
        description:
          "The release build type's signingConfig references signingConfigs.debug. This is high-confidence risky release-configuration evidence; it does not prove a shipped APK was actually signed with the debug key (variant/flavor selection is not evaluated).",
        manifestPath: buildFileRelativePath,
        identity: "release-debug-signing",
        evidenceDetails: [`buildType=release`, `signingConfigRef=${buildType.signingConfigRef}`],
        recommendation: "Configure a dedicated release signing configuration and remove the reference to signingConfigs.debug.",
      });
      if (isLibraryOnlyModule) {
        candidates.push(
          makeCandidateEvidence({
            ruleId: "android-signing-debug-in-release",
            category: "android-signing-configuration",
            confidence: "low",
            modulePath,
            location,
            summary: `${debugFinding.title} (library module — not an installable application)`,
            rawValue: undefined,
            resolutionState: "not-applicable",
          })
        );
      } else {
        findings.push(debugFinding);
      }
      continue;
    }

    const referencedConfigExists = signingConfigs.some((c) => c.name === referencedName);
    if (!referencedConfigExists) {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-signing-debug-in-release",
          category: "android-signing-configuration",
          confidence: "low",
          modulePath,
          location,
          summary: `Release build type references signing config "${referencedName}", which has no matching definition in this build file`,
          rawValue: referencedName,
          resolutionState: "missing",
        })
      );
      continue;
    }

    evidenceText.push(`release build type references named signing config "${referencedName}" (ordinary metadata)`);

    // --- committed-keystore + literal-credential + release correlation ---
    if (literalCredentialConfigNames.has(referencedName)) {
      const referencedConfig = signingConfigs.find((c) => c.name === referencedName)!;
      const storeFileName = referencedConfig.storeFile.state === "literal" ? path.basename(referencedConfig.storeFile.literalValue ?? "") : undefined;
      const committedKeystore = storeFileName ? allKeystoreCandidates.find((k) => path.basename(k.relativePath) === storeFileName) : undefined;
      if (committedKeystore && !isLibraryOnlyModule) {
        findings.push(
          makeAndroidFinding({
            ruleId: "android-signing-keystore-candidate",
            title: `Release signing configuration "${referencedName}" correlates with a committed keystore and a literal credential`,
            severity: "major",
            confidence: "high",
            description: `The release build type references signing configuration "${referencedName}", which has a literal password and a matching committed keystore file (${committedKeystore.relativePath}) in the target. This is a high-confidence aligned static signal; it does not prove the credential is valid or that this keystore is used in a published artifact.`,
            manifestPath: committedKeystore.relativePath,
            identity: `${referencedName}-committed-keystore-correlation`,
            evidenceDetails: [`signingConfig=${referencedName}`, `keystore=${committedKeystore.relativePath}`],
            recommendation: "Remove the committed keystore and credential from source control; use a secure, out-of-repo signing mechanism (e.g. CI secret store).",
          })
        );
      }
    }
  }

  return { candidates, findings, evidenceText };
}
