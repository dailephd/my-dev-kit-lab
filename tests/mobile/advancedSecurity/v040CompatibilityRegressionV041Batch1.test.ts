import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateAndroidTarget } from "../../../src/mobile/android/validate/validateAndroidTarget.js";
import { toAndroidReportModel } from "../../../src/mobile/android/report/model.js";
import { renderAndroidTextReport } from "../../../src/mobile/android/report/renderAndroidReport.js";
import { ANDROID_ADVANCED_RULE_IDS } from "../../../src/mobile/android/advancedSecurity/ruleIds.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "android");
const TOOL_ROOT = path.resolve(__dirname, "..", "..", "..");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

// ANDROID-V041-B1-19/20/21/22 — v0.4.1 Batch 1 must not change v0.4.0's
// observable Android validation behavior: same checks run, same verdict
// policy, and no v0.4.1 rule id ever appears as if it had executed.
describe("v0.4.0 Android validation regression after v0.4.1 Batch 1 substrate", () => {
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

  it("still produces a valid verdict for the Compose fixture, unchanged from v0.4.0", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    expect(["ready-for-release-preparation", "ready-except-optional-manual-checks"]).toContain(result.verdict);
  });

  it("never reports a v0.4.1 advanced rule id as an executed check or finding id", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const checkIds = result.checks.map((c) => c.id);
    const findingIds = result.findings.map((f) => f.id);
    for (const ruleId of ANDROID_ADVANCED_RULE_IDS) {
      expect(checkIds).not.toContain(ruleId);
      expect(findingIds.some((id) => id.startsWith(ruleId))).toBe(false);
    }
  });

  it("renders a text report with no claim that v0.4.1 checks ran", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const model = toAndroidReportModel(result);
    const text = renderAndroidTextReport(model);
    for (const ruleId of ANDROID_ADVANCED_RULE_IDS) {
      expect(text).not.toContain(ruleId);
    }
  });

  it("keeps result.checks free of any new android-network-security/webview/etc category in normal validation", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const categories = new Set(result.checks.map((c) => c.category));
    for (const advancedCategory of [
      "android-network-security",
      "android-webview",
      "android-file-provider",
      "android-secret-candidates",
    ] as const) {
      expect(categories.has(advancedCategory)).toBe(false);
    }
  });
});
