import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractModuleGradleMetadata } from "../../../../src/mobile/android/gradle/moduleMetadataExtractor.js";
import { detectAndroidProject } from "../../../../src/mobile/android/detect/detectAndroidProject.js";
import { parseAllAndroidManifests } from "../../../../src/mobile/android/manifest/parseAndroidManifest.js";
import { readAndroidGradleMetadata } from "../../../../src/mobile/android/gradle/readAndroidGradleMetadata.js";
import { auditAndroidReleaseConfiguration, ANDROID_RELEASE_CONFIGURATION_AUDIT_CHECK_ID } from "../../../../src/mobile/android/advancedSecurity/releaseConfiguration/checkResult.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "..", "fixtures", "android");
const RELEASE_FIXTURES_ROOT = path.join(FIXTURES_ROOT, "advanced-security-fixtures", "release-configuration");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

function readReleaseFixture(name: string): string {
  return fs.readFileSync(path.join(RELEASE_FIXTURES_ROOT, name), "utf8");
}

// ANDROID-V041-B3-25/27 — Groovy release build-type fixture extraction.
describe("release-configuration fixtures — Groovy extraction", () => {
  it("extracts literal debuggable=true/minifyEnabled/shrinkResources/signingConfig", () => {
    const { info } = extractModuleGradleMetadata(readReleaseFixture("groovy-release-debuggable-true.gradle"));
    const release = info.buildTypeDetails?.find((b) => b.name === "release");
    expect(release?.debuggable).toBe(true);
    expect(release?.minifyEnabled).toBe(true);
    expect(release?.shrinkResources).toBe(true);
    expect(release?.signingConfigRef).toContain("signingConfigs.release");
  });

  it("extracts literal debuggable=false", () => {
    const { info } = extractModuleGradleMetadata(readReleaseFixture("groovy-release-debuggable-false.gradle"));
    expect(info.buildTypeDetails?.find((b) => b.name === "release")?.debuggable).toBe(false);
  });

  // ANDROID-V041-B3-28
  it("classifies a dynamic release debuggable expression distinctly from a literal", () => {
    const { info } = extractModuleGradleMetadata(readReleaseFixture("groovy-release-debuggable-dynamic.gradle"));
    const release = info.buildTypeDetails?.find((b) => b.name === "release");
    expect(release?.debuggableState).toBe("dynamic");
    expect(release?.debuggable).toBeUndefined();
  });
});

// ANDROID-V041-B3-26 — Kotlin DSL release build-type fixture extraction.
describe("release-configuration fixtures — Kotlin DSL extraction", () => {
  it("extracts literal isDebuggable=true/isMinifyEnabled/isShrinkResources/signingConfig", () => {
    const { info } = extractModuleGradleMetadata(readReleaseFixture("kotlin-release-debuggable-true.gradle.kts"));
    const release = info.buildTypeDetails?.find((b) => b.name === "release");
    expect(release?.debuggable).toBe(true);
    expect(release?.minifyEnabled).toBe(true);
    expect(release?.shrinkResources).toBe(true);
    expect(release?.signingConfigRef).toContain("signingConfigs.getByName");
  });

  it("extracts literal isDebuggable=false", () => {
    const { info } = extractModuleGradleMetadata(readReleaseFixture("kotlin-release-debuggable-false.gradle.kts"));
    expect(info.buildTypeDetails?.find((b) => b.name === "release")?.debuggable).toBe(false);
  });

  // ANDROID-V041-B3-29
  it("finds no release build type when only debug is declared", () => {
    const { info } = extractModuleGradleMetadata(readReleaseFixture("missing-release-build-type.gradle.kts"));
    expect(info.buildTypeDetails?.some((b) => b.name === "release")).toBe(false);
  });
});

// ANDROID-V041-B3-42 — standalone AndroidCheckResult-compatible object.
describe("auditAndroidReleaseConfiguration — standalone check result", () => {
  it("returns a deterministic AndroidCheckResult with the expected id/category", () => {
    const targetRoot = fixture("compose-app");
    const detection = detectAndroidProject(targetRoot);
    const manifests = parseAllAndroidManifests(targetRoot, detection);
    const gradle = readAndroidGradleMetadata(targetRoot, detection);
    const result = auditAndroidReleaseConfiguration(targetRoot, detection, manifests, gradle.modules);

    expect(result.id).toBe(ANDROID_RELEASE_CONFIGURATION_AUDIT_CHECK_ID);
    expect(result.category).toBe("android-release-configuration");
    expect(result.ran).toBe(true);
  });

  it("is deterministic across repeated invocations", () => {
    const targetRoot = fixture("compose-app");
    const detection = detectAndroidProject(targetRoot);
    const manifests = parseAllAndroidManifests(targetRoot, detection);
    const gradle = readAndroidGradleMetadata(targetRoot, detection);
    const first = auditAndroidReleaseConfiguration(targetRoot, detection, manifests, gradle.modules);
    const second = auditAndroidReleaseConfiguration(targetRoot, detection, manifests, gradle.modules);
    expect(first).toEqual(second);
  });

  it("does not apply application-only conclusions to a library module", () => {
    const targetRoot = fixture("library");
    const detection = detectAndroidProject(targetRoot);
    const manifests = parseAllAndroidManifests(targetRoot, detection);
    const gradle = readAndroidGradleMetadata(targetRoot, detection);
    const result = auditAndroidReleaseConfiguration(targetRoot, detection, manifests, gradle.modules);
    expect(result.ran).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  // ANDROID-V041-B3-35
  it("preserves module identity across a multi-module project without arbitrary selection", () => {
    const targetRoot = fixture("multi-module");
    const detection = detectAndroidProject(targetRoot);
    const manifests = parseAllAndroidManifests(targetRoot, detection);
    const gradle = readAndroidGradleMetadata(targetRoot, detection);
    const result = auditAndroidReleaseConfiguration(targetRoot, detection, manifests, gradle.modules);
    expect(result.ran).toBe(true);
    expect(result.sourcePaths.length).toBe(manifests.length);
  });
});
