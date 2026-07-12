import fs from "node:fs";
import path from "node:path";
import type { SecurityFinding } from "../../../../../securityValidation/types.js";
import { makeAndroidFinding } from "../../../audit/androidFinding.js";
import { makeCandidateEvidence, type CandidateEvidence } from "../../candidateEvidence.js";
import { buildAndroidSourceLocation } from "../../sourceLocation.js";
import { sortCandidateEvidence } from "../../ordering.js";
import type { AndroidDetectionResult } from "../../../detection.js";
import type { AndroidCheckResult, AndroidCheckStatus } from "../../../validation/checkResult.js";
import { buildGradleCommandPlan } from "../../../gradle/validate/planner.js";
import type { GradleCommandExecutor } from "../../../gradle/validate/executor.js";
import { captureTargetSnapshot, isExpectedAndroidGeneratedPath } from "../../../gradle/validate/targetMutation.js";
import { buildExternalToolMutationReport, findFreshFiles } from "../mutation.js";
import { copyExternalToolArtifactFromTarget } from "../artifacts.js";
import { parseLintXml } from "./parseLintXml.js";
import { parseLintSarif } from "./parseLintSarif.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — standalone Android Lint check. Reuses the existing
// lint-debug Gradle operation as-is (its fixed args already include
// --offline/--no-daemon/--console=plain — see operations.ts) rather than
// creating a second Gradle task/operation system. Not called from
// validateAndroidTarget or any active orchestration; not rendered in
// reports; no CLI effect. Batch 8 integrates.
// ---------------------------------------------------------------------------

export const ANDROID_LINT_AUDIT_CHECK_ID = "android-lint-audit";
const LINT_REPORT_EXTENSIONS = [".xml", ".sarif"];

export type AndroidLintCheckOptions = {
  targetRoot: string;
  detection: AndroidDetectionResult;
  executor: GradleCommandExecutor;
  artifactRoot: string;
  // Injectable for tests: mirrors runOptionalGradleValidation's task-gating
  // (lint-debug is only attempted when the lintDebug task is known
  // available). Defaults to true so callers that already ran task
  // discovery can pass the real result; a caller with no task-discovery
  // evidence may explicitly pass false to represent "task unknown".
  taskAvailable?: boolean;
};

function skippedCheck(reason: string, environmentRequirements: string[] = []): AndroidCheckResult {
  return {
    id: ANDROID_LINT_AUDIT_CHECK_ID,
    category: "android-lint",
    title: "Android Lint audit (offline)",
    status: "skipped",
    requirementLevel: "optional",
    ran: false,
    skipped: true,
    skipInfo: {
      checkId: ANDROID_LINT_AUDIT_CHECK_ID,
      reason,
      requirementLevel: "optional",
      missingCapability: "gradle-lint-debug",
      verdictImpact: "does not apply until Batch 8 integration",
      recommendedNextAction: "Ensure a Gradle wrapper, Java, Android SDK, and cached dependencies are available, or run again after Batch 8 wires optional-tool selection into the CLI.",
    },
    evidence: [],
    findings: [],
    warnings: [],
    errors: [],
    sourcePaths: [],
    confidence: "unknown",
    environmentRequirements,
    candidateEvidence: [],
  };
}

function severityToProject(severity: string): "major" | "minor" | "informational" | undefined {
  const normalized = severity.toLowerCase();
  if (normalized === "fatal" || normalized === "error") return "major";
  if (normalized === "warning") return "minor";
  if (normalized === "information" || normalized === "informational") return "informational";
  if (normalized === "ignore") return undefined;
  return undefined;
}

export async function auditAndroidLint(options: AndroidLintCheckOptions): Promise<AndroidCheckResult> {
  const targetRoot = path.resolve(options.targetRoot);

  if (options.taskAvailable === false) {
    return skippedCheck("The lintDebug Gradle task was not found for this target.");
  }

  const plan = buildGradleCommandPlan("lint-debug", targetRoot, options.detection);
  if (plan.rejected) {
    return skippedCheck(plan.reason);
  }

  const before = captureTargetSnapshot(targetRoot, true);
  const startedAtMs = Date.now();
  const result = await options.executor(plan);
  const after = captureTargetSnapshot(targetRoot, true);
  const mutation = buildExternalToolMutationReport(before, after, isExpectedAndroidGeneratedPath);

  const warnings: string[] = [];
  if (!mutation.comparable) warnings.push(`Target mutation evidence unavailable: ${mutation.reason ?? "unknown reason"}`);
  if (mutation.unexpectedChanges.length > 0) warnings.push(`Unexpected target change(s) observed: ${mutation.unexpectedChanges.join(", ")}`);

  if (result.timedOut) {
    return {
      id: ANDROID_LINT_AUDIT_CHECK_ID,
      category: "android-lint",
      title: "Android Lint audit (offline)",
      status: "inconclusive",
      requirementLevel: "optional",
      ran: true,
      skipped: false,
      evidence: [`exitCode=${result.exitCode ?? "null"}`],
      findings: [],
      warnings: [...warnings, `lintDebug timed out after ${plan.timeoutMs}ms.`],
      errors: [],
      sourcePaths: [],
      confidence: "medium",
      environmentRequirements: plan.environmentLimitations,
      candidateEvidence: [],
    };
  }

  if (result.exitCode === null) {
    return skippedCheck("Gradle could not be spawned or resolved for this target (missing Java, wrapper, or environment issue).");
  }

  // Discover fresh (created-or-modified-by-this-run) lint report files
  // rather than trusting a stale pre-existing report from an earlier run.
  // A small backward epsilon absorbs filesystem mtime rounding/clock-tick
  // granularity (observed on some Windows filesystems) without meaningfully
  // weakening the stale-report exclusion, since a genuinely stale report is
  // from a prior run (seconds/minutes old), not a few tens of milliseconds.
  const FRESHNESS_EPSILON_MS = 250;
  const freshFiles = findFreshFiles(targetRoot, LINT_REPORT_EXTENSIONS, startedAtMs - FRESHNESS_EPSILON_MS).filter((f) => /lint-results/i.test(path.basename(f)));

  const findingsById = new Map<string, SecurityFinding>();
  const candidatesById = new Map<string, CandidateEvidence>();
  const limitations = ["Reflects the debug variant lint run only; does not prove the published release variant's lint result.", "Gradle/plugin/report format may drift; unsupported report shapes are represented conservatively."];

  const finding = (issueId: string, severity: "major" | "minor", title: string, message: string, relativePath: string | undefined, line: number | undefined, module: string | undefined) =>
    findingsById.set(
      `lint:${issueId}:${relativePath ?? "(no-path)"}:${line ?? 0}`,
      makeAndroidFinding({
        ruleId: "android-optional-tool-lint-evidence",
        title,
        severity,
        confidence: "medium",
        description: message || `Android Lint reported issue ${issueId}.`,
        manifestPath: relativePath ?? "(unresolved)",
        identity: `lint:${issueId}:${module ?? "(root)"}`,
        location: { line },
        evidenceDetails: [`externalRuleId=${issueId}`, module ? `module=${module}` : undefined].filter((v): v is string => Boolean(v)),
        recommendation: "Review the Android Lint issue and remediate or explicitly suppress it with justification.",
      })
    );

  const candidate = (issueId: string, summary: string, relativePath: string | undefined, line: number | undefined, confidence: "low" | "medium" = "low") =>
    candidatesById.set(
      `${issueId}:${relativePath ?? "(no-path)"}:${line ?? 0}:${summary.slice(0, 40)}`,
      makeCandidateEvidence({
        ruleId: "android-optional-tool-lint-evidence",
        category: "android-lint",
        confidence,
        location: relativePath ? (() => { try { return buildAndroidSourceLocation(targetRoot, path.resolve(targetRoot, relativePath), { line }); } catch { return { path: relativePath, line }; } })() : { path: "(unknown)" },
        summary,
        rawValue: undefined,
        resolutionState: "resolved",
        staticAnalysisLimitations: limitations,
      })
    );

  const seenIssueKeys = new Set<string>();
  let sawAnyReport = false;

  for (const filePath of freshFiles) {
    const content = readFileSafe(filePath);
    if (content === undefined) continue;
    const moduleGuess = moduleForPath(targetRoot, filePath, options.detection.modules.map((m) => m.path));
    const artifact = copyExternalToolArtifactFromTarget(options.artifactRoot, targetRoot, "android-lint", filePath, filePath.toLowerCase().endsWith(".sarif") ? "sarif" : "xml");
    void artifact;

    if (filePath.toLowerCase().endsWith(".xml")) {
      const parsedXml = parseLintXml(content);
      if (parsedXml.malformed) {
        warnings.push(`Malformed lint XML report: ${path.basename(filePath)}`);
        continue;
      }
      sawAnyReport = true;
      for (const issue of parsedXml.issues) {
        const dedupeKey = `${issue.id}:${issue.file}:${issue.line}`;
        if (seenIssueKeys.has(dedupeKey)) continue;
        seenIssueKeys.add(dedupeKey);
        const relativePath = issue.file ? relativeIfContained(targetRoot, issue.file) : undefined;
        const projectSeverity = severityToProject(issue.severity);
        if (projectSeverity === "major" || projectSeverity === "minor") {
          finding(issue.id, projectSeverity, `Android Lint: ${issue.id}`, issue.message, relativePath, issue.line, moduleGuess);
        } else {
          candidate(issue.id, `Android Lint ${issue.severity} issue: ${issue.id} — ${issue.message}`, relativePath, issue.line, projectSeverity === "informational" ? "medium" : "low");
        }
      }
    } else {
      const parsedSarif = parseLintSarif(content);
      if (parsedSarif.malformed) {
        warnings.push(`Malformed lint SARIF report: ${path.basename(filePath)}`);
        continue;
      }
      sawAnyReport = true;
      for (const sarifResult of parsedSarif.results) {
        const dedupeKey = `${sarifResult.ruleId}:${sarifResult.artifactUri}:${sarifResult.line}`;
        if (seenIssueKeys.has(dedupeKey)) continue;
        seenIssueKeys.add(dedupeKey);
        const relativePath = sarifResult.artifactUri ? relativeIfContained(targetRoot, sarifResult.artifactUri) : undefined;
        candidate(sarifResult.ruleId, `Android Lint SARIF ${sarifResult.level} result: ${sarifResult.ruleId} — ${sarifResult.message}`, relativePath, sarifResult.line, "low");
      }
    }
  }

  const findings = [...findingsById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const candidateEvidence = sortCandidateEvidence([...candidatesById.values()]);

  if (!sawAnyReport) {
    const status: AndroidCheckStatus = result.exitCode === 0 ? "inconclusive" : "inconclusive";
    return {
      id: ANDROID_LINT_AUDIT_CHECK_ID,
      category: "android-lint",
      title: "Android Lint audit (offline)",
      status,
      requirementLevel: "optional",
      ran: true,
      skipped: false,
      evidence: [`exitCode=${result.exitCode}`, "No fresh structured lint report was discovered."],
      findings: [],
      warnings,
      errors: result.exitCode !== 0 ? ["lintDebug exited non-zero and no structured report was produced."] : [],
      sourcePaths: [],
      confidence: "low",
      environmentRequirements: plan.environmentLimitations,
      candidateEvidence: [],
    };
  }

  const status: AndroidCheckStatus = findings.length > 0 ? "failed" : "passed";
  if (result.exitCode !== 0) {
    warnings.push(`lintDebug exited with code ${result.exitCode}; a structured report was still discovered and parsed.`);
  }

  return {
    id: ANDROID_LINT_AUDIT_CHECK_ID,
    category: "android-lint",
    title: "Android Lint audit (offline)",
    status,
    requirementLevel: "optional",
    ran: true,
    skipped: false,
    evidence: [`exitCode=${result.exitCode}`, `reportsDiscovered=${freshFiles.length}`, `expectedGeneratedPaths=${plan.expectedGeneratedPaths.join(",") || "(none)"}`],
    findings,
    warnings,
    errors: [],
    sourcePaths: freshFiles.map((f) => relativeIfContained(targetRoot, f) ?? f),
    confidence: "high",
    environmentRequirements: plan.environmentLimitations,
    targetModificationObserved: mutation.comparable ? mutation.unexpectedChanges.length > 0 : undefined,
    candidateEvidence,
  };
}

function readFileSafe(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function moduleForPath(targetRoot: string, filePath: string, modulePaths: readonly string[]): string | undefined {
  const relative = relativeIfContained(targetRoot, filePath);
  if (!relative) return undefined;
  return modulePaths.find((m) => relative.startsWith(`${m}/`));
}

function relativeIfContained(root: string, absoluteOrRelative: string): string | undefined {
  const absolute = path.isAbsolute(absoluteOrRelative) ? absoluteOrRelative : path.resolve(root, absoluteOrRelative);
  const normalizedRoot = path.resolve(root).replace(/\\/g, "/");
  const normalizedAbsolute = absolute.replace(/\\/g, "/");
  if (!normalizedAbsolute.startsWith(`${normalizedRoot}/`)) return undefined;
  return normalizedAbsolute.slice(normalizedRoot.length + 1);
}
