import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAndroidManifestSource, type AndroidManifestParseEntry } from "../../../src/mobile/android/manifest/parseAndroidManifest.js";
import { extractManifestBackupEvidence } from "../../../src/mobile/android/advancedSecurity/backupConfiguration/manifestEvidence.js";
import { analyzeManifestBackupConfiguration } from "../../../src/mobile/android/advancedSecurity/backupConfiguration/analyzeBackupConfiguration.js";
import { analyzeApplicationReleaseConfiguration } from "../../../src/mobile/android/advancedSecurity/releaseConfiguration/analyzeReleaseConfiguration.js";
import { validateAndroidTarget } from "../../../src/mobile/android/validate/validateAndroidTarget.js";
import { toAndroidReportModel } from "../../../src/mobile/android/report/model.js";
import { renderAndroidTextReport } from "../../../src/mobile/android/report/renderAndroidReport.js";
import { ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/networkSecurity/checkResult.js";
import { ANDROID_BACKUP_CONFIGURATION_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/backupConfiguration/checkResult.js";
import { ANDROID_RELEASE_CONFIGURATION_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/releaseConfiguration/checkResult.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android");
const TOOL_ROOT = path.resolve(__dirname, "..", "..", "..");
const BACKUP_FIXTURES_ROOT = path.join(FIXTURES_ROOT, "advanced-security-fixtures", "backup-configuration");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

function manifestXml(applicationAttrs: string): string {
  return `<?xml version="1.0"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application ${applicationAttrs}></application></manifest>`;
}

function entry(root: string, xml: string, modulePath = "module-a"): AndroidManifestParseEntry {
  return {
    manifestPath: `${modulePath}/src/main/AndroidManifest.xml`,
    modulePath,
    sourceSetKind: "main",
    manifest: parseAndroidManifestSource(xml, `${modulePath}/src/main/AndroidManifest.xml`),
  };
}

// ANDROID-V041-B3-19 — target containment (backup resource resolution).
describe("Batch 3 target containment", () => {
  it("rejects a traversal-shaped backup resource reference", () => {
    const evidence = extractManifestBackupEvidence(BACKUP_FIXTURES_ROOT, entry(BACKUP_FIXTURES_ROOT, manifestXml(`android:fullBackupContent="@xml/../../../../etc/passwd"`)));
    expect(evidence.fullBackupContent.state).toBe("malformed");
  });

  it("throws rather than silently resolving when modulePath is outside the given root", () => {
    const outsideEntry: AndroidManifestParseEntry = {
      manifestPath: "AndroidManifest.xml",
      modulePath: path.relative(BACKUP_FIXTURES_ROOT, path.resolve(".")),
      sourceSetKind: "main",
      manifest: parseAndroidManifestSource(manifestXml(`android:fullBackupContent="@xml/backup_rules"`), "AndroidManifest.xml"),
    };
    expect(() => extractManifestBackupEvidence(BACKUP_FIXTURES_ROOT, outsideEntry)).toThrow();
  });
});

// ANDROID-V041-B3-40 — no process execution.
describe("Batch 3 — no process execution", () => {
  it("never references child_process or network modules in any new Batch 3 module", () => {
    const moduleFiles = [
      "src/mobile/android/advancedSecurity/backupConfiguration/parseBackupRules.ts",
      "src/mobile/android/advancedSecurity/backupConfiguration/manifestEvidence.ts",
      "src/mobile/android/advancedSecurity/backupConfiguration/analyzeBackupConfiguration.ts",
      "src/mobile/android/advancedSecurity/backupConfiguration/checkResult.ts",
      "src/mobile/android/advancedSecurity/releaseConfiguration/manifestEvidence.ts",
      "src/mobile/android/advancedSecurity/releaseConfiguration/analyzeReleaseConfiguration.ts",
      "src/mobile/android/advancedSecurity/releaseConfiguration/checkResult.ts",
      "src/mobile/android/gradle/moduleMetadataExtractor.ts",
    ];
    for (const file of moduleFiles) {
      const content = fs.readFileSync(path.resolve(file), "utf8");
      expect(content).not.toMatch(/child_process|node:net\b|node:http\b|node:https\b/);
    }
  });
});

// ANDROID-V041-B3-39 — bounded evidence for release configuration.
describe("Batch 3 — bounded evidence (release configuration)", () => {
  it("never includes an absolute workstation path or complete Gradle file content", () => {
    const gradleModule = {
      path: "app",
      buildFilePath: "app/build.gradle.kts",
      isApplication: true,
      buildTypes: ["release"],
      buildTypeDetails: [
        {
          name: "release",
          debuggableState: "literal-true" as const,
          debuggable: true,
          minifyEnabledState: "missing" as const,
          shrinkResourcesState: "missing" as const,
        },
      ],
      sourceSetEvidence: [],
      testSourceSetEvidence: [],
      unsupportedExpressions: [],
    };
    const result = analyzeApplicationReleaseConfiguration(TOOL_ROOT, entry(TOOL_ROOT, manifestXml(`android:debuggable="true"`), "app"), [gradleModule]);
    const serialized = JSON.stringify({ candidates: result.candidates, findings: result.findings });
    expect(serialized).not.toContain(TOOL_ROOT.replace(/\\/g, "\\\\"));
  });
});

// ANDROID-V041-B3-44 — Batch 2 (network-security) regression. Updated for
// v0.4.1 Batch 8, which activates all internal advanced checks by default
// (agents.txt Batch 8 section 9.1) — the network-security check is now
// expected to be present.
describe("Batch 3 does not disturb Batch 2 network-security behavior", () => {
  it("network-security check id is present in active validation alongside Batch 3", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const ids = result.checks.map((c) => c.id);
    expect(ids).toContain(ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID);
  });
});

// ANDROID-V041-B3-43/45 — updated for Batch 8 active integration.
describe("Batch 3 is active in Android validation and reports as of Batch 8", () => {
  it("validateAndroidTarget now runs and reports the Batch 3 check ids", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const ids = result.checks.map((c) => c.id);
    expect(ids).toContain(ANDROID_BACKUP_CONFIGURATION_AUDIT_CHECK_ID);
    expect(ids).toContain(ANDROID_RELEASE_CONFIGURATION_AUDIT_CHECK_ID);
  });

  it("validateAndroidTarget still runs exactly the same v0.4.0 checks", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const ids = result.checks.map((c) => c.id);
    expect(ids).toContain("android-project-detection");
    expect(ids).toContain("android-manifest-parsing");
    expect(ids).toContain("android-permissions-audit");
    expect(ids).toContain("android-exported-components-audit");
    expect(ids).toContain("android-intent-filters-audit");
    expect(ids).toContain("android-deep-links-audit");
    expect(ids).toContain("android-gradle-metadata");
  });

  it("still produces a valid verdict for the Compose fixture", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    expect(["ready-for-release-preparation", "ready-except-optional-manual-checks"]).toContain(result.verdict);
  });

  it("renders a text report that now includes the Batch 3 check ids", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const model = toAndroidReportModel(result);
    const text = renderAndroidTextReport(model);
    expect(text).toContain(ANDROID_BACKUP_CONFIGURATION_AUDIT_CHECK_ID);
    expect(text).toContain(ANDROID_RELEASE_CONFIGURATION_AUDIT_CHECK_ID);
  });

  it("includes the android-backup-configuration/android-release-configuration categories in normal validation", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const categories = new Set(result.checks.map((c) => c.category));
    expect(categories.has("android-backup-configuration")).toBe(true);
    expect(categories.has("android-release-configuration")).toBe(true);
  });
});

// Fixture safety for the new Batch 3 fixture families.
describe("Batch 3 fixture safety", () => {
  function allFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? allFiles(full) : [full];
    });
  }

  it("backup-configuration fixtures contain no real credentials or paths", () => {
    const files = allFiles(BACKUP_FIXTURES_ROOT);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).not.toContain("PRIVATE KEY");
    }
  });

  it("release-configuration fixtures contain no real credentials", () => {
    const releaseRoot = path.join(FIXTURES_ROOT, "advanced-security-fixtures", "release-configuration");
    const files = allFiles(releaseRoot);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).not.toContain("PRIVATE KEY");
      expect(content).not.toMatch(/signingConfigs\.(release|debug)\s*\{[^}]*(storePassword|keyPassword)\s*[:=]?\s*["'][^"']+["']/);
    }
  });
});
