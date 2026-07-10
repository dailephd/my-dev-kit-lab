import { describe, expect, it } from "vitest";
import type { AndroidGradleMetadata } from "../../src/mobile/android/gradle/types.js";

// ANDROID-B1-05: Gradle metadata contracts represent wrapper, module, plugin,
// SDK, build type, Compose, source-set, and unresolved dynamic-value
// evidence.
describe("android gradle metadata contract — ANDROID-B1-05", () => {
  it("represents wrapper presence, plugin evidence, and per-module SDK/Compose metadata", () => {
    const metadata: AndroidGradleMetadata = {
      wrapper: { present: true, wrapperPropertiesPath: "gradle/wrapper/gradle-wrapper.properties", versionEvidence: "gradle-8.5-bin.zip" },
      settingsFiles: ["settings.gradle.kts"],
      rootBuildFiles: ["build.gradle.kts"],
      moduleBuildFiles: ["app/build.gradle.kts"],
      pluginEvidence: {
        androidGradlePluginEvidence: "com.android.application 8.2.0",
        kotlinAndroidPluginEvidence: "org.jetbrains.kotlin.android 1.9.22",
      },
      modules: [
        {
          path: "app",
          buildFilePath: "app/build.gradle.kts",
          isApplication: true,
          namespace: "com.example.composeapp",
          applicationId: "com.example.composeapp",
          minSdk: 24,
          targetSdk: 34,
          compileSdk: 34,
          buildTypes: ["debug", "release"],
          composeEnabled: true,
          sourceSetEvidence: ["src/main"],
          testSourceSetEvidence: ["src/test", "src/androidTest"],
          unsupportedExpressions: [],
        },
      ],
      metadataConfidence: "high",
      parseWarnings: [],
      unsupportedExpressions: [],
    };

    expect(metadata.wrapper.present).toBe(true);
    expect(metadata.modules[0].composeEnabled).toBe(true);
    expect(metadata.modules[0].buildTypes).toContain("release");
  });

  it("represents unresolved dynamic Gradle expressions without failing the contract", () => {
    const metadata: AndroidGradleMetadata = {
      wrapper: { present: false },
      settingsFiles: [],
      rootBuildFiles: [],
      moduleBuildFiles: ["app/build.gradle.kts"],
      pluginEvidence: {},
      modules: [
        {
          path: "app",
          buildFilePath: "app/build.gradle.kts",
          versionName: "versionFromGitTag()",
          buildTypes: [],
          sourceSetEvidence: [],
          testSourceSetEvidence: [],
          unsupportedExpressions: ["versionName = versionFromGitTag()"],
        },
      ],
      metadataConfidence: "low",
      parseWarnings: ["Could not statically resolve versionName"],
      unsupportedExpressions: ["versionFromGitTag()"],
    };

    expect(metadata.wrapper.present).toBe(false);
    expect(metadata.modules[0].unsupportedExpressions).toHaveLength(1);
    expect(metadata.metadataConfidence).toBe("low");
  });
});
