import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSecretSourceFiles } from "../../../../src/mobile/android/advancedSecurity/secretCandidates/discoverSecretSourceFiles.js";

const FIXTURES_ROOT = path.resolve("tests/fixtures/android/compose-app");

// ANDROID-V041-B4-04 — eligible file discovery.
describe("discoverSecretSourceFiles — discovery", () => {
  it("discovers eligible files deterministically", () => {
    const first = discoverSecretSourceFiles(FIXTURES_ROOT);
    const second = discoverSecretSourceFiles(FIXTURES_ROOT);
    expect(first.files.map((f) => f.relativePath)).toEqual(second.files.map((f) => f.relativePath));
    expect(first.files.length).toBeGreaterThan(0);
  });

  // ANDROID-V041-B4-06 — target containment.
  it("only returns target-contained relative paths", () => {
    const result = discoverSecretSourceFiles(FIXTURES_ROOT);
    for (const file of result.files) {
      expect(file.relativePath.startsWith("..")).toBe(false);
      expect(path.isAbsolute(file.relativePath)).toBe(false);
    }
  });

  // ANDROID-V041-B4-05 — generated directory exclusion.
  it("never returns files under .gradle/build/dist/out/reports/node_modules", () => {
    const result = discoverSecretSourceFiles(FIXTURES_ROOT);
    for (const file of result.files) {
      expect(file.relativePath).not.toMatch(/(^|\/)(\.gradle|build|dist|out|reports|node_modules)\//);
    }
  });
});

// ANDROID-V041-B4-07 — oversized file behavior.
describe("discoverSecretSourceFiles — bounded reads", () => {
  it("skips oversized files with structured skip evidence", () => {
    const oversizedRoot = path.resolve("tests/fixtures/android/advanced-security-fixtures/secret-candidates-bounds");
    const result = discoverSecretSourceFiles(oversizedRoot);
    const oversizedSkip = result.skipped.find((s) => s.relativePath.includes("oversized"));
    expect(oversizedSkip?.reason).toBe("oversized");
    expect(result.files.some((f) => f.relativePath.includes("oversized"))).toBe(false);
  });

  // ANDROID-V041-B4-08 — binary-like file behavior.
  it("skips binary-like files with structured skip evidence", () => {
    const oversizedRoot = path.resolve("tests/fixtures/android/advanced-security-fixtures/secret-candidates-bounds");
    const result = discoverSecretSourceFiles(oversizedRoot);
    const binarySkip = result.skipped.find((s) => s.relativePath.includes("binary"));
    expect(binarySkip?.reason).toBe("binary-like");
  });
});

// ANDROID-V041-B4-49 — module identity preservation.
describe("discoverSecretSourceFiles — module identity", () => {
  it("associates discovered files with the correct known module path", () => {
    const result = discoverSecretSourceFiles(FIXTURES_ROOT, ["app"]);
    const manifestFile = result.files.find((f) => f.relativePath.endsWith("AndroidManifest.xml"));
    expect(manifestFile?.modulePath).toBe("app");
  });
});
