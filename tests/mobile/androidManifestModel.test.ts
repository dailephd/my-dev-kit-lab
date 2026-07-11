import { describe, expect, it } from "vitest";
import type { AndroidManifestModel } from "../../src/mobile/android/manifest/types.js";

// ANDROID-B1-04: Manifest model types represent permissions, components,
// exported state, intent filters, deep-link data, launcher evidence, labels,
// icons, warnings, and unsupported constructs.
describe("android manifest model contract — ANDROID-B1-04", () => {
  it("represents a manifest with permissions, an exported launcher activity, and a deep link", () => {
    const manifest: AndroidManifestModel = {
      manifestPath: "app/src/main/AndroidManifest.xml",
      packageName: "com.example.xmlviewapp",
      application: {
        label: "XML View App",
        iconRef: "@mipmap/ic_launcher",
        allowBackup: false,
      },
      permissions: [{ name: "android.permission.INTERNET" }],
      usesFeatures: [],
      activities: [
        {
          kind: "activity",
          name: ".MainActivity",
          exported: true,
          isLauncherActivity: true,
          intentFilters: [
            {
              filterData: [
                { action: "android.intent.action.MAIN", category: "android.intent.category.LAUNCHER" },
              ],
              isDeepLinkCandidate: false,
            },
          ],
        },
        {
          kind: "activity",
          name: ".DeepLinkActivity",
          exported: true,
          intentFilters: [
            {
              filterData: [
                {
                  action: "android.intent.action.VIEW",
                  dataScheme: "https",
                  dataHost: "example.com",
                  dataPathPrefix: "/share",
                  autoVerify: true,
                },
              ],
              isDeepLinkCandidate: true,
            },
          ],
        },
      ],
      services: [],
      receivers: [],
      providers: [],
      deepLinks: [
        { dataScheme: "https", dataHost: "example.com", dataPathPrefix: "/share" },
      ],
      launcherActivityName: ".MainActivity",
      parseWarnings: [],
      unsupportedConstructs: [],
    };

    expect(manifest.permissions).toHaveLength(1);
    expect(manifest.activities[0].isLauncherActivity).toBe(true);
    expect(manifest.activities[1].intentFilters[0].isDeepLinkCandidate).toBe(true);
    expect(manifest.deepLinks).toHaveLength(1);
    expect(manifest.application.iconRef).toBe("@mipmap/ic_launcher");
  });

  it("can carry parse warnings and unsupported constructs without discarding partial data", () => {
    const manifest: AndroidManifestModel = {
      manifestPath: "app/src/main/AndroidManifest.xml",
      application: {},
      permissions: [],
      usesFeatures: [],
      activities: [],
      services: [],
      receivers: [],
      providers: [],
      deepLinks: [],
      parseWarnings: ["Unresolved manifest placeholder ${applicationId}"],
      unsupportedConstructs: ["<queries> element"],
    };

    expect(manifest.parseWarnings).toHaveLength(1);
    expect(manifest.unsupportedConstructs).toContain("<queries> element");
    expect(manifest.packageName).toBeUndefined();
  });
});
