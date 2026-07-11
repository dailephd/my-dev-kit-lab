// Shared mobile-platform contracts for my-dev-kit-lab's mobile/Android
// validation substrate (v0.4.0 Batch 1).
//
// Android is the only implemented platform. Additional platform ids may be
// added to MOBILE_PLATFORMS in a future version once real detection and
// validation exist for them — this file must never claim support for a
// platform that has no implementation behind it.

export const MOBILE_PLATFORMS = ["android"] as const;
export type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];

// Confidence in a detection/classification/evidence claim. "unknown" is used
// when confidence itself could not be determined (distinct from "low", which
// asserts a deliberately weak but present signal).
export const MOBILE_CONFIDENCE_LEVELS = ["unknown", "low", "medium", "high"] as const;
export type MobileConfidence = (typeof MOBILE_CONFIDENCE_LEVELS)[number];

// Validation capabilities a profile can declare support for. This batch only
// defines the vocabulary; no capability is exercised until its owning batch
// implements it. Capabilities are declarative metadata, not proof of
// execution — a profile listing a capability does not mean a check ran.
export const MOBILE_VALIDATION_CAPABILITIES = [
  "static-detection",
  "manifest-analysis",
  "gradle-metadata",
  "gradle-task-execution",
  "permission-audit",
  "component-audit",
  "deep-link-audit",
  "release-metadata-summary",
  "play-readiness-checklist",
] as const;
export type MobileValidationCapability = (typeof MOBILE_VALIDATION_CAPABILITIES)[number];

// A detected mobile project profile. Represents what was observed about a
// single target, not a static catalog entry — detectionConfidence/evidence
// are populated by detection logic added in a later batch.
export type MobileProfile = {
  id: string;
  displayName: string;
  platform: MobilePlatform;
  projectType?: string;
  projectSubtype?: string;
  profileVersion?: string;
  detectionConfidence: MobileConfidence;
  evidence: string[];
  unsupportedNotes: string[];
  supportedCapabilities: MobileValidationCapability[];
  limitations: string[];
};
