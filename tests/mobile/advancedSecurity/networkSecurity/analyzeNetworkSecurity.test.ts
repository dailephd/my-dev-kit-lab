import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAndroidManifestSource, type AndroidManifestParseEntry } from "../../../../src/mobile/android/manifest/parseAndroidManifest.js";
import { analyzeManifestNetworkSecurity } from "../../../../src/mobile/android/advancedSecurity/networkSecurity/analyzeNetworkSecurity.js";
import { ANDROID_NETWORK_SECURITY_RULE_IDS } from "../../../../src/mobile/android/advancedSecurity/ruleIds.js";

const FIXTURES_ROOT = path.resolve("tests/fixtures/android/advanced-security-fixtures/network-security");

function entry(xml: string, modulePath = "module-a"): AndroidManifestParseEntry {
  return {
    manifestPath: `${modulePath}/src/main/AndroidManifest.xml`,
    modulePath,
    sourceSetKind: "main",
    manifest: parseAndroidManifestSource(xml, `${modulePath}/src/main/AndroidManifest.xml`),
  };
}

function manifestXml(applicationAttrs: string): string {
  return `<?xml version="1.0"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application ${applicationAttrs}></application></manifest>`;
}

// ANDROID-V041-B2-01 — inherited rule/category identities.
describe("analyzeManifestNetworkSecurity — inherited rule identities", () => {
  it("every produced finding/candidate rule id is one of the Batch 1 network-security rule ids", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:usesCleartextTraffic="true" android:networkSecurityConfig="@xml/network_security_config"`)));
    for (const finding of result.findings) {
      expect(ANDROID_NETWORK_SECURITY_RULE_IDS).toContain(finding.id.split("--")[0]);
    }
    for (const candidate of result.candidates) {
      expect(ANDROID_NETWORK_SECURITY_RULE_IDS).toContain(candidate.ruleId);
      expect(candidate.category).toBe("android-network-security");
    }
  });
});

// ANDROID-V041-B2-02 — manifest cleartext true, no NSC -> major finding.
describe("analyzeManifestNetworkSecurity — manifest usesCleartextTraffic=true", () => {
  it("produces a major finding when no Network Security Config narrows it", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:usesCleartextTraffic="true"`)));
    const finding = result.findings.find((f) => f.id.startsWith("android-network-cleartext-traffic"));
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("major");
  });

  // ANDROID-V041-B2-03
  it("produces no finding for explicit false", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:usesCleartextTraffic="false"`)));
    expect(result.findings.some((f) => f.id.startsWith("android-network-cleartext-traffic"))).toBe(false);
  });

  // ANDROID-V041-B2-04
  it("produces no finding when the attribute is absent", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:label="x"`)));
    expect(result.findings).toHaveLength(0);
  });

  // ANDROID-V041-B2-05
  it("produces review candidate evidence, not a finding, for a malformed value", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:usesCleartextTraffic="\${x}"`)));
    expect(result.findings).toHaveLength(0);
    expect(result.candidates.some((c) => c.ruleId === "android-network-cleartext-traffic")).toBe(true);
  });
});

describe("analyzeManifestNetworkSecurity — manifest/NSC conflict handling", () => {
  it("produces conflicting-configuration candidate evidence (not a finding) when NSC base explicitly disagrees", () => {
    const result = analyzeManifestNetworkSecurity(
      FIXTURES_ROOT,
      entry(manifestXml(`android:usesCleartextTraffic="true" android:networkSecurityConfig="@xml/base_cleartext_false"`))
    );
    const manifestFinding = result.findings.find((f) => f.id.startsWith("android-network-cleartext-traffic") && (f.evidence ?? "").includes("manifest-attribute"));
    expect(manifestFinding).toBeUndefined();
    expect(result.candidates.some((c) => c.ruleId === "android-network-cleartext-traffic" && c.summary.includes("conflicts"))).toBe(true);
  });

  it("still produces the major manifest-level finding when the resolved NSC does not contradict it", () => {
    const result = analyzeManifestNetworkSecurity(
      FIXTURES_ROOT,
      entry(manifestXml(`android:usesCleartextTraffic="true" android:networkSecurityConfig="@xml/network_security_config"`))
    );
    expect(result.findings.some((f) => f.id.startsWith("android-network-cleartext-traffic"))).toBe(true);
  });
});

// ANDROID-V041-B2-12/13 — base/domain cleartext findings from a real NSC file.
describe("analyzeManifestNetworkSecurity — Network Security Config cleartext findings", () => {
  it("produces a major finding for base-config cleartext and a minor finding for the scoped domain", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/network_security_config"`)));
    const cleartextFindings = result.findings.filter((f) => f.id.startsWith("android-network-cleartext-traffic"));
    expect(cleartextFindings.some((f) => f.severity === "major")).toBe(true);
    expect(cleartextFindings.some((f) => f.severity === "minor")).toBe(true);
  });
});

// ANDROID-V041-B2-16/17/18/19/20 — trust-anchor findings/candidates.
describe("analyzeManifestNetworkSecurity — trust anchors", () => {
  it("produces a finding for user-added CA trust and no finding for system CA trust in the same config", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/network_security_config"`)));
    expect(result.findings.some((f) => f.id.startsWith("android-network-user-added-trust-anchor"))).toBe(true);
    // System-CA-only evidence must never itself become a finding.
    const systemOnlyFindingCount = result.findings.filter((f) => f.description.includes("src=\"system\"")).length;
    expect(systemOnlyFindingCount).toBe(0);
  });

  it("produces review candidate evidence (not a finding) for a custom raw CA", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/network_security_config"`)));
    const rawCaCandidate = result.candidates.find((c) => c.summary.includes("Custom raw certificate authority"));
    expect(rawCaCandidate).toBeDefined();
    expect(rawCaCandidate?.confidence).toBe("medium");
  });

  it("keeps debug-overrides trust evidence as review candidate evidence, separate from release-relevant findings", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/network_security_config"`)));
    const debugCandidate = result.candidates.find((c) => c.ruleId === "android-network-debug-trust-override");
    expect(debugCandidate).toBeDefined();
    expect(result.findings.some((f) => f.id.startsWith("android-network-debug-trust-override"))).toBe(false);
  });

  it("associates overridePins evidence with its trust-anchor scope without claiming a runtime bypass", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/network_security_config"`)));
    const debugCandidate = result.candidates.find((c) => c.ruleId === "android-network-debug-trust-override");
    expect(debugCandidate?.summary).toContain("Debug-only trust override");
  });
});

// ANDROID-V041-B2-23 — broad domain candidate boundaries.
describe("analyzeManifestNetworkSecurity — domain broadness and duplicates", () => {
  it("flags only narrowly broad domain candidates and normalizes duplicates deterministically", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/broad_and_duplicate_domains"`)));
    const broadCandidates = result.candidates.filter((c) => c.ruleId === "android-network-broad-domain-config");
    // "ab" (short single-label) should be flagged; ordinary "example.com" (both casings) should not.
    expect(broadCandidates.some((c) => c.summary.includes('"ab"'))).toBe(true);
    expect(broadCandidates.some((c) => c.summary.includes("example.com"))).toBe(false);
  });

  it("flags an empty/malformed domain entry", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/empty_domain"`)));
    expect(result.candidates.some((c) => c.ruleId === "android-network-broad-domain-config" && c.resolutionState === "malformed")).toBe(true);
  });
});

// ANDROID-V041-B2-24/25/26 — pin-set metadata and absence-of-pinning regression.
describe("analyzeManifestNetworkSecurity — pinning", () => {
  it("produces informational pin-set metadata evidence", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/network_security_config"`)));
    expect(result.candidates.some((c) => c.ruleId === "android-network-pinning-metadata")).toBe(true);
  });

  it("produces unresolved-pin candidate evidence for malformed pins without throwing", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/malformed_pin"`)));
    const unresolved = result.candidates.filter((c) => c.ruleId === "android-network-pinning-unresolved");
    expect(unresolved.length).toBeGreaterThanOrEqual(2);
  });

  // ANDROID-V041-B2-26 — regression: absence of pinning is never a finding.
  it("never produces a finding solely because a configuration has no pin-set", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/base_cleartext_false"`)));
    expect(result.findings.some((f) => f.title.toLowerCase().includes("pin"))).toBe(false);
  });
});

// ANDROID-V041-B2-07/08/09/10/11 — missing/ambiguous/malformed/unsupported reference handling.
describe("analyzeManifestNetworkSecurity — non-resolving references", () => {
  it("produces missing-reference candidate evidence, not a finding, for a nonexistent file", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/does_not_exist"`)));
    expect(result.findings).toHaveLength(0);
    expect(result.candidates.some((c) => c.resolutionState === "missing")).toBe(true);
  });

  it("produces ambiguous-reference candidate evidence for multiple resolvable candidates without arbitrarily picking one", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/ambiguous_config"`)));
    expect(result.candidates.some((c) => c.summary.includes("ambiguous candidates"))).toBe(true);
  });

  it("handles a malformed resource reference without throwing", () => {
    expect(() => analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="not-a-reference"`)))).not.toThrow();
  });

  it("handles a malformed referenced XML file without crashing the whole analysis", () => {
    const result = analyzeManifestNetworkSecurity(
      FIXTURES_ROOT,
      entry(manifestXml(`android:networkSecurityConfig="@xml/malformed_network_security_config"`), "module-b")
    );
    expect(result.candidates.some((c) => c.resolutionState === "malformed")).toBe(true);
  });

  it("handles an unsupported-root referenced XML file distinctly", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/unsupported_root"`), "module-b"));
    expect(result.candidates.some((c) => c.resolutionState === "unsupported")).toBe(true);
  });
});

// ANDROID-V041-B2-27/28 — deterministic output.
describe("analyzeManifestNetworkSecurity — determinism", () => {
  it("produces stable finding ids and ordering across repeated runs", () => {
    const xml = manifestXml(`android:networkSecurityConfig="@xml/network_security_config"`);
    const first = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(xml));
    const second = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(xml));
    expect(first.findings.map((f) => f.id)).toEqual(second.findings.map((f) => f.id));
    expect(first.candidates.map((c) => c.id)).toEqual(second.candidates.map((c) => c.id));
  });
});

// ANDROID-V041-B2-35 — bounded evidence: no complete XML, no absolute paths.
describe("analyzeManifestNetworkSecurity — bounded evidence", () => {
  it("never includes an absolute workstation path in candidate or finding output", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/network_security_config"`)));
    const serialized = JSON.stringify({ candidates: result.candidates, findings: result.findings });
    expect(serialized).not.toContain(FIXTURES_ROOT.replace(/\\/g, "\\\\"));
    expect(serialized).not.toContain(process.cwd().replace(/\\/g, "\\\\"));
  });

  it("never includes the complete referenced XML document in evidence", () => {
    const result = analyzeManifestNetworkSecurity(FIXTURES_ROOT, entry(manifestXml(`android:networkSecurityConfig="@xml/network_security_config"`)));
    const serialized = JSON.stringify({ candidates: result.candidates, findings: result.findings });
    expect(serialized).not.toContain("<network-security-config>");
  });
});
