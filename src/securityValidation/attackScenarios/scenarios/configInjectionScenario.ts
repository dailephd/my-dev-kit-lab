import type { AttackScenario, AttackScenarioContext, AttackScenarioRunOutcome } from "../attackScenario.js";
import { makeEvidence } from "../exploitEvidence.js";
import { getPayloadsForGroup } from "../payloadCorpus.js";
import { normalizeSecurityValidateConfig } from "../../validate/cliOptions.js";
import { renderJsonReport, renderTextReport } from "../../report/renderSecurityReport.js";
import type { SecurityReport } from "../../report/securityReportTypes.js";
import { SAFE_BASELINE_CONTENT, detectJsonStructuralInjection } from "../reportSchemaGuard.js";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 3 — config injection scenario.
//
// Two parts, using the Batch 2 "malformed-config" and "report-poisoning"
// payload groups:
//  1. Confirms malformed values for --checks/--profile/--format/--fail-on are
//     rejected by normalizeSecurityValidateConfig() (Batch 1) rather than
//     silently accepted or partially applied.
//  2. Confirms JSON-breakout / ANSI-escape style strings embedded in report
//     content (e.g. via a check name or skip reason) do not corrupt
//     renderJsonReport()'s output (still valid, parseable JSON) or crash
//     renderTextReport().
// ---------------------------------------------------------------------------

function makeFixtureReport(injected: string): SecurityReport {
  const now = new Date().toISOString();
  return {
    metadata: {
      toolRoot: "/tool/root",
      toolPackageName: "my-dev-kit-lab",
      toolPackageVersion: "0.2.1",
      targetRoot: "/tool/root",
      targetDescription: "self (my-dev-kit-lab)",
      packageName: "my-dev-kit-lab",
      packageVersion: "0.2.1",
      branch: injected,
      commit: "abc1234",
      isSelf: true,
      generatedAt: now,
      totalDurationMs: 1,
    },
    sections: [],
    allChecks: [
      {
        id: "config-injection-fixture",
        name: injected,
        category: "artifact-safety",
        status: "skipped",
        severity: "skipped",
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        findings: [],
        skippedReason: injected,
      },
    ],
    allFindings: [],
    verdict: "ready-except-optional-manual-checks",
    recommendedNextStep: injected,
  };
}

export const CONFIG_INJECTION_SCENARIO: AttackScenario = {
  id: "config-injection-safety",
  title: "Config injection: malformed CLI config is rejected; injected content cannot corrupt reports",
  description:
    "Confirms malformed --checks/--profile/--format/--fail-on values fail cleanly via normalizeSecurityValidateConfig(), and that JSON-breakout/ANSI-escape strings embedded in report content do not corrupt JSON output or crash text rendering.",
  checkId: "boundary",
  applicableProfiles: [],
  severityBaseline: "major",
  verdictImpact: "tool-framework-blocker",
  expectedSafeBehavior:
    "Malformed config values always throw before any validation runs; injected content in report fields never breaks JSON parseability or text rendering.",
  evidenceRequirements: ["observation", "output"],
  run: async (ctx: AttackScenarioContext): Promise<AttackScenarioRunOutcome> => {
    const evidence = [];
    const notRejected: string[] = [];

    const malformedPayloads = getPayloadsForGroup("malformed-config");
    const flagsToTest: Array<"checks" | "profile" | "format" | "failOn"> = ["checks", "profile", "format", "failOn"];

    for (const payload of malformedPayloads) {
      for (const flag of flagsToTest) {
        let rejected = false;
        try {
          normalizeSecurityValidateConfig({ [flag]: payload.value }, ctx.toolRoot);
        } catch {
          rejected = true;
        }
        if (!rejected) {
          notRejected.push(`${flag}=${payload.id}`);
        }
      }
    }
    evidence.push(
      makeEvidence({
        kind: "observation",
        source: "normalizeSecurityValidateConfig()",
        confidence: "high",
        expectedBehavior: `All ${malformedPayloads.length * flagsToTest.length} malformed (payload, flag) combinations must throw.`,
        observedBehavior:
          notRejected.length === 0
            ? "All malformed combinations were rejected."
            : `${notRejected.length} combination(s) were NOT rejected.`,
      })
    );

    const poisoningPayloads = getPayloadsForGroup("report-poisoning");
    const baselineJson = renderJsonReport(makeFixtureReport(SAFE_BASELINE_CONTENT));
    let jsonCorrupted = false;
    let textCrashed = false;
    for (const payload of poisoningPayloads) {
      const report = makeFixtureReport(payload.value);
      try {
        const json = renderJsonReport(report);
        // Baseline-diff check (v0.2.2 Batch 6): a payload can only widen the
        // top-level JSON shape by actually breaking out of its string
        // context — legitimate additive schema fields render identically in
        // both the baseline and poisoned renders and are never flagged.
        const injection = detectJsonStructuralInjection(baselineJson, json);
        if (!injection.parseable || injection.injectedTopLevelKeys.length > 0) {
          jsonCorrupted = true;
        }
      } catch {
        jsonCorrupted = true;
      }
      try {
        renderTextReport(report);
      } catch {
        textCrashed = true;
      }
    }
    evidence.push(
      makeEvidence({
        kind: "output",
        source: "renderJsonReport() / renderTextReport() with report-poisoning payloads",
        confidence: "high",
        expectedBehavior: "JSON stays parseable with no extra top-level keys; text rendering never throws.",
        observedBehavior: `jsonCorrupted=${jsonCorrupted}, textCrashed=${textCrashed}`,
      })
    );

    if (notRejected.length > 0 || jsonCorrupted || textCrashed) {
      return {
        status: "failed",
        confidence: "high",
        evidence,
        recommendation:
          notRejected.length > 0
            ? "Ensure normalizeSecurityValidateConfig() validates every enum flag against its known-value list."
            : "Ensure report rendering treats all field content as opaque data (JSON.stringify already does this by construction).",
      };
    }

    return {
      status: "passed",
      confidence: "high",
      evidence,
    };
  },
};
