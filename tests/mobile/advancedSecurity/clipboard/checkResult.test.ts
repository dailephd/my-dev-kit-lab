import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditAndroidClipboardSecurity, ANDROID_CLIPBOARD_SECURITY_AUDIT_CHECK_ID } from "../../../../src/mobile/android/advancedSecurity/clipboard/checkResult.js";
import type { AndroidDetectionResult } from "../../../../src/mobile/android/detection.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function target(source: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-audit-"));
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

describe("standalone clipboard security audit", () => {
  it("is unsupported/inactive-shaped for a non-Android target", () => {
    const root = target("class X {}");
    const result = auditAndroidClipboardSecurity(root, nonAndroidDetection());
    expect(result.id).toBe(ANDROID_CLIPBOARD_SECURITY_AUDIT_CHECK_ID);
    expect(result.status).toBe("unsupported");
  });

  it("flags a direct sensitive ClipData payload written inline to the clipboard", () => {
    const root = target(`
      class Foo {
        fun a(password: String) {
          clipboard.setPrimaryClip(ClipData.newPlainText("password", password))
        }
      }
    `);
    const result = auditAndroidClipboardSecurity(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-sensitive-clipboard-write"))).toBe(true);
  });

  it("correlates a local clip variable with setPrimaryClip within the same method", () => {
    const root = target(`
      class Foo {
        fun a(password: String) {
          val clip = ClipData.newPlainText("password", password)
          clipboard.setPrimaryClip(clip)
        }
      }
    `);
    const result = auditAndroidClipboardSecurity(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-sensitive-clipboard-write"))).toBe(true);
  });

  it("does not correlate an unrelated clip variable from a different method", () => {
    const root = target(`
      class Foo {
        fun make(password: String): ClipData { val clip = ClipData.newPlainText("password", password); return clip }
        fun setUnrelated(other: ClipData) { clipboard.setPrimaryClip(other) }
      }
    `);
    const result = auditAndroidClipboardSecurity(root, detection());
    expect(result.findings).toHaveLength(0);
  });

  it("does not flag an ordinary user-triggered copy of non-sensitive text", () => {
    const root = target(`
      class Foo {
        fun onClick() {
          clipboard.setPrimaryClip(ClipData.newPlainText("message", "hello world"))
        }
      }
    `);
    const result = auditAndroidClipboardSecurity(root, detection());
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.length ?? 0).toBe(0);
  });

  it("flags a direct sensitive value copied via legacy ClipboardManager.setText", () => {
    const root = target(`class Foo { fun a(password: String) { legacyClipboard.setText(password) } }`);
    const result = auditAndroidClipboardSecurity(root, detection());
    expect(result.findings.some((f) => f.title.includes("legacy"))).toBe(true);
  });

  it("treats a dynamic sensitive-label payload as candidate evidence, not a finding, in a user-triggered flow", () => {
    const root = target(`
      class Foo {
        fun onClick(secretValue: Any) {
          clipboard.setPrimaryClip(ClipData.newPlainText("password", secretValue.toString()))
        }
      }
    `);
    const result = auditAndroidClipboardSecurity(root, detection());
    expect(result.candidateEvidence?.some((c) => c.ruleId === "android-sensitive-clipboard-write")).toBe(true);
  });

  it("preserves EXTRA_IS_SENSITIVE marker evidence and downgrades a nearby sensitive write to candidate evidence", () => {
    const root = target(`
      class Foo {
        fun a(password: String) {
          val extras = PersistableBundle()
          extras.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
          val clip = ClipData.newPlainText("password", password)
          clip.description.extras = extras
          clipboard.setPrimaryClip(clip)
        }
      }
    `);
    const result = auditAndroidClipboardSecurity(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-sensitive-clipboard-write"))).toBe(false);
    expect(result.candidateEvidence?.some((c) => c.summary.includes("EXTRA_IS_SENSITIVE"))).toBe(true);
  });

  it("records clearPrimaryClip as evidence without suppressing an unrelated sensitive write elsewhere", () => {
    const root = target(`
      class Foo {
        fun a(password: String) { clipboard.setPrimaryClip(ClipData.newPlainText("password", password)) }
        fun b() { clipboard.clearPrimaryClip() }
      }
    `);
    const result = auditAndroidClipboardSecurity(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-sensitive-clipboard-write"))).toBe(true);
  });

  it("produces low-confidence review evidence for an ordinary clipboard read", () => {
    const root = target(`class Foo { fun a() { clipboard.getPrimaryClip() } }`);
    const result = auditAndroidClipboardSecurity(root, detection());
    expect(result.candidateEvidence?.some((c) => c.ruleId === "android-sensitive-clipboard-read-review")).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("produces stronger review evidence for a clipboard read in a background-like class", () => {
    const root = target(`class SyncWorker { fun run() { clipboard.getPrimaryClip() } }`);
    const result = auditAndroidClipboardSecurity(root, detection());
    const candidate = result.candidateEvidence?.find((c) => c.ruleId === "android-sensitive-clipboard-read-review");
    expect(candidate?.confidence).toBe("medium");
  });

  it("classifies a user-triggered paste flow read less severely than an unrecognized context", () => {
    const root = target(`class Foo { fun onClick() { clipboard.getPrimaryClip() } }`);
    const result = auditAndroidClipboardSecurity(root, detection());
    expect(result.candidateEvidence?.length ?? 0).toBe(0);
  });

  it("ignores commented-out clipboard calls and unrelated strings", () => {
    const root = target(`
      class Foo {
        fun a(password: String) {
          // clipboard.setPrimaryClip(ClipData.newPlainText("password", password))
          val s = "clipboard.setPrimaryClip(ClipData.newPlainText(\\"password\\", password))"
        }
      }
    `);
    const result = auditAndroidClipboardSecurity(root, detection());
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.length ?? 0).toBe(0);
  });

  it("produces deterministic output across repeated runs", () => {
    const root = target(`class Foo { fun a(password: String) { clipboard.setPrimaryClip(ClipData.newPlainText("password", password)) } }`);
    const first = auditAndroidClipboardSecurity(root, detection());
    const second = auditAndroidClipboardSecurity(root, detection());
    expect(first).toEqual(second);
  });
});
