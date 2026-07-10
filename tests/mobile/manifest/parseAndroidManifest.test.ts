import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseAndroidManifestSource } from "../../../src/mobile/android/manifest/parseAndroidManifest.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android", "manifest-audit-fixtures");

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_ROOT, name), "utf8");
}

// ANDROID-B3-01: Basic manifest parsing.
describe("parseAndroidManifestSource — basic parsing — ANDROID-B3-01", () => {
  it("produces a normalized summary with package, application, permissions, and components", () => {
    const xml = `<?xml version="1.0"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.basic">
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-feature android:name="android.hardware.camera" android:required="false" />
  <application android:label="Basic App">
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>`;
    const manifest = parseAndroidManifestSource(xml, "app/src/main/AndroidManifest.xml");
    expect(manifest.packageName).toBe("com.example.basic");
    expect(manifest.application.label).toBe("Basic App");
    expect(manifest.permissions).toHaveLength(1);
    expect(manifest.permissions[0].name).toBe("android.permission.INTERNET");
    expect(manifest.usesFeatures).toHaveLength(1);
    expect(manifest.usesFeatures[0].required).toBe(false);
    expect(manifest.activities).toHaveLength(1);
    expect(manifest.launcherActivityName).toBe(".MainActivity");
    expect(manifest.parseWarnings).toEqual([]);
  });
});

// ANDROID-B3-03: uses-permission / uses-permission-sdk-23 / uses-permission-sdk-m
// element types are preserved distinctly.
describe("parseAndroidManifestSource — permission element variants — ANDROID-B3-03", () => {
  it("preserves the source element type for sdk-23 permission declarations", () => {
    const manifest = parseAndroidManifestSource(readFixture("permission-coverage.xml"), "AndroidManifest.xml");
    const bluetooth = manifest.permissions.find((p) => p.name === "android.permission.BLUETOOTH_CONNECT");
    expect(bluetooth?.sourceElement).toBe("uses-permission-sdk-23");
    const internet = manifest.permissions.find((p) => p.name === "android.permission.INTERNET");
    expect(internet?.sourceElement).toBe("uses-permission");
  });

  it("does not conflate the two source element types even for the same permission name", () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.CAMERA" />
  <uses-permission-sdk-23 android:name="android.permission.CAMERA" />
  <application/>
</manifest>`;
    const manifest = parseAndroidManifestSource(xml, "AndroidManifest.xml");
    expect(manifest.permissions).toHaveLength(2);
    expect(manifest.permissions.map((p) => p.sourceElement).sort()).toEqual(["uses-permission", "uses-permission-sdk-23"]);
  });
});

// ANDROID-B3-04: Component parsing (raw names, exported state, permissions,
// authorities, intent filters) across all five component kinds.
describe("parseAndroidManifestSource — component parsing — ANDROID-B3-04", () => {
  it("parses raw component names, exported state, and provider authority/permission evidence", () => {
    const manifest = parseAndroidManifestSource(readFixture("risky-components.xml"), "AndroidManifest.xml");
    expect(manifest.activities.map((a) => a.name)).toContain(".UnprotectedExportedActivity");
    expect(manifest.services[0].name).toBe(".UnprotectedExportedService");
    expect(manifest.receivers[0].name).toBe(".UnprotectedExportedReceiver");

    const provider = manifest.providers.find((p) => p.name === ".FullyProtectedProvider");
    expect(provider?.authorities).toEqual(["com.example.risky.provider3"]);
    expect(provider?.readPermission).toBe("com.example.risky.permission.READ");
    expect(provider?.writePermission).toBe("com.example.risky.permission.WRITE");

    const protectedActivity = manifest.activities.find((a) => a.name === ".ProtectedExportedActivity");
    expect(protectedActivity?.exported).toBe(true);
    expect(protectedActivity?.permission).toBe("com.example.risky.permission.ADMIN");
  });
});

// ANDROID-B3-05: Exported-state vocabulary stays distinct; malformed/
// unspecified values are never normalized to false.
describe("parseAndroidManifestSource — exported-state vocabulary — ANDROID-B3-05", () => {
  it("distinguishes explicit true, explicit false, unspecified, and malformed", () => {
    const manifest = parseAndroidManifestSource(readFixture("risky-components.xml"), "AndroidManifest.xml");
    const explicitTrue = manifest.activities.find((a) => a.name === ".UnprotectedExportedActivity");
    const explicitFalse = manifest.activities.find((a) => a.name === ".NotExportedActivity");
    const unspecified = manifest.activities.find((a) => a.name === ".UnspecifiedExportedActivity");

    expect(explicitTrue?.exported).toBe(true);
    expect(explicitFalse?.exported).toBe(false);
    expect(unspecified?.exported).toBeUndefined();
    expect(unspecified?.exportedRaw).toBeUndefined();
  });

  it("never normalizes a malformed exported value to false — critical invariant", () => {
    const manifest = parseAndroidManifestSource(readFixture("malformed-exported.xml"), "AndroidManifest.xml");
    const activity = manifest.activities[0];
    expect(activity.exported).not.toBe(false);
    expect(activity.exported).toBeUndefined();
    expect(activity.exportedRaw).toBe("maybe");
    expect(manifest.parseWarnings.some((w) => w.includes("exported"))).toBe(true);
  });
});

// ANDROID-B3-06: Intent-filter actions/categories/data preserved deterministically.
describe("parseAndroidManifestSource — intent-filter parsing — ANDROID-B3-06", () => {
  it("preserves multiple actions, categories, and separate data elements without inventing combinations", () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application>
    <activity android:name=".Multi" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <action android:name="android.intent.action.SEND" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="https" android:host="a.example.com" />
        <data android:scheme="https" android:host="b.example.com" />
      </intent-filter>
    </activity>
  </application>
</manifest>`;
    const manifest = parseAndroidManifestSource(xml, "AndroidManifest.xml");
    const filter = manifest.activities[0].intentFilters[0];
    expect(filter.actions).toEqual(["android.intent.action.VIEW", "android.intent.action.SEND"]);
    expect(filter.categories).toEqual(["android.intent.category.DEFAULT", "android.intent.category.BROWSABLE"]);
    expect(filter.dataElements).toHaveLength(2);
    expect(filter.dataElements?.[0].dataHost).toBe("a.example.com");
    expect(filter.dataElements?.[1].dataHost).toBe("b.example.com");
  });
});

// ANDROID-B3-07: Launcher activity evidence via MAIN + LAUNCHER.
describe("parseAndroidManifestSource — launcher activity evidence — ANDROID-B3-07", () => {
  it("identifies the launcher activity without claiming runtime behavior", () => {
    const manifest = parseAndroidManifestSource(readFixture("risky-components.xml"), "AndroidManifest.xml");
    expect(manifest.launcherActivityName).toBe(".MainActivity");
    const launcher = manifest.activities.find((a) => a.name === ".MainActivity");
    expect(launcher?.isLauncherActivity).toBe(true);
    const other = manifest.activities.find((a) => a.name === ".UnprotectedExportedActivity");
    expect(other?.isLauncherActivity).toBeFalsy();
  });
});

// ANDROID-B3-08: Deep-link candidate data parsing.
describe("parseAndroidManifestSource — deep-link candidate parsing — ANDROID-B3-08", () => {
  it("preserves scheme, host, path, pathPrefix, pathPattern, and autoVerify", () => {
    const manifest = parseAndroidManifestSource(readFixture("risky-deep-links.xml"), "AndroidManifest.xml");
    const bounded = manifest.activities.find((a) => a.name === ".BoundedSafeDeepLinkActivity");
    const dataEl = bounded?.intentFilters[0].dataElements?.[0];
    expect(dataEl?.dataScheme).toBe("https");
    expect(dataEl?.dataHost).toBe("example.com");
    expect(dataEl?.dataPathPrefix).toBe("/product");
    expect(bounded?.intentFilters[0].autoVerify).toBe(true);

    const broadPattern = manifest.activities.find((a) => a.name === ".BroadPathPatternActivity");
    expect(broadPattern?.intentFilters[0].dataElements?.[0].dataPathPattern).toBe(".*");
  });
});

// ANDROID-B3-09: Resource references and manifest placeholders are preserved
// unresolved, never fabricated or silently discarded.
describe("parseAndroidManifestSource — resource/placeholder preservation — ANDROID-B3-09", () => {
  it("preserves @string/... and ${...} values verbatim", () => {
    const manifest = parseAndroidManifestSource(readFixture("unresolved-placeholder.xml"), "AndroidManifest.xml");
    expect(manifest.packageName).toBe("${applicationId}");
    expect(manifest.application.label).toBe("@string/app_name");
    const dataEl = manifest.activities[0].intentFilters[0].dataElements?.[0];
    expect(dataEl?.dataScheme).toBe("${deepLinkScheme}");
    expect(dataEl?.dataHost).toBe("@string/deep_link_host");
  });
});

// ANDROID-B3-10: Approximate source locations retained when available.
describe("parseAndroidManifestSource — source locations — ANDROID-B3-10", () => {
  it("attaches a line number to parsed components", () => {
    const manifest = parseAndroidManifestSource(readFixture("risky-components.xml"), "AndroidManifest.xml");
    expect(manifest.activities[0].location?.line).toBeGreaterThan(0);
  });
});

// ANDROID-B3-11: Malformed manifest handling — structured warning, no crash.
describe("parseAndroidManifestSource — malformed manifest handling — ANDROID-B3-11", () => {
  it("produces a structured warning for malformed XML instead of throwing", () => {
    expect(() => parseAndroidManifestSource(readFixture("malformed.xml"), "AndroidManifest.xml")).not.toThrow();
    const manifest = parseAndroidManifestSource(readFixture("malformed.xml"), "AndroidManifest.xml");
    expect(manifest.parseWarnings.some((w) => w.startsWith("Malformed XML:"))).toBe(true);
    expect(manifest.activities).toEqual([]);
  });

  it("records missing <application> as an unsupported construct, not a crash", () => {
    const manifest = parseAndroidManifestSource(readFixture("missing-application.xml"), "AndroidManifest.xml");
    expect(manifest.unsupportedConstructs.some((w) => w.includes("<application>"))).toBe(true);
    expect(manifest.permissions).toHaveLength(1);
  });

  it("records a missing component name as a warning without fabricating one", () => {
    const manifest = parseAndroidManifestSource(readFixture("missing-component-name.xml"), "AndroidManifest.xml");
    expect(manifest.activities[0].name).toBe("");
    expect(manifest.parseWarnings.some((w) => w.includes("missing android:name"))).toBe(true);
  });

  it("resolves an unusual but valid namespace prefix", () => {
    const manifest = parseAndroidManifestSource(readFixture("unusual-namespace-prefix.xml"), "AndroidManifest.xml");
    expect(manifest.activities[0].name).toBe(".MainActivity");
    expect(manifest.activities[0].exported).toBe(true);
  });

  it("does not crash on an intent filter with incomplete data", () => {
    const manifest = parseAndroidManifestSource(readFixture("incomplete-intent-filter.xml"), "AndroidManifest.xml");
    expect(manifest.activities).toHaveLength(2);
    const empty = manifest.activities.find((a) => a.name === ".EmptyFilterActivity");
    expect(empty?.intentFilters[0].actions).toEqual([]);
  });
});
