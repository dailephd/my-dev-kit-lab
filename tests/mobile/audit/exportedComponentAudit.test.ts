import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { auditAndroidExportedComponents } from "../../../src/mobile/android/audit/exportedComponentAudit.js";
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

// ANDROID-B3-17: A protected exported component gets a lower severity than
// an equivalent unprotected one, and retains the protection evidence.
describe("auditAndroidExportedComponents — protected exported component — ANDROID-B3-17", () => {
  it("gives an informational finding to a permission-protected exported activity", () => {
    const result = auditAndroidExportedComponents(detectedAndroid(), [androidEntry(riskyXml)]);
    const protectedFinding = result.findings.find((f) => f.title.includes("ProtectedExportedActivity"));
    expect(protectedFinding?.severity).toBe("informational");
    expect(protectedFinding?.evidence).toContain("com.example.risky.permission.ADMIN");
  });

  it("gives protected and unprotected equivalent components different severities", () => {
    const result = auditAndroidExportedComponents(detectedAndroid(), [androidEntry(riskyXml)]);
    const protectedFinding = result.findings.find((f) => f.title.includes("ProtectedExportedActivity"));
    const unprotectedFinding = result.findings.find((f) => f.title.includes("UnprotectedExportedActivity"));
    expect(protectedFinding?.severity).not.toBe(unprotectedFinding?.severity);
  });
});

// ANDROID-B3-18: An unprotected explicitly exported activity produces an
// evidence-backed finding.
describe("auditAndroidExportedComponents — unprotected exported activity — ANDROID-B3-18", () => {
  it("flags the unprotected exported activity with evidence", () => {
    const result = auditAndroidExportedComponents(detectedAndroid(), [androidEntry(riskyXml)]);
    const finding = result.findings.find((f) => f.title.includes("UnprotectedExportedActivity"));
    expect(finding?.severity).toBe("minor");
    expect(finding?.affectedFiles).toContain("AndroidManifest.xml");
  });

  it("never flags an explicitly non-exported component", () => {
    const result = auditAndroidExportedComponents(detectedAndroid(), [androidEntry(riskyXml)]);
    expect(result.findings.some((f) => f.title.includes("NotExportedActivity"))).toBe(false);
  });
});

// ANDROID-B3-19: Exported services/receivers with broad entry-point evidence
// are reported conservatively.
describe("auditAndroidExportedComponents — exported service and receiver — ANDROID-B3-19", () => {
  it("reports the unprotected exported service and receiver conservatively (minor, not major)", () => {
    const result = auditAndroidExportedComponents(detectedAndroid(), [androidEntry(riskyXml)]);
    const service = result.findings.find((f) => f.title.includes("UnprotectedExportedService"));
    const receiver = result.findings.find((f) => f.title.includes("UnprotectedExportedReceiver"));
    expect(service?.severity).toBe("minor");
    expect(receiver?.severity).toBe("minor");
  });
});

// ANDROID-B3-20: Exported providers preserve authority/permission evidence
// and produce a finding scaled to protection state.
describe("auditAndroidExportedComponents — exported provider — ANDROID-B3-20", () => {
  it("uses major severity only for a fully unprotected exported provider", () => {
    const result = auditAndroidExportedComponents(detectedAndroid(), [androidEntry(riskyXml)]);
    const unprotected = result.findings.find((f) => f.title.includes("UnprotectedExportedProvider"));
    expect(unprotected?.severity).toBe("major");
  });

  it("uses minor severity for a partially protected provider (only read or write set)", () => {
    const result = auditAndroidExportedComponents(detectedAndroid(), [androidEntry(riskyXml)]);
    const partial = result.findings.find((f) => f.title.includes("PartiallyProtectedProvider"));
    expect(partial?.severity).toBe("minor");
  });

  it("uses informational severity for a fully protected provider", () => {
    const result = auditAndroidExportedComponents(detectedAndroid(), [androidEntry(riskyXml)]);
    const full = result.findings.find((f) => f.title.includes("FullyProtectedProvider"));
    expect(full?.severity).toBe("informational");
  });
});

// ANDROID-B3-21: Unspecified exported state + intent filter → review, not
// "definitely exported".
describe("auditAndroidExportedComponents — unspecified exported with filter — ANDROID-B3-21", () => {
  it("flags unspecified-exported-with-filter as review-required, not as confirmed export", () => {
    const result = auditAndroidExportedComponents(detectedAndroid(), [androidEntry(riskyXml)]);
    const finding = result.findings.find((f) => f.title.includes("UnspecifiedExportedActivity"));
    expect(finding?.id).toContain("unspecified-exported-with-filter");
    expect(finding?.description).not.toMatch(/is exported\b/i);
    expect(finding?.severity).toBe("minor");
  });

  it("gives the launcher activity an informational (not minor) finding since it is expected to be exported", () => {
    const result = auditAndroidExportedComponents(detectedAndroid(), [androidEntry(riskyXml)]);
    const launcher = result.findings.find((f) => f.title.includes("MainActivity"));
    expect(launcher?.severity).toBe("informational");
  });
});
