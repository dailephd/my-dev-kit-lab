import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractModuleGradleMetadata } from "../../../src/mobile/android/gradle/moduleMetadataExtractor.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android", "gradle-metadata-fixtures");

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_ROOT, name), "utf8");
}

// ANDROID-B4-03: Groovy literal metadata.
describe("extractModuleGradleMetadata — Groovy literal forms — ANDROID-B4-03", () => {
  it("extracts namespace, applicationId, version, and SDK fields from Groovy DSL", () => {
    const result = extractModuleGradleMetadata(readFixture("groovy-literal.gradle"));
    expect(result.info.namespace).toBe("com.example.groovyliteral");
    expect(result.info.applicationId).toBe("com.example.groovyliteral");
    expect(result.info.versionCode).toBe("2");
    expect(result.info.versionName).toBe("2.0");
    expect(result.info.minSdk).toBe("21");
    expect(result.info.targetSdk).toBe("33");
    expect(result.info.compileSdk).toBe("33");
  });

  it("extracts custom build-type names alongside debug and release", () => {
    const result = extractModuleGradleMetadata(readFixture("groovy-literal.gradle"));
    expect(result.info.buildTypes).toEqual(["debug", "release", "staging"]);
  });
});

// ANDROID-B4-04: Kotlin DSL literal metadata (compose-app fixture already
// uses Kotlin DSL `=` assignment forms).
describe("extractModuleGradleMetadata — Kotlin DSL literal forms — ANDROID-B4-04", () => {
  it("extracts namespace, applicationId, version, and SDK fields from Kotlin DSL", () => {
    const composeAppBuildFile = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "fixtures", "android", "compose-app", "app", "build.gradle.kts"),
      "utf8"
    );
    const result = extractModuleGradleMetadata(composeAppBuildFile);
    expect(result.info.namespace).toBe("com.example.composeapp");
    expect(result.info.applicationId).toBe("com.example.composeapp");
    expect(result.info.versionCode).toBe("1");
    expect(result.info.versionName).toBe("1.0");
    expect(result.info.minSdk).toBe("24");
    expect(result.info.targetSdk).toBe("34");
    expect(result.info.compileSdk).toBe("34");
    expect(result.info.composeEnabled).toBe(true);
  });
});

// ANDROID-B4-05: Comment and unrelated-string safety.
describe("extractModuleGradleMetadata — comment/string safety — ANDROID-B4-05", () => {
  it("does not extract a commented-out assignment", () => {
    const result = extractModuleGradleMetadata(readFixture("comment-safety.gradle.kts"));
    expect(result.info.applicationId).toBe("com.example.commentsafety");
    expect(result.info.applicationIdRaw).toBeUndefined();
  });

  it("does not treat the key name appearing inside an unrelated string as an assignment", () => {
    const result = extractModuleGradleMetadata(readFixture("comment-safety.gradle.kts"));
    // The real assignment further down the file must win; no raw/unresolved
    // artifact should be produced from the prose string mentioning the key.
    expect(result.info.applicationId).toBe("com.example.commentsafety");
    expect(result.info.unsupportedExpressions.some((e) => e.includes("field below"))).toBe(false);
  });
});

// ANDROID-B4-06: Dynamic expression preservation.
describe("extractModuleGradleMetadata — dynamic expressions — ANDROID-B4-06", () => {
  it("preserves function calls, variables, and property references as unresolved raw expressions", () => {
    const result = extractModuleGradleMetadata(readFixture("dynamic-values.gradle.kts"));
    expect(result.info.applicationId).toBeUndefined();
    expect(result.info.applicationIdRaw).toBe("appIdFromProperties()");
    expect(result.info.versionName).toBeUndefined();
    expect(result.info.versionNameRaw).toBe("gitVersionName");
    expect(result.info.targetSdk).toBeUndefined();
    expect(result.info.targetSdkRaw).toContain("project.property");
    expect(result.info.compileSdk).toBeUndefined();
    expect(result.info.compileSdkRaw).toContain("libs.versions.compileSdk");
  });

  it("does not fabricate a resolved value for any unresolved field", () => {
    const result = extractModuleGradleMetadata(readFixture("dynamic-values.gradle.kts"));
    for (const field of [result.info.applicationId, result.info.versionName, result.info.targetSdk, result.info.compileSdk]) {
      expect(field).toBeUndefined();
    }
  });

  it("still resolves the one directly-literal field (minSdk) in the same file", () => {
    const result = extractModuleGradleMetadata(readFixture("dynamic-values.gradle.kts"));
    expect(result.info.minSdk).toBe("24");
  });
});

// ANDROID-B4-10: Build-type extraction.
describe("extractModuleGradleMetadata — build-type extraction — ANDROID-B4-10", () => {
  it("extracts debug/release/custom build-type names deterministically", () => {
    const result = extractModuleGradleMetadata(readFixture("groovy-literal.gradle"));
    const sorted = [...result.info.buildTypes].sort((a, b) => a.localeCompare(b));
    expect(result.info.buildTypes).toEqual(sorted);
  });

  it("returns an empty build-type list when no buildTypes block exists", () => {
    const result = extractModuleGradleMetadata(readFixture("dynamic-values.gradle.kts"));
    expect(result.info.buildTypes).toEqual([]);
  });
});
