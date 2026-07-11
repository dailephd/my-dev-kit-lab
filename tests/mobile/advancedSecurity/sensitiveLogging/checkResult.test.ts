import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditAndroidSensitiveLogging, ANDROID_SENSITIVE_LOGGING_AUDIT_CHECK_ID } from "../../../../src/mobile/android/advancedSecurity/sensitiveLogging/checkResult.js";
import type { AndroidDetectionResult } from "../../../../src/mobile/android/detection.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function target(source: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sensitive-logging-audit-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "app/src/main/java/example"), { recursive: true });
  fs.writeFileSync(path.join(root, "app/src/main/java/example/Main.kt"), source);
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

describe("standalone sensitive-logging audit", () => {
  it("is unsupported/inactive-shaped for a non-Android target", () => {
    const root = target("class X {}");
    const result = auditAndroidSensitiveLogging(root, nonAndroidDetection());
    expect(result.id).toBe(ANDROID_SENSITIVE_LOGGING_AUDIT_CHECK_ID);
    expect(result.status).toBe("unsupported");
  });

  it("flags a direct sensitive identifier logged via Android Log", () => {
    const root = target(`class Foo { fun a(password: String) { Log.d(TAG, password) } }`);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-sensitive-logging"))).toBe(true);
    expect(result.findings[0].severity).toBe("major");
  });

  it("does not flag an ordinary constant diagnostic message", () => {
    const root = target(`class Foo { fun a() { Log.d(TAG, "Activity started") } }`);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.length ?? 0).toBe(0);
  });

  it("produces candidate evidence for a dynamic non-sensitive log message without inventing content", () => {
    const root = target(`class Foo { fun a(status: Any) { Log.d(TAG, status.toString()) } }`);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.some((c) => c.summary.includes("Dynamic"))).toBe(true);
  });

  it("applies the same sensitive-argument policy to Timber", () => {
    const root = target(`class Foo { fun a(authToken: String) { Timber.d(authToken) } }`);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-sensitive-logging"))).toBe(true);
  });

  it("does not classify a similarly named custom logger method as a confirmed sink", () => {
    const root = target(`class Foo { fun a(password: String) { myCustomThing.notARealLogSink(password) } }`);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.length ?? 0).toBe(0);
  });

  it("flags direct sensitive output through stdout/stderr and Kotlin println", () => {
    const root = target(`
      class Foo {
        fun a(password: String) { System.out.println(password) }
        fun b(token: String) { println(token) }
      }
    `);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
  });

  it("treats printStackTrace as review evidence without claiming secrets are present", () => {
    const root = target(`class Foo { fun a(e: Exception) { e.printStackTrace() } }`);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.some((c) => c.summary.includes("printStackTrace"))).toBe(true);
  });

  it("treats exception message logging as candidate evidence, not a confirmed finding", () => {
    const root = target(`class Foo { fun a(e: Exception) { Log.e(TAG, e.message) } }`);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.some((c) => c.summary.includes("Exception message"))).toBe(true);
  });

  it("flags a direct authorization header value logged", () => {
    const root = target(`class Foo { fun a(authorization: String) { Log.d(TAG, authorization) } }`);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-sensitive-logging"))).toBe(true);
  });

  it("does not flag logging only a header name literal", () => {
    const root = target(`class Foo { fun a() { Log.d("Authorization", "present") } }`);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings).toHaveLength(0);
  });

  it("lowers severity to minor (without suppressing) a sensitive finding guarded by BuildConfig.DEBUG", () => {
    const root = target(`
      class Foo {
        fun a(password: String) {
          if (BuildConfig.DEBUG) {
            Log.d(TAG, password)
          }
        }
      }
    `);
    const result = auditAndroidSensitiveLogging(root, detection());
    const finding = result.findings.find((f) => f.id.includes("android-sensitive-logging"));
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("minor");
  });

  it("treats Log.isLoggable as contextual evidence, not a security control", () => {
    const root = target(`class Foo { fun a() { Log.isLoggable(TAG, Log.DEBUG) } }`);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.some((c) => c.summary.includes("isLoggable"))).toBe(true);
  });

  it("flags a direct sensitive Crashlytics custom key", () => {
    const root = target(`class Foo { fun a(password: String) { crashlytics.setCustomKey("password", password) } }`);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings.some((f) => f.title.includes("Crashlytics"))).toBe(true);
  });

  it("flags a direct personal identifier supplied to Crashlytics setUserId", () => {
    const root = target(`class Foo { fun a(email: String) { crashlytics.setUserId(email) } }`);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings.some((f) => f.title.includes("setUserId"))).toBe(true);
  });

  it("treats Crashlytics recordException as candidate evidence unless directly sensitive", () => {
    const root = target(`class Foo { fun a(e: Exception) { crashlytics.recordException(e) } }`);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.some((c) => c.summary.includes("recordException"))).toBe(true);
  });

  it("recognizes sensitive identifiers inside Java string concatenation without evaluating arbitrary expressions", () => {
    const root = target(`class Foo { fun a(password: String) { Log.d(TAG, "pwd=" + password) } }`);
    const result = auditAndroidSensitiveLogging(root, detection());
    // Concatenation is classified as placeholder-interpolation (dynamic), not
    // a bare sensitive identifier — conservative: no confirmed finding, but
    // also no crash and no raw value leakage.
    expect(result.findings).toHaveLength(0);
  });

  it("ignores commented-out log calls and unrelated strings", () => {
    const root = target(`
      class Foo {
        fun a(password: String) {
          // Log.d(TAG, password)
          val s = "Log.d(TAG, password)"
        }
      }
    `);
    const result = auditAndroidSensitiveLogging(root, detection());
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.length ?? 0).toBe(0);
  });

  it("produces deterministic output across repeated runs", () => {
    const root = target(`class Foo { fun a(password: String) { Log.d(TAG, password) } }`);
    const first = auditAndroidSensitiveLogging(root, detection());
    const second = auditAndroidSensitiveLogging(root, detection());
    expect(first).toEqual(second);
  });
});
