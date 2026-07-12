import fs from "node:fs";
import path from "node:path";
import type { AndroidCheckResult, AndroidCheckStatus } from "../../../validation/checkResult.js";
import { sortCandidateEvidence } from "../../ordering.js";
import { discoverAllowlistedExecutable, type DiscoveredExecutable } from "../discoverExecutable.js";
import { buildMinimalEnvironment } from "../minimalEnvironment.js";
import { copyExternalToolArtifactFromTarget } from "../artifacts.js";
import { captureTargetSnapshot, buildExternalToolMutationReport } from "../mutation.js";
import { runBoundedExternalTool, buildCommandSummary, VERSION_PROBE_TIMEOUT_MS } from "../runBoundedExternalTool.js";
import type { ExternalToolExecutor } from "../types.js";
import { buildDependencyCheckArgs, DEPENDENCY_CHECK_REPORT_FILE_NAME, sanitizeDependencyCheckProjectName } from "./command.js";
import { parseDependencyCheckJson } from "./parseDependencyCheckJson.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — standalone Android OWASP Dependency-Check check. Not
// called from validateAndroidTarget or any active orchestration; not
// rendered in reports; no CLI effect. Batch 8 integrates.
// ---------------------------------------------------------------------------

export const ANDROID_DEPENDENCY_CHECK_AUDIT_CHECK_ID = "android-dependency-check-audit";
const DEPENDENCY_CHECK_CANDIDATES = ["dependency-check", "dependency-check.exe", "dependency-check.sh", "dependency-check.bat", "dependency-check.cmd"];
const DEPENDENCY_CHECK_TIMEOUT_MS = 15 * 60_000;
const DATABASE_UNAVAILABLE_PATTERN = /database.*(missing|unavailable|not found|corrupt)|no such file.*\.h2\.db/i;

export type AndroidDependencyCheckOptions = {
  targetRoot: string;
  artifactRoot: string;
  executor: ExternalToolExecutor;
  javaAvailable?: boolean;
  discover?: () => DiscoveredExecutable;
};

function skippedCheck(reason: string, environmentRequirements: string[] = []): AndroidCheckResult {
  return {
    id: ANDROID_DEPENDENCY_CHECK_AUDIT_CHECK_ID,
    category: "android-dependency-check",
    title: "Android OWASP Dependency-Check audit",
    status: "skipped",
    requirementLevel: "optional",
    ran: false,
    skipped: true,
    skipInfo: {
      checkId: ANDROID_DEPENDENCY_CHECK_AUDIT_CHECK_ID,
      reason,
      requirementLevel: "optional",
      missingCapability: "dependency-check-executable-or-database",
      verdictImpact: "does not apply until Batch 8 integration",
      recommendedNextAction: "Install OWASP Dependency-Check locally with a populated local database, or run again after Batch 8 wires optional-tool selection into the CLI.",
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

export async function auditAndroidDependencyCheck(options: AndroidDependencyCheckOptions): Promise<AndroidCheckResult> {
  const targetRoot = path.resolve(options.targetRoot);

  if (options.javaAvailable === false) {
    return skippedCheck("Java was not available; OWASP Dependency-Check requires a Java runtime.", ["Requires a Java runtime (JAVA_HOME or java on PATH)."]);
  }

  const discovered = (options.discover ?? (() => discoverAllowlistedExecutable(DEPENDENCY_CHECK_CANDIDATES, targetRoot)))();
  if (!discovered.available) {
    return skippedCheck("A Dependency-Check executable was not found on PATH.", ["Requires a Dependency-Check executable on PATH."]);
  }

  const env = buildMinimalEnvironment({ additionalAllowedKeys: ["JAVA_HOME"] });
  const versionOutcome = await runBoundedExternalTool(options.executor, { command: discovered.command, args: ["--version"], cwd: targetRoot, timeoutMs: VERSION_PROBE_TIMEOUT_MS, env });
  if (versionOutcome.result.timedOut || versionOutcome.result.exitCode === null) {
    return skippedCheck("Dependency-Check version probe failed or timed out.");
  }
  const rawVersion = versionOutcome.stdout.trim();

  const outDir = path.resolve(options.artifactRoot, "dependency-check", "raw");
  fs.mkdirSync(outDir, { recursive: true });
  const projectName = sanitizeDependencyCheckProjectName(path.basename(targetRoot));
  const args = buildDependencyCheckArgs(projectName, targetRoot, outDir);
  const commandSummary = buildCommandSummary(discovered.basename, args, targetRoot, path.resolve(options.artifactRoot));

  const before = captureTargetSnapshot(targetRoot, true);
  const analysisOutcome = await runBoundedExternalTool(options.executor, { command: discovered.command, args, cwd: targetRoot, timeoutMs: DEPENDENCY_CHECK_TIMEOUT_MS, env });
  const after = captureTargetSnapshot(targetRoot, true);
  const mutation = buildExternalToolMutationReport(before, after);

  const warnings: string[] = [];
  if (analysisOutcome.stdoutTruncated) warnings.push("stdout was truncated.");
  if (analysisOutcome.stderrTruncated) warnings.push("stderr was truncated.");
  if (!mutation.comparable) warnings.push(`Target mutation evidence unavailable: ${mutation.reason ?? "unknown reason"}`);
  if (mutation.unexpectedChanges.length > 0) warnings.push(`Unexpected target change(s) observed: ${mutation.unexpectedChanges.join(", ")}`);

  if (analysisOutcome.result.timedOut) {
    return {
      id: ANDROID_DEPENDENCY_CHECK_AUDIT_CHECK_ID,
      category: "android-dependency-check",
      title: "Android OWASP Dependency-Check audit",
      status: "inconclusive",
      requirementLevel: "optional",
      ran: true,
      skipped: false,
      evidence: [`version=${rawVersion}`],
      findings: [],
      warnings: [...warnings, `Dependency-Check timed out after ${DEPENDENCY_CHECK_TIMEOUT_MS}ms.`],
      errors: [],
      sourcePaths: [],
      confidence: "medium",
      environmentRequirements: [],
      candidateEvidence: [],
    };
  }

  const reportPath = path.join(outDir, DEPENDENCY_CHECK_REPORT_FILE_NAME);
  const reportExists = fs.existsSync(reportPath);

  if (!reportExists) {
    if (DATABASE_UNAVAILABLE_PATTERN.test(analysisOutcome.stderr)) {
      return skippedCheck("The local OWASP Dependency-Check vulnerability database is unavailable; updates are disabled by policy, so the scan did not run.", [
        "Requires a populated local Dependency-Check vulnerability database.",
      ]);
    }
    return {
      id: ANDROID_DEPENDENCY_CHECK_AUDIT_CHECK_ID,
      category: "android-dependency-check",
      title: "Android OWASP Dependency-Check audit",
      status: "inconclusive",
      requirementLevel: "optional",
      ran: true,
      skipped: false,
      evidence: [`version=${rawVersion}`, `exitCode=${analysisOutcome.result.exitCode}`, "No JSON report was produced."],
      findings: [],
      warnings,
      errors: analysisOutcome.result.exitCode !== 0 ? ["Dependency-Check exited non-zero and produced no report."] : [],
      sourcePaths: [],
      confidence: "low",
      environmentRequirements: [],
      candidateEvidence: [],
    };
  }

  const artifact = copyExternalToolArtifactFromTarget(options.artifactRoot, targetRoot, "dependency-check", reportPath, "json");
  void artifact;
  const rawJson = fs.readFileSync(reportPath, "utf8");
  const parsed = parseDependencyCheckJson(rawJson, targetRoot);
  const isFindingsExitCode = analysisOutcome.result.exitCode === 0 || analysisOutcome.result.exitCode === 1;

  if (parsed.malformed) {
    return {
      id: ANDROID_DEPENDENCY_CHECK_AUDIT_CHECK_ID,
      category: "android-dependency-check",
      title: "Android OWASP Dependency-Check audit",
      status: "inconclusive",
      requirementLevel: "optional",
      ran: true,
      skipped: false,
      evidence: [`version=${rawVersion}`, `exitCode=${analysisOutcome.result.exitCode}`],
      findings: [],
      warnings,
      errors: [],
      sourcePaths: [],
      confidence: "low",
      environmentRequirements: [],
      candidateEvidence: [],
    };
  }

  if (parsed.truncated) warnings.push("Dependency count exceeded the bounded limit; results were truncated.");

  const findingsById = new Map(parsed.findings.map((f) => [f.id, f]));
  const candidatesById = new Map(parsed.candidates.map((c) => [c.id, c]));
  const findings = [...findingsById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const candidateEvidence = sortCandidateEvidence([...candidatesById.values()]);

  const status: AndroidCheckStatus = findings.length > 0 ? "failed" : isFindingsExitCode ? "passed" : "error";

  return {
    id: ANDROID_DEPENDENCY_CHECK_AUDIT_CHECK_ID,
    category: "android-dependency-check",
    title: "Android OWASP Dependency-Check audit",
    status,
    requirementLevel: "optional",
    ran: true,
    skipped: false,
    evidence: [`version=${rawVersion}`, `dependencies=${parsed.dependencyCount}`, `command=${commandSummary}`],
    findings,
    warnings,
    errors: status === "error" ? ["Dependency-Check exited with a non-findings error."] : [],
    sourcePaths: [],
    confidence: "high",
    environmentRequirements: [],
    candidateEvidence,
  };
}
