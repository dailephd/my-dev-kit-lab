import { describe, expect, it } from "vitest";
import { parseAndroidManifestSource } from "../../../src/mobile/android/manifest/parseAndroidManifest.js";

// v0.4.1 Batch 3 narrow inherited-contract correction: AndroidManifestApplicationAttributes
// gained allowBackupRaw/debuggableRaw (allowBackup/debuggable already existed
// but only kept the parsed boolean, discarding raw text) and new
// fullBackupContentRef/dataExtractionRulesRef/testOnly/testOnlyRaw fields.
// All additive/optional. Regression-tested per agents.txt Batch 3 section 6.
describe("AndroidManifest <application> widening — v0.4.1 Batch 3 inherited-contract regression", () => {
  function manifestXml(applicationAttrs: string): string {
    return `<?xml version="1.0"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application ${applicationAttrs}></application></manifest>`;
  }

  it("preserves raw allowBackup text alongside the normalized boolean", () => {
    const manifest = parseAndroidManifestSource(manifestXml(`android:allowBackup="true"`), "AndroidManifest.xml");
    expect(manifest.application.allowBackup).toBe(true);
    expect(manifest.application.allowBackupRaw).toBe("true");
  });

  it("preserves raw debuggable text alongside the normalized boolean", () => {
    const manifest = parseAndroidManifestSource(manifestXml(`android:debuggable="true"`), "AndroidManifest.xml");
    expect(manifest.application.debuggable).toBe(true);
    expect(manifest.application.debuggableRaw).toBe("true");
  });

  it("does not normalize a malformed allowBackup value to true or false", () => {
    const manifest = parseAndroidManifestSource(manifestXml(`android:allowBackup="\${allowBackup}"`), "AndroidManifest.xml");
    expect(manifest.application.allowBackup).toBeUndefined();
    expect(manifest.application.allowBackupRaw).toBe("${allowBackup}");
  });

  it("preserves fullBackupContent and dataExtractionRules raw references verbatim", () => {
    const manifest = parseAndroidManifestSource(
      manifestXml(`android:fullBackupContent="@xml/backup_rules" android:dataExtractionRules="@xml/data_extraction_rules"`),
      "AndroidManifest.xml"
    );
    expect(manifest.application.fullBackupContentRef).toBe("@xml/backup_rules");
    expect(manifest.application.dataExtractionRulesRef).toBe("@xml/data_extraction_rules");
  });

  it("preserves a literal boolean fullBackupContent value verbatim (legacy form)", () => {
    const manifest = parseAndroidManifestSource(manifestXml(`android:fullBackupContent="false"`), "AndroidManifest.xml");
    expect(manifest.application.fullBackupContentRef).toBe("false");
  });

  it("classifies testOnly true/false and preserves raw text", () => {
    const manifestTrue = parseAndroidManifestSource(manifestXml(`android:testOnly="true"`), "AndroidManifest.xml");
    expect(manifestTrue.application.testOnly).toBe(true);
    expect(manifestTrue.application.testOnlyRaw).toBe("true");

    const manifestFalse = parseAndroidManifestSource(manifestXml(`android:testOnly="false"`), "AndroidManifest.xml");
    expect(manifestFalse.application.testOnly).toBe(false);
  });

  it("leaves all Batch 3 fields undefined when attributes are absent", () => {
    const manifest = parseAndroidManifestSource(manifestXml(`android:label="x"`), "AndroidManifest.xml");
    expect(manifest.application.allowBackupRaw).toBeUndefined();
    expect(manifest.application.debuggableRaw).toBeUndefined();
    expect(manifest.application.fullBackupContentRef).toBeUndefined();
    expect(manifest.application.dataExtractionRulesRef).toBeUndefined();
    expect(manifest.application.testOnly).toBeUndefined();
    expect(manifest.application.testOnlyRaw).toBeUndefined();
  });

  it("emits exactly one malformed-value warning per attribute, not a duplicate", () => {
    const manifest = parseAndroidManifestSource(
      manifestXml(`android:allowBackup="\${x}" android:debuggable="\${y}" android:testOnly="\${z}"`),
      "AndroidManifest.xml"
    );
    expect(manifest.parseWarnings.filter((w) => w.includes("allowBackup"))).toHaveLength(1);
    expect(manifest.parseWarnings.filter((w) => w.includes("debuggable"))).toHaveLength(1);
    expect(manifest.parseWarnings.filter((w) => w.includes("testOnly"))).toHaveLength(1);
  });
});
