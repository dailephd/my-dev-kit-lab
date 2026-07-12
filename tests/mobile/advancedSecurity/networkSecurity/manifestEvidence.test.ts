import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAndroidManifestSource, type AndroidManifestParseEntry } from "../../../../src/mobile/android/manifest/parseAndroidManifest.js";
import { extractManifestNetworkSecurityEvidence } from "../../../../src/mobile/android/advancedSecurity/networkSecurity/manifestEvidence.js";

const FIXTURES_ROOT = path.resolve("tests/fixtures/android/advanced-security-fixtures/network-security");

function entry(xml: string, options: { modulePath?: string; sourceSetKind?: AndroidManifestParseEntry["sourceSetKind"] } = {}): AndroidManifestParseEntry {
  return {
    manifestPath: `${options.modulePath ?? "module-a"}/src/main/AndroidManifest.xml`,
    modulePath: options.modulePath ?? "module-a",
    sourceSetKind: options.sourceSetKind ?? "main",
    manifest: parseAndroidManifestSource(xml, `${options.modulePath ?? "module-a"}/src/main/AndroidManifest.xml`),
  };
}

function manifestXml(applicationAttrs: string): string {
  return `<?xml version="1.0"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application ${applicationAttrs}></application></manifest>`;
}

// ANDROID-V041-B2-02/03/04/05 — usesCleartextTraffic classification.
describe("extractManifestNetworkSecurityEvidence — usesCleartextTraffic", () => {
  it("classifies explicit true", () => {
    const evidence = extractManifestNetworkSecurityEvidence(FIXTURES_ROOT, entry(manifestXml(`android:usesCleartextTraffic="true"`)));
    expect(evidence.usesCleartextTraffic).toEqual({ state: "explicit-true", raw: "true" });
  });

  it("classifies explicit false", () => {
    const evidence = extractManifestNetworkSecurityEvidence(FIXTURES_ROOT, entry(manifestXml(`android:usesCleartextTraffic="false"`)));
    expect(evidence.usesCleartextTraffic).toEqual({ state: "explicit-false", raw: "false" });
  });

  it("classifies a missing attribute distinctly from explicit false", () => {
    const evidence = extractManifestNetworkSecurityEvidence(FIXTURES_ROOT, entry(manifestXml(`android:label="x"`)));
    expect(evidence.usesCleartextTraffic).toEqual({ state: "missing" });
  });

  it("classifies a malformed value without normalizing it to true or false", () => {
    const evidence = extractManifestNetworkSecurityEvidence(FIXTURES_ROOT, entry(manifestXml(`android:usesCleartextTraffic="\${cleartext}"`)));
    expect(evidence.usesCleartextTraffic.state).toBe("malformed");
  });
});

// ANDROID-V041-B2-06/07/08/09 — networkSecurityConfig reference classification
// and reuse of the Batch 1 resolver.
describe("extractManifestNetworkSecurityEvidence — networkSecurityConfig reference", () => {
  it("classifies an absent reference", () => {
    const evidence = extractManifestNetworkSecurityEvidence(FIXTURES_ROOT, entry(manifestXml(`android:label="x"`)));
    expect(evidence.networkSecurityConfig).toEqual({ state: "absent" });
  });

  it("classifies an unresolved build placeholder distinctly", () => {
    const evidence = extractManifestNetworkSecurityEvidence(
      FIXTURES_ROOT,
      entry(manifestXml(`android:networkSecurityConfig="\${networkSecurityConfig}"`))
    );
    expect(evidence.networkSecurityConfig.state).toBe("placeholder");
  });

  it("classifies a malformed reference", () => {
    const evidence = extractManifestNetworkSecurityEvidence(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="not-a-reference"`)));
    expect(evidence.networkSecurityConfig.state).toBe("malformed");
  });

  it("classifies an unsupported resource type", () => {
    const evidence = extractManifestNetworkSecurityEvidence(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@string/x"`)));
    expect(evidence.networkSecurityConfig.state).toBe("unsupported-type");
  });

  it("classifies a package-qualified external reference", () => {
    const evidence = extractManifestNetworkSecurityEvidence(
      FIXTURES_ROOT,
      entry(manifestXml(`android:networkSecurityConfig="@com.example.lib:xml/network_security_config"`))
    );
    expect(evidence.networkSecurityConfig.state).toBe("package-qualified");
  });

  it("resolves a valid module-local reference through the Batch 1 resolver and parses it", () => {
    const evidence = extractManifestNetworkSecurityEvidence(
      FIXTURES_ROOT,
      entry(manifestXml(`android:networkSecurityConfig="@xml/network_security_config"`))
    );
    expect(evidence.networkSecurityConfig.state).toBe("resolved");
    if (evidence.networkSecurityConfig.state === "resolved") {
      expect(evidence.networkSecurityConfig.parseResult.state).toBe("parsed");
    }
  });

  it("reports missing when the reference is well-formed but no file matches", () => {
    const evidence = extractManifestNetworkSecurityEvidence(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/does_not_exist"`)));
    expect(evidence.networkSecurityConfig.state).toBe("missing");
  });

  it("reports ambiguous when multiple source sets define the same resource, without picking one", () => {
    const evidence = extractManifestNetworkSecurityEvidence(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/ambiguous_config"`)));
    expect(evidence.networkSecurityConfig.state).toBe("ambiguous");
    if (evidence.networkSecurityConfig.state === "ambiguous") {
      expect(evidence.networkSecurityConfig.candidates).toHaveLength(2);
    }
  });

  it("reports module-unknown when the manifest's module path could not be determined", () => {
    const bareEntry: AndroidManifestParseEntry = {
      manifestPath: "AndroidManifest.xml",
      modulePath: undefined,
      sourceSetKind: "other",
      manifest: parseAndroidManifestSource(manifestXml(`android:networkSecurityConfig="@xml/network_security_config"`), "AndroidManifest.xml"),
    };
    const evidence = extractManifestNetworkSecurityEvidence(FIXTURES_ROOT, bareEntry);
    expect(evidence.networkSecurityConfig.state).toBe("module-unknown");
  });

  it("parses a malformed referenced XML file without throwing", () => {
    const evidence = extractManifestNetworkSecurityEvidence(
      FIXTURES_ROOT,
      entry(manifestXml(`android:networkSecurityConfig="@xml/malformed_network_security_config"`), { modulePath: "module-b" })
    );
    expect(evidence.networkSecurityConfig.state).toBe("resolved");
    if (evidence.networkSecurityConfig.state === "resolved") {
      expect(evidence.networkSecurityConfig.parseResult.state).toBe("malformed-xml");
    }
  });

  it("parses an unsupported-root referenced XML file without masquerading as valid", () => {
    const evidence = extractManifestNetworkSecurityEvidence(
      FIXTURES_ROOT,
      entry(manifestXml(`android:networkSecurityConfig="@xml/unsupported_root"`), { modulePath: "module-b" })
    );
    if (evidence.networkSecurityConfig.state === "resolved") {
      expect(evidence.networkSecurityConfig.parseResult.state).toBe("unsupported-root");
    } else {
      throw new Error("expected resolved");
    }
  });
});

// ANDROID-V041-B2-01 (partial) — module/source-set/location identity carried.
describe("extractManifestNetworkSecurityEvidence — identity preservation", () => {
  it("preserves manifest path, module path, source-set kind, and application location", () => {
    const evidence = extractManifestNetworkSecurityEvidence(FIXTURES_ROOT, entry(manifestXml(`android:usesCleartextTraffic="true"`), { modulePath: "module-a", sourceSetKind: "debug" }));
    expect(evidence.modulePath).toBe("module-a");
    expect(evidence.sourceSetKind).toBe("debug");
    expect(evidence.applicationLocation?.line).toBeGreaterThan(0);
  });
});
