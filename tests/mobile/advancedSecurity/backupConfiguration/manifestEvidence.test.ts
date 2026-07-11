import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAndroidManifestSource, type AndroidManifestParseEntry } from "../../../../src/mobile/android/manifest/parseAndroidManifest.js";
import { extractManifestBackupEvidence } from "../../../../src/mobile/android/advancedSecurity/backupConfiguration/manifestEvidence.js";

const FIXTURES_ROOT = path.resolve("tests/fixtures/android/advanced-security-fixtures/backup-configuration");

function entry(xml: string, options: { modulePath?: string; sourceSetKind?: AndroidManifestParseEntry["sourceSetKind"] } = {}): AndroidManifestParseEntry {
  const modulePath = options.modulePath ?? "module-a";
  return {
    manifestPath: `${modulePath}/src/main/AndroidManifest.xml`,
    modulePath,
    sourceSetKind: options.sourceSetKind ?? "main",
    manifest: parseAndroidManifestSource(xml, `${modulePath}/src/main/AndroidManifest.xml`),
  };
}

function manifestXml(applicationAttrs: string): string {
  return `<?xml version="1.0"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application ${applicationAttrs}></application></manifest>`;
}

// ANDROID-V041-B3-02/03/04/05 — allowBackup classification.
describe("extractManifestBackupEvidence — allowBackup", () => {
  it("classifies explicit true/false/missing/malformed", () => {
    expect(extractManifestBackupEvidence(FIXTURES_ROOT, entry(manifestXml(`android:allowBackup="true"`))).allowBackup.state).toBe("explicit-true");
    expect(extractManifestBackupEvidence(FIXTURES_ROOT, entry(manifestXml(`android:allowBackup="false"`))).allowBackup.state).toBe("explicit-false");
    expect(extractManifestBackupEvidence(FIXTURES_ROOT, entry(manifestXml(`android:label="x"`))).allowBackup.state).toBe("missing");
    expect(extractManifestBackupEvidence(FIXTURES_ROOT, entry(manifestXml(`android:allowBackup="\${x}"`))).allowBackup.state).toBe("malformed");
  });
});

describe("extractManifestBackupEvidence — debuggable/testOnly", () => {
  it("classifies debuggable and testOnly the same way as allowBackup", () => {
    const evidence = extractManifestBackupEvidence(FIXTURES_ROOT, entry(manifestXml(`android:debuggable="true" android:testOnly="true"`)));
    expect(evidence.debuggable.state).toBe("explicit-true");
    expect(evidence.testOnly.state).toBe("explicit-true");
  });
});

// ANDROID-V041-B3-06 — fullBackupContent resolution + legacy literal support.
describe("extractManifestBackupEvidence — fullBackupContent", () => {
  it("classifies a legacy literal true/false value", () => {
    expect(extractManifestBackupEvidence(FIXTURES_ROOT, entry(manifestXml(`android:fullBackupContent="true"`))).fullBackupContent.state).toBe("legacy-literal-true");
    expect(extractManifestBackupEvidence(FIXTURES_ROOT, entry(manifestXml(`android:fullBackupContent="false"`))).fullBackupContent.state).toBe("legacy-literal-false");
  });

  it("resolves a valid @xml reference through the Batch 1 resolver and parses it", () => {
    const evidence = extractManifestBackupEvidence(FIXTURES_ROOT, entry(manifestXml(`android:fullBackupContent="@xml/backup_rules"`)));
    expect(evidence.fullBackupContent.state).toBe("resolved");
    if (evidence.fullBackupContent.state === "resolved") {
      expect(evidence.fullBackupContent.parseResult.state).toBe("parsed-full-backup-content");
    }
  });

  it("reports missing for a nonexistent reference", () => {
    expect(extractManifestBackupEvidence(FIXTURES_ROOT, entry(manifestXml(`android:fullBackupContent="@xml/does_not_exist"`))).fullBackupContent.state).toBe(
      "missing"
    );
  });

  // ANDROID-V041-B3-09
  it("reports ambiguous for multiple source-set candidates without arbitrary selection", () => {
    const evidence = extractManifestBackupEvidence(FIXTURES_ROOT, entry(manifestXml(`android:fullBackupContent="@xml/ambiguous_backup_rules"`)));
    expect(evidence.fullBackupContent.state).toBe("ambiguous");
    if (evidence.fullBackupContent.state === "ambiguous") {
      expect(evidence.fullBackupContent.candidates).toHaveLength(2);
    }
  });

  // ANDROID-V041-B3-10
  it("parses a malformed referenced file without throwing", () => {
    const evidence = extractManifestBackupEvidence(
      FIXTURES_ROOT,
      entry(manifestXml(`android:fullBackupContent="@xml/malformed_backup_rules"`), { modulePath: "module-b" })
    );
    expect(evidence.fullBackupContent.state).toBe("resolved");
    if (evidence.fullBackupContent.state === "resolved") {
      expect(evidence.fullBackupContent.parseResult.state).toBe("malformed-xml");
    }
  });

  // ANDROID-V041-B3-11
  it("parses an unsupported-root referenced file distinctly", () => {
    const evidence = extractManifestBackupEvidence(
      FIXTURES_ROOT,
      entry(manifestXml(`android:fullBackupContent="@xml/unsupported_root"`), { modulePath: "module-b" })
    );
    if (evidence.fullBackupContent.state === "resolved") {
      expect(evidence.fullBackupContent.parseResult.state).toBe("unsupported-root");
    } else {
      throw new Error("expected resolved");
    }
  });

  it("classifies an unresolved placeholder distinctly", () => {
    expect(extractManifestBackupEvidence(FIXTURES_ROOT, entry(manifestXml(`android:fullBackupContent="\${backup}"`))).fullBackupContent.state).toBe("placeholder");
  });
});

// ANDROID-V041-B3-07 — dataExtractionRules resolution (always @xml, no legacy literal).
describe("extractManifestBackupEvidence — dataExtractionRules", () => {
  it("resolves a valid @xml reference and parses cloud-backup/device-transfer separately", () => {
    const evidence = extractManifestBackupEvidence(FIXTURES_ROOT, entry(manifestXml(`android:dataExtractionRules="@xml/data_extraction_rules"`)));
    expect(evidence.dataExtractionRules.state).toBe("resolved");
    if (evidence.dataExtractionRules.state === "resolved" && evidence.dataExtractionRules.parseResult.state === "parsed-data-extraction-rules") {
      expect(evidence.dataExtractionRules.parseResult.model.cloudBackup?.rules).toHaveLength(2);
      expect(evidence.dataExtractionRules.parseResult.model.deviceTransfer?.rules).toHaveLength(1);
    } else {
      throw new Error("expected resolved+parsed-data-extraction-rules");
    }
  });

  it("classifies absent distinctly from every other state", () => {
    expect(extractManifestBackupEvidence(FIXTURES_ROOT, entry(manifestXml(`android:label="x"`))).dataExtractionRules.state).toBe("absent");
  });
});

describe("extractManifestBackupEvidence — identity preservation", () => {
  it("preserves manifest path, module path, source-set kind, and application location", () => {
    const evidence = extractManifestBackupEvidence(FIXTURES_ROOT, entry(manifestXml(`android:allowBackup="true"`), { modulePath: "module-a", sourceSetKind: "debug" }));
    expect(evidence.modulePath).toBe("module-a");
    expect(evidence.sourceSetKind).toBe("debug");
    expect(evidence.applicationLocation?.line).toBeGreaterThan(0);
  });
});
