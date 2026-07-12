import type { MobileConfidence } from "../../types.js";
import type { AndroidAdvancedRuleId, AndroidAdvancedCheckCategory } from "./ruleIds.js";
import type { SensitiveDataCategory } from "./sensitiveCategories.js";
import type { AndroidSourceLocation } from "./sourceLocation.js";
import { fingerprintCandidateValue, redactedPreviewForCandidate, type RedactedPreviewInput } from "./redaction.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 1 — candidate-evidence contract for static, unconfirmed
// findings produced by later v0.4.1 detectors (secrets, signing, WebView,
// FileProvider, sensitive storage, Firebase config, optional-tool output).
//
// This is deliberately NOT a replacement for SecurityFinding
// (src/securityValidation/types.ts) or for AndroidCheckResult's `findings:
// SecurityFinding[]` field. A later batch that confirms/escalates a
// candidate into an actual finding constructs a SecurityFinding (via
// makeAndroidFinding, src/mobile/android/audit/androidFinding.ts) as it
// already does today; CandidateEvidence is the intermediate, pre-finding
// representation of "something static analysis noticed that is not
// necessarily a real vulnerability" — it explicitly must never claim:
//   - runtime exploitability
//   - confirmed data leakage
//   - confirmed credential validity
//   - confirmed remote exposure
//   - confirmed release configuration (Gradle evaluation is out of scope)
// A CandidateEvidence MAY later be linked to a SecurityFinding id via
// relatedFindingIds once a detector promotes it — this batch defines the
// field but does not populate it (no detector exists yet).
// ---------------------------------------------------------------------------

// Reuses MobileConfidence (src/mobile/types.ts: unknown/low/medium/high) as
// the confidence vocabulary — no second confidence enum. Candidate evidence
// only ever needs "high"/"medium"/"low" in practice (per spec section 7.4);
// "unknown" remains available since MobileConfidence already defines it and
// a detector may legitimately be unable to judge confidence for an edge case.
export type CandidateConfidence = MobileConfidence;

// Resolution states for a static candidate's underlying evidence (e.g. did a
// referenced resource file resolve, was a signing config path found). Kept
// narrow and additive; overlaps deliberately with AndroidCheckStatus/XML
// resource-resolution states where the underlying concept is the same
// (resolved and missing/malformed/unsupported are shared vocabulary), but
// this is not a duplicate of AndroidCheckStatus — a candidate's resolution
// state describes one piece of referenced evidence, not an entire check.
export const CANDIDATE_RESOLUTION_STATES = ["resolved", "unresolved", "missing", "malformed", "unsupported", "not-applicable"] as const;
export type CandidateResolutionState = (typeof CANDIDATE_RESOLUTION_STATES)[number];

export type CandidateEvidence = {
  id: string;
  ruleId: AndroidAdvancedRuleId;
  category: AndroidAdvancedCheckCategory;
  sensitiveDataCategory?: SensitiveDataCategory;
  confidence: CandidateConfidence;
  modulePath?: string;
  location: AndroidSourceLocation;
  summary: string;
  redactedPreview: string;
  fingerprint: string;
  resolutionState: CandidateResolutionState;
  staticAnalysisLimitations: string[];
  relatedManifestComponentIds?: string[];
  relatedResourceReferences?: string[];
  relatedFindingIds?: string[];
  relatedCheckIds?: string[];
};

export type MakeCandidateEvidenceInput = {
  ruleId: AndroidAdvancedRuleId;
  category: AndroidAdvancedCheckCategory;
  sensitiveDataCategory?: SensitiveDataCategory;
  confidence: CandidateConfidence;
  modulePath?: string;
  location: AndroidSourceLocation;
  summary: string;
  rawValue: RedactedPreviewInput;
  resolutionState: CandidateResolutionState;
  staticAnalysisLimitations?: string[];
  relatedManifestComponentIds?: string[];
  relatedResourceReferences?: string[];
  relatedFindingIds?: string[];
  relatedCheckIds?: string[];
};

function slug(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

// Deterministic, content-derived id (no counter, no timestamp) so equivalent
// candidate evidence always produces the same id across repeated runs.
function buildCandidateEvidenceId(ruleId: string, location: AndroidSourceLocation, fingerprint: string): string {
  const locationPart = [location.path, location.line !== undefined ? `l${location.line}` : undefined, location.column !== undefined ? `c${location.column}` : undefined]
    .filter((part): part is string => Boolean(part))
    .join(":");
  return [ruleId, slug(locationPart), fingerprint.slice(0, 16)].join("--");
}

// Never accepts a raw secret value as a plain string parameter name to
// discourage accidental logging at call sites — `rawValue` is redacted and
// fingerprinted here, once, and the raw value is never stored on the
// returned object.
export function makeCandidateEvidence(input: MakeCandidateEvidenceInput): CandidateEvidence {
  const fingerprint = fingerprintCandidateValue(input.rawValue);
  const redactedPreview = redactedPreviewForCandidate(input.rawValue);
  const id = buildCandidateEvidenceId(input.ruleId, input.location, fingerprint);

  return {
    id,
    ruleId: input.ruleId,
    category: input.category,
    sensitiveDataCategory: input.sensitiveDataCategory,
    confidence: input.confidence,
    modulePath: input.modulePath,
    location: input.location,
    summary: input.summary,
    redactedPreview,
    fingerprint,
    resolutionState: input.resolutionState,
    staticAnalysisLimitations: input.staticAnalysisLimitations ?? [],
    relatedManifestComponentIds: input.relatedManifestComponentIds,
    relatedResourceReferences: input.relatedResourceReferences,
    relatedFindingIds: input.relatedFindingIds,
    relatedCheckIds: input.relatedCheckIds,
  };
}
