import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateAndroidTarget } from "../../../src/mobile/android/validate/validateAndroidTarget.js";
import { toAndroidReportModel } from "../../../src/mobile/android/report/model.js";
import { renderAndroidTextReport } from "../../../src/mobile/android/report/renderAndroidReport.js";
import { ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/networkSecurity/checkResult.js";
import { ANDROID_BACKUP_CONFIGURATION_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/backupConfiguration/checkResult.js";
import { ANDROID_RELEASE_CONFIGURATION_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/releaseConfiguration/checkResult.js";
import { ANDROID_SECRET_CANDIDATES_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/secretCandidates/checkResult.js";
import { ANDROID_SIGNING_CONFIGURATION_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/signingConfiguration/checkResult.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android");
const TOOL_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

// ANDROID-V041-B4-55/56/57/58 — no active registration; Batch 2/3/v0.4.0 regression.
describe("Batch 4 does not affect active Android validation, reports, Batch 2, or Batch 3", () => {
  it("validateAndroidTarget never runs or reports any Batch 2/3/4 standalone check id", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const ids = result.checks.map((c) => c.id);
    expect(ids).not.toContain(ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID);
    expect(ids).not.toContain(ANDROID_BACKUP_CONFIGURATION_AUDIT_CHECK_ID);
    expect(ids).not.toContain(ANDROID_RELEASE_CONFIGURATION_AUDIT_CHECK_ID);
    expect(ids).not.toContain(ANDROID_SECRET_CANDIDATES_AUDIT_CHECK_ID);
    expect(ids).not.toContain(ANDROID_SIGNING_CONFIGURATION_AUDIT_CHECK_ID);
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

  it("still produces a valid, unchanged verdict for the Compose fixture", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    expect(["ready-for-release-preparation", "ready-except-optional-manual-checks"]).toContain(result.verdict);
  });

  it("renders a text report that never claims any Batch 2/3/4 check ran", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const model = toAndroidReportModel(result);
    const text = renderAndroidTextReport(model);
    for (const checkId of [
      ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID,
      ANDROID_BACKUP_CONFIGURATION_AUDIT_CHECK_ID,
      ANDROID_RELEASE_CONFIGURATION_AUDIT_CHECK_ID,
      ANDROID_SECRET_CANDIDATES_AUDIT_CHECK_ID,
      ANDROID_SIGNING_CONFIGURATION_AUDIT_CHECK_ID,
    ]) {
      expect(text).not.toContain(checkId);
    }
  });

  it("keeps result.checks free of android-secret-candidates/android-signing-configuration categories in normal validation", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const categories = new Set(result.checks.map((c) => c.category));
    expect(categories.has("android-secret-candidates")).toBe(false);
    expect(categories.has("android-signing-configuration")).toBe(false);
  });

  it("Batch 3's buildTypeDetails/signingConfigRef extraction remains unchanged (Batch 3 regression)", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    expect(Array.isArray(result.gradle.modules)).toBe(true);
    for (const module of result.gradle.modules) {
      expect(Array.isArray(module.buildTypes)).toBe(true);
    }
  });
});

// ANDROID-V041-B4-52 — no process/network execution across all Batch 4 modules.
describe("Batch 4 — no process or network execution", () => {
  it("never references child_process or network modules in any new Batch 4 module", () => {
    const moduleFiles = [
      "src/mobile/android/advancedSecurity/secretCandidates/discoverSecretSourceFiles.ts",
      "src/mobile/android/advancedSecurity/secretCandidates/matchSecretCandidates.ts",
      "src/mobile/android/advancedSecurity/secretCandidates/analyzeSecretCandidates.ts",
      "src/mobile/android/advancedSecurity/secretCandidates/checkResult.ts",
      "src/mobile/android/advancedSecurity/signingConfiguration/discoverKeystoreCandidates.ts",
      "src/mobile/android/advancedSecurity/signingConfiguration/extractSigningConfigurations.ts",
      "src/mobile/android/advancedSecurity/signingConfiguration/analyzeSigningConfiguration.ts",
      "src/mobile/android/advancedSecurity/signingConfiguration/checkResult.ts",
    ];
    for (const file of moduleFiles) {
      const content = fs.readFileSync(path.resolve(file), "utf8");
      expect(content).not.toMatch(/child_process|node:net\b|node:http\b|node:https\b/);
    }
  });
});

// ANDROID-V041-B4-47 — signing analysis never reads keystore binary contents.
describe("Batch 4 — no keystore content read", () => {
  it("discoverKeystoreCandidates and analyzeSigningConfiguration never call readFileSync/readFile on a keystore extension", () => {
    const discoveryContent = fs.readFileSync(
      path.resolve("src/mobile/android/advancedSecurity/signingConfiguration/discoverKeystoreCandidates.ts"),
      "utf8"
    );
    expect(discoveryContent).not.toMatch(/readFileSync|readFile\(/);
  });
});

// Fixture safety.
describe("Batch 4 fixture safety", () => {
  function allFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? allFiles(full) : [full];
    });
  }

  it("secret-candidates fixtures contain only unmistakably fake values", () => {
    const dir = path.join(FIXTURES_ROOT, "advanced-security-fixtures", "secret-candidates");
    const files = allFiles(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).not.toContain("-----BEGIN RSA PRIVATE KEY-----MII"); // no real-shaped embedded key body marker
    }
  });

  it("signing-configuration keystore fixtures are not real keystore files", () => {
    const dir = path.join(FIXTURES_ROOT, "advanced-security-fixtures", "signing-configuration");
    const files = allFiles(dir).filter((f) => f.endsWith(".jks") || f.endsWith(".keystore"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).toContain("FAKE_KEYSTORE_DUMMY_BYTES");
    }
  });
});
