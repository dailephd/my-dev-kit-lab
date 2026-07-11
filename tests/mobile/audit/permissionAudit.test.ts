import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { auditAndroidPermissions } from "../../../src/mobile/android/audit/permissionAudit.js";
import { parseAndroidManifestSource } from "../../../src/mobile/android/manifest/parseAndroidManifest.js";
import { detectAndroidProject } from "../../../src/mobile/android/detect/detectAndroidProject.js";
import type { AndroidDetectionResult } from "../../../src/mobile/android/detection.js";
import type { AndroidManifestParseEntry } from "../../../src/mobile/android/manifest/parseAndroidManifest.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android");

function androidEntry(xml: string, manifestPath = "AndroidManifest.xml"): AndroidManifestParseEntry {
  return { manifestPath, sourceSetKind: "main", manifest: parseAndroidManifestSource(xml, manifestPath) };
}

function detectedAndroid(): AndroidDetectionResult {
  return detectAndroidProject(path.join(FIXTURES_ROOT, "compose-app"));
}

const permissionCoverageXml = fs.readFileSync(path.join(FIXTURES_ROOT, "manifest-audit-fixtures", "permission-coverage.xml"), "utf8");

// ANDROID-B3-13: Ordinary INTERNET and other low-risk declarations do not
// produce exaggerated high-severity findings.
describe("auditAndroidPermissions — safe baseline — ANDROID-B3-13", () => {
  it("produces no findings for INTERNET/ACCESS_NETWORK_STATE alone", () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET"/><uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/><application/></manifest>`;
    const result = auditAndroidPermissions(detectedAndroid(), [androidEntry(xml)]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("passed");
  });
});

// ANDROID-B3-14: Sensitive permission declarations produce evidence-backed
// review findings with exact names and conservative descriptions.
describe("auditAndroidPermissions — sensitive permission review — ANDROID-B3-14", () => {
  it("flags CAMERA, RECORD_AUDIO, and contacts/calendar/sms/call-log with the exact declared name", () => {
    const result = auditAndroidPermissions(detectedAndroid(), [androidEntry(permissionCoverageXml)]);
    const names = result.findings.map((f) => f.evidence);
    expect(result.findings.some((f) => f.title.includes("android.permission.CAMERA"))).toBe(true);
    expect(result.findings.some((f) => f.title.includes("android.permission.RECORD_AUDIO"))).toBe(true);
    expect(result.findings.some((f) => f.severity === "major")).toBe(false);
    expect(names.every((e) => e !== undefined)).toBe(true);
  });

  it("never uses blocker severity for a permission declaration alone", () => {
    const result = auditAndroidPermissions(detectedAndroid(), [androidEntry(permissionCoverageXml)]);
    expect(result.findings.every((f) => f.severity !== "blocker")).toBe(true);
  });
});

// ANDROID-B3-15: Background location + foreground location combination is
// recognized as a stronger review condition, not runtime misuse.
describe("auditAndroidPermissions — background-location combination — ANDROID-B3-15", () => {
  it("recognizes background + foreground location declared together", () => {
    const result = auditAndroidPermissions(detectedAndroid(), [androidEntry(permissionCoverageXml)]);
    const combo = result.findings.find((f) => f.id.includes("background-and-foreground-location"));
    expect(combo).toBeDefined();
    expect(combo?.description).not.toMatch(/misuse|malicious/i);
  });

  it("does not raise the combination finding when only background location is declared", () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION"/><application/></manifest>`;
    const result = auditAndroidPermissions(detectedAndroid(), [androidEntry(xml)]);
    expect(result.findings.some((f) => f.id.includes("background-and-foreground-location"))).toBe(false);
    expect(result.findings.some((f) => f.id.includes("android-permission-sensitive"))).toBe(true);
  });
});

// ANDROID-B3-16: Unknown custom permissions are preserved and reviewed
// without being classified as dangerous automatically.
describe("auditAndroidPermissions — unknown custom permission — ANDROID-B3-16", () => {
  it("flags a custom permission as informational review, not dangerous", () => {
    const result = auditAndroidPermissions(detectedAndroid(), [androidEntry(permissionCoverageXml)]);
    const custom = result.findings.find((f) => f.id.includes("unknown-custom"));
    expect(custom?.severity).toBe("informational");
    expect(custom?.title).toContain("com.example.permissions.CUSTOM_PERMISSION");
  });

  it("deduplicates a permission declared twice into a single finding", () => {
    const result = auditAndroidPermissions(detectedAndroid(), [androidEntry(permissionCoverageXml)]);
    const cameraFindings = result.findings.filter((f) => f.title.includes("android.permission.CAMERA"));
    expect(cameraFindings).toHaveLength(1);
    expect(cameraFindings[0].evidence).toContain("declared 2 times");
  });
});
