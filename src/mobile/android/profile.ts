import type { MobileConfidence, MobileProfile, MobileValidationCapability } from "../types.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 1 — Android profile identity.
//
// A single canonical profile id ("android") is used for all Android Gradle
// projects. Application vs. library vs. Compose-vs-XML/View distinctions are
// represented as classification data on AndroidDetectionResult (see
// detection.ts), not as separate profile ids — this keeps the public profile
// surface minimal, per the batch's "no unnecessary user-facing aliases" rule.
// ---------------------------------------------------------------------------

export const ANDROID_PLATFORM = "android" as const;
export const ANDROID_PROFILE_ID = "android" as const;

export function createAndroidProfile(partial: {
  detectionConfidence: MobileConfidence;
  evidence?: string[];
  unsupportedNotes?: string[];
  supportedCapabilities?: MobileValidationCapability[];
  limitations?: string[];
  projectType?: string;
  projectSubtype?: string;
  profileVersion?: string;
}): MobileProfile {
  return {
    id: ANDROID_PROFILE_ID,
    displayName: "Android",
    platform: ANDROID_PLATFORM,
    projectType: partial.projectType,
    projectSubtype: partial.projectSubtype,
    profileVersion: partial.profileVersion,
    detectionConfidence: partial.detectionConfidence,
    evidence: partial.evidence ?? [],
    unsupportedNotes: partial.unsupportedNotes ?? [],
    supportedCapabilities: partial.supportedCapabilities ?? [],
    limitations: partial.limitations ?? [],
  };
}

export function isAndroidProfile(profile: MobileProfile): boolean {
  return profile.platform === ANDROID_PLATFORM && profile.id === ANDROID_PROFILE_ID;
}
