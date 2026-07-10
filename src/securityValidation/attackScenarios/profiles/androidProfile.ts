import type { AttackProfileDefinition } from "../attackProfile.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 5 — registry placeholder for the "android" profile.
//
// Unlike the other three profiles, "android" does NOT route through the
// classic check-group/attack-scenario pipeline that this definition
// describes (src/mobile/android/validate/validateAndroidTarget.ts is an
// entirely separate orchestrator — see agents.txt Batch 5 section 6.1). This
// entry exists only so SECURITY_PROFILE_IDS including "android" satisfies
// PROFILE_REGISTRY's Record<SecurityProfileId, AttackProfileDefinition> type;
// its check-id lists are deliberately empty so nothing here ever appears to
// select or gate a classic check group for the Android path.
// ---------------------------------------------------------------------------

export const ANDROID_PROFILE: AttackProfileDefinition = {
  id: "android",
  label: "Android",
  description:
    "Profile for an Android Gradle project, validated through a dedicated Android orchestrator (detection, manifest audits, Gradle metadata, optional Gradle operations) rather than the classic check-group/attack-scenario pipeline this definition otherwise describes.",
  defaultCheckIds: [],
  applicableCheckIds: [],
  scenarioGroups: [],
};
