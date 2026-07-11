import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAndroidManifestSource, type AndroidManifestParseEntry } from "../../../../src/mobile/android/manifest/parseAndroidManifest.js";
import { extractManifestNetworkSecurityEvidence } from "../../../../src/mobile/android/advancedSecurity/networkSecurity/manifestEvidence.js";
import { analyzeManifestNetworkSecurity } from "../../../../src/mobile/android/advancedSecurity/networkSecurity/analyzeNetworkSecurity.js";

const FIXTURES_ROOT = path.resolve("tests/fixtures/android/advanced-security-fixtures/network-security");

function manifestXml(applicationAttrs: string): string {
  return `<?xml version="1.0"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application ${applicationAttrs}></application></manifest>`;
}

function entry(xml: string, modulePath = "module-a"): AndroidManifestParseEntry {
  return {
    manifestPath: `${modulePath}/src/main/AndroidManifest.xml`,
    modulePath,
    sourceSetKind: "main",
    manifest: parseAndroidManifestSource(xml, `${modulePath}/src/main/AndroidManifest.xml`),
  };
}

// ANDROID-V041-B2-30/40 — target containment remains valid when the Batch 1
// resolver is consumed through Batch 2's manifest-evidence and analysis
// layers (not just when called directly, as Batch 1's own tests cover).
describe("Batch 2 target containment (cross-layer)", () => {
  it("a traversal-shaped resource name never resolves outside the target root", () => {
    const evidence = extractManifestNetworkSecurityEvidence(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/../../../../etc/passwd"`)));
    expect(evidence.networkSecurityConfig.state).toBe("malformed");
  });

  it("a modulePath outside the target root throws rather than silently resolving", () => {
    const outsideEntry: AndroidManifestParseEntry = {
      manifestPath: "AndroidManifest.xml",
      modulePath: path.relative(FIXTURES_ROOT, path.resolve("..")),
      sourceSetKind: "main",
      manifest: parseAndroidManifestSource(manifestXml(`android:networkSecurityConfig="@xml/network_security_config"`), "AndroidManifest.xml"),
    };
    expect(() => extractManifestNetworkSecurityEvidence(FIXTURES_ROOT, outsideEntry)).toThrow();
  });

  it("analyzeManifestNetworkSecurity never throws for an adversarial reference and produces bounded, contained evidence", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/..%2f..%2fetc%2fpasswd"`)));
    expect(result.candidates.every((c) => !c.location.path.includes(".."))).toBe(true);
  });
});
