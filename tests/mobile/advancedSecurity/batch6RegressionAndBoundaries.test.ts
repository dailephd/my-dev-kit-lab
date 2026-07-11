import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateAndroidTarget } from "../../../src/mobile/android/validate/validateAndroidTarget.js";
import { toAndroidReportModel } from "../../../src/mobile/android/report/model.js";
import { renderAndroidTextReport } from "../../../src/mobile/android/report/renderAndroidReport.js";
import { ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/networkSecurity/checkResult.js";
import { ANDROID_BACKUP_CONFIGURATION_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/backupConfiguration/checkResult.js";
import { ANDROID_RELEASE_CONFIGURATION_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/releaseConfiguration/checkResult.js";
import { ANDROID_SECRET_CANDIDATES_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/secretCandidates/checkResult.js";
import { ANDROID_SIGNING_CONFIGURATION_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/signingConfiguration/checkResult.js";
import { ANDROID_WEBVIEW_SECURITY_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/webview/checkResult.js";
import { ANDROID_FILE_PROVIDER_AUDIT_CHECK_ID } from "../../../src/mobile/android/advancedSecurity/fileProvider/checkResult.js";
import { ANDROID_SENSITIVE_STORAGE_AUDIT_CHECK_ID, auditAndroidSensitiveStorage } from "../../../src/mobile/android/advancedSecurity/sensitiveStorage/checkResult.js";
import { ANDROID_SENSITIVE_LOGGING_AUDIT_CHECK_ID, auditAndroidSensitiveLogging } from "../../../src/mobile/android/advancedSecurity/sensitiveLogging/checkResult.js";
import { ANDROID_CLIPBOARD_SECURITY_AUDIT_CHECK_ID, auditAndroidClipboardSecurity } from "../../../src/mobile/android/advancedSecurity/clipboard/checkResult.js";
import { ANDROID_FIREBASE_GOOGLE_SERVICES_AUDIT_CHECK_ID, auditAndroidFirebaseGoogleServices } from "../../../src/mobile/android/advancedSecurity/firebaseGoogle/checkResult.js";
import type { AndroidDetectionResult } from "../../../src/mobile/android/detection.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android");
const TOOL_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

const ALL_BATCH_2_6_CHECK_IDS = [
  ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID,
  ANDROID_BACKUP_CONFIGURATION_AUDIT_CHECK_ID,
  ANDROID_RELEASE_CONFIGURATION_AUDIT_CHECK_ID,
  ANDROID_SECRET_CANDIDATES_AUDIT_CHECK_ID,
  ANDROID_SIGNING_CONFIGURATION_AUDIT_CHECK_ID,
  ANDROID_WEBVIEW_SECURITY_AUDIT_CHECK_ID,
  ANDROID_FILE_PROVIDER_AUDIT_CHECK_ID,
  ANDROID_SENSITIVE_STORAGE_AUDIT_CHECK_ID,
  ANDROID_SENSITIVE_LOGGING_AUDIT_CHECK_ID,
  ANDROID_CLIPBOARD_SECURITY_AUDIT_CHECK_ID,
  ANDROID_FIREBASE_GOOGLE_SERVICES_AUDIT_CHECK_ID,
];

describe("Batch 6 does not affect active Android validation or reports", () => {
  it("validateAndroidTarget never runs or reports any Batch 2-6 standalone check id", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const ids = result.checks.map((c) => c.id);
    for (const checkId of ALL_BATCH_2_6_CHECK_IDS) {
      expect(ids).not.toContain(checkId);
    }
  });

  it("renders a text report that never claims any Batch 6 check ran", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const model = toAndroidReportModel(result);
    const text = renderAndroidTextReport(model);
    expect(text).not.toContain(ANDROID_SENSITIVE_STORAGE_AUDIT_CHECK_ID);
    expect(text).not.toContain(ANDROID_SENSITIVE_LOGGING_AUDIT_CHECK_ID);
    expect(text).not.toContain(ANDROID_CLIPBOARD_SECURITY_AUDIT_CHECK_ID);
    expect(text).not.toContain(ANDROID_FIREBASE_GOOGLE_SERVICES_AUDIT_CHECK_ID);
  });

  it("keeps result.checks free of the four new Batch 6 categories in normal validation", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const categories = new Set(result.checks.map((c) => c.category));
    expect(categories.has("android-sensitive-storage")).toBe(false);
    expect(categories.has("android-sensitive-logging")).toBe(false);
    expect(categories.has("android-clipboard")).toBe(false);
    expect(categories.has("android-firebase-google-services")).toBe(false);
  });

  it("still produces a valid, unchanged verdict for the Compose fixture (v0.4.0 regression)", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    expect(["ready-for-release-preparation", "ready-except-optional-manual-checks"]).toContain(result.verdict);
  });
});

describe("Batch 6 — no process or network execution", () => {
  it("never references child_process or network modules in any new Batch 6 module", () => {
    const moduleFiles = [
      "src/mobile/android/advancedSecurity/sensitiveData/classifySensitiveIdentifier.ts",
      "src/mobile/android/advancedSecurity/sensitiveData/classifyDirectExpression.ts",
      "src/mobile/android/advancedSecurity/sensitiveData/localSourceContext.ts",
      "src/mobile/android/advancedSecurity/sensitiveStorage/collectStorageEvidence.ts",
      "src/mobile/android/advancedSecurity/sensitiveStorage/analyzeSensitiveStorage.ts",
      "src/mobile/android/advancedSecurity/sensitiveStorage/checkResult.ts",
      "src/mobile/android/advancedSecurity/sensitiveLogging/collectLoggingEvidence.ts",
      "src/mobile/android/advancedSecurity/sensitiveLogging/analyzeSensitiveLogging.ts",
      "src/mobile/android/advancedSecurity/sensitiveLogging/checkResult.ts",
      "src/mobile/android/advancedSecurity/clipboard/collectClipboardEvidence.ts",
      "src/mobile/android/advancedSecurity/clipboard/analyzeClipboardSecurity.ts",
      "src/mobile/android/advancedSecurity/clipboard/checkResult.ts",
      "src/mobile/android/advancedSecurity/firebaseGoogle/discoverFirebaseArtifacts.ts",
      "src/mobile/android/advancedSecurity/firebaseGoogle/parseGoogleServicesConfig.ts",
      "src/mobile/android/advancedSecurity/firebaseGoogle/parseFirebaseConfig.ts",
      "src/mobile/android/advancedSecurity/firebaseGoogle/parseDatabaseRules.ts",
      "src/mobile/android/advancedSecurity/firebaseGoogle/parseFirestoreStorageRules.ts",
      "src/mobile/android/advancedSecurity/firebaseGoogle/collectFirebaseServiceEvidence.ts",
      "src/mobile/android/advancedSecurity/firebaseGoogle/analyzeFirebaseGoogleServices.ts",
      "src/mobile/android/advancedSecurity/firebaseGoogle/checkResult.ts",
    ];
    for (const file of moduleFiles) {
      const content = fs.readFileSync(path.resolve(file), "utf8");
      expect(content).not.toMatch(/child_process|node:net\b|node:http\b|node:https\b/);
    }
  });
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function target(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "batch6-cross-check-"));
  roots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const full = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function detection(): AndroidDetectionResult {
  return {
    detected: true,
    confidence: "high",
    evidence: [],
    projectKind: "application",
    uiToolkit: "xml-view",
    hasGradleWrapper: false,
    gradleSettingsFiles: [],
    rootBuildFiles: [],
    versionCatalogFiles: [],
    modules: [{ path: "app", kind: "application", manifestPaths: [] }],
    applicationModules: ["app"],
    libraryModules: [],
    manifestPaths: [],
    javaSourceRoots: [],
    kotlinSourceRoots: [],
    unitTestSourceRoots: [],
    instrumentedTestSourceRoots: [],
    partialOrUnsupportedStructure: false,
    warnings: [],
  };
}

describe("Batch 6 — cross-check ownership boundaries", () => {
  it("a messaging token stored via SharedPreferences is owned by the storage check, not duplicated as a Firebase finding", () => {
    const root = target({
      "app/src/main/java/example/Foo.kt": `
        class Foo {
          fun onNewToken(token: String) {
            val prefs = getSharedPreferences("app", MODE_PRIVATE)
            prefs.edit().putString("authToken", token).apply()
          }
        }
      `,
      "app/build.gradle": `dependencies { implementation("com.google.firebase:firebase-messaging:1.0") }`,
    });
    const storage = auditAndroidSensitiveStorage(root, detection());
    const firebase = auditAndroidFirebaseGoogleServices(root, detection());
    expect(storage.candidateEvidence?.some((c) => c.ruleId === "android-sensitive-preferences")).toBe(true);
    expect(firebase.findings.some((f) => f.title.toLowerCase().includes("token"))).toBe(false);
  });

  it("a Crashlytics sensitive payload finding is owned by the logging check, not the Firebase/Google check", () => {
    const root = target({
      "app/src/main/java/example/Foo.kt": `
        class Foo {
          fun a(password: String) { crashlytics.setCustomKey("password", password) }
        }
      `,
    });
    const logging = auditAndroidSensitiveLogging(root, detection());
    const firebase = auditAndroidFirebaseGoogleServices(root, detection());
    expect(logging.findings.some((f) => f.title.includes("Crashlytics"))).toBe(true);
    expect(firebase.findings.some((f) => f.title.includes("Crashlytics"))).toBe(false);
  });

  it("a messaging token copied to the clipboard is owned by the clipboard check, not duplicated as a Firebase finding", () => {
    const root = target({
      "app/src/main/java/example/Foo.kt": `
        class Foo {
          fun a(authToken: String) { clipboard.setPrimaryClip(ClipData.newPlainText("authToken", authToken)) }
        }
      `,
    });
    const clipboard = auditAndroidClipboardSecurity(root, detection());
    const firebase = auditAndroidFirebaseGoogleServices(root, detection());
    expect(clipboard.findings.some((f) => f.id.includes("android-sensitive-clipboard-write"))).toBe(true);
    expect(firebase.findings).toHaveLength(0);
  });
});

describe("Batch 6 — no raw sensitive value leakage across all four analyzers", () => {
  it("combined scan output never contains any fake fixture secret literal", () => {
    const root = target({
      "app/src/main/java/example/Combined.kt": `
        class Combined {
          fun storage(password: String) {
            getSharedPreferences("p", MODE_PRIVATE).edit().putString("password", "CombinedFakeSecretLiteral1").apply()
          }
          fun logging() { Log.d(TAG, "CombinedFakeSecretLiteral1") }
          fun clipboard() { clipboard.setPrimaryClip(ClipData.newPlainText("password", "CombinedFakeSecretLiteral2")) }
        }
      `,
      "app/google-services.json": JSON.stringify({
        project_info: { project_id: "fake-project" },
        client: [{ client_info: { mobilesdk_app_id: "1:0:android:fake" }, api_key: [{ current_key: "CombinedFakeApiKeyLiteral3" }] }],
      }),
    });
    const results = [
      auditAndroidSensitiveStorage(root, detection()),
      auditAndroidSensitiveLogging(root, detection()),
      auditAndroidClipboardSecurity(root, detection()),
      auditAndroidFirebaseGoogleServices(root, detection()),
    ];
    const serialized = JSON.stringify(results);
    expect(serialized).not.toContain("CombinedFakeSecretLiteral1");
    expect(serialized).not.toContain("CombinedFakeSecretLiteral2");
    expect(serialized).not.toContain("CombinedFakeApiKeyLiteral3");
  });
});
