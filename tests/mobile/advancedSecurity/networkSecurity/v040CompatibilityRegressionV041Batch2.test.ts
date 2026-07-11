import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateAndroidTarget } from "../../../../src/mobile/android/validate/validateAndroidTarget.js";
import { toAndroidReportModel } from "../../../../src/mobile/android/report/model.js";
import { renderAndroidTextReport } from "../../../../src/mobile/android/report/renderAndroidReport.js";
import { ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID } from "../../../../src/mobile/android/advancedSecurity/networkSecurity/checkResult.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "..", "fixtures", "android");
const TOOL_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function fixture(name: string): string {
  return path.join(FIXTURES_ROOT, name);
}

// ANDROID-V041-B2-37/38/39 — originally asserted Batch 2 was disconnected
// from active orchestration. v0.4.1 Batch 8 activates it by default for
// --profile android (agents.txt Batch 8 section 9.1); updated to assert the
// current, intentional active behavior.
describe("Batch 2 is active in Android validation and reports as of Batch 8", () => {
  it("validateAndroidTarget now runs and reports the Batch 2 check id by default", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const ids = result.checks.map((c) => c.id);
    expect(ids).toContain(ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID);
  });

  it("validateAndroidTarget still runs exactly the same v0.4.0 checks", async () => {
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

  it("renders a text report that now includes the Batch 2 check id", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const model = toAndroidReportModel(result);
    const text = renderAndroidTextReport(model);
    expect(text).toContain(ANDROID_NETWORK_SECURITY_AUDIT_CHECK_ID);
  });

  it("includes the android-network-security category in normal validation", async () => {
    const result = await validateAndroidTarget({ toolRoot: TOOL_ROOT, targetPath: fixture("compose-app") });
    const categories = new Set(result.checks.map((c) => c.category));
    expect(categories.has("android-network-security")).toBe(true);
  });
});
