import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditAndroidSensitiveStorage, ANDROID_SENSITIVE_STORAGE_AUDIT_CHECK_ID } from "../../../../src/mobile/android/advancedSecurity/sensitiveStorage/checkResult.js";
import type { AndroidDetectionResult } from "../../../../src/mobile/android/detection.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function target(source: string, fileName = "Main.kt"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sensitive-storage-audit-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "app/src/main/java/example"), { recursive: true });
  fs.writeFileSync(path.join(root, "app/src/main/java/example", fileName), source);
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

function nonAndroidDetection(): AndroidDetectionResult {
  return { ...detection(), detected: false, projectKind: "non-android", modules: [], applicationModules: [] };
}

describe("standalone sensitive-storage audit", () => {
  it("is unsupported/inactive-shaped for a non-Android target", () => {
    const root = target("class X {}");
    const result = auditAndroidSensitiveStorage(root, nonAndroidDetection());
    expect(result.id).toBe(ANDROID_SENSITIVE_STORAGE_AUDIT_CHECK_ID);
    expect(result.status).toBe("unsupported");
    expect(result.ran).toBe(false);
    expect(result.skipped).toBe(true);
  });

  it("produces a redacted finding for a direct credential written to plaintext SharedPreferences", () => {
    const root = target(`
      class Foo {
        fun save() {
          val prefs = getSharedPreferences("app", MODE_PRIVATE)
          prefs.edit().putString("password", "SuperSecretLiteral123").apply()
        }
      }
    `);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-sensitive-preferences"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("SuperSecretLiteral123");
  });

  it("treats a sensitive key with a dynamic value as candidate evidence, not a finding", () => {
    const root = target(`
      class Foo {
        fun save(token: String) {
          val prefs = getSharedPreferences("app", MODE_PRIVATE)
          prefs.edit().putString("authToken", token).apply()
        }
      }
    `);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-sensitive-preferences"))).toBe(false);
    expect(result.candidateEvidence?.some((c) => c.ruleId === "android-sensitive-preferences")).toBe(true);
  });

  it("does not flag ordinary non-sensitive preference writes", () => {
    const root = target(`
      class Foo {
        fun save(prefs: SharedPreferences) {
          prefs.edit().putString("username", "bob").apply()
          prefs.edit().putBoolean("onboardingComplete", true).apply()
        }
      }
    `);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.length ?? 0).toBe(0);
  });

  it("flags MODE_WORLD_READABLE and MODE_WORLD_WRITEABLE as high-confidence risky evidence", () => {
    const root = target(`
      class Foo {
        fun a() { getSharedPreferences("p1", MODE_WORLD_READABLE) }
        fun b() { getSharedPreferences("p2", MODE_WORLD_WRITEABLE) }
      }
    `);
    const result = auditAndroidSensitiveStorage(root, detection());
    const worldFindings = result.findings.filter((f) => f.title.includes("world-readable/world-writable"));
    expect(worldFindings).toHaveLength(2);
    expect(worldFindings.every((f) => f.severity === "major")).toBe(true);
  });

  it("treats MODE_PRIVATE as protective metadata, not proof of encryption, without emitting a finding", () => {
    const root = target(`class Foo { fun a() { getSharedPreferences("p1", MODE_PRIVATE) } }`);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.findings).toHaveLength(0);
    const candidate = result.candidateEvidence?.find((c) => c.summary.includes("MODE_PRIVATE"));
    expect(candidate?.resolutionState).toBe("not-applicable");
  });

  it("preserves EncryptedSharedPreferences/EncryptedFile as protective evidence without suppressing unrelated plaintext writes", () => {
    const root = target(`
      class Foo {
        fun safe() { EncryptedSharedPreferences.create(context, "safe", masterKey, scheme, scheme) }
        fun unsafe() {
          val prefs = getSharedPreferences("app", MODE_PRIVATE)
          prefs.edit().putString("password", "PlainLiteralSecret").apply()
        }
      }
    `);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.candidateEvidence?.some((c) => c.summary.includes("EncryptedSharedPreferences"))).toBe(true);
    expect(result.findings.some((f) => f.id.includes("android-sensitive-preferences"))).toBe(true);
  });

  it("produces bounded review evidence for a sensitive DataStore key", () => {
    const root = target(`
      class Foo {
        fun save() { dataStore[PASSWORD_KEY] = newPassword }
      }
    `);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.candidateEvidence?.some((c) => c.summary.includes("DataStore"))).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("does not classify ordinary DataStore keys as sensitive", () => {
    const root = target(`class Foo { fun save() { dataStore[THEME_KEY] = "dark" } }`);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.candidateEvidence?.length ?? 0).toBe(0);
  });

  it("produces a redacted finding for a direct credential written to an ordinary internal file", () => {
    const root = target(`
      class Foo {
        fun save() {
          val out = openFileOutput("credentials.txt", MODE_PRIVATE)
          out.write("PlainSecretValue".toByteArray())
        }
      }
    `);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.candidateEvidence?.some((c) => c.summary.includes("internal file"))).toBe(true);
  });

  it("flags direct sensitive writes to shared public external storage as high-confidence risky evidence", () => {
    const root = target(`
      class Foo {
        fun save() { Environment.getExternalStoragePublicDirectory("credentials") }
      }
    `);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-sensitive-external-storage"))).toBe(true);
  });

  it("classifies app-specific external storage distinctly from public external storage", () => {
    const root = target(`class Foo { fun save() { context.getExternalFilesDir("tokens") } }`);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-sensitive-external-storage"))).toBe(false);
    expect(result.candidateEvidence?.some((c) => c.ruleId === "android-sensitive-external-storage")).toBe(true);
  });

  it("does not flag external storage API use without sensitive content", () => {
    const root = target(`class Foo { fun save() { context.getExternalFilesDir("photos") } }`);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.length ?? 0).toBe(0);
  });

  it("produces a redacted finding for a direct credential inserted into a local database column", () => {
    const root = target(`
      class Foo {
        fun save(values: ContentValues) { values.put("password", "PlainDbSecret") }
      }
    `);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-sensitive-unsafe-file-database-storage"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PlainDbSecret");
  });

  it("produces candidate evidence for a dynamic sensitive database column value", () => {
    const root = target(`
      class Foo { fun save(values: ContentValues, token: String) { values.put("authToken", token) } }
    `);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.findings.some((f) => f.title.includes("database"))).toBe(false);
    expect(result.candidateEvidence?.some((c) => c.ruleId === "android-sensitive-unsafe-file-database-storage")).toBe(true);
  });

  it("ignores commented-out storage calls and unrelated strings", () => {
    const root = target(`
      class Foo {
        fun save() {
          // prefs.edit().putString("password", "literal").apply()
          val s = "prefs.edit().putString(\\"password\\", \\"literal\\").apply()"
        }
      }
    `);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.length ?? 0).toBe(0);
  });

  it("produces deterministic, order-independent output across repeated runs", () => {
    const root = target(`
      class Foo {
        fun save() {
          val prefs = getSharedPreferences("app", MODE_PRIVATE)
          prefs.edit().putString("password", "LiteralOne").apply()
        }
      }
    `);
    const first = auditAndroidSensitiveStorage(root, detection());
    const second = auditAndroidSensitiveStorage(root, detection());
    expect(first).toEqual(second);
  });

  it("remains standalone: findings/candidates never reference active validation category names", () => {
    const root = target(`class Foo { fun save() { getSharedPreferences("p", MODE_WORLD_READABLE) } }`);
    const result = auditAndroidSensitiveStorage(root, detection());
    expect(result.category).toBe("android-sensitive-storage");
    expect(result.requirementLevel).toBe("required");
  });
});
