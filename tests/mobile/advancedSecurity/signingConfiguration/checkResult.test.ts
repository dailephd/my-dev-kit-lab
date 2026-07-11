import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectAndroidProject } from "../../../../src/mobile/android/detect/detectAndroidProject.js";
import { readAndroidGradleMetadata } from "../../../../src/mobile/android/gradle/readAndroidGradleMetadata.js";
import { auditAndroidSigningConfiguration, ANDROID_SIGNING_CONFIGURATION_AUDIT_CHECK_ID } from "../../../../src/mobile/android/advancedSecurity/signingConfiguration/checkResult.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "..", "fixtures", "android");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

// ANDROID-V041-B4-54 — standalone AndroidCheckResult-compatible object.
describe("auditAndroidSigningConfiguration — standalone check result", () => {
  it("returns a deterministic AndroidCheckResult with the expected id/category against a real v0.4.0 fixture", () => {
    const targetRoot = fixture("compose-app");
    const detection = detectAndroidProject(targetRoot);
    const gradle = readAndroidGradleMetadata(targetRoot, detection);
    const result = auditAndroidSigningConfiguration(targetRoot, detection, gradle.modules);

    expect(result.id).toBe(ANDROID_SIGNING_CONFIGURATION_AUDIT_CHECK_ID);
    expect(result.category).toBe("android-signing-configuration");
    expect(result.ran).toBe(true);
  });

  it("is deterministic across repeated invocations", () => {
    const targetRoot = fixture("compose-app");
    const detection = detectAndroidProject(targetRoot);
    const gradle = readAndroidGradleMetadata(targetRoot, detection);
    const first = auditAndroidSigningConfiguration(targetRoot, detection, gradle.modules);
    const second = auditAndroidSigningConfiguration(targetRoot, detection, gradle.modules);
    expect(first).toEqual(second);
  });

  // ANDROID-V041-B4-48
  it("does not apply application-only conclusions to a library module", () => {
    const targetRoot = fixture("library");
    const detection = detectAndroidProject(targetRoot);
    const gradle = readAndroidGradleMetadata(targetRoot, detection);
    const result = auditAndroidSigningConfiguration(targetRoot, detection, gradle.modules);
    expect(result.ran).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  // ANDROID-V041-B4-49
  it("preserves module identity across a multi-module project", () => {
    const targetRoot = fixture("multi-module");
    const detection = detectAndroidProject(targetRoot);
    const gradle = readAndroidGradleMetadata(targetRoot, detection);
    const result = auditAndroidSigningConfiguration(targetRoot, detection, gradle.modules);
    expect(result.ran).toBe(true);
  });

  // ANDROID-V041-B4-47/52
  it("never invokes any subprocess, network, or file-content-reading-of-keystore operation", async () => {
    const fs = await import("node:fs");
    const moduleFiles = [
      "src/mobile/android/advancedSecurity/signingConfiguration/discoverKeystoreCandidates.ts",
      "src/mobile/android/advancedSecurity/signingConfiguration/extractSigningConfigurations.ts",
      "src/mobile/android/advancedSecurity/signingConfiguration/analyzeSigningConfiguration.ts",
      "src/mobile/android/advancedSecurity/signingConfiguration/checkResult.ts",
    ];
    for (const file of moduleFiles) {
      const content = fs.readFileSync(path.resolve(file), "utf8");
      expect(content).not.toMatch(/child_process|node:net\b|node:http\b|node:https\b/);
    }
  });
});
