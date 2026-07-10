import { describe, expect, it } from "vitest";
import type { AndroidManifestModel, AndroidManifestComponent, AndroidIntentFilter } from "../../src/mobile/android/manifest/types.js";
import { ANDROID_CHECK_CATEGORIES } from "../../src/mobile/android/validation/checkResult.js";

// Regression coverage for the narrow Batch 2 -> Batch 3 inherited-contract
// corrections (see agents.txt Batch 3 section 6.7): every change is additive
// (new optional fields/enum members only), so existing Batch 1/2 object
// literals must remain valid and existing enum values must remain present.
describe("AndroidManifest contract widening — Batch 3 inherited-contract regression", () => {
  it("still accepts a Batch-1-shaped manifest literal with no new fields populated", () => {
    const manifest: AndroidManifestModel = {
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
    };
    expect(manifest.activityAliases).toBeUndefined();
  });

  it("accepts activity-alias as a component kind", () => {
    const alias: AndroidManifestComponent = { kind: "activity-alias", name: ".Alias", intentFilters: [] };
    expect(alias.kind).toBe("activity-alias");
  });

  it("distinguishes exported unspecified from a malformed exportedRaw value", () => {
    const malformed: AndroidManifestComponent = {
      kind: "activity",
      name: ".Weird",
      exported: undefined,
      exportedRaw: "maybe",
      intentFilters: [],
    };
    expect(malformed.exported).toBeUndefined();
    expect(malformed.exportedRaw).toBe("maybe");
  });

  it("supports multiple actions/categories/data elements on one intent filter", () => {
    const filter: AndroidIntentFilter = {
      filterData: [],
      actions: ["android.intent.action.VIEW", "android.intent.action.SEND"],
      categories: ["android.intent.category.DEFAULT", "android.intent.category.BROWSABLE"],
      dataElements: [{ dataScheme: "https", dataHost: "example.com" }],
      isDeepLinkCandidate: true,
    };
    expect(filter.actions).toHaveLength(2);
    expect(filter.categories).toHaveLength(2);
    expect(filter.dataElements).toHaveLength(1);
  });

  it("preserves permission source-element type", () => {
    const declaration = { name: "android.permission.CAMERA", sourceElement: "uses-permission" as const };
    expect(declaration.sourceElement).toBe("uses-permission");
  });

  it("adds android-intent-filters to ANDROID_CHECK_CATEGORIES while preserving all Batch 1 category values", () => {
    expect(ANDROID_CHECK_CATEGORIES).toContain("android-intent-filters");
    for (const original of [
      "android-detection",
      "android-manifest",
      "android-gradle",
      "android-permissions",
      "android-components",
      "android-deep-links",
      "android-release-metadata",
      "android-play-readiness",
    ]) {
      expect(ANDROID_CHECK_CATEGORIES).toContain(original);
    }
    expect(ANDROID_CHECK_CATEGORIES).toHaveLength(9);
  });
});
