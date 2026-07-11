import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateAndroidTarget } from "../../../src/mobile/android/validate/validateAndroidTarget.js";
import { toAndroidReportModel } from "../../../src/mobile/android/report/model.js";
import { renderAndroidTextReport } from "../../../src/mobile/android/report/renderAndroidReport.js";
import { ANDROID_SENSITIVE_STORAGE_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/sensitiveStorage/checkResult.js";
import { ANDROID_SENSITIVE_LOGGING_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/sensitiveLogging/checkResult.js";
import { ANDROID_CLIPBOARD_SECURITY_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/clipboard/checkResult.js";
import { ANDROID_FIREBASE_GOOGLE_SERVICES_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/firebaseGoogle/checkResult.js";
import { ANDROID_SEMGREP_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/externalTools/semgrep/checkResult.js";
import { ANDROID_OSV_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/externalTools/osv/checkResult.js";
import { ANDROID_LINT_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/externalTools/androidLint/checkResult.js";
import { ANDROID_DEPENDENCY_CHECK_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/externalTools/dependencyCheck/checkResult.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android");
const TOOL_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

const ALL_BATCH_7_TOOL_CHECK_IDS = [ANDROID_SEMGREP_AUDIT_CHECK_ID, ANDROID_OSV_AUDIT_CHECK_ID, ANDROID_LINT_AUDIT_CHECK_ID, ANDROID_DEPENDENCY_CHECK_AUDIT_CHECK_ID];

describe("Batch 7 external tools remain opt-in even after Batch 8 activates internal checks", () => {
  it("validateAndroidTarget never runs or reports any Batch 7 external-tool check id", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const ids = result.checks.map((c) => c.id);
    for (const checkId of ALL_BATCH_7_TOOL_CHECK_IDS) {
      expect(ids).not.toContain(checkId);
    }
  });

  it("renders a text report that never claims any Batch 7 tool ran", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const model = toAndroidReportModel(result);
    const text = renderAndroidTextReport(model);
    for (const checkId of ALL_BATCH_7_TOOL_CHECK_IDS) {
      expect(text).not.toContain(checkId);
    }
  });

  it("keeps result.checks free of the four Batch 7 tool categories in normal validation", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const categories = new Set(result.checks.map((c) => c.category));
    expect(categories.has("android-semgrep")).toBe(false);
    expect(categories.has("android-osv")).toBe(false);
    expect(categories.has("android-lint")).toBe(false);
    expect(categories.has("android-dependency-check")).toBe(false);
  });

  it("still produces a valid, unchanged verdict for the Compose fixture (v0.4.0 regression)", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    expect(["ready-for-release-preparation", "ready-except-optional-manual-checks"]).toContain(result.verdict);
  });

  it("Batch 2-6 internal checks are active by default (Batch 8 activation) while Batch 7 external tools stay opt-in", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const ids = result.checks.map((c) => c.id);
    expect(ids).toContain(ANDROID_SENSITIVE_STORAGE_AUDIT_CHECK_ID);
    expect(ids).toContain(ANDROID_SENSITIVE_LOGGING_AUDIT_CHECK_ID);
    expect(ids).toContain(ANDROID_CLIPBOARD_SECURITY_AUDIT_CHECK_ID);
    expect(ids).toContain(ANDROID_FIREBASE_GOOGLE_SERVICES_AUDIT_CHECK_ID);
    for (const checkId of ALL_BATCH_7_TOOL_CHECK_IDS) {
      expect(ids).not.toContain(checkId);
    }
  });
});

describe("Batch 7 — no unauthorized installer, download, or shell execution paths", () => {
  it("production Batch 7 modules never reference package-manager installers or binary downloads", () => {
    const externalToolsRoot = path.resolve("src/mobile/android/advancedSecurity/externalTools");
    const files = allTsFiles(externalToolsRoot);
    expect(files.length).toBeGreaterThan(10);
    const forbidden = /\bnpm install\b|\bnpx\b|\bpip install\b|\bpipx\b|\bbrew install\b|\bapt(-get)? install\b|\bwinget install\b|\bchoco install\b|\bcurl\s|\bwget\s/;
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).not.toMatch(forbidden);
    }
  });

  it("production Batch 7 modules never use shell:true or command-string concatenation for process execution", () => {
    const externalToolsRoot = path.resolve("src/mobile/android/advancedSecurity/externalTools");
    const files = allTsFiles(externalToolsRoot);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).not.toMatch(/shell:\s*true/);
      // child_process.exec (string-shell) is never imported by any Batch 7
      // module — RegExp.prototype.exec (used for version parsing) is fine
      // and deliberately not matched by this narrower check.
      expect(content).not.toMatch(/\bexecSync\s*\(|\{\s*exec\s*\}\s*from\s*["']node:child_process["']/);
    }
  });

  it("production Batch 7 modules never import child_process directly (process execution goes through runSecurityCommand only)", () => {
    const externalToolsRoot = path.resolve("src/mobile/android/advancedSecurity/externalTools");
    const files = allTsFiles(externalToolsRoot);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).not.toMatch(/from\s*["']node:child_process["']/);
    }
  });

  it("no Semgrep adapter file references a remote registry config identifier or SEMGREP_APP_TOKEN", () => {
    const files = allTsFiles(path.resolve("src/mobile/android/advancedSecurity/externalTools/semgrep"));
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).not.toContain("SEMGREP_APP_TOKEN");
      expect(content).not.toMatch(/["'`]p\/|["'`]r\/|registry\.semgrep/);
    }
  });

  it("no Dependency-Check adapter file references an NVD API key", () => {
    const files = allTsFiles(path.resolve("src/mobile/android/advancedSecurity/externalTools/dependencyCheck"));
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).not.toContain("NVD_API_KEY");
      expect(content).not.toContain("nvdApiKey");
    }
  });

  it("Android Lint adapter never adds a download/refresh-dependencies flag", () => {
    const files = allTsFiles(path.resolve("src/mobile/android/advancedSecurity/externalTools/androidLint"));
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content).not.toContain("--refresh-dependencies");
      expect(content).not.toContain("--update-locks");
    }
  });
});

function allTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return allTsFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}
