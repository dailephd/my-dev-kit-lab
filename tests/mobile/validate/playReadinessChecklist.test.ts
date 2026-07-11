import { describe, expect, it } from "vitest";
import { buildAndroidPlayReadinessChecklist } from "../../../src/mobile/android/validate/playReadinessChecklist.js";
import type { AndroidReleaseMetadataSummary } from "../../../src/mobile/android/gradle/releaseMetadataSummary.js";
import type { AndroidManifestModel } from "../../../src/mobile/android/manifest/types.js";

function baseReleaseMetadata(overrides: Partial<AndroidReleaseMetadataSummary> = {}): AndroidReleaseMetadataSummary {
  return {
    applicationModuleSelectionNote: "Exactly one application module was detected (app).",
    buildTypes: [],
    metadataConfidence: "high",
    unresolvedFields: [],
    conflicts: [],
    ...overrides,
  };
}

function manifestWith(overrides: Partial<AndroidManifestModel> = {}): AndroidManifestModel {
  return {
    manifestPath: "app/src/main/AndroidManifest.xml",
    application: {},
    permissions: [],
    usesFeatures: [],
    activities: [],
    services: [],
    receivers: [],
    providers: [],
    deepLinks: [],
    parseWarnings: [],
    unsupportedConstructs: [],
    ...overrides,
  };
}

// ANDROID-B5-23: Play checklist application target.
describe("buildAndroidPlayReadinessChecklist — application target — ANDROID-B5-23", () => {
  it("confirms resolved fields and requires manual checks for policy placeholders", () => {
    const releaseMetadata = baseReleaseMetadata({
      applicationModulePath: "app",
      applicationId: "com.example.app",
      namespace: "com.example.app",
      versionCode: 1,
      versionName: "1.0",
      minSdk: 24,
      targetSdk: 34,
      compileSdk: 34,
    });
    const manifests = [manifestWith({ launcherActivityName: ".Main", application: { label: "App", iconRef: "@mipmap/ic" } })];
    const checklist = buildAndroidPlayReadinessChecklist({ isLibraryOnly: false, releaseMetadata, manifests });

    expect(checklist.applicable).toBe(true);
    const byId = new Map(checklist.items.map((i) => [i.id, i]));
    expect(byId.get("application-id-resolved")?.status).toBe("confirmed");
    expect(byId.get("launcher-activity-identified")?.status).toBe("confirmed");
    expect(byId.get("target-sdk-policy-check")?.status).toBe("manual-check-required");
    expect(byId.get("privacy-policy-required")?.status).toBe("manual-check-required");
  });

  it("marks unresolved fields distinctly from missing ones", () => {
    const releaseMetadata = baseReleaseMetadata({
      applicationModulePath: "app",
      unresolvedFields: ["applicationId: appIdFromProperties()"],
    });
    const checklist = buildAndroidPlayReadinessChecklist({ isLibraryOnly: false, releaseMetadata, manifests: [manifestWith()] });
    const byId = new Map(checklist.items.map((i) => [i.id, i]));
    expect(byId.get("application-id-resolved")?.status).toBe("unresolved");
  });

  it("never claims Google Play compliance was validated", () => {
    const checklist = buildAndroidPlayReadinessChecklist({ isLibraryOnly: false, releaseMetadata: baseReleaseMetadata(), manifests: [] });
    const serialized = JSON.stringify(checklist);
    expect(serialized).not.toMatch(/compliant|approved|policy compliance validated/i);
  });
});

// ANDROID-B5-24: Play checklist library target.
describe("buildAndroidPlayReadinessChecklist — library target — ANDROID-B5-24", () => {
  it("marks all application-store checklist items not applicable for a pure library", () => {
    const checklist = buildAndroidPlayReadinessChecklist({ isLibraryOnly: true, releaseMetadata: baseReleaseMetadata(), manifests: [] });
    expect(checklist.applicable).toBe(false);
    expect(checklist.items.every((i) => i.status === "not-applicable")).toBe(true);
  });

  it("does not report missing applicationId/launcher/versionCode as a failure for a library", () => {
    const checklist = buildAndroidPlayReadinessChecklist({ isLibraryOnly: true, releaseMetadata: baseReleaseMetadata(), manifests: [] });
    expect(checklist.items.some((i) => i.status === "missing")).toBe(false);
  });
});

describe("buildAndroidPlayReadinessChecklist — non-Android target", () => {
  it("marks all items not applicable and applicable=false when the target is not Android", () => {
    const checklist = buildAndroidPlayReadinessChecklist({
      isLibraryOnly: false,
      isNonAndroid: true,
      releaseMetadata: baseReleaseMetadata(),
      manifests: [],
    });
    expect(checklist.applicable).toBe(false);
    expect(checklist.items.every((i) => i.status === "not-applicable")).toBe(true);
  });
});
