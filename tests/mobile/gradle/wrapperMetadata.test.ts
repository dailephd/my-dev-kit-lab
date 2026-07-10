import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseWrapperProperties } from "../../../src/mobile/android/gradle/wrapperMetadata.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android", "gradle-metadata-fixtures");

// ANDROID-B4-01: Wrapper properties parsing.
describe("parseWrapperProperties — valid wrapper — ANDROID-B4-01", () => {
  it("extracts the raw distributionUrl and a deterministic Gradle version", () => {
    const result = parseWrapperProperties(fs.readFileSync(path.join(FIXTURES_ROOT, "wrapper-with-checksum.properties"), "utf8"));
    expect(result.distributionUrl).toBe("https://services.gradle.org/distributions/gradle-8.7-all.zip");
    expect(result.gradleVersion).toBe("8.7");
    expect(result.distributionType).toBe("all");
  });
});

// ANDROID-B4-02: Wrapper metadata limitations — missing/malformed URLs and
// checksum presence represented without claiming authenticity.
describe("parseWrapperProperties — limitations — ANDROID-B4-02", () => {
  it("records checksum property presence without validating it", () => {
    const result = parseWrapperProperties(fs.readFileSync(path.join(FIXTURES_ROOT, "wrapper-with-checksum.properties"), "utf8"));
    expect(result.checksumPropertyPresent).toBe(true);
  });

  it("records checksum absence for a properties file without one", () => {
    const result = parseWrapperProperties(fs.readFileSync(path.join(FIXTURES_ROOT, "wrapper-malformed.properties"), "utf8"));
    expect(result.checksumPropertyPresent).toBe(false);
  });

  it("produces a warning and unknown distribution type for a malformed distributionUrl", () => {
    const result = parseWrapperProperties(fs.readFileSync(path.join(FIXTURES_ROOT, "wrapper-malformed.properties"), "utf8"));
    expect(result.distributionType).toBe("unknown");
    expect(result.gradleVersion).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("produces a warning when distributionUrl is missing entirely", () => {
    const result = parseWrapperProperties(fs.readFileSync(path.join(FIXTURES_ROOT, "wrapper-missing-url.properties"), "utf8"));
    expect(result.distributionUrl).toBeUndefined();
    expect(result.warnings.some((w) => w.includes("distributionUrl"))).toBe(true);
  });

  it("never claims wrapper JAR authenticity or checksum correctness in its output shape", () => {
    const result = parseWrapperProperties(fs.readFileSync(path.join(FIXTURES_ROOT, "wrapper-with-checksum.properties"), "utf8"));
    expect(result).not.toHaveProperty("authentic");
    expect(result).not.toHaveProperty("checksumValid");
  });
});
