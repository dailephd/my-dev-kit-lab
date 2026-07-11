import type { SecurityFinding, SecuritySeverity } from "../../../securityValidation/types.js";
import type { MobileConfidence } from "../../types.js";
import type { AndroidManifestSourceLocation } from "../manifest/types.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 3 — Android SecurityFinding factory.
//
// Reuses SecurityFinding as-is (no parallel Android finding schema). Android
// findings use category "static-scan" — an existing SecurityCheckCategory
// value that already covers static-analysis-derived findings (CodeQL,
// Semgrep) and accurately describes manifest analysis, so no widening of the
// shared, heavily-tested SecurityCheckCategory union was needed. Per-finding
// audit family is instead carried by the owning AndroidCheckResult.category
// (android-permissions/android-components/android-intent-filters/
// android-deep-links) and by the finding id/title.
//
// SecurityFinding has no `confidence` or structured `location` field (the
// existing codebase convention, e.g. AttackResult, keeps confidence on the
// *check result*, not the individual finding — see
// src/securityValidation/attackScenarios/attackResult.ts). Android check
// results already carry `confidence: MobileConfidence` (Batch 1). Per-finding
// confidence and location are therefore folded into the free-text `evidence`
// field here, consistent with how existing scenario code joins evidence
// previews into that same field.
// ---------------------------------------------------------------------------

function slug(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

// Deterministic, content-derived id — never depends on a counter, timestamp,
// or enumeration order, so equivalent evidence always yields the same id.
function buildFindingId(ruleId: string, manifestPath: string, identity: string | undefined, location: AndroidManifestSourceLocation | undefined): string {
  const parts = [ruleId, slug(manifestPath), identity ? slug(identity) : undefined, location?.line !== undefined ? `l${location.line}` : undefined].filter(
    (part): part is string => Boolean(part)
  );
  return parts.join("--");
}

function defaultReleaseImpact(severity: SecuritySeverity): string {
  switch (severity) {
    case "blocker":
      return "Must fix before release";
    case "major":
      return "Should fix before release";
    case "minor":
      return "Review recommended before release";
    case "informational":
      return "No release impact; informational only";
    case "skipped":
      return "Not evaluated";
  }
}

export type AndroidFindingInput = {
  ruleId: string;
  title: string;
  severity: SecuritySeverity;
  confidence: MobileConfidence;
  description: string;
  manifestPath: string;
  identity?: string;
  location?: AndroidManifestSourceLocation;
  evidenceDetails?: string[];
  recommendation?: string;
  releaseImpact?: string;
};

export function makeAndroidFinding(input: AndroidFindingInput): SecurityFinding {
  const id = buildFindingId(input.ruleId, input.manifestPath, input.identity, input.location);
  const locationSuffix = input.location?.line !== undefined ? `:${input.location.line}` : "";
  const evidenceParts = [
    `confidence=${input.confidence}`,
    input.identity ? `identity=${input.identity}` : undefined,
    `location=${input.manifestPath}${locationSuffix}`,
    ...(input.evidenceDetails ?? []),
  ].filter((part): part is string => Boolean(part));

  return {
    id,
    title: input.title,
    severity: input.severity,
    category: "static-scan",
    description: input.description,
    evidence: evidenceParts.join(" | "),
    affectedFiles: [input.manifestPath],
    recommendation: input.recommendation,
    releaseImpact: input.releaseImpact ?? defaultReleaseImpact(input.severity),
  };
}
