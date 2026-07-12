import { describe, expect, it } from "vitest";
import { parseAndroidManifestSource, type AndroidManifestParseEntry } from "../../../../src/mobile/android/manifest/parseAndroidManifest.js";
import { analyzeApplicationReleaseConfiguration } from "../../../../src/mobile/android/advancedSecurity/releaseConfiguration/analyzeReleaseConfiguration.js";
import { ANDROID_BACKUP_RELEASE_RULE_IDS } from "../../../../src/mobile/android/advancedSecurity/ruleIds.js";
import type { AndroidGradleModuleInfo } from "../../../../src/mobile/android/gradle/types.js";

const TARGET_ROOT = "Z:/fake-target-root";

function manifestXml(applicationAttrs: string): string {
  return `<?xml version="1.0"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application ${applicationAttrs}></application></manifest>`;
}

function entry(xml: string, modulePath = "app"): AndroidManifestParseEntry {
  return {
    manifestPath: `${modulePath}/src/main/AndroidManifest.xml`,
    modulePath,
    sourceSetKind: "main",
    manifest: parseAndroidManifestSource(xml, `${modulePath}/src/main/AndroidManifest.xml`),
  };
}

function baseGradleModule(overrides: Partial<AndroidGradleModuleInfo> = {}): AndroidGradleModuleInfo {
  return {
    path: "app",
    buildFilePath: "app/build.gradle.kts",
    isApplication: true,
    buildTypes: ["debug", "release"],
    sourceSetEvidence: [],
    testSourceSetEvidence: [],
    unsupportedExpressions: [],
    ...overrides,
  };
}

// ANDROID-V041-B3-01 — inherited rule identities.
describe("analyzeApplicationReleaseConfiguration — inherited rule identities", () => {
  it("every produced finding/candidate rule id is one of the Batch 1 release rule ids", () => {
    const result = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(manifestXml(`android:debuggable="true" android:testOnly="true"`)), [
      baseGradleModule({ buildTypeDetails: [{ name: "release", debuggableState: "literal-true", minifyEnabledState: "missing", shrinkResourcesState: "missing" }] }),
    ]);
    for (const finding of result.findings) {
      expect(ANDROID_BACKUP_RELEASE_RULE_IDS).toContain(finding.id.split("--")[0]);
    }
    for (const candidate of result.candidates) {
      expect(ANDROID_BACKUP_RELEASE_RULE_IDS).toContain(candidate.ruleId);
      expect(candidate.category).toBe("android-release-configuration");
    }
  });
});

// ANDROID-V041-B3-20/21/22 — manifest debuggable.
describe("analyzeApplicationReleaseConfiguration — manifest debuggable", () => {
  it("produces a major finding for explicit true in an application module", () => {
    const result = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(manifestXml(`android:debuggable="true"`)), [baseGradleModule()]);
    const finding = result.findings.find((f) => f.id.startsWith("android-release-debuggable") && f.description.includes("manifest"));
    expect(finding?.severity).toBe("major");
  });

  it("produces no finding for explicit false", () => {
    const result = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(manifestXml(`android:debuggable="false"`)), [baseGradleModule()]);
    expect(result.findings.filter((f) => f.id.startsWith("android-release-debuggable"))).toHaveLength(0);
  });

  it("produces review candidate evidence, not a finding, for a malformed/placeholder value", () => {
    const result = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(manifestXml(`android:debuggable="\${x}"`)), [baseGradleModule()]);
    expect(result.findings).toHaveLength(0);
    expect(result.candidates.some((c) => c.ruleId === "android-release-debuggable")).toBe(true);
  });
});

// ANDROID-V041-B3-23/24 — testOnly + library module suppression.
describe("analyzeApplicationReleaseConfiguration — testOnly and library modules", () => {
  it("produces a major finding for explicit application testOnly=true", () => {
    const result = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(manifestXml(`android:testOnly="true"`)), [baseGradleModule()]);
    expect(result.findings.some((f) => f.id.startsWith("android-release-test-only"))).toBe(true);
  });

  it("downgrades debuggable=true to a candidate (not a finding) for a confirmed library module", () => {
    const libraryModule = baseGradleModule({ isApplication: undefined, isLibrary: true, buildTypeDetails: [] });
    const result = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(manifestXml(`android:debuggable="true"`), "mylibrary"), [
      { ...libraryModule, path: "mylibrary" },
    ]);
    expect(result.findings).toHaveLength(0);
    expect(result.candidates.some((c) => c.resolutionState === "not-applicable")).toBe(true);
  });
});

// ANDROID-V041-B3-25/26/27/28 — Gradle release debuggable literal/dynamic.
describe("analyzeApplicationReleaseConfiguration — Gradle release build type", () => {
  it("produces a major finding for a literal release debuggable=true", () => {
    const result = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(manifestXml(`android:label="x"`)), [
      baseGradleModule({ buildTypeDetails: [{ name: "release", debuggableState: "literal-true", debuggable: true, minifyEnabledState: "missing", shrinkResourcesState: "missing" }] }),
    ]);
    const finding = result.findings.find((f) => f.id.startsWith("android-release-debuggable") && f.description.includes("Gradle"));
    expect(finding?.severity).toBe("major");
  });

  it("produces no finding for literal release debuggable=false", () => {
    const result = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(manifestXml(`android:label="x"`)), [
      baseGradleModule({ buildTypeDetails: [{ name: "release", debuggableState: "literal-false", debuggable: false, minifyEnabledState: "missing", shrinkResourcesState: "missing" }] }),
    ]);
    expect(result.findings).toHaveLength(0);
  });

  it("produces candidate evidence, not a finding, for a dynamic release debuggable expression", () => {
    const result = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(manifestXml(`android:label="x"`)), [
      baseGradleModule({
        buildTypeDetails: [{ name: "release", debuggableState: "dynamic", debuggableRaw: "rootProject.ext.isDebug", minifyEnabledState: "missing", shrinkResourcesState: "missing" }],
      }),
    ]);
    expect(result.findings).toHaveLength(0);
    expect(result.candidates.some((c) => c.resolutionState === "unresolved")).toBe(true);
  });

  // ANDROID-V041-B3-29
  it("produces candidate evidence, not a finding, when no release build type exists", () => {
    const result = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(manifestXml(`android:label="x"`)), [baseGradleModule({ buildTypeDetails: [] })]);
    expect(result.findings).toHaveLength(0);
    expect(result.candidates.some((c) => c.ruleId === "android-release-build-type-configuration" && c.resolutionState === "missing")).toBe(true);
  });
});

// ANDROID-V041-B3-30/31/32 — minification/shrink/signingConfig metadata only.
describe("analyzeApplicationReleaseConfiguration — release-hardening metadata", () => {
  it("records minifyEnabled/shrinkResources/signingConfig as evidence text without producing a finding", () => {
    const result = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(manifestXml(`android:label="x"`)), [
      baseGradleModule({
        buildTypeDetails: [
          {
            name: "release",
            debuggableState: "literal-false",
            debuggable: false,
            minifyEnabledState: "literal-true",
            minifyEnabled: true,
            shrinkResourcesState: "literal-false",
            shrinkResources: false,
            signingConfigRef: "signingConfigs.getByName(\"release\")",
          },
        ],
      }),
    ]);
    expect(result.evidenceText.some((t) => t.includes("minifyEnabled=literal-true"))).toBe(true);
    expect(result.evidenceText.some((t) => t.includes("signingConfig=signingConfigs"))).toBe(true);
    expect(result.findings.filter((f) => f.title.toLowerCase().includes("minif"))).toHaveLength(0);
  });
});

// ANDROID-V041-B3-33/34 — manifest/Gradle correlation and conflict.
describe("analyzeApplicationReleaseConfiguration — manifest/Gradle correlation", () => {
  it("adds aligned-evidence text when both manifest and Gradle release agree on debuggable=true", () => {
    const result = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(manifestXml(`android:debuggable="true"`)), [
      baseGradleModule({ buildTypeDetails: [{ name: "release", debuggableState: "literal-true", debuggable: true, minifyEnabledState: "missing", shrinkResourcesState: "missing" }] }),
    ]);
    expect(result.evidenceText.some((t) => t.includes("aligns"))).toBe(true);
  });

  it("produces conflict candidate evidence rather than inventing a winner when sources disagree", () => {
    const result = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(manifestXml(`android:debuggable="true"`)), [
      baseGradleModule({ buildTypeDetails: [{ name: "release", debuggableState: "literal-false", debuggable: false, minifyEnabledState: "missing", shrinkResourcesState: "missing" }] }),
    ]);
    expect(result.candidates.some((c) => c.summary.includes("conflicts"))).toBe(true);
  });
});

// ANDROID-V041-B3-37/38 — determinism.
describe("analyzeApplicationReleaseConfiguration — determinism", () => {
  it("produces stable finding/candidate ids across repeated runs", () => {
    const gradleModules = [baseGradleModule({ buildTypeDetails: [{ name: "release", debuggableState: "literal-true", debuggable: true, minifyEnabledState: "missing", shrinkResourcesState: "missing" }] })];
    const xml = manifestXml(`android:debuggable="true"`);
    const first = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(xml), gradleModules);
    const second = analyzeApplicationReleaseConfiguration(TARGET_ROOT, entry(xml), gradleModules);
    expect(first.findings.map((f) => f.id)).toEqual(second.findings.map((f) => f.id));
    expect(first.candidates.map((c) => c.id)).toEqual(second.candidates.map((c) => c.id));
  });
});
