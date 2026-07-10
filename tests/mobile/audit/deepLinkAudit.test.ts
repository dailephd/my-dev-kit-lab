import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { auditAndroidDeepLinks } from "../../../src/mobile/android/audit/deepLinkAudit.js";
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

const riskyDeepLinksXml = fs.readFileSync(path.join(FIXTURES_ROOT, "manifest-audit-fixtures", "risky-deep-links.xml"), "utf8");

// ANDROID-B3-24: A bounded deep link is represented without exaggerated severity.
describe("auditAndroidDeepLinks — safe bounded deep link — ANDROID-B3-24", () => {
  it("gives the bounded, host+path-restricted deep link an informational finding", () => {
    // The risky-deep-links fixture intentionally bundles several risky
    // activities alongside the bounded one, so the overall check result can
    // be "failed" — what matters here is that the bounded activity itself
    // is not exaggerated to minor/major severity.
    const result = auditAndroidDeepLinks(detectedAndroid(), [androidEntry(riskyDeepLinksXml)]);
    const finding = result.findings.find((f) => f.title.includes("BoundedSafeDeepLinkActivity"));
    expect(finding?.severity).toBe("informational");
  });

  it("reports 'passed' for a manifest containing only a bounded deep link", () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name=".Bounded" android:exported="true"><intent-filter android:autoVerify="true"><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="https" android:host="example.com" android:pathPrefix="/product"/></intent-filter></activity></application></manifest>`;
    const result = auditAndroidDeepLinks(detectedAndroid(), [androidEntry(xml)]);
    expect(result.status).toBe("passed");
  });
});

// ANDROID-B3-25: Custom scheme without host is a review finding, not
// automatically exploitable.
describe("auditAndroidDeepLinks — custom scheme without host — ANDROID-B3-25", () => {
  it("flags the custom scheme with no host restriction as minor, not exploitable", () => {
    const result = auditAndroidDeepLinks(detectedAndroid(), [androidEntry(riskyDeepLinksXml)]);
    const finding = result.findings.find((f) => f.title.includes("CustomSchemeNoHostActivity"));
    expect(finding?.severity).toBe("minor");
    expect(finding?.description).not.toMatch(/exploitable/i);
  });
});

// ANDROID-B3-26: HTTP/HTTPS without a host produces a configuration finding.
describe("auditAndroidDeepLinks — web link without host — ANDROID-B3-26", () => {
  it("flags an https filter with no host as minor", () => {
    const result = auditAndroidDeepLinks(detectedAndroid(), [androidEntry(riskyDeepLinksXml)]);
    const finding = result.findings.find((f) => f.title.includes("HttpNoHostActivity"));
    expect(finding?.severity).toBe("minor");
    expect(finding?.title).toContain("no host restriction");
  });
});

// ANDROID-B3-27: Broad path matching is retained and qualified.
describe("auditAndroidDeepLinks — broad path matching — ANDROID-B3-27", () => {
  it("escalates to major only when exported+unprotected+wildcard all combine", () => {
    const result = auditAndroidDeepLinks(detectedAndroid(), [androidEntry(riskyDeepLinksXml)]);
    const finding = result.findings.find((f) => f.title.includes("BroadPathPatternActivity"));
    expect(finding?.severity).toBe("major");
    expect(finding?.evidence).toContain("scheme=web");
  });

  it("does not escalate to major when the component is not exported", () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name=".Broad"><intent-filter><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="https" android:host="example.com" android:pathPattern=".*"/></intent-filter></activity></application></manifest>`;
    const result = auditAndroidDeepLinks(detectedAndroid(), [androidEntry(xml)]);
    const finding = result.findings.find((f) => f.title.includes("Broad"));
    expect(finding?.severity).toBe("minor");
  });
});

// ANDROID-B3-28: Placeholder-heavy deep link produces reduced-confidence
// findings, not fabricated resolved values.
describe("auditAndroidDeepLinks — placeholder-based deep link — ANDROID-B3-28", () => {
  it("produces a low-confidence, informational finding for placeholder scheme/host", () => {
    const xml = fs.readFileSync(path.join(FIXTURES_ROOT, "manifest-audit-fixtures", "unresolved-placeholder.xml"), "utf8");
    const result = auditAndroidDeepLinks(detectedAndroid(), [androidEntry(xml)]);
    const finding = result.findings.find((f) => f.id.includes("placeholder-value"));
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("informational");
    expect(finding?.evidence).toContain("confidence=low");
  });
});

describe("auditAndroidDeepLinks — incomplete filter patterns", () => {
  it("flags BROWSABLE without VIEW as informational, distinct from a real deep link", () => {
    const xml = fs.readFileSync(path.join(FIXTURES_ROOT, "manifest-audit-fixtures", "incomplete-intent-filter.xml"), "utf8");
    const result = auditAndroidDeepLinks(detectedAndroid(), [androidEntry(xml)]);
    const finding = result.findings.find((f) => f.title.includes("BrowsableOnlyActivity"));
    expect(finding?.id).toContain("browsable-without-view");
    expect(finding?.severity).toBe("informational");
  });
});
