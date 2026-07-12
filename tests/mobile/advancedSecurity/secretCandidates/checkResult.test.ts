import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectAndroidProject } from "../../../../src/mobile/android/detect/detectAndroidProject.js";
import { auditAndroidSecretCandidates, ANDROID_SECRET_CANDIDATES_AUDIT_CHECK_ID } from "../../../../src/mobile/android/advancedSecurity/secretCandidates/checkResult.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "..", "fixtures", "android");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

// ANDROID-V041-B4-53 — standalone AndroidCheckResult-compatible object.
describe("auditAndroidSecretCandidates — standalone check result", () => {
  it("returns a deterministic AndroidCheckResult with the expected id/category", () => {
    const targetRoot = fixture("compose-app");
    const detection = detectAndroidProject(targetRoot);
    const result = auditAndroidSecretCandidates(targetRoot, detection);

    expect(result.id).toBe(ANDROID_SECRET_CANDIDATES_AUDIT_CHECK_ID);
    expect(result.category).toBe("android-secret-candidates");
    expect(result.ran).toBe(true);
  });

  it("is deterministic across repeated invocations", () => {
    const targetRoot = fixture("compose-app");
    const detection = detectAndroidProject(targetRoot);
    const first = auditAndroidSecretCandidates(targetRoot, detection);
    const second = auditAndroidSecretCandidates(targetRoot, detection);
    expect(first).toEqual(second);
  });

  it("produces a real finding against the dedicated secret-candidate fixtures", () => {
    const targetRoot = fixture("advanced-security-fixtures/secret-candidates");
    const detection = { ...detectAndroidProject(targetRoot), projectKind: "application" as const };
    const result = auditAndroidSecretCandidates(targetRoot, detection);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("never invokes any subprocess or network operation", async () => {
    const fs = await import("node:fs");
    const moduleFiles = [
      "src/mobile/android/advancedSecurity/secretCandidates/discoverSecretSourceFiles.ts",
      "src/mobile/android/advancedSecurity/secretCandidates/matchSecretCandidates.ts",
      "src/mobile/android/advancedSecurity/secretCandidates/analyzeSecretCandidates.ts",
      "src/mobile/android/advancedSecurity/secretCandidates/checkResult.ts",
    ];
    for (const file of moduleFiles) {
      const content = fs.readFileSync(path.resolve(file), "utf8");
      expect(content).not.toMatch(/child_process|node:net\b|node:http\b|node:https\b/);
    }
  });
});
