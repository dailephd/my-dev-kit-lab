import type { AttackScenario, AttackScenarioContext, AttackScenarioRunOutcome } from "../attackScenario.js";
import { makeEvidence, stripUnsafeControlChars } from "../exploitEvidence.js";
import { getPayloadsForGroup } from "../payloadCorpus.js";
import { renderJsonReport, renderTextReport, sanitizeForTextReport } from "../../report/renderSecurityReport.js";
import type { SecurityReport } from "../../report/securityReportTypes.js";
import { SAFE_BASELINE_CONTENT, detectJsonStructuralInjection } from "../reportSchemaGuard.js";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 4 — report poisoning scenario.
//
// Registered under checkId "boundary" — the AttackScenario contract supports
// only one primary check id per scenario, and report-rendering safety is a
// boundary-of-trust concern (untrusted scanned/attacker content must not
// escape into trusted report structure), same family as Batch 3's
// configInjectionScenario (which covers a narrower slice of this: malformed
// CLI config + basic JSON-breakout safety). This scenario is the dedicated,
// broader check: ANSI/terminal escapes, fake section headers, HTML/script-
// like content, markdown-link-like content, and JSON structural integrity —
// all exercised through the real renderJsonReport()/renderTextReport()
// functions with controlled, non-destructive mock findings (no payload is
// ever written into target source files).
// ---------------------------------------------------------------------------

const REAL_VERDICT_BLOCK = ["=".repeat(72), "21. RELEASE VERDICT", "=".repeat(72)].join("\n");

function makePoisonedReport(payloadValue: string): SecurityReport {
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
      branch: "feature/security-validate-config-surface",
      commit: "abc1234",
      isSelf: true,
      generatedAt: now,
      totalDurationMs: 1,
    },
    sections: [],
    allChecks: [
      {
        id: "report-poisoning-fixture",
        name: payloadValue,
        category: "artifact-safety",
        status: "failed",
        severity: "major",
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        findings: [
          {
            id: "report-poisoning-fixture-finding",
            title: payloadValue,
            severity: "major",
            category: "artifact-safety",
            description: payloadValue,
            recommendation: payloadValue,
            releaseImpact: "Should fix before release",
          },
        ],
        skippedReason: payloadValue,
      },
    ],
    allFindings: [],
    verdict: "ready-except-optional-manual-checks",
    recommendedNextStep: payloadValue,
    attackResults: [
      {
        scenarioId: "report-poisoning-fixture-scenario",
        scenarioTitle: payloadValue,
        checkId: "boundary",
        profileId: "node-cli-package",
        status: "failed",
        severity: "major",
        confidence: "low",
        evidence: [
          makeEvidence({ kind: "observation", source: "fixture", confidence: "low", rawPreview: payloadValue }),
        ],
        category: "artifact-safety",
        recommendation: payloadValue,
        skippedReason: payloadValue,
      },
    ],
  };
}

export const REPORT_POISONING_SCENARIO: AttackScenario = {
  id: "report-poisoning-safety",
  title: "Report poisoning: renderer treats payload content as untrusted data, never trusted structure",
  description:
    "Renders text and JSON reports with report-poisoning payloads (ANSI escapes, fake section headers, JSON breakout, HTML/script-like, markdown-link-like) embedded in check/finding/attack-result fields, and confirms: JSON stays parseable with no extra top-level keys, text rendering never crashes, the real RELEASE VERDICT block is structurally intact, and no raw ANSI control bytes reach the final text output.",
  checkId: "boundary",
  applicableProfiles: [],
  severityBaseline: "major",
  verdictImpact: "tool-framework-blocker",
  expectedSafeBehavior:
    "Report-poisoning payloads are rendered as inert content; they never corrupt JSON structure, crash rendering, or forge a trusted verdict/section.",
  evidenceRequirements: ["output", "observation"],
  run: async (): Promise<AttackScenarioRunOutcome> => {
    const evidence = [];
    const problems: string[] = [];

    const payloads = getPayloadsForGroup("report-poisoning");
    // Baseline-diff check (v0.2.2 Batch 6): compare each poisoned render's
    // top-level JSON keys against an identically-shaped render carrying an
    // inert placeholder instead of the payload. A payload can only widen the
    // top-level shape by actually breaking out of its string context —
    // legitimate additive schema fields appear in both and are never
    // flagged, so this doesn't need to know the current field list at all.
    const baselineJson = renderJsonReport(makePoisonedReport(SAFE_BASELINE_CONTENT));
    for (const payload of payloads) {
      let jsonOk = true;
      let jsonExtraKeys: string[] = [];
      let textOk = true;
      let textError: string | undefined;
      let verdictBlockIntact = true;
      let rawAnsiLeaked = false;

      const report = makePoisonedReport(payload.value);

      try {
        const json = renderJsonReport(report);
        const injection = detectJsonStructuralInjection(baselineJson, json);
        jsonExtraKeys = injection.injectedTopLevelKeys;
        jsonOk = injection.parseable && jsonExtraKeys.length === 0;
      } catch {
        jsonOk = false;
      }

      let text = "";
      try {
        text = renderTextReport(report);
      } catch (err) {
        textOk = false;
        textError = err instanceof Error ? err.message : String(err);
      }

      if (textOk) {
        verdictBlockIntact = text.includes(REAL_VERDICT_BLOCK);
        rawAnsiLeaked = /\x1b\[[0-9;]*[a-zA-Z]/.test(text);
      }

      const payloadProblem = !jsonOk || !textOk || !verdictBlockIntact || rawAnsiLeaked;
      if (payloadProblem) {
        problems.push(payload.id);
      }

      evidence.push(
        makeEvidence({
          kind: "output",
          source: `renderJsonReport()/renderTextReport() with payload '${payload.id}'`,
          confidence: "high",
          expectedBehavior:
            "JSON parseable with no extra top-level keys; text rendering does not crash; real verdict block intact; no raw ANSI bytes in text output.",
          observedBehavior: `jsonOk=${jsonOk}${jsonExtraKeys.length > 0 ? ` (extraKeys=${jsonExtraKeys.join(",")})` : ""}, textOk=${textOk}${textError ? ` (${textError})` : ""}, verdictBlockIntact=${verdictBlockIntact}, rawAnsiLeaked=${rawAnsiLeaked}`,
          rawPreview: payload.value,
        })
      );
    }

    // Direct regression check on the sanitizer itself, independent of the
    // full report pipeline above.
    const ansiPayload = payloads.find((p) => p.id === "report-poisoning-ansi-escape");
    if (ansiPayload) {
      const sanitized = sanitizeForTextReport(ansiPayload.value);
      const stillHasAnsi = /\x1b\[[0-9;]*[a-zA-Z]/.test(sanitized);
      const stillHasAnsiViaStrip = /\x1b\[[0-9;]*[a-zA-Z]/.test(stripUnsafeControlChars(ansiPayload.value));
      if (stillHasAnsi || stillHasAnsiViaStrip) {
        problems.push("ansi-sanitizer-regression");
      }
      evidence.push(
        makeEvidence({
          kind: "observation",
          source: "sanitizeForTextReport() / stripUnsafeControlChars() direct check",
          confidence: "high",
          expectedBehavior: "ANSI escape sequences are removed by the sanitizer.",
          observedBehavior: stillHasAnsi || stillHasAnsiViaStrip ? "ANSI bytes survived sanitization." : "ANSI bytes removed.",
        })
      );
    }

    if (problems.length > 0) {
      return {
        status: "failed",
        confidence: "high",
        evidence,
        recommendation: `Report rendering is not safe against payload(s): ${problems.join(", ")}. Fix before treating generated reports as safe to share.`,
      };
    }

    return { status: "passed", confidence: "high", evidence };
  },
};
