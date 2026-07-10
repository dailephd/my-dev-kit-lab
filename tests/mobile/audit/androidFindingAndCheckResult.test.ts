import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { auditAndroidPermissions } from "../../../src/mobile/android/audit/permissionAudit.js";
import { auditAndroidExportedComponents } from "../../../src/mobile/android/audit/exportedComponentAudit.js";
import { parseAllAndroidManifests, parseAndroidManifestSource } from "../../../src/mobile/android/manifest/parseAndroidManifest.js";
import { detectAndroidProject } from "../../../src/mobile/android/detect/detectAndroidProject.js";
import type { AndroidManifestParseEntry } from "../../../src/mobile/android/manifest/parseAndroidManifest.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android");

function androidEntry(xml: string, manifestPath = "AndroidManifest.xml"): AndroidManifestParseEntry {
  return { manifestPath, sourceSetKind: "main", manifest: parseAndroidManifestSource(xml, manifestPath) };
}

const riskyXml = fs.readFileSync(path.join(FIXTURES_ROOT, "manifest-audit-fixtures", "risky-components.xml"), "utf8");

// ANDROID-B3-29: Equivalent parsed evidence produces stable finding IDs
// independent of timestamps and enumeration order.
describe("Android finding IDs — stability — ANDROID-B3-29", () => {
  it("produces identical finding ids for two independent parses of the same manifest", () => {
    const detection = detectAndroidProject(path.join(FIXTURES_ROOT, "compose-app"));
    const first = auditAndroidExportedComponents(detection, [androidEntry(riskyXml)]);
    const second = auditAndroidExportedComponents(detection, [androidEntry(riskyXml)]);
    expect(first.findings.map((f) => f.id)).toEqual(second.findings.map((f) => f.id));
  });

  it("finding ids do not contain a timestamp or random component", () => {
    const detection = detectAndroidProject(path.join(FIXTURES_ROOT, "compose-app"));
    const result = auditAndroidExportedComponents(detection, [androidEntry(riskyXml)]);
    for (const finding of result.findings) {
      expect(finding.id).not.toMatch(/\d{13}/); // no epoch-millis-looking substring
    }
  });
});

// ANDROID-B3-30: Repeated parsing/auditing of unchanged fixtures produces
// equivalent normalized output.
describe("Android audit determinism — ANDROID-B3-30", () => {
  it("produces byte-identical JSON for repeated full audits of the same target", () => {
    const root = path.join(FIXTURES_ROOT, "multi-module");
    const runOnce = () => {
      const detection = detectAndroidProject(root);
      const manifests = parseAllAndroidManifests(root, detection);
      return JSON.stringify({
        permissions: auditAndroidPermissions(detection, manifests),
        components: auditAndroidExportedComponents(detection, manifests),
      });
    };
    expect(runOnce()).toBe(runOnce());
  });
});

// ANDROID-B3-31: Check-status semantics — malformed/unsupported/inconclusive
// are never reported as passed.
describe("Android check-result status semantics — ANDROID-B3-31", () => {
  it("reports 'unsupported' (never 'passed') for a non-Android target", () => {
    const root = path.join(FIXTURES_ROOT, "non-android-gradle");
    const detection = detectAndroidProject(root);
    const manifests = parseAllAndroidManifests(root, detection);
    const result = auditAndroidPermissions(detection, manifests);
    expect(result.status).toBe("unsupported");
    expect(result.status).not.toBe("passed");
    expect(result.skipped).toBe(true);
  });

  it("reports 'inconclusive' (never 'passed') when Android was detected but no manifest was found", () => {
    const detection = detectAndroidProject(path.join(FIXTURES_ROOT, "compose-app"));
    const result = auditAndroidPermissions({ ...detection, manifestPaths: [] }, []);
    expect(result.status).toBe("inconclusive");
    expect(result.status).not.toBe("passed");
  });

  it("reports 'error' (never 'passed') when every manifest is malformed", () => {
    const detection = detectAndroidProject(path.join(FIXTURES_ROOT, "compose-app"));
    const malformedXml = fs.readFileSync(path.join(FIXTURES_ROOT, "manifest-audit-fixtures", "malformed.xml"), "utf8");
    const result = auditAndroidPermissions(detection, [androidEntry(malformedXml)]);
    expect(result.status).toBe("error");
    expect(result.status).not.toBe("passed");
  });

  it("reports 'passed' only when manifests parsed and no reportable finding exists", () => {
    const detection = detectAndroidProject(path.join(FIXTURES_ROOT, "compose-app"));
    const safeXml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET"/><application/></manifest>`;
    const result = auditAndroidPermissions(detection, [androidEntry(safeXml)]);
    expect(result.status).toBe("passed");
  });

  it("reports 'failed' (never 'passed') when a reportable finding exists", () => {
    const detection = detectAndroidProject(path.join(FIXTURES_ROOT, "compose-app"));
    const result = auditAndroidExportedComponents(detection, [androidEntry(riskyXml)]);
    expect(result.status).toBe("failed");
  });
});
