import { describe, expect, it } from "vitest";
import type { AndroidDetectionResult } from "../../src/mobile/android/detection.js";

function baseDetection(overrides: Partial<AndroidDetectionResult> = {}): AndroidDetectionResult {
  return {
    detected: false,
    confidence: "unknown",
    evidence: [],
    projectKind: "unknown",
    uiToolkit: "uncertain",
    hasGradleWrapper: false,
    gradleSettingsFiles: [],
    rootBuildFiles: [],
    versionCatalogFiles: [],
    modules: [],
    applicationModules: [],
    libraryModules: [],
    manifestPaths: [],
    javaSourceRoots: [],
    kotlinSourceRoots: [],
    unitTestSourceRoots: [],
    instrumentedTestSourceRoots: [],
    partialOrUnsupportedStructure: false,
    warnings: [],
    ...overrides,
  };
}

// ANDROID-B1-02: Android detection result contracts can represent detected,
// partially detected, uncertain, and non-Android outcomes without treating
// uncertainty as success.
describe("android detection result contract — ANDROID-B1-02", () => {
  it("represents a confidently detected Compose application", () => {
    const result = baseDetection({
      detected: true,
      confidence: "high",
      projectKind: "application",
      uiToolkit: "compose",
      hasGradleWrapper: true,
      applicationModules: ["app"],
    });
    expect(result.detected).toBe(true);
    expect(result.uiToolkit).toBe("compose");
  });

  it("represents an uncertain/non-Android outcome as not detected", () => {
    const result = baseDetection({
      detected: false,
      confidence: "low",
      partialOrUnsupportedStructure: true,
      warnings: ["Gradle settings file found but no Android plugin evidence"],
    });
    expect(result.detected).toBe(false);
    expect(result.uiToolkit).toBe("uncertain");
    expect(result.partialOrUnsupportedStructure).toBe(true);
  });

  it("represents a partially detected project without asserting full detection", () => {
    const result = baseDetection({
      detected: true,
      confidence: "medium",
      projectKind: "application",
      partialOrUnsupportedStructure: true,
      warnings: ["No compileSdk found in module build file"],
    });
    expect(result.detected).toBe(true);
    expect(result.partialOrUnsupportedStructure).toBe(true);
    expect(result.confidence).not.toBe("high");
  });

  it("never implies detection when confidence is unknown and detected is false", () => {
    const result = baseDetection();
    expect(result.detected).toBe(false);
    expect(result.confidence).toBe("unknown");
  });
});
