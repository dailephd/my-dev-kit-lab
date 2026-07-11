import fs from "node:fs";
import path from "node:path";
import type { AndroidDetectionResult } from "../../detection.js";
import type { AndroidGradleModuleInfo } from "../../gradle/types.js";
import type { AndroidCheckResult } from "../../validation/checkResult.js";
import { buildAndroidSourceLocation } from "../sourceLocation.js";
import { makeCandidateEvidence } from "../candidateEvidence.js";
import { sortCandidateEvidence } from "../ordering.js";
import { discoverKeystoreCandidates } from "./discoverKeystoreCandidates.js";
import { analyzeModuleSigningConfiguration } from "./analyzeSigningConfiguration.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 4 — standalone Android signing-configuration check result.
//
// Operates over Gradle module metadata rather than parsed manifests, so it
// cannot reuse buildAndroidManifestCheckResult. Standalone: not called from
// validateAndroidTarget / any active orchestration, not rendered in reports,
// no CLI effect. Batch 8 integrates.
// ---------------------------------------------------------------------------

export const ANDROID_SIGNING_CONFIGURATION_AUDIT_CHECK_ID = "android-signing-configuration-audit";

export function auditAndroidSigningConfiguration(
  targetRoot: string,
  detection: AndroidDetectionResult,
  gradleModules: AndroidGradleModuleInfo[]
): AndroidCheckResult {
  if (detection.projectKind === "non-android") {
    return {
      id: ANDROID_SIGNING_CONFIGURATION_AUDIT_CHECK_ID,
      category: "android-signing-configuration",
      title: "Android signing configuration audit",
      status: "unsupported",
      requirementLevel: "optional",
      ran: false,
      skipped: true,
      skipInfo: {
        checkId: ANDROID_SIGNING_CONFIGURATION_AUDIT_CHECK_ID,
        reason: "Target was not detected as an Android project.",
        requirementLevel: "optional",
        missingCapability: "android-detection",
        verdictImpact: "does not apply to a non-Android target",
        recommendedNextAction: "Re-run against an Android Gradle project, or verify project detection.",
      },
      evidence: [],
      findings: [],
      warnings: [],
      errors: [],
      sourcePaths: [],
      confidence: "unknown",
      environmentRequirements: [],
      candidateEvidence: [],
    };
  }

  const modulePaths = gradleModules.map((m) => m.path);
  const keystoreCandidates = discoverKeystoreCandidates(targetRoot, modulePaths);

  const findingsById = new Map();
  const candidatesById = new Map();
  const evidence: string[] = [];
  const warnings: string[] = [];
  const sourcePaths: string[] = [];
  const correlatedKeystorePaths = new Set<string>();

  for (const module of gradleModules) {
    if (module.buildFilePath === undefined) {
      warnings.push(`${module.path}: no build file path known; signing configuration was not analyzed for this module`);
      continue;
    }
    const absolutePath = path.join(targetRoot, module.buildFilePath);
    let text: string;
    try {
      text = fs.readFileSync(absolutePath, "utf8");
    } catch {
      warnings.push(`${module.buildFilePath}: could not be read; signing configuration was not analyzed for this module`);
      continue;
    }
    sourcePaths.push(module.buildFilePath);

    const result = analyzeModuleSigningConfiguration(targetRoot, module, text, keystoreCandidates);
    for (const finding of result.findings) {
      findingsById.set(finding.id, finding);
      if (finding.affectedFiles) for (const p of finding.affectedFiles) correlatedKeystorePaths.add(p);
    }
    for (const candidate of result.candidates) candidatesById.set(candidate.id, candidate);
    evidence.push(`${module.path}: ${result.evidenceText.length} evidence note(s), ${result.findings.length} finding(s)`, ...result.evidenceText);
  }

  // Baseline review evidence for every committed keystore not already
  // covered by a higher-confidence correlation finding above.
  for (const keystore of keystoreCandidates) {
    if (correlatedKeystorePaths.has(keystore.relativePath)) continue;
    const absolutePath = path.join(targetRoot, keystore.relativePath);
    candidatesById.set(
      `keystore-candidate--${keystore.relativePath}`,
      makeCandidateEvidence({
        ruleId: "android-signing-keystore-candidate",
        category: "android-signing-configuration",
        confidence: "low",
        modulePath: keystore.modulePath,
        location: buildAndroidSourceLocation(targetRoot, absolutePath),
        summary: `Committed keystore-like file found: ${keystore.relativePath}`,
        rawValue: undefined,
        resolutionState: "resolved",
        staticAnalysisLimitations: [
          "File contents were not read, opened, or validated; this does not prove the file contains a production release key.",
        ],
      })
    );
  }

  const findings = [...findingsById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const candidateEvidence = sortCandidateEvidence([...candidatesById.values()]);
  const hasReportableFinding = findings.some((f) => f.severity !== "informational");

  return {
    id: ANDROID_SIGNING_CONFIGURATION_AUDIT_CHECK_ID,
    category: "android-signing-configuration",
    title: "Android signing configuration audit",
    status: hasReportableFinding ? "failed" : "passed",
    requirementLevel: "required",
    ran: true,
    skipped: false,
    evidence,
    findings,
    warnings: [...warnings, "Static analysis only: does not open keystores, validate credentials, evaluate Gradle, or inspect APK/AAB signing."],
    errors: [],
    sourcePaths,
    confidence: warnings.length > 0 ? "medium" : "high",
    environmentRequirements: [],
    candidateEvidence,
  };
}
