import type { MobileConfidence } from "../../types.js";
import type { AndroidDetectionResult } from "../detection.js";
import type { AndroidManifestParseEntry } from "../manifest/parseAndroidManifest.js";
import type { AndroidCheckResult } from "../validation/checkResult.js";
import type { TargetMutationReport } from "../gradle/validate/targetMutation.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 5 — the three required check families that no prior batch
// produced an AndroidCheckResult for: project detection, manifest parsing
// (as distinct from the audits that consume parsed manifests), and target
// immutability evidence (agents.txt Batch 5 section 10.1).
// ---------------------------------------------------------------------------

export function buildAndroidDetectionCheckResult(detection: AndroidDetectionResult): AndroidCheckResult {
  const sourcePaths = [...detection.gradleSettingsFiles, ...detection.rootBuildFiles].sort((a, b) => a.localeCompare(b));

  if (detection.projectKind === "non-android") {
    return {
      id: "android-project-detection",
      category: "android-detection",
      title: "Android project detection",
      status: "unsupported",
      requirementLevel: "optional",
      ran: true,
      skipped: true,
      skipInfo: {
        checkId: "android-project-detection",
        reason: "Target was not detected as an Android project.",
        requirementLevel: "optional",
        missingCapability: "android-evidence",
        verdictImpact: "does not apply to a non-Android target",
        recommendedNextAction: "Confirm the target is an Android Gradle project.",
      },
      evidence: detection.evidence,
      findings: [],
      warnings: detection.warnings,
      errors: [],
      sourcePaths,
      confidence: detection.confidence,
      environmentRequirements: [],
    };
  }

  const isPartial = detection.projectKind === "partial" || detection.projectKind === "unknown" || detection.partialOrUnsupportedStructure;

  return {
    id: "android-project-detection",
    category: "android-detection",
    title: "Android project detection",
    status: isPartial ? "inconclusive" : "passed",
    requirementLevel: "required",
    ran: true,
    skipped: false,
    evidence: detection.evidence,
    findings: [],
    warnings: detection.warnings,
    errors: [],
    sourcePaths,
    confidence: detection.confidence,
    environmentRequirements: [],
  };
}

const MALFORMED_PREFIX = "Malformed XML:";

export function buildAndroidManifestParsingCheckResult(
  detection: AndroidDetectionResult,
  manifests: AndroidManifestParseEntry[]
): AndroidCheckResult {
  const sourcePaths = manifests.map((m) => m.manifestPath);

  if (detection.projectKind === "non-android") {
    return {
      id: "android-manifest-parsing",
      category: "android-manifest",
      title: "Android manifest parsing",
      status: "unsupported",
      requirementLevel: "optional",
      ran: false,
      skipped: true,
      skipInfo: {
        checkId: "android-manifest-parsing",
        reason: "Target was not detected as an Android project.",
        requirementLevel: "optional",
        missingCapability: "android-detection",
        verdictImpact: "does not apply to a non-Android target",
        recommendedNextAction: "Confirm the target is an Android Gradle project.",
      },
      evidence: [],
      findings: [],
      warnings: [],
      errors: [],
      sourcePaths: [],
      confidence: "unknown",
      environmentRequirements: [],
    };
  }

  if (manifests.length === 0) {
    return {
      id: "android-manifest-parsing",
      category: "android-manifest",
      title: "Android manifest parsing",
      status: "inconclusive",
      requirementLevel: "required",
      ran: true,
      skipped: false,
      evidence: [],
      findings: [],
      warnings: ["No AndroidManifest.xml was found for this target."],
      errors: [],
      sourcePaths: [],
      confidence: "unknown",
      environmentRequirements: [],
    };
  }

  const malformed = manifests.filter((m) => m.manifest.parseWarnings.some((w) => w.startsWith(MALFORMED_PREFIX)));
  const allMalformed = malformed.length === manifests.length;
  const warnings = manifests.flatMap((m) => m.manifest.parseWarnings);

  if (allMalformed) {
    return {
      id: "android-manifest-parsing",
      category: "android-manifest",
      title: "Android manifest parsing",
      status: "error",
      requirementLevel: "required",
      ran: true,
      skipped: false,
      evidence: [],
      findings: [],
      warnings,
      errors: malformed.flatMap((m) => m.manifest.parseWarnings.filter((w) => w.startsWith(MALFORMED_PREFIX))),
      sourcePaths,
      confidence: "unknown",
      environmentRequirements: [],
    };
  }

  const confidence: MobileConfidence = malformed.length > 0 ? "medium" : "high";
  return {
    id: "android-manifest-parsing",
    category: "android-manifest",
    title: "Android manifest parsing",
    status: "passed",
    requirementLevel: "required",
    ran: true,
    skipped: false,
    evidence: [`${manifests.length} manifest(s) parsed independently (not merged)`],
    findings: [],
    warnings,
    errors: [],
    sourcePaths,
    confidence,
    environmentRequirements: [],
  };
}

export function buildAndroidTargetImmutabilityCheckResult(mutation: TargetMutationReport): AndroidCheckResult {
  if (!mutation.comparable) {
    return {
      id: "android-target-immutability",
      category: "android-target-immutability",
      title: "Android target immutability",
      status: "inconclusive",
      requirementLevel: "optional",
      ran: true,
      skipped: false,
      evidence: [],
      findings: [],
      warnings: [`Target mutation evidence unavailable: ${mutation.reason ?? "unknown reason"}`],
      errors: [],
      sourcePaths: [],
      confidence: "unknown",
      environmentRequirements: [],
      targetModificationObserved: undefined,
    };
  }

  const unexpected = mutation.unexpectedChanges.length > 0;
  return {
    id: "android-target-immutability",
    category: "android-target-immutability",
    title: "Android target immutability",
    status: unexpected ? "failed" : "passed",
    requirementLevel: "optional",
    ran: true,
    skipped: false,
    evidence: mutation.expectedGeneratedChanges.map((p) => `generatedOutput=${p}`),
    findings: [],
    warnings: unexpected ? [`Unexpected target change(s): ${mutation.unexpectedChanges.join(", ")}`] : [],
    errors: [],
    sourcePaths: [],
    confidence: "high",
    environmentRequirements: [],
    targetModificationObserved: unexpected,
  };
}
