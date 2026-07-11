import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditAndroidFirebaseGoogleServices, ANDROID_FIREBASE_GOOGLE_SERVICES_AUDIT_CHECK_ID } from "../../../../src/mobile/android/advancedSecurity/firebaseGoogle/checkResult.js";
import type { AndroidDetectionResult } from "../../../../src/mobile/android/detection.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function newRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "firebase-google-audit-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "app/src/main/java/example"), { recursive: true });
  return root;
}

function write(root: string, relativePath: string, content: string): void {
  const full = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
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

const FAKE_GOOGLE_SERVICES = JSON.stringify({
  project_info: { project_number: "000000000000", project_id: "fake-project-id", storage_bucket: "fake-project-id.appspot.com" },
  client: [
    {
      client_info: { mobilesdk_app_id: "1:000000000000:android:fakeappid", android_client_info: { package_name: "com.example.fakeapp" } },
      oauth_client: [],
      api_key: [{ current_key: "AIzaFakeNotARealKeyExampleOnly1234567" }],
      services: {},
    },
  ],
});

describe("standalone Firebase/Google services audit", () => {
  it("is unsupported/inactive-shaped for a non-Android target", () => {
    const root = newRoot();
    write(root, "app/build.gradle", "");
    const result = auditAndroidFirebaseGoogleServices(root, nonAndroidDetection());
    expect(result.id).toBe(ANDROID_FIREBASE_GOOGLE_SERVICES_AUDIT_CHECK_ID);
    expect(result.status).toBe("unsupported");
  });

  it("parses a valid google-services.json without producing a vulnerability finding", () => {
    const root = newRoot();
    write(root, "app/google-services.json", FAKE_GOOGLE_SERVICES);
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.findings).toHaveLength(0);
    expect(result.candidateEvidence?.some((c) => c.summary.includes("google-services.json parsed"))).toBe(true);
  });

  it("never emits the full Firebase API key value", () => {
    const root = newRoot();
    write(root, "app/google-services.json", FAKE_GOOGLE_SERVICES);
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(JSON.stringify(result)).not.toContain("AIzaFakeNotARealKeyExampleOnly1234567");
  });

  it("handles malformed google-services.json safely without crashing", () => {
    const root = newRoot();
    write(root, "app/google-services.json", "{ not valid json ");
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.candidateEvidence?.some((c) => c.summary.includes("could not be parsed"))).toBe(true);
  });

  it("recognizes a matching application package client", () => {
    const root = newRoot();
    write(root, "app/google-services.json", FAKE_GOOGLE_SERVICES);
    write(root, "app/src/main/AndroidManifest.xml", `<manifest package="com.example.fakeapp"></manifest>`);
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.candidateEvidence?.some((c) => c.summary.includes("No google-services.json client matches"))).toBe(false);
  });

  it("flags no matching client when the package differs", () => {
    const root = newRoot();
    write(root, "app/google-services.json", FAKE_GOOGLE_SERVICES);
    write(root, "app/src/main/AndroidManifest.xml", `<manifest package="com.example.other"></manifest>`);
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.candidateEvidence?.some((c) => c.summary.includes("No google-services.json client matches"))).toBe(true);
  });

  it("flags a Realtime Database rule with root-level read:true as a major finding", () => {
    const root = newRoot();
    write(root, "database.rules.json", JSON.stringify({ rules: { ".read": true, ".write": false } }));
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-firebase-realtime-database-permissive-rules"))).toBe(true);
  });

  it("treats an auth-restricted database rule as restrictive evidence, not a public-rule finding", () => {
    const root = newRoot();
    write(root, "database.rules.json", JSON.stringify({ rules: { users: { "$uid": { ".read": "auth != null && auth.uid == $uid" } } } }));
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.findings).toHaveLength(0);
  });

  it("handles malformed database.rules.json safely", () => {
    const root = newRoot();
    write(root, "database.rules.json", "{ broken");
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.candidateEvidence?.some((c) => c.summary.includes("could not be parsed"))).toBe(true);
  });

  it("flags a broad Firestore allow-if-true rule as a major finding", () => {
    const root = newRoot();
    write(
      root,
      "firestore.rules",
      `
      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /{document=**} {
            allow read, write: if true;
          }
        }
      }
    `
    );
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-firebase-firestore-permissive-rules"))).toBe(true);
  });

  it("treats an auth-restricted Firestore rule as review evidence, not a public-access finding", () => {
    const root = newRoot();
    write(
      root,
      "firestore.rules",
      `
      service cloud.firestore {
        match /databases/{database}/documents {
          match /users/{userId} {
            allow read, write: if request.auth != null && request.auth.uid == userId;
          }
        }
      }
    `
    );
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.findings).toHaveLength(0);
  });

  it("records a time-limited test-mode Firestore rule as candidate evidence without an expiration claim", () => {
    const root = newRoot();
    write(
      root,
      "firestore.rules",
      `
      service cloud.firestore {
        match /databases/{database}/documents {
          match /{document=**} {
            allow read, write: if request.time < timestamp.date(2030, 1, 1);
          }
        }
      }
    `
    );
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.candidateEvidence?.some((c) => c.summary.includes("Time-limited test-mode rule"))).toBe(true);
    expect(result.findings.some((f) => f.id.includes("permissive-rules"))).toBe(false);
  });

  it("flags a broad Storage allow-if-true rule as a major finding", () => {
    const root = newRoot();
    write(
      root,
      "storage.rules",
      `
      service firebase.storage {
        match /b/{bucket}/o {
          match /{allPaths=**} {
            allow read, write: if true;
          }
        }
      }
    `
    );
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.findings.some((f) => f.id.includes("android-firebase-storage-permissive-rules"))).toBe(true);
  });

  it("handles malformed Firestore rules syntax without crashing", () => {
    const root = newRoot();
    write(root, "firestore.rules", "service cloud.firestore { match /x/ { allow read: if !!! broken");
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.errors).toHaveLength(0);
  });

  it("ignores commented-out and string-embedded rules text", () => {
    const root = newRoot();
    write(
      root,
      "firestore.rules",
      `
      service cloud.firestore {
        match /databases/{database}/documents {
          // match /{document=**} { allow read, write: if true; }
          match /safe/{id} { allow read: if request.auth != null; }
        }
      }
    `
    );
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.findings).toHaveLength(0);
  });

  it("flags missing local database rules when Realtime Database service use is directly evident", () => {
    const root = newRoot();
    write(root, "app/build.gradle", `dependencies { implementation("com.google.firebase:firebase-database:1.0") }`);
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.candidateEvidence?.some((c) => c.ruleId === "android-firebase-missing-local-rules" && c.summary.includes("Realtime Database"))).toBe(true);
  });

  it("does not flag missing rules when no Firebase service use is evident", () => {
    const root = newRoot();
    write(root, "app/build.gradle", `dependencies { implementation("androidx.core:core-ktx:1.0") }`);
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.candidateEvidence?.some((c) => c.ruleId === "android-firebase-missing-local-rules")).toBe(false);
  });

  it("records explicit analytics-collection-disabled manifest metadata as protective evidence", () => {
    const root = newRoot();
    write(root, "app/src/main/AndroidManifest.xml", `<manifest><application><meta-data android:name="firebase_analytics_collection_enabled" android:value="false" /></application></manifest>`);
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.candidateEvidence?.some((c) => c.summary.includes("firebase_analytics_collection_enabled"))).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("flags a direct sensitive value sent as an analytics event parameter", () => {
    const root = newRoot();
    write(
      root,
      "app/src/main/java/example/Analytics.kt",
      `
      class Foo {
        fun track(password: String) {
          val bundle = Bundle()
          bundle.putString("password", "HardcodedLiteralSecret")
          analytics.logEvent("login", bundle)
        }
      }
    `
    );
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.findings.some((f) => f.title.includes("Analytics event parameter"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("HardcodedLiteralSecret");
  });

  it("does not flag an ordinary analytics event without sensitive parameters", () => {
    const root = newRoot();
    write(
      root,
      "app/src/main/java/example/Analytics.kt",
      `
      class Foo {
        fun track() {
          val bundle = Bundle()
          bundle.putString("screen_name", "home")
          analytics.logEvent("screen_view", bundle)
        }
      }
    `
    );
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.findings).toHaveLength(0);
  });

  it("produces deterministic output across repeated runs", () => {
    const root = newRoot();
    write(root, "database.rules.json", JSON.stringify({ rules: { ".read": true } }));
    write(root, "app/build.gradle", `dependencies { implementation("com.google.firebase:firebase-database:1.0") }`);
    const first = auditAndroidFirebaseGoogleServices(root, detection());
    const second = auditAndroidFirebaseGoogleServices(root, detection());
    expect(first).toEqual(second);
  });

  it("remains standalone: correct category and required requirement level", () => {
    const root = newRoot();
    write(root, "app/build.gradle", "");
    const result = auditAndroidFirebaseGoogleServices(root, detection());
    expect(result.category).toBe("android-firebase-google-services");
    expect(result.requirementLevel).toBe("required");
  });
});
