import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectAndroidProject } from "../../../../src/mobile/android/detect/detectAndroidProject.js";
import { parseAllAndroidManifests } from "../../../../src/mobile/android/manifest/parseAndroidManifest.js";
import { auditAndroidBackupConfiguration, ANDROID_BACKUP_CONFIGURATION_AUDIT_CHECK_ID } from "../../../../src/mobile/android/advancedSecurity/backupConfiguration/checkResult.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "..", "fixtures", "android");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

// ANDROID-V041-B3-41 — standalone AndroidCheckResult-compatible object.
describe("auditAndroidBackupConfiguration — standalone check result", () => {
  it("returns a deterministic AndroidCheckResult with the expected id/category", () => {
    const targetRoot = fixture("compose-app");
    const detection = detectAndroidProject(targetRoot);
    const manifests = parseAllAndroidManifests(targetRoot, detection);
    const result = auditAndroidBackupConfiguration(targetRoot, detection, manifests);

    expect(result.id).toBe(ANDROID_BACKUP_CONFIGURATION_AUDIT_CHECK_ID);
    expect(result.category).toBe("android-backup-configuration");
    expect(result.ran).toBe(true);
    expect(Array.isArray(result.candidateEvidence)).toBe(true);
  });

  it("is deterministic across repeated invocations", () => {
    const targetRoot = fixture("compose-app");
    const detection = detectAndroidProject(targetRoot);
    const manifests = parseAllAndroidManifests(targetRoot, detection);
    const first = auditAndroidBackupConfiguration(targetRoot, detection, manifests);
    const second = auditAndroidBackupConfiguration(targetRoot, detection, manifests);
    expect(first).toEqual(second);
  });

  it("does not apply application-only conclusions to a library module", () => {
    const targetRoot = fixture("library");
    const detection = detectAndroidProject(targetRoot);
    const manifests = parseAllAndroidManifests(targetRoot, detection);
    const result = auditAndroidBackupConfiguration(targetRoot, detection, manifests);
    expect(result.ran).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("analyzes multi-module manifests independently, retaining module identity", () => {
    const targetRoot = fixture("multi-module");
    const detection = detectAndroidProject(targetRoot);
    const manifests = parseAllAndroidManifests(targetRoot, detection);
    const result = auditAndroidBackupConfiguration(targetRoot, detection, manifests);
    expect(result.ran).toBe(true);
    expect(result.sourcePaths.length).toBe(manifests.length);
  });
});
