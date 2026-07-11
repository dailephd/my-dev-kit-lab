import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAndroidManifestSource, type AndroidManifestParseEntry } from "../../../../src/mobile/android/manifest/parseAndroidManifest.js";
import { analyzeManifestBackupConfiguration } from "../../../../src/mobile/android/advancedSecurity/backupConfiguration/analyzeBackupConfiguration.js";
import { ANDROID_BACKUP_RELEASE_RULE_IDS } from "../../../../src/mobile/android/advancedSecurity/ruleIds.js";

const FIXTURES_ROOT = path.resolve("tests/fixtures/android/advanced-security-fixtures/backup-configuration");

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

// ANDROID-V041-B3-01 — inherited rule identities.
describe("analyzeManifestBackupConfiguration — inherited rule identities", () => {
  it("every produced finding/candidate rule id is one of the Batch 1 backup rule ids", () => {
    const result = analyzeManifestBackupConfiguration(FIXTURES_ROOT, entry(manifestXml(`android:allowBackup="true" android:fullBackupContent="@xml/broad_backup_rules"`)));
    for (const finding of result.findings) {
      expect(ANDROID_BACKUP_RELEASE_RULE_IDS).toContain(finding.id.split("--")[0]);
    }
    for (const candidate of result.candidates) {
      expect(ANDROID_BACKUP_RELEASE_RULE_IDS).toContain(candidate.ruleId);
      expect(candidate.category).toBe("android-backup-configuration");
    }
  });
});

// ANDROID-V041-B3-02/03/04/05 — allowBackup severity boundary.
describe("analyzeManifestBackupConfiguration — allowBackup", () => {
  it("produces a minor finding for explicit true with no broad-rule evidence", () => {
    const result = analyzeManifestBackupConfiguration(FIXTURES_ROOT, entry(manifestXml(`android:allowBackup="true"`)));
    const finding = result.findings.find((f) => f.id.startsWith("android-backup-allow-backup"));
    expect(finding?.severity).toBe("minor");
  });

  it("escalates to major when a broad backup-rule inclusion is found", () => {
    const result = analyzeManifestBackupConfiguration(
      FIXTURES_ROOT,
      entry(manifestXml(`android:allowBackup="true" android:fullBackupContent="@xml/broad_backup_rules"`))
    );
    const finding = result.findings.find((f) => f.id.startsWith("android-backup-allow-backup"));
    expect(finding?.severity).toBe("major");
  });

  it("produces no finding for explicit false", () => {
    const result = analyzeManifestBackupConfiguration(FIXTURES_ROOT, entry(manifestXml(`android:allowBackup="false"`)));
    expect(result.findings).toHaveLength(0);
  });

  it("produces no finding when allowBackup is absent", () => {
    const result = analyzeManifestBackupConfiguration(FIXTURES_ROOT, entry(manifestXml(`android:label="x"`)));
    expect(result.findings).toHaveLength(0);
  });

  it("produces review candidate evidence, not a finding, for a malformed value", () => {
    const result = analyzeManifestBackupConfiguration(FIXTURES_ROOT, entry(manifestXml(`android:allowBackup="\${x}"`)));
    expect(result.findings).toHaveLength(0);
    expect(result.candidates.some((c) => c.ruleId === "android-backup-allow-backup")).toBe(true);
  });
});

// ANDROID-V041-B3-12/13/14 — legacy/cloud/device-transfer separation.
describe("analyzeManifestBackupConfiguration — rule scope separation", () => {
  it("keeps cloud-backup and device-transfer evidence separate", () => {
    const result = analyzeManifestBackupConfiguration(FIXTURES_ROOT, entry(manifestXml(`android:dataExtractionRules="@xml/data_extraction_rules"`)));
    const broadCandidates = result.candidates.filter((c) => c.summary.includes("Broad"));
    expect(broadCandidates.some((c) => c.summary.includes("device-transfer"))).toBe(true);
  });

  it("preserves restrictive exclusions as evidence text, not a finding or candidate", () => {
    const result = analyzeManifestBackupConfiguration(FIXTURES_ROOT, entry(manifestXml(`android:fullBackupContent="@xml/backup_rules"`)));
    expect(result.evidenceText.some((t) => t.includes("restrictive exclusion"))).toBe(true);
    expect(result.findings).toHaveLength(0);
  });
});

// ANDROID-V041-B3-08/09/10/11 — missing/ambiguous/malformed/unsupported-root.
describe("analyzeManifestBackupConfiguration — non-resolving references", () => {
  it("produces missing-reference candidate evidence for a nonexistent file", () => {
    const result = analyzeManifestBackupConfiguration(FIXTURES_ROOT, entry(manifestXml(`android:fullBackupContent="@xml/does_not_exist"`)));
    expect(result.candidates.some((c) => c.resolutionState === "missing")).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("produces ambiguous-reference candidate evidence without arbitrary selection", () => {
    const result = analyzeManifestBackupConfiguration(FIXTURES_ROOT, entry(manifestXml(`android:fullBackupContent="@xml/ambiguous_backup_rules"`)));
    expect(result.candidates.some((c) => c.summary.includes("ambiguous candidates"))).toBe(true);
  });

  it("handles a malformed referenced XML file without crashing", () => {
    const result = analyzeManifestBackupConfiguration(
      FIXTURES_ROOT,
      entry(manifestXml(`android:fullBackupContent="@xml/malformed_backup_rules"`), "module-b")
    );
    expect(result.candidates.some((c) => c.resolutionState === "malformed")).toBe(true);
  });

  it("handles an unsupported-root referenced XML file distinctly", () => {
    const result = analyzeManifestBackupConfiguration(FIXTURES_ROOT, entry(manifestXml(`android:fullBackupContent="@xml/unsupported_root"`), "module-b"));
    expect(result.candidates.some((c) => c.resolutionState === "unsupported")).toBe(true);
  });

  it("flags an unsupported backup domain as review evidence", () => {
    const result = analyzeManifestBackupConfiguration(FIXTURES_ROOT, entry(manifestXml(`android:fullBackupContent="@xml/unsupported_domain_rules"`)));
    expect(result.candidates.some((c) => c.summary.includes("Unsupported backup domain"))).toBe(true);
  });
});

// ANDROID-V041-B3-37/38 — deterministic output.
describe("analyzeManifestBackupConfiguration — determinism", () => {
  it("produces stable finding/candidate ids across repeated runs", () => {
    const xml = manifestXml(`android:allowBackup="true" android:fullBackupContent="@xml/broad_backup_rules"`);
    const first = analyzeManifestBackupConfiguration(FIXTURES_ROOT, entry(xml));
    const second = analyzeManifestBackupConfiguration(FIXTURES_ROOT, entry(xml));
    expect(first.findings.map((f) => f.id)).toEqual(second.findings.map((f) => f.id));
    expect(first.candidates.map((c) => c.id)).toEqual(second.candidates.map((c) => c.id));
  });
});

// ANDROID-V041-B3-39 — bounded evidence.
describe("analyzeManifestBackupConfiguration — bounded evidence", () => {
  it("never includes an absolute workstation path or complete XML document", () => {
    const result = analyzeManifestBackupConfiguration(FIXTURES_ROOT, entry(manifestXml(`android:fullBackupContent="@xml/backup_rules"`)));
    const serialized = JSON.stringify({ candidates: result.candidates, findings: result.findings });
    expect(serialized).not.toContain(FIXTURES_ROOT.replace(/\\/g, "\\\\"));
    expect(serialized).not.toContain("<full-backup-content>");
  });
});
