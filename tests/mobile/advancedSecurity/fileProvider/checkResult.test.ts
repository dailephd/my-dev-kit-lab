import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditAndroidFileProviders } from "../../../../src/mobile/android/advancedSecurity/fileProvider/checkResult.js";
import { parseAndroidManifestSource } from "../../../../src/mobile/android/manifest/parseAndroidManifest.js";
import type { AndroidDetectionResult } from "../../../../src/mobile/android/detection.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function detection(): AndroidDetectionResult { return { detected: true, confidence: "high", evidence: [], projectKind: "application", uiToolkit: "xml-view", hasGradleWrapper: false, gradleSettingsFiles: [], rootBuildFiles: [], versionCatalogFiles: [], modules: [{ path: "app", kind: "application", manifestPaths: ["app/src/main/AndroidManifest.xml"] }], applicationModules: ["app"], libraryModules: [], manifestPaths: ["app/src/main/AndroidManifest.xml"], javaSourceRoots: [], kotlinSourceRoots: [], unitTestSourceRoots: [], instrumentedTestSourceRoots: [], partialOrUnsupportedStructure: false, warnings: [] }; }
describe("standalone FileProvider audit", () => {
  it("retains provider metadata and correlates an exported unprotected provider with root-path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "provider-audit-")); roots.push(root); fs.mkdirSync(path.join(root, "app/src/main/res/xml"), { recursive: true }); fs.writeFileSync(path.join(root, "app/src/main/res/xml/paths.xml"), '<paths><root-path name="root" path="."/></paths>');
    const manifest = parseAndroidManifestSource('<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><provider android:name="androidx.core.content.FileProvider" android:authorities="example.provider" android:exported="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/paths"/></provider></application></manifest>', "app/src/main/AndroidManifest.xml");
    const result = auditAndroidFileProviders(root, detection(), [{ manifestPath: "app/src/main/AndroidManifest.xml", modulePath: "app", sourceSetKind: "main", manifest }]);
    expect(manifest.providers[0].metadata?.[0].resource).toBe("@xml/paths");
    expect(result.findings.map((item) => item.id).join(" ")).toContain("android-file-provider-broad-paths");
    expect(result.candidateEvidence?.some((item) => item.ruleId === "android-file-provider-missing-protection" && item.summary.includes("generic exported audit"))).toBe(true);
  });
  it("keeps missing paths XML as review evidence rather than a fabricated finding", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "provider-audit-")); roots.push(root);
    const manifest = parseAndroidManifestSource('<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><provider android:name="androidx.core.content.FileProvider" android:exported="false"/></application></manifest>', "app/src/main/AndroidManifest.xml");
    const result = auditAndroidFileProviders(root, detection(), [{ manifestPath: "app/src/main/AndroidManifest.xml", modulePath: "app", sourceSetKind: "main", manifest }]);
    expect(result.findings).toHaveLength(0); expect(result.candidateEvidence?.some((item) => item.ruleId === "android-file-provider-missing-paths-xml")).toBe(true);
  });
  it("parses every supported path type and keeps broad paths review-only when exported is false", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "provider-audit-")); roots.push(root); fs.mkdirSync(path.join(root, "app/src/main/res/xml"), { recursive: true });
    fs.writeFileSync(path.join(root, "app/src/main/res/xml/paths.xml"), '<paths><root-path name="root" path="."/><files-path name="files" path="nested/docs"/><cache-path name="cache" path="cache"/><external-path name="external" path="/"/><external-files-path name="ef" path="docs"/><external-cache-path name="ec" path="cache"/><external-media-path name="em" path="media"/><unknown-path name="u" path="."/><files-path path="../escape"/><files-path name="files" path="other"/></paths>');
    const manifest = parseAndroidManifestSource('<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><provider android:name="android.support.v4.content.FileProvider" android:authorities="example.one; example.two" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/paths"/></provider></application></manifest>', "app/src/main/AndroidManifest.xml");
    const result = auditAndroidFileProviders(root, detection(), [{ manifestPath: "app/src/main/AndroidManifest.xml", modulePath: "app", sourceSetKind: "main", manifest }]);
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.some((item) => item.summary.includes("Unsupported FileProvider path"))).toBe(true);
    expect(result.candidateEvidence?.some((item) => item.summary.includes("missing or empty name"))).toBe(true);
    expect(result.candidateEvidence?.some((item) => item.summary.includes("Conflicting"))).toBe(true);
    expect(result.candidateEvidence?.some((item) => item.summary.includes("Potentially broad"))).toBe(true);
  });
  it("preserves raw placeholder states, authority problems, and library-module review boundaries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "provider-audit-")); roots.push(root);
    const manifest = parseAndroidManifestSource('<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.files;;bad authority" android:exported="${exported}" android:grantUriPermissions="${grants}"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="${paths}"/></provider></application></manifest>', "lib/src/main/AndroidManifest.xml");
    const libraryDetection = { ...detection(), modules: [{ path: "lib", kind: "library" as const, manifestPaths: ["lib/src/main/AndroidManifest.xml"] }], applicationModules: [], libraryModules: ["lib"], projectKind: "library" as const };
    const result = auditAndroidFileProviders(root, libraryDetection, [{ manifestPath: "lib/src/main/AndroidManifest.xml", modulePath: "lib", sourceSetKind: "main", manifest }]);
    expect(manifest.providers[0].exportedRaw).toBe("${exported}"); expect(manifest.providers[0].grantUriPermissionsRaw).toBe("${grants}");
    expect(result.findings).toHaveLength(0); expect(result.candidateEvidence?.some((item) => item.resolutionState === "unresolved")).toBe(true); expect(result.candidateEvidence?.some((item) => item.summary.includes("malformed"))).toBe(true);
  });
  it("proves direct custom subclasses module-locally and detects duplicate authorities across manifests", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "provider-audit-")); roots.push(root); fs.mkdirSync(path.join(root, "app/src/main/java/example"), { recursive: true }); fs.mkdirSync(path.join(root, "app/src/main/res/xml"), { recursive: true });
    fs.writeFileSync(path.join(root, "app/src/main/java/example/CustomProvider.java"), "package example; class CustomProvider extends androidx.core.content.FileProvider {} class SimilarFileProvider {}");
    fs.writeFileSync(path.join(root, "app/src/main/res/xml/paths.xml"), '<paths><files-path name="files" path="docs"/></paths>');
    const first = parseAndroidManifestSource('<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="example"><application><provider android:name=".CustomProvider" android:authorities="example.shared" android:exported="false"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/paths"/></provider><provider android:name="example.SimilarFileProvider" android:authorities="example.similar"/></application></manifest>', "app/src/main/AndroidManifest.xml");
    const second = parseAndroidManifestSource('<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><provider android:name="androidx.core.content.FileProvider" android:authorities="example.shared" android:exported="false"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/paths"/></provider></application></manifest>', "app/src/debug/AndroidManifest.xml");
    const result = auditAndroidFileProviders(root, detection(), [{ manifestPath: "app/src/main/AndroidManifest.xml", modulePath: "app", sourceSetKind: "main", manifest: first }, { manifestPath: "app/src/debug/AndroidManifest.xml", modulePath: "app", sourceSetKind: "debug", manifest: second }]);
    expect(result.sourcePaths).toContain("app/src/main/AndroidManifest.xml");
    expect(result.candidateEvidence?.some((item) => item.summary.includes("Duplicate FileProvider authority"))).toBe(true);
    expect(result.candidateEvidence?.some((item) => item.summary.includes("not a directly proven"))).toBe(true);
  });
});
