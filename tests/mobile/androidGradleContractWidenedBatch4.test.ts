import { describe, expect, it } from "vitest";
import type { AndroidGradleMetadata, AndroidGradleModuleInfo, AndroidGradleWrapperInfo } from "../../src/mobile/android/gradle/types.js";

// Regression coverage for the narrow Batch 1/2 -> Batch 4 inherited-contract
// corrections (see agents.txt Batch 4 section 6.6): every change is additive
// (new optional fields only), so existing Batch 1 object literals must
// remain valid.
describe("AndroidGradleMetadata contract widening — Batch 4 inherited-contract regression", () => {
  it("still accepts a Batch-1-shaped wrapper/metadata literal with no new fields populated", () => {
    const wrapper: AndroidGradleWrapperInfo = { present: false };
    const module: AndroidGradleModuleInfo = {
      path: "app",
      buildTypes: [],
      sourceSetEvidence: [],
      testSourceSetEvidence: [],
      unsupportedExpressions: [],
    };
    const metadata: AndroidGradleMetadata = {
      wrapper,
      settingsFiles: [],
      rootBuildFiles: [],
      moduleBuildFiles: [],
      pluginEvidence: {},
      modules: [module],
      metadataConfidence: "unknown",
      parseWarnings: [],
      unsupportedExpressions: [],
    };
    expect(metadata.conflicts).toBeUndefined();
    expect(metadata.versionCatalogEvidence).toBeUndefined();
  });

  it("distinguishes a resolved literal from an unresolved raw expression via the Raw field pattern", () => {
    const module: AndroidGradleModuleInfo = {
      path: "app",
      buildTypes: [],
      sourceSetEvidence: [],
      testSourceSetEvidence: [],
      unsupportedExpressions: [],
      applicationId: undefined,
      applicationIdRaw: "versionFromGitTag()",
    };
    expect(module.applicationId).toBeUndefined();
    expect(module.applicationIdRaw).toBe("versionFromGitTag()");
  });

  it("supports wrapper completeness fields without claiming authenticity", () => {
    const wrapper: AndroidGradleWrapperInfo = {
      present: true,
      distributionUrl: "https://services.gradle.org/distributions/gradle-8.5-bin.zip",
      distributionType: "bin",
      checksumPropertyPresent: false,
      gradlewPresent: true,
      gradlewBatPresent: true,
    };
    expect(wrapper.distributionType).toBe("bin");
    expect(wrapper.checksumPropertyPresent).toBe(false);
  });

  it("supports a metadata conflict record with per-source evidence", () => {
    const metadata: AndroidGradleMetadata = {
      wrapper: { present: false },
      settingsFiles: [],
      rootBuildFiles: [],
      moduleBuildFiles: [],
      pluginEvidence: {},
      modules: [],
      metadataConfidence: "unknown",
      parseWarnings: [],
      unsupportedExpressions: [],
      conflicts: [
        {
          field: "applicationId",
          modulePath: "app",
          values: [
            { value: "com.example.a", sourceFile: "app/build.gradle.kts" },
            { value: "com.example.b", sourceFile: "app/build-debug.gradle" },
          ],
          note: "Conflicting applicationId assignments found for module app.",
        },
      ],
    };
    expect(metadata.conflicts).toHaveLength(1);
  });
});
