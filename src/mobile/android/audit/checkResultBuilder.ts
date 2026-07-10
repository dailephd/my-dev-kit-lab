import type { SecurityFinding } from "../../../securityValidation/types.js";
import type { MobileConfidence } from "../../types.js";
import type { AndroidDetectionResult } from "../detection.js";
import type { AndroidCheckCategory, AndroidCheckResult, AndroidCheckStatus } from "../validation/checkResult.js";
import type { AndroidManifestParseEntry } from "../manifest/parseAndroidManifest.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 3 — shared AndroidCheckResult construction for the four
// initial manifest-based audits.
//
// Centralizes the status-decision policy (agents.txt Batch 3 section 7.17)
// so all four audits apply it identically:
//   - non-Android target            -> "unsupported" (optional, skipped)
//   - Android but no manifest found -> "inconclusive" (required, ran)
//   - all manifests malformed       -> "error" (required, ran)
//   - manifests parsed, findings    -> "failed"
//   - manifests parsed, no findings -> "passed"
// None of these ever collapse into "passed" except the last case — the
// critical invariant from Batch 1 (skipped/unsupported/inconclusive/error
// are never reported as passed).
// ---------------------------------------------------------------------------

export type BuildAndroidManifestCheckResultInput = {
  id: string;
  category: AndroidCheckCategory;
  title: string;
  detection: AndroidDetectionResult;
  manifests: AndroidManifestParseEntry[];
  findings: SecurityFinding[];
  evidence: string[];
  warnings: string[];
};

function isMalformed(entry: AndroidManifestParseEntry): boolean {
  return entry.manifest.parseWarnings.some((w) => w.startsWith("Malformed XML:"));
}

export function buildAndroidManifestCheckResult(input: BuildAndroidManifestCheckResultInput): AndroidCheckResult {
  const { id, category, title, detection, manifests, findings, evidence, warnings } = input;
  const sourcePaths = manifests.map((m) => m.manifestPath);

  if (detection.projectKind === "non-android") {
    return {
      id,
      category,
      title,
      status: "unsupported",
      requirementLevel: "optional",
      ran: false,
      skipped: true,
      skipInfo: {
        checkId: id,
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
    };
  }

  if (manifests.length === 0) {
    return {
      id,
      category,
      title,
      status: "inconclusive",
      requirementLevel: "required",
      ran: true,
      skipped: false,
      evidence,
      findings: [],
      warnings: [...warnings, "No AndroidManifest.xml was found for this target; audit could not run."],
      errors: [],
      sourcePaths: [],
      confidence: "unknown",
      environmentRequirements: [],
    };
  }

  const malformedEntries = manifests.filter(isMalformed);
  const allMalformed = malformedEntries.length === manifests.length;

  if (allMalformed) {
    return {
      id,
      category,
      title,
      status: "error",
      requirementLevel: "required",
      ran: true,
      skipped: false,
      evidence,
      findings: [],
      warnings,
      errors: malformedEntries.flatMap((entry) => entry.manifest.parseWarnings.filter((w) => w.startsWith("Malformed XML:"))),
      sourcePaths,
      confidence: "unknown",
      environmentRequirements: [],
    };
  }

  const confidence: MobileConfidence = malformedEntries.length > 0 ? "medium" : "high";
  // Informational-only findings (e.g. "standard launcher activity is
  // exported, as expected") are evidence/inventory, not a reportable issue —
  // only minor/major/blocker findings cause a "failed" status, matching
  // section 7.17's "completed and found no reportable issues may pass".
  const hasReportableFinding = findings.some((finding) => finding.severity !== "informational");
  const status: AndroidCheckStatus = hasReportableFinding ? "failed" : "passed";

  return {
    id,
    category,
    title,
    status,
    requirementLevel: "required",
    ran: true,
    skipped: false,
    evidence,
    findings,
    warnings: [
      ...warnings,
      ...malformedEntries.flatMap((entry) => entry.manifest.parseWarnings.filter((w) => w.startsWith("Malformed XML:"))),
    ],
    errors: [],
    sourcePaths,
    confidence,
    environmentRequirements: [],
  };
}
