import { describe, expect, it } from "vitest";
import { MOBILE_PLATFORMS, MOBILE_CONFIDENCE_LEVELS } from "../../src/mobile/types.js";
import { ANDROID_PLATFORM, ANDROID_PROFILE_ID, createAndroidProfile, isAndroidProfile } from "../../src/mobile/android/profile.js";

// ANDROID-B1-01: Mobile and Android profile contracts accept the supported
// Android profile values and reject unsupported ones where runtime
// validation exists.
describe("mobile profile contracts — ANDROID-B1-01", () => {
  it("only declares android as a supported mobile platform", () => {
    expect(MOBILE_PLATFORMS).toEqual(["android"]);
  });

  it("creates an android profile with the canonical id and platform", () => {
    const profile = createAndroidProfile({ detectionConfidence: "high" });
    expect(profile.id).toBe(ANDROID_PROFILE_ID);
    expect(profile.platform).toBe(ANDROID_PLATFORM);
    expect(isAndroidProfile(profile)).toBe(true);
  });

  it("rejects a profile whose id does not match the canonical android identity", () => {
    const profile = createAndroidProfile({ detectionConfidence: "low" });
    const mismatched = { ...profile, id: "android-legacy-alias" };
    expect(isAndroidProfile(mismatched)).toBe(false);
  });

  it("only declares the four defined confidence levels", () => {
    expect(MOBILE_CONFIDENCE_LEVELS).toEqual(["unknown", "low", "medium", "high"]);
  });
});
