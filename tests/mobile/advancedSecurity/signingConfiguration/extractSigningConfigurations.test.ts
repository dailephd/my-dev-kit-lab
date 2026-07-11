import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractSigningConfigurations } from "../../../../src/mobile/android/advancedSecurity/signingConfiguration/extractSigningConfigurations.js";

const FIXTURES_ROOT = path.resolve("tests/fixtures/android/advanced-security-fixtures/secret-candidates");

// ANDROID-V041-B4-30 — Groovy signing config literal extraction (existing Batch 1 fixture).
describe("extractSigningConfigurations — Groovy (existing fixture)", () => {
  it("classifies storeFile/storePassword/keyAlias/keyPassword from the Batch 1 build.gradle fixture", () => {
    const text = fs.readFileSync(path.join(FIXTURES_ROOT, "build.gradle"), "utf8");
    const configs = extractSigningConfigurations(text);
    expect(configs).toHaveLength(1);
    const release = configs[0];
    expect(release.name).toBe("release");
    expect(release.storeFile).toEqual({ state: "literal", literalValue: "fake-release-keystore.jks" });
    expect(release.storePassword.state).toBe("literal");
    expect(release.storePassword.redactedPreview).toBeDefined();
    expect(release.storePassword.fingerprint).toBeDefined();
    expect(release.keyAlias).toEqual({ state: "literal", literalValue: "fake-release-key" });
    expect(release.keyPassword.state).toBe("literal");
  });

  it("never includes the raw storePassword/keyPassword literal anywhere in the returned object", () => {
    const text = fs.readFileSync(path.join(FIXTURES_ROOT, "build.gradle"), "utf8");
    const configs = extractSigningConfigurations(text);
    const serialized = JSON.stringify(configs);
    expect(serialized).not.toContain("FAKE-KEYSTORE-PASSWORD-0000");
    expect(serialized).not.toContain("FAKE-KEY-PASSWORD-0000");
  });
});

// ANDROID-V041-B4-31 — Kotlin DSL signing config literal extraction (existing Batch 1 fixture).
describe("extractSigningConfigurations — Kotlin DSL (existing fixture)", () => {
  it("classifies storeFile/storePassword/keyAlias/keyPassword from the Batch 1 build.gradle.kts fixture", () => {
    const text = fs.readFileSync(path.join(FIXTURES_ROOT, "build.gradle.kts"), "utf8");
    const configs = extractSigningConfigurations(text);
    expect(configs).toHaveLength(1);
    const release = configs.find((c) => c.name === "release")!;
    expect(release.storeFile.state).toBe("literal");
    expect(release.storeFile.literalValue).toBe("fake-release-keystore.jks");
    expect(release.storePassword.state).toBe("literal");
    expect(release.keyPassword.state).toBe("literal");
  });
});

describe("extractSigningConfigurations — expression classification", () => {
  it("classifies System.getenv as environment-reference, never a literal", () => {
    const configs = extractSigningConfigurations(
      `android { signingConfigs { release { storePassword System.getenv("STORE_PASSWORD") } } }`
    );
    expect(configs[0].storePassword.state).toBe("environment-reference");
    expect(configs[0].storePassword.redactedPreview).toBeUndefined();
    expect(configs[0].storePassword.fingerprint).toBeUndefined();
  });

  it("classifies a Gradle property lookup as gradle-property-reference", () => {
    const configs = extractSigningConfigurations(
      `android { signingConfigs { release { storePassword project.findProperty("storePassword") } } }`
    );
    expect(configs[0].storePassword.state).toBe("gradle-property-reference");
  });

  it("classifies a bare variable reference distinctly from a literal", () => {
    const configs = extractSigningConfigurations(`android { signingConfigs { release { storePassword storePasswordVar } } }`);
    expect(configs[0].storePassword.state).toBe("variable-reference");
  });

  it("reports missing when a field is absent", () => {
    const configs = extractSigningConfigurations(`android { signingConfigs { release { keyAlias "fake-alias" } } }`);
    expect(configs[0].storePassword.state).toBe("missing");
  });

  it("classifies enableV1Signing/V2/V3/V4 literal booleans", () => {
    const configs = extractSigningConfigurations(
      `android { signingConfigs { release { enableV1Signing true\nenableV2Signing false } } }`
    );
    expect(configs[0].enableV1Signing).toBe(true);
    expect(configs[0].enableV2Signing).toBe(false);
  });

  it("returns an empty array when there is no signingConfigs block", () => {
    expect(extractSigningConfigurations(`android { namespace "com.example" }`)).toEqual([]);
  });
});
