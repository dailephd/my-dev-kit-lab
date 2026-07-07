import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { runDependencyChecks } from "../dependencies/runDependencyChecks.js";
import { runPackageChecks } from "../packageChecks/runPackageChecks.js";
import { runCodeqlCheck } from "../staticScans/codeql.js";
import { runSemgrepCheck } from "../staticScans/semgrep.js";
import { runAllFuzzTargets } from "../fuzz/fuzzHarness.js";
import { ALL_FUZZ_TARGETS } from "../fuzz/fuzzTargets.js";
import { calculateVerdict, summarizeVerdictReasoning } from "./verdict.js";
import { resolveValidationTarget, targetDescription as describeTarget } from "./resolveTarget.js";
import { DEFAULT_SECURITY_CONFIG } from "../config.js";
import type { SecurityCheckResult, SecurityFinding, SecurityValidationSummary } from "../types.js";
import type { SecurityValidationConfig } from "../config.js";
import { runCliSecuritySuiteCheck } from "./runCliSecuritySuiteCheck.js";
import {
  DEFAULT_SECURITY_CHECKS,
  DEFAULT_SECURITY_PROFILE,
  IMPLEMENTED_SECURITY_CHECK_IDS,
  PLANNED_SECURITY_CHECK_IDS,
  type SecurityCheckId,
  type SecurityProfileId,
} from "./cliOptions.js";
import { runAttackScenarios } from "../attackScenarios/attackRunner.js";
import { toSecurityCheckResult, type AttackResult } from "../attackScenarios/attackResult.js";
import { captureTargetSnapshot } from "../attackScenarios/targetSnapshot.js";

export type RunSecurityValidationOptions = {
  // my-dev-kit-lab root (tool root — where configs, fuzz targets, and tests live)
  cwd: string;
  // Optional path to the project being validated. Omit for self-validation.
  targetPath?: string;
  config?: Partial<SecurityValidationConfig>;
  fuzzIterations?: number;
  fuzzSeed?: number;
  // v0.2.2 Batch 1: which check groups to run. Defaults to all implemented groups
  // (deps, package, static, cli-adversarial, fuzz), preserving prior behavior.
  selectedChecks?: SecurityCheckId[];
  // v0.2.2 Batch 2: profile passed through to the attack-scenario runner for
  // scenario applicability filtering. Report-metadata-only otherwise.
  profile?: SecurityProfileId;
};

const NOT_SELECTED_REASON = "Not selected via --checks.";

function skippedCheck(
  id: string,
  name: string,
  category: SecurityCheckResult["category"],
  skippedReason: string
): SecurityCheckResult {
  const now = new Date().toISOString();
  return {
    id,
    name,
    category,
    status: "skipped",
    severity: "skipped",
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    findings: [],
    skippedReason,
  };
}

export async function runSecurityValidation(
  options: RunSecurityValidationOptions
): Promise<SecurityValidationSummary> {
  const toolRoot = options.cwd;
  const config: SecurityValidationConfig = {
    ...DEFAULT_SECURITY_CONFIG,
    reportDir: path.join(toolRoot, DEFAULT_SECURITY_CONFIG.reportDir),
    rawOutputDir: path.join(toolRoot, DEFAULT_SECURITY_CONFIG.rawOutputDir),
    ...options.config,
  };

  // Resolve and validate the target project
  const target = resolveValidationTarget(options.targetPath, toolRoot);

  // v0.2.2 Batch 3: read-only git-status snapshot taken before any checks run,
  // so the target-sandbox attack scenario (which runs last, among the
  // attack-scenario checks) can distinguish pre-existing target dirtiness
  // from changes caused by this validation run.
  const targetSnapshotBefore = captureTargetSnapshot(target.targetRoot, target.hasGit);

  const startedAt = new Date().toISOString();
  const allChecks: SecurityCheckResult[] = [];
  const allFindings: SecurityFinding[] = [];
  const selectedChecks = new Set<SecurityCheckId>(options.selectedChecks ?? DEFAULT_SECURITY_CHECKS);

  function collect(check: SecurityCheckResult): void {
    allChecks.push(check);
    allFindings.push(...check.findings);
  }

  function collectMany(checks: SecurityCheckResult[]): void {
    for (const c of checks) collect(c);
  }

  // --- Dependency checks (runs in target root) ---
  // If target has no package.json/lockfile, runDependencyChecks will surface that
  // as a structured finding rather than crashing.
  if (selectedChecks.has("deps")) {
    try {
      const depOutput = await runDependencyChecks({ cwd: target.targetRoot, config });
      collectMany(depOutput.checks);
    } catch (err) {
      collect(errorCheck("dependency-checks", "Dependency checks", "dependency-audit", err));
    }
  } else {
    // Preserve the mandatory-check IDs verdict.ts relies on so deselecting this
    // group still shows up as a skipped mandatory check, not a silent gap.
    collect(skippedCheck("npm-audit-full", "npm audit (full)", "dependency-audit", NOT_SELECTED_REASON));
    collect(skippedCheck("npm-audit-runtime", "npm audit (runtime)", "dependency-audit", NOT_SELECTED_REASON));
  }

  // --- Package content checks (runs in target root) ---
  // Not all projects are publishable npm packages; runPackageChecks handles
  // missing package.json gracefully.
  if (selectedChecks.has("package")) {
    try {
      const pkgOutput = await runPackageChecks({ cwd: target.targetRoot, config });
      collectMany(pkgOutput.checks);
    } catch (err) {
      collect(errorCheck("package-content", "Package content checks", "package-content", err));
    }
  } else {
    collect(skippedCheck("npm-pack-dry-run", "npm pack --dry-run", "package-content", NOT_SELECTED_REASON));
  }

  // --- Static scans (scan target root; config from tool root) ---
  if (selectedChecks.has("static")) {
    try {
      collect(
        await runCodeqlCheck({ cwd: toolRoot, targetRoot: target.targetRoot, timeoutMs: config.commandTimeoutMs })
      );
    } catch (err) {
      collect(errorCheck("codeql-scan", "CodeQL static analysis", "static-scan", err));
    }

    try {
      collect(
        await runSemgrepCheck({
          targetRoot: target.targetRoot,
          toolRoot,
          timeoutMs: config.commandTimeoutMs,
        })
      );
    } catch (err) {
      collect(errorCheck("semgrep-scan", "Semgrep static analysis", "static-scan", err));
    }
  } else {
    collect(skippedCheck("codeql-scan", "CodeQL static analysis", "static-scan", NOT_SELECTED_REASON));
    collect(skippedCheck("semgrep-scan", "Semgrep static analysis", "static-scan", NOT_SELECTED_REASON));
  }

  // --- Security suite check ---
  // Self-validation runs the lab's own test:security suite.
  // External validation runs the target project's test:security script when present.
  if (selectedChecks.has("cli-adversarial")) {
    collect(
      await runCliSecuritySuiteCheck({
        toolRoot,
        target,
        timeoutMs: config.commandTimeoutMs,
      })
    );
  } else {
    collect(
      skippedCheck("cli-adversarial-suite", "Target security test suite", "cli-adversarial", NOT_SELECTED_REASON)
    );
  }

  // --- Fuzz smoke (always tool-internal; tests library parser/helper code) ---
  if (selectedChecks.has("fuzz")) {
    try {
      collect(
        await runAllFuzzTargets(ALL_FUZZ_TARGETS, {
          seed: options.fuzzSeed ?? 0xdeadbeef,
          iterations: options.fuzzIterations ?? 50,
        })
      );
    } catch (err) {
      collect(errorCheck("fuzz-smoke", "Fuzz smoke", "fuzz-smoke", err));
    }
  } else {
    collect(skippedCheck("fuzz-smoke", "Fuzz smoke", "fuzz-smoke", NOT_SELECTED_REASON));
  }

  // --- Attack-scenario checks (boundary, subprocess, secrets, network) ---
  // v0.2.2 Batch 2: routed through the attack-scenario runner. The registry
  // is empty in Batch 2, so these currently resolve to explicit "no
  // scenarios registered yet" skipped results — never "passed".
  const profile = options.profile ?? DEFAULT_SECURITY_PROFILE;
  const attackScenarioChecks = PLANNED_SECURITY_CHECK_IDS.filter((id) => selectedChecks.has(id));
  let attackResults: AttackResult[] = [];
  if (attackScenarioChecks.length > 0) {
    try {
      attackResults = await runAttackScenarios({
        selectedChecks: attackScenarioChecks,
        profile,
        toolRoot,
        target,
        config,
        targetSnapshotBefore,
      });
    } catch (err) {
      attackResults = attackScenarioChecks.map((checkId) => ({
        scenarioId: `${checkId}-attack-runner-error`,
        scenarioTitle: `Attack scenario runner error for '${checkId}'`,
        checkId,
        profileId: profile,
        status: "blocked" as const,
        severity: "major" as const,
        confidence: "low" as const,
        evidence: [],
        category: "cli-adversarial" as const,
        errorSummary: err instanceof Error ? err.message : String(err),
      }));
    }
    for (const result of attackResults) {
      collect(toSecurityCheckResult(result));
    }
  }

  const finishedAt = new Date().toISOString();

  // --- Tool root metadata ---
  let toolPackageName = "my-dev-kit-lab";
  let toolPackageVersion = "unknown";

  try {
    const pkgRaw = fs.readFileSync(path.join(toolRoot, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { name?: string; version?: string };
    if (pkg.name) toolPackageName = pkg.name;
    if (pkg.version) toolPackageVersion = pkg.version;
  } catch {
    // Use defaults.
  }

  const { verdict, recommendedNextStep } = calculateVerdict(allChecks, allFindings);
  const verdictReasonSummary = summarizeVerdictReasoning(allChecks, allFindings);
  // "Full release gate" = every classic pre-v0.2.2 check group was selected.
  // Attack-scenario checks (boundary/subprocess/secrets/network) are
  // additional coverage, not part of that traditional baseline gate.
  const isFullReleaseGate = IMPLEMENTED_SECURITY_CHECK_IDS.every((id) => selectedChecks.has(id));

  return {
    toolRoot,
    toolPackageName,
    toolPackageVersion,
    targetRoot: target.targetRoot,
    targetDescription: describeTarget(target),
    packageName: target.packageName ?? (target.isSelf ? toolPackageName : path.basename(target.targetRoot)),
    packageVersion: target.packageVersion ?? (target.isSelf ? toolPackageVersion : "unknown"),
    auditedBranch: target.branch ?? "unknown",
    auditedCommit: target.commit ?? "unknown",
    isSelf: target.isSelf,
    startedAt,
    finishedAt,
    checks: allChecks,
    findings: allFindings,
    verdict,
    recommendedNextStep,
    attackResults,
    verdictReasonSummary,
    isFullReleaseGate,
  };
}

function errorCheck(
  id: string,
  name: string,
  category: SecurityCheckResult["category"],
  err: unknown
): SecurityCheckResult {
  const now = new Date().toISOString();
  return {
    id,
    name: `${name} (orchestrator error)`,
    category,
    status: "failed",
    severity: "major",
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    findings: [],
    skippedReason: err instanceof Error ? err.message : String(err),
  };
}
