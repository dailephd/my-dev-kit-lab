import { describe, expect, it } from "vitest";
import { REPORT_POISONING_SCENARIO } from "../../../src/securityValidation/attackScenarios/scenarios/reportPoisoningScenario.js";
import { DEFAULT_SECURITY_CONFIG } from "../../../src/securityValidation/config.js";
import type { SecurityValidationTarget } from "../../../src/securityValidation/validate/resolveTarget.js";
import type { AttackScenarioContext } from "../../../src/securityValidation/attackScenarios/attackScenario.js";
import { getPayloadsForGroup } from "../../../src/securityValidation/attackScenarios/payloadCorpus.js";

function makeCtx(): AttackScenarioContext {
  const target: SecurityValidationTarget = {
    targetRoot: process.cwd(),
    toolRoot: process.cwd(),
    packageName: "fixture",
    packageVersion: "1.0.0",
    hasPackageJson: true,
    hasSecurityTestScript: false,
    hasLockfile: false,
    branch: "main",
    commit: "abc",
    hasGit: true,
    isSelf: true,
  };
  return { toolRoot: process.cwd(), target, profile: "node-cli-package", config: DEFAULT_SECURITY_CONFIG };
}

describe("REPORT_POISONING_SCENARIO", () => {
  it("JSON report remains parseable for every report-poisoning payload → passed", async () => {
    const outcome = await REPORT_POISONING_SCENARIO.run(makeCtx());
    expect(outcome.status).toBe("passed");
  });

  it("covers all 5 report-poisoning payloads (ansi, fake-header, json-breakout, html-script, markdown-link)", async () => {
    const payloads = getPayloadsForGroup("report-poisoning");
    expect(payloads.length).toBe(5);
    const outcome = await REPORT_POISONING_SCENARIO.run(makeCtx());
    // 5 per-payload evidence entries + 1 direct sanitizer regression entry.
    expect(outcome.evidence.length).toBe(6);
  });

  it("does not crash on any payload (report renderer safety)", async () => {
    await expect(REPORT_POISONING_SCENARIO.run(makeCtx())).resolves.toBeDefined();
  });

  it("evidence includes payload id (via source), renderer checked, expected/observed behavior", async () => {
    const outcome = await REPORT_POISONING_SCENARIO.run(makeCtx());
    const ansiEvidence = outcome.evidence.find((e) => e.source?.includes("ansi-escape"));
    expect(ansiEvidence).toBeDefined();
    expect(ansiEvidence!.source).toContain("renderJsonReport");
    expect(ansiEvidence!.expectedBehavior).toBeTruthy();
    expect(ansiEvidence!.observedBehavior).toBeTruthy();
  });

  it("confirms ANSI escape sequences do not survive the sanitizer (direct regression check)", async () => {
    const outcome = await REPORT_POISONING_SCENARIO.run(makeCtx());
    const sanitizerEvidence = outcome.evidence.find((e) => e.source?.includes("sanitizeForTextReport"));
    expect(sanitizerEvidence?.observedBehavior).toMatch(/removed/i);
  });

  it("produces JSON-serializable evidence with no raw ANSI bytes leaking into previews", async () => {
    const outcome = await REPORT_POISONING_SCENARIO.run(makeCtx());
    const serialized = JSON.stringify(outcome.evidence);
    expect(() => JSON.parse(serialized)).not.toThrow();
    // eslint-disable-next-line no-control-regex
    expect(/\x1b\[[0-9;]*[a-zA-Z]/.test(serialized)).toBe(false);
  });
});
