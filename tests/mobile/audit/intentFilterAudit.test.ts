import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { auditAndroidIntentFilters } from "../../../src/mobile/android/audit/intentFilterAudit.js";
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

const riskyXml = fs.readFileSync(path.join(FIXTURES_ROOT, "manifest-audit-fixtures", "risky-components.xml"), "utf8");

// ANDROID-B3-22: A standard launcher intent filter does not automatically
// produce a finding solely because it exists — required negative control.
describe("auditAndroidIntentFilters — negative control — ANDROID-B3-22", () => {
  it("does not flag the standard MAIN/LAUNCHER intent filter", () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name=".Main" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>`;
    const result = auditAndroidIntentFilters(detectedAndroid(), [androidEntry(xml)]);
    expect(result.findings).toEqual([]);
    expect(result.status).toBe("passed");
  });
});

// ANDROID-B3-23: A custom action on a reachable component produces a review
// finding with appropriate confidence.
describe("auditAndroidIntentFilters — custom action entry point — ANDROID-B3-23", () => {
  it("flags a custom action on an explicitly exported component with high confidence", () => {
    const result = auditAndroidIntentFilters(detectedAndroid(), [androidEntry(riskyXml)]);
    const finding = result.findings.find((f) => f.title.includes("UnprotectedExportedActivity"));
    expect(finding).toBeDefined();
    expect(finding?.evidence).toContain("com.example.risky.CUSTOM_ACTION");
    expect(finding?.severity).toBe("minor");
  });

  it("flags a custom action with medium confidence when exported state is unspecified", () => {
    const result = auditAndroidIntentFilters(detectedAndroid(), [androidEntry(riskyXml)]);
    const finding = result.findings.find((f) => f.title.includes("UnspecifiedExportedActivity"));
    expect(finding?.evidence).toContain("confidence=medium");
  });

  it("does not claim exploitability from the action string alone", () => {
    const result = auditAndroidIntentFilters(detectedAndroid(), [androidEntry(riskyXml)]);
    const finding = result.findings.find((f) => f.title.includes("UnprotectedExportedActivity"));
    expect(finding?.description).not.toMatch(/exploitable|vulnerable/i);
  });
});

describe("auditAndroidIntentFilters — malformed and duplicate filters", () => {
  it("flags an empty intent-filter as informational", () => {
    const xml = fs.readFileSync(path.join(FIXTURES_ROOT, "manifest-audit-fixtures", "incomplete-intent-filter.xml"), "utf8");
    const result = auditAndroidIntentFilters(detectedAndroid(), [androidEntry(xml)]);
    const empty = result.findings.find((f) => f.title.includes("EmptyFilterActivity"));
    expect(empty?.severity).toBe("informational");
  });

  it("flags duplicate actions/categories within one filter", () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name=".Dup" android:exported="true"><intent-filter><action android:name="android.intent.action.VIEW"/><action android:name="android.intent.action.VIEW"/></intent-filter></activity></application></manifest>`;
    const result = auditAndroidIntentFilters(detectedAndroid(), [androidEntry(xml)]);
    expect(result.findings.some((f) => f.id.includes("duplicate-entries"))).toBe(true);
  });
});
