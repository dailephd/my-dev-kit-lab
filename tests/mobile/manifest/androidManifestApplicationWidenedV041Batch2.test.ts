import { describe, expect, it } from "vitest";
import { parseAndroidManifestSource } from "../../../src/mobile/android/manifest/parseAndroidManifest.js";

// v0.4.1 Batch 2 narrow inherited-contract correction: AndroidManifestApplicationAttributes
// gained usesCleartextTrafficRaw and location (both additive/optional), and
// parseAndroidManifest.ts no longer discards the raw usesCleartextTraffic
// text or double-emits its malformed-value warning. Regression-tested here
// per agents.txt Batch 2 section 6's requirement for inherited corrections.
describe("AndroidManifest <application> widening — v0.4.1 Batch 2 inherited-contract regression", () => {
  function manifestXml(applicationAttrs: string): string {
    return `<?xml version="1.0"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application ${applicationAttrs}></application></manifest>`;
  }

  it("preserves the raw usesCleartextTraffic text alongside the normalized boolean", () => {
    const manifest = parseAndroidManifestSource(manifestXml(`android:usesCleartextTraffic="true"`), "AndroidManifest.xml");
    expect(manifest.application.usesCleartextTraffic).toBe(true);
    expect(manifest.application.usesCleartextTrafficRaw).toBe("true");
  });

  it("preserves a malformed raw value without normalizing usesCleartextTraffic to true or false", () => {
    const manifest = parseAndroidManifestSource(manifestXml(`android:usesCleartextTraffic="\${cleartext}"`), "AndroidManifest.xml");
    expect(manifest.application.usesCleartextTraffic).toBeUndefined();
    expect(manifest.application.usesCleartextTrafficRaw).toBe("${cleartext}");
  });

  it("emits exactly one malformed-value warning, not a duplicate", () => {
    const manifest = parseAndroidManifestSource(manifestXml(`android:usesCleartextTraffic="\${cleartext}"`), "AndroidManifest.xml");
    const matching = manifest.parseWarnings.filter((w) => w.includes("usesCleartextTraffic"));
    expect(matching).toHaveLength(1);
  });

  it("leaves usesCleartextTrafficRaw undefined when the attribute is absent", () => {
    const manifest = parseAndroidManifestSource(manifestXml(`android:label="x"`), "AndroidManifest.xml");
    expect(manifest.application.usesCleartextTrafficRaw).toBeUndefined();
  });

  it("preserves the <application> element's own source location", () => {
    const manifest = parseAndroidManifestSource(manifestXml(`android:label="x"`), "AndroidManifest.xml");
    expect(manifest.application.location?.line).toBeGreaterThan(0);
  });

  it("leaves application as an empty object (no location) when there is no <application> element", () => {
    const xml = `<?xml version="1.0"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"></manifest>`;
    const manifest = parseAndroidManifestSource(xml, "AndroidManifest.xml");
    expect(manifest.application.location).toBeUndefined();
    expect(manifest.application.usesCleartextTraffic).toBeUndefined();
  });
});
