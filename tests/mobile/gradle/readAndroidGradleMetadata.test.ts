import { describe, expect, it } from "vitest";
import path from "node:path";
import { detectAndroidProject } from "../../../src/mobile/android/detect/detectAndroidProject.js";
import { readAndroidGradleMetadata } from "../../../src/mobile/android/gradle/readAndroidGradleMetadata.js";
import { buildAndroidGradleMetadataCheckResult } from "../../../src/mobile/android/gradle/gradleMetadataCheckResult.js";
import { buildAndroidReleaseMetadataSummary } from "../../../src/mobile/android/gradle/releaseMetadataSummary.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

function gradleFor(name: string) {
  const root = fixture(name);
  const detection = detectAndroidProject(root);
  return { root, detection, gradle: readAndroidGradleMetadata(root, detection) };
}

// ANDROID-B4-11: Compose Gradle metadata.
describe("readAndroidGradleMetadata — Compose metadata — ANDROID-B4-11", () => {
  it("captures buildFeatures compose evidence supporting the Batch 2 UI classification", () => {
    const { detection, gradle } = gradleFor("compose-app");
    expect(gradle.modules[0].composeEnabled).toBe(true);
    expect(detection.uiToolkit).toBe("compose");
  });
});

// ANDROID-B4-12: Source-set metadata.
describe("readAndroidGradleMetadata — source-set metadata — ANDROID-B4-12", () => {
  it("associates filesystem-derived source roots with the correct module", () => {
    const { gradle } = gradleFor("multi-module");
    const app = gradle.modules.find((m) => m.path === "app");
    expect(app?.sourceSetEvidence.every((p) => p.startsWith("app/"))).toBe(true);
    expect(app?.testSourceSetEvidence).toEqual(["app/src/androidTest", "app/src/test"]);
  });
});

// ANDROID-B4-13: Application versus library metadata association.
describe("readAndroidGradleMetadata — application vs library metadata — ANDROID-B4-13", () => {
  it("associates applicationId only with the application module, never the library", () => {
    const { gradle } = gradleFor("multi-module");
    const app = gradle.modules.find((m) => m.path === "app");
    const core = gradle.modules.find((m) => m.path === "core");
    expect(app?.applicationId).toBe("com.example.multimodule.app");
    expect(core?.applicationId).toBeUndefined();
    expect(core?.isLibrary).toBe(true);
  });

  it("does not produce a release-application summary for a pure library project", () => {
    const { detection, gradle } = gradleFor("library");
    const summary = buildAndroidReleaseMetadataSummary(detection, gradle);
    expect(summary.applicationId).toBeUndefined();
    expect(summary.applicationModulePath).toBeUndefined();
  });
});

// ANDROID-B4-14: Multi-module aggregation stays module-associated and deterministic.
describe("readAndroidGradleMetadata — multi-module aggregation — ANDROID-B4-14", () => {
  it("keeps each module's metadata independently associated", () => {
    const { gradle } = gradleFor("multi-module");
    expect(gradle.modules.map((m) => m.path)).toEqual(["app", "core", "feature-login"]);
    expect(gradle.modules.every((m) => m.namespace?.startsWith("com.example.multimodule"))).toBe(true);
  });

  it("produces identical output across repeated runs", () => {
    const first = JSON.stringify(gradleFor("multi-module").gradle);
    const second = JSON.stringify(gradleFor("multi-module").gradle);
    expect(first).toBe(second);
  });
});

// ANDROID-B4-15: Metadata conflicts.
describe("readAndroidGradleMetadata — metadata conflicts — ANDROID-B4-15", () => {
  it("does not report a conflict when application modules agree", () => {
    const { gradle } = gradleFor("multi-module");
    expect(gradle.conflicts).toBeUndefined();
  });
});

// ANDROID-B4-16: Partial project handling.
describe("readAndroidGradleMetadata — partial project — ANDROID-B4-16", () => {
  it("produces partial results and does not crash on the incomplete fixture", () => {
    expect(() => gradleFor("partial")).not.toThrow();
    const { gradle } = gradleFor("partial");
    expect(gradle.modules[0].namespace).toBe("com.example.partial");
    expect(gradle.modules[0].applicationId).toBeUndefined();
    expect(gradle.wrapper.present).toBe(false);
  });
});

// ANDROID-B4-17: Non-Android Gradle negative control.
describe("readAndroidGradleMetadata — non-Android negative control — ANDROID-B4-17", () => {
  it("does not extract Android application metadata for a generic Gradle project", () => {
    const { gradle } = gradleFor("non-android-gradle");
    expect(gradle.modules.every((m) => !m.isApplication && !m.applicationId && !m.namespace)).toBe(true);
  });
});

// ANDROID-B4-18: Static metadata check status — never passed for unsupported/inconclusive cases.
describe("buildAndroidGradleMetadataCheckResult — status semantics — ANDROID-B4-18", () => {
  it("reports 'unsupported' for a non-Android target, never 'passed'", () => {
    const { detection, gradle } = gradleFor("non-android-gradle");
    const result = buildAndroidGradleMetadataCheckResult(detection, gradle);
    expect(result.status).toBe("unsupported");
    expect(result.status).not.toBe("passed");
  });

  it("reports 'passed' for a fully resolved Compose application", () => {
    const { detection, gradle } = gradleFor("compose-app");
    const result = buildAndroidGradleMetadataCheckResult(detection, gradle);
    expect(result.status).toBe("passed");
  });

  it("reports 'inconclusive' (never 'passed') when no metadata could be resolved despite Android detection", () => {
    const { detection, gradle } = gradleFor("compose-app");
    const emptyGradle = { ...gradle, modules: gradle.modules.map((m) => ({ ...m, namespace: undefined, applicationId: undefined, minSdk: undefined, targetSdk: undefined, compileSdk: undefined, versionCode: undefined, versionName: undefined })) };
    const result = buildAndroidGradleMetadataCheckResult(detection, emptyGradle);
    expect(result.status).toBe("inconclusive");
  });
});

// ANDROID-B4-38 / B4-39: Release metadata summary — presence and Play-policy silence.
describe("buildAndroidReleaseMetadataSummary — release metadata — ANDROID-B4-38", () => {
  it("preserves applicationId, version, SDK, plugin, and wrapper fields for a single application module", () => {
    const { detection, gradle } = gradleFor("compose-app");
    const summary = buildAndroidReleaseMetadataSummary(detection, gradle);
    expect(summary.applicationModulePath).toBe("app");
    expect(summary.applicationId).toBe("com.example.composeapp");
    expect(summary.versionCode).toBe("1");
    expect(summary.versionName).toBe("1.0");
    expect(summary.minSdk).toBe("24");
    expect(summary.targetSdk).toBe("34");
    expect(summary.compileSdk).toBe("34");
    expect(summary.androidGradlePluginVersion).toBe("8.2.0");
    expect(summary.wrapperGradleVersion).toBe("8.5");
  });

  it("does not select a primary application module when multiple exist", () => {
    const { detection, gradle } = gradleFor("compose-app");
    const twoAppDetection = { ...detection, applicationModules: ["app", "app2"] };
    const summary = buildAndroidReleaseMetadataSummary(twoAppDetection, gradle);
    expect(summary.applicationModulePath).toBeUndefined();
    expect(summary.applicationModuleSelectionNote).toContain("2 application modules");
  });
});

describe("buildAndroidReleaseMetadataSummary — no Play-policy claims — ANDROID-B4-39", () => {
  it("never includes a Play-readiness or policy-compliance field", () => {
    const { detection, gradle } = gradleFor("compose-app");
    const summary = buildAndroidReleaseMetadataSummary(detection, gradle);
    expect(summary).not.toHaveProperty("playReady");
    expect(summary).not.toHaveProperty("policyCompliant");
    expect(summary).not.toHaveProperty("targetSdkCurrent");
  });
});

// ANDROID-B4-40: Deterministic static output.
describe("readAndroidGradleMetadata — deterministic output — ANDROID-B4-40", () => {
  it("produces equivalent normalized output for repeated parses", () => {
    const first = JSON.stringify(gradleFor("compose-app").gradle);
    const second = JSON.stringify(gradleFor("compose-app").gradle);
    expect(first).toBe(second);
  });
});

// ANDROID-B4-41: Batch 2 detection compatibility.
describe("readAndroidGradleMetadata — Batch 2 detector compatibility — ANDROID-B4-41", () => {
  it("does not change the Batch 2 detection result it was derived from", () => {
    const root = fixture("multi-module");
    const before = detectAndroidProject(root);
    readAndroidGradleMetadata(root, before);
    const after = detectAndroidProject(root);
    expect(after).toEqual(before);
  });
});
