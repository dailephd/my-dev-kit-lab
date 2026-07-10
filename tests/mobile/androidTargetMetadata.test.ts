import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveLocalProjectTarget } from "../../src/core/localProjectTarget.js";
import { createAndroidProfile } from "../../src/mobile/android/profile.js";
import { createAndroidTargetMetadata } from "../../src/mobile/android/targetMetadata.js";
import type { AndroidDetectionResult } from "../../src/mobile/android/detection.js";

const TOOL_ROOT = path.resolve(__dirname, "..", "..");
const COMPOSE_APP_FIXTURE = path.resolve(__dirname, "..", "fixtures", "android", "compose-app");

function detectionFor(overrides: Partial<AndroidDetectionResult> = {}): AndroidDetectionResult {
  return {
    detected: true,
    confidence: "high",
    evidence: ["com.android.application plugin found in app/build.gradle.kts"],
    projectKind: "application",
    uiToolkit: "compose",
    hasGradleWrapper: true,
    gradleSettingsFiles: ["settings.gradle.kts"],
    rootBuildFiles: ["build.gradle.kts"],
    versionCatalogFiles: [],
    modules: [{ path: "app", kind: "application", manifestPaths: ["app/src/main/AndroidManifest.xml"] }],
    applicationModules: ["app"],
    libraryModules: [],
    manifestPaths: ["app/src/main/AndroidManifest.xml"],
    javaSourceRoots: [],
    kotlinSourceRoots: ["app/src/main/java"],
    unitTestSourceRoots: [],
    instrumentedTestSourceRoots: [],
    partialOrUnsupportedStructure: false,
    warnings: [],
    ...overrides,
  };
}

// ANDROID-B1-03: Android target metadata composes existing local-project
// target metadata instead of losing tool-root/target-root separation.
describe("android target metadata composition — ANDROID-B1-03", () => {
  it("composes LocalProjectTargetMetadata under `local` without redefining tool/target roots", () => {
    const local = resolveLocalProjectTarget(COMPOSE_APP_FIXTURE, TOOL_ROOT);
    const profile = createAndroidProfile({ detectionConfidence: "high" });
    const detection = detectionFor();

    const metadata = createAndroidTargetMetadata({ local, androidProfile: profile, detection });

    expect(metadata.local.toolRoot).toBe(path.resolve(TOOL_ROOT));
    expect(metadata.local.targetRoot).toBe(path.resolve(COMPOSE_APP_FIXTURE));
    expect(metadata.local.isSelf).toBe(false);
  });

  it("does not confuse the lab repository with an external Android target", () => {
    const local = resolveLocalProjectTarget(COMPOSE_APP_FIXTURE, TOOL_ROOT);
    expect(local.targetRoot).not.toBe(local.toolRoot);

    const selfLocal = resolveLocalProjectTarget(undefined, TOOL_ROOT);
    expect(selfLocal.isSelf).toBe(true);
  });

  it("derives classification and module lists from the detection result", () => {
    const local = resolveLocalProjectTarget(COMPOSE_APP_FIXTURE, TOOL_ROOT);
    const profile = createAndroidProfile({ detectionConfidence: "high" });
    const detection = detectionFor();

    const metadata = createAndroidTargetMetadata({ local, androidProfile: profile, detection });

    expect(metadata.classification).toEqual({ projectKind: "application", uiToolkit: "compose" });
    expect(metadata.applicationModules).toEqual(["app"]);
    expect(metadata.manifestPaths).toEqual(["app/src/main/AndroidManifest.xml"]);
  });

  it("fills environment capability and release metadata placeholders when not supplied", () => {
    const local = resolveLocalProjectTarget(COMPOSE_APP_FIXTURE, TOOL_ROOT);
    const profile = createAndroidProfile({ detectionConfidence: "high" });
    const detection = detectionFor();

    const metadata = createAndroidTargetMetadata({ local, androidProfile: profile, detection });

    expect(metadata.releaseMetadata.available).toBe(false);
    expect(metadata.environmentCapabilities.gradleAvailable).toBe("unknown");
    expect(metadata.environmentCapabilities.androidSdkAvailable).toBe("unknown");
  });
});
