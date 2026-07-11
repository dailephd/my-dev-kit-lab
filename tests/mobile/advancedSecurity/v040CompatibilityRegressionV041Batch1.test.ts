import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateAndroidTarget } from "../../../src/mobile/android/validate/validateAndroidTarget.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android");
const TOOL_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

// ANDROID-V041-B1-19/20/21/22 — originally asserted that v0.4.1 Batch 1's
// substrate did not change v0.4.0's observable behavior, back when every
// advanced check was still disconnected. v0.4.1 Batch 8 is the batch that
// intentionally activates all eleven internal advanced checks by default
// for --profile android (agents.txt Batch 8 section 9.1) — this file is
// updated to assert the current, intentional post-Batch-8 behavior: the
// original v0.4.0 checks still run unchanged, the verdict policy is still
// valid, and the advanced categories now legitimately appear.
describe("v0.4.0 Android validation behavior after v0.4.1 Batch 8 activation", () => {
  it("still runs exactly the same v0.4.0 check ids for the Compose fixture", async () => {
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

  it("still produces a valid verdict for the Compose fixture", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    expect(["ready-for-release-preparation", "ready-except-optional-manual-checks"]).toContain(result.verdict);
  });

  it("now runs the eleven advanced internal checks by default (Batch 8 activation)", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const checkIds = result.checks.map((c) => c.id);
    for (const id of [
      "android-network-security-audit",
      "android-backup-configuration-audit",
      "android-release-configuration-audit",
      "android-secret-candidates-audit",
      "android-signing-configuration-audit",
      "android-webview-security-audit",
      "android-file-provider-audit",
      "android-sensitive-storage-audit",
      "android-sensitive-logging-audit",
      "android-clipboard-security-audit",
      "android-firebase-google-services-audit",
    ]) {
      expect(checkIds).toContain(id);
    }
  });

  it("keeps result.checks free of any Batch 7 external-tool category by default (no external tools requested)", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const categories = new Set(result.checks.map((c) => c.category));
    for (const externalCategory of ["android-semgrep", "android-osv", "android-lint", "android-dependency-check"] as const) {
      expect(categories.has(externalCategory)).toBe(false);
    }
  });

  it("still executes zero external-tool and Gradle processes by default", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const gradleOpChecks = result.checks.filter((c) => c.id.startsWith("android-gradle-") && c.id !== "android-gradle-metadata");
    expect(gradleOpChecks).toHaveLength(0);
  });
});
