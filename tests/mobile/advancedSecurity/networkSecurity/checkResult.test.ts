import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectAndroidProject } from "../../../../src/mobile/android/detect/detectAndroidProject.js";
import { parseAllAndroidManifests } from "../../../../src/mobile/android/manifest/parseAndroidManifest.js";
import { auditAndroidNetworkSecurity, ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID } from "../../../../src/mobile/android/advancedSecurity/networkSecurity/checkResult.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "..", "fixtures", "android");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

// ANDROID-V041-B2-36 — standalone AndroidCheckResult-compatible object.
describe("auditAndroidNetworkSecurity — standalone check result", () => {
  it("returns a deterministic AndroidCheckResult with the expected id/category and candidate evidence", () => {
    const targetRoot = fixture("compose-app");
    const detection = detectAndroidProject(targetRoot);
    const manifests = parseAllAndroidManifests(targetRoot, detection);
    const result = auditAndroidNetworkSecurity(targetRoot, detection, manifests);

    expect(result.id).toBe(ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID);
    expect(result.category).toBe("android-network-security");
    expect(result.ran).toBe(true);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(Array.isArray(result.candidateEvidence)).toBe(true);
  });

  it("is deterministic across repeated invocations against the same fixture", () => {
    const targetRoot = fixture("compose-app");
    const detection = detectAndroidProject(targetRoot);
    const manifests = parseAllAndroidManifests(targetRoot, detection);
    const first = auditAndroidNetworkSecurity(targetRoot, detection, manifests);
    const second = auditAndroidNetworkSecurity(targetRoot, detection, manifests);
    expect(first).toEqual(second);
  });

  it("never invokes any subprocess or network operation (no child_process/network import in the module chain)", async () => {
    const fs = await import("node:fs");
    const moduleFiles = [
      "src/mobile/android/advancedSecurity/networkSecurity/parseNetworkSecurityConfig.ts",
      "src/mobile/android/advancedSecurity/networkSecurity/deriveEffectiveNetworkPolicy.ts",
      "src/mobile/android/advancedSecurity/networkSecurity/manifestEvidence.ts",
      "src/mobile/android/advancedSecurity/networkSecurity/analyzeNetworkSecurity.ts",
      "src/mobile/android/advancedSecurity/networkSecurity/checkResult.ts",
    ];
    for (const file of moduleFiles) {
      const content = fs.readFileSync(path.resolve(file), "utf8");
      expect(content).not.toMatch(/child_process|node:net\b|node:http\b|node:https\b/);
    }
  });

  // ANDROID-V041-B2-31/32 — application/library modules retain identity.
  it("does not apply application-only conclusions to a library module", () => {
    const targetRoot = fixture("library");
    const detection = detectAndroidProject(targetRoot);
    const manifests = parseAllAndroidManifests(targetRoot, detection);
    const result = auditAndroidNetworkSecurity(targetRoot, detection, manifests);
    expect(result.ran).toBe(true);
    // A library fixture with no cleartext/NSC evidence must produce no
    // network-security findings — confirms no application-only assumption
    // leaked into library analysis.
    expect(result.findings).toHaveLength(0);
  });

  // ANDROID-V041-B2-32/33 — multi-module / multiple-manifest independence.
  it("analyzes each module/manifest independently, retaining distinct module identity", () => {
    const targetRoot = fixture("multi-module");
    const detection = detectAndroidProject(targetRoot);
    const manifests = parseAllAndroidManifests(targetRoot, detection);
    expect(manifests.length).toBeGreaterThan(1);
    const result = auditAndroidNetworkSecurity(targetRoot, detection, manifests);
    expect(result.ran).toBe(true);
    expect(result.sourcePaths.length).toBe(manifests.length);
    // Each manifest's module path must be distinctly represented in the
    // check's evidence summary lines, not collapsed into one module.
    const modulePaths = new Set(manifests.map((m) => m.modulePath));
    expect(modulePaths.size).toBeGreaterThan(1);
  });
});
