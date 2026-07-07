import type { AttackScenario, AttackScenarioContext, AttackScenarioRunOutcome } from "../attackScenario.js";
import { makeEvidence } from "../exploitEvidence.js";
import { runSecurityCommand, resolveNpmCommand } from "../../commandRunner.js";
import { parseNpmPackDryRun } from "../../packageChecks/parseNpmPackDryRun.js";
import { detectForbiddenContents, isCriticalForbidden } from "../../packageChecks/forbiddenPackageContents.js";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 3 — package boundary scenario.
//
// Reuses the existing npm-pack-dry-run parser and forbidden-content detector
// (src/securityValidation/packageChecks/) rather than re-implementing tarball
// parsing. This scenario adds structured, evidence-first attack-scenario
// framing on top of the same underlying data the "package" check group
// already produces — it does not publish or create real package artifacts.
//
// v0.2.2 Batch 5: escalates the result severity to "blocker" (via
// AttackScenarioRunOutcome.severity) when any matched file is
// isCriticalForbidden() (.env, .pem, .key, .p12, lab-output/, .my-dev-kit/) —
// reusing the exact same critical-file rule the underlying package check
// already applies, so a real secret-shaped leak in the tarball reliably
// triggers the "not-ready" verdict via blocker severity, not just "major".
// ---------------------------------------------------------------------------

export const PACKAGE_BOUNDARY_SCENARIO: AttackScenario = {
  id: "package-boundary-forbidden-content",
  title: "Package boundary: npm tarball excludes forbidden/local-only content",
  description:
    "Runs npm pack --dry-run against the target and verifies the resulting tarball file list does not include forbidden paths (.env, reports/security/, lab-output/, .my-dev-kit/, tarballs, node_modules, etc).",
  checkId: "boundary",
  applicableProfiles: [],
  severityBaseline: "major",
  verdictImpact: "target-project-blocker",
  expectedSafeBehavior: "The npm pack --dry-run file list contains no files matching the forbidden content patterns.",
  evidenceRequirements: ["package-content", "command"],
  skipCondition: (ctx: AttackScenarioContext) => {
    if (!ctx.target.hasPackageJson) {
      return "Target has no package.json; npm pack --dry-run based package boundary check is not applicable.";
    }
    return undefined;
  },
  run: async (ctx: AttackScenarioContext): Promise<AttackScenarioRunOutcome> => {
    const npm = resolveNpmCommand();
    const cmd = await runSecurityCommand({
      command: npm,
      args: ["pack", "--dry-run"],
      cwd: ctx.target.targetRoot,
      timeoutMs: ctx.config.commandTimeoutMs,
    });

    const commandEvidence = makeEvidence({
      kind: "command",
      source: "npm pack --dry-run",
      commandCwd: ctx.target.targetRoot,
      commandSummary: `${npm} pack --dry-run`,
      exitCode: cmd.exitCode,
      confidence: "high",
    });

    const packOutput =
      [cmd.stdout, cmd.stderr].find((stream) => /tarball contents/i.test(stream)) ??
      [cmd.stdout, cmd.stderr].filter(Boolean).join("\n");
    const parsed = parseNpmPackDryRun(packOutput);

    if (parsed.parseError && parsed.files.length === 0) {
      return {
        status: "blocked",
        confidence: "low",
        evidence: [
          commandEvidence,
          makeEvidence({
            kind: "skipped-tool",
            source: "npm pack --dry-run",
            confidence: "low",
            observedBehavior: parsed.parseError,
            expectedBehavior: "npm pack --dry-run should list tarball contents for evaluation.",
          }),
        ],
        recommendation: "Ensure npm is available and the target package.json is valid, then re-run.",
      };
    }

    const { matches, findings } = detectForbiddenContents({
      files: parsed.files,
      forbiddenPatterns: ctx.config.forbiddenPackagePatterns,
      allowedExceptions: ctx.config.allowedPackageExceptions,
      checkId: "attack-boundary-package",
    });

    if (matches.length === 0) {
      return {
        status: "passed",
        confidence: "high",
        evidence: [
          commandEvidence,
          makeEvidence({
            kind: "package-content",
            source: "npm pack --dry-run file list",
            confidence: "high",
            observedBehavior: `${parsed.files.length} file(s) inspected; none matched a forbidden pattern.`,
            expectedBehavior: "No forbidden paths in the tarball file list.",
          }),
        ],
      };
    }

    const evidence = [
      commandEvidence,
      ...matches.slice(0, 20).map((m, i) => {
        const finding = findings[i];
        return makeEvidence({
          kind: "package-content",
          source: "npm pack --dry-run file list",
          filePath: m.file,
          confidence: "high",
          expectedBehavior: "Forbidden paths must not appear in the published tarball.",
          observedBehavior: `Included '${m.file}' matching forbidden pattern '${m.pattern}' (${finding?.severity ?? "major"} severity).`,
        });
      }),
    ];

    const hasCriticalMatch = matches.some((m) => isCriticalForbidden(m.file));

    return {
      status: "failed",
      confidence: "high",
      evidence,
      severity: hasCriticalMatch ? "blocker" : "major",
      recommendation: `Add ${matches.length} matched path(s) to .npmignore or the package.json "files" allowlist before publishing.`,
    };
  },
};
