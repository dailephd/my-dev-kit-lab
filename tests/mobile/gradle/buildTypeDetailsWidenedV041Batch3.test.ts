import { describe, expect, it } from "vitest";
import { extractModuleGradleMetadata } from "../../../src/mobile/android/gradle/moduleMetadataExtractor.js";

// v0.4.1 Batch 3 narrow inherited-contract widening: AndroidGradleModuleInfo
// gained optional buildTypeDetails (per-build-type literal evidence);
// existing buildTypes: string[] is unchanged. Regression-tested per
// agents.txt Batch 3 section 6.
describe("extractModuleGradleMetadata — buildTypeDetails widening (Groovy)", () => {
  it("extracts literal debuggable=true/minifyEnabled=false for a release build type", () => {
    const text = `
android {
  buildTypes {
    release {
      debuggable false
      minifyEnabled true
      shrinkResources true
      signingConfig signingConfigs.release
    }
    debug {
      debuggable true
    }
  }
}`;
    const { info } = extractModuleGradleMetadata(text);
    const release = info.buildTypeDetails?.find((b) => b.name === "release");
    expect(release?.debuggable).toBe(false);
    expect(release?.debuggableState).toBe("literal-false");
    expect(release?.minifyEnabled).toBe(true);
    expect(release?.minifyEnabledState).toBe("literal-true");
    expect(release?.shrinkResources).toBe(true);
    expect(release?.signingConfigRef).toContain("signingConfigs.release");

    const debug = info.buildTypeDetails?.find((b) => b.name === "debug");
    expect(debug?.debuggable).toBe(true);
  });

  it("still returns build-type names unchanged in the existing buildTypes field", () => {
    const text = `android { buildTypes { release { debuggable false } debug { debuggable true } } }`;
    const { info } = extractModuleGradleMetadata(text);
    expect(info.buildTypes).toEqual(["debug", "release"]);
  });

  it("classifies a dynamic/unresolved debuggable expression distinctly from a literal", () => {
    const text = `android { buildTypes { release { debuggable rootProject.ext.isDebug } } }`;
    const { info } = extractModuleGradleMetadata(text);
    const release = info.buildTypeDetails?.find((b) => b.name === "release");
    expect(release?.debuggableState).toBe("dynamic");
    expect(release?.debuggable).toBeUndefined();
    expect(release?.debuggableRaw).toContain("rootProject");
  });

  it("classifies a missing field as missing, not false", () => {
    const text = `android { buildTypes { release { minifyEnabled true } } }`;
    const { info } = extractModuleGradleMetadata(text);
    const release = info.buildTypeDetails?.find((b) => b.name === "release");
    expect(release?.debuggableState).toBe("missing");
    expect(release?.debuggable).toBeUndefined();
  });

  it("returns an empty buildTypeDetails array when there is no buildTypes block", () => {
    const text = `android { namespace "com.example" }`;
    const { info } = extractModuleGradleMetadata(text);
    expect(info.buildTypeDetails).toEqual([]);
  });
});

describe("extractModuleGradleMetadata — buildTypeDetails widening (Kotlin DSL)", () => {
  it("extracts literal isDebuggable/isMinifyEnabled for getByName(\"release\")", () => {
    const text = `
android {
  buildTypes {
    getByName("release") {
      isDebuggable = false
      isMinifyEnabled = true
      isShrinkResources = true
      signingConfig = signingConfigs.getByName("release")
    }
  }
}`;
    const { info } = extractModuleGradleMetadata(text);
    const release = info.buildTypeDetails?.find((b) => b.name === "release");
    expect(release?.debuggable).toBe(false);
    expect(release?.minifyEnabled).toBe(true);
    expect(release?.shrinkResources).toBe(true);
    expect(release?.signingConfigRef).toContain("signingConfigs.getByName");
  });

  it("extracts literal evidence for create(\"release\")", () => {
    const text = `android { buildTypes { create("release") { isDebuggable = false } } }`;
    const { info } = extractModuleGradleMetadata(text);
    expect(info.buildTypeDetails?.find((b) => b.name === "release")?.debuggable).toBe(false);
  });
});
