import path from "node:path";
import type { AndroidCheckResult, AndroidCheckStatus } from "../../../validation/checkResult.js";
import { sortCandidateEvidence } from "../../ordering.js";
import { discoverAllowlistedExecutable, type DiscoveredExecutable } from "../discoverExecutable.js";
import { buildMinimalEnvironment } from "../minimalEnvironment.js";
import { writeExternalToolArtifact } from "../artifacts.js";
import { captureTargetSnapshot, buildExternalToolMutationReport } from "../mutation.js";
import { runBoundedExternalTool, buildCommandSummary, VERSION_PROBE_TIMEOUT_MS } from "../runBoundedExternalTool.js";
import type { ExternalToolExecutor } from "../types.js";
import { serializeSemgrepRulePack } from "./rules.js";
import { buildSemgrepArgs, parseSemgrepMajorVersion, semgrepCommandFamilyForVersion } from "./command.js";
import { parseSemgrepJson } from "./parseSemgrepJson.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — standalone Android Semgrep check. Not called from
// validateAndroidTarget or any active orchestration; not rendered in
// reports; no CLI effect. Batch 8 integrates.
// ---------------------------------------------------------------------------

export const ANDROID_SEMGREP_AUDIT_CHECK_ID = "android-semgrep-audit";
const SEMGREP_CANDIDATES = ["semgrep", "semgrep.exe"];
const SEMGREP_TIMEOUT_MS = 5 * 60_000;

export type AndroidSemgrepCheckOptions = {
  targetRoot: string;
  artifactRoot: string;
  executor: ExternalToolExecutor;
  // Injectable for tests, mirroring GradleCommandExecutor injection — tests
  // never need a real Semgrep binary on PATH. Defaults to real PATH
  // discovery of the fixed semgrep/semgrep.exe candidate list.
  discover?: () => DiscoveredExecutable;
};

function skippedCheck(reason: string, environmentRequirements: string[] = []): AndroidCheckResult {
  return {
    id: ANDROID_SEMGREP_AUDIT_CHECK_ID,
    category: "android-semgrep",
    title: "Android Semgrep audit",
    status: "skipped",
    requirementLevel: "optional",
    ran: false,
    skipped: true,
    skipInfo: {
      checkId: ANDROID_SEMGREP_AUDIT_CHECK_ID,
      reason,
      requirementLevel: "optional",
      missingCapability: "semgrep-executable",
      verdictImpact: "does not apply until Batch 8 integration",
      recommendedNextAction: "Install Semgrep locally, or run again after Batch 8 wires optional-tool selection into the CLI.",
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

export async function auditAndroidSemgrep(options: AndroidSemgrepCheckOptions): Promise<AndroidCheckResult> {
  const targetRoot = path.resolve(options.targetRoot);
  const discovered = (options.discover ?? (() => discoverAllowlistedExecutable(SEMGREP_CANDIDATES, targetRoot)))();
  if (!discovered.available) {
    return skippedCheck("Semgrep executable was not found on PATH.", ["Requires a Semgrep executable (semgrep) on PATH."]);
  }

  const env = buildMinimalEnvironment();
  const versionInput = { command: discovered.command, args: ["--version"], cwd: targetRoot, timeoutMs: VERSION_PROBE_TIMEOUT_MS, env };
  const versionOutcome = await runBoundedExternalTool(options.executor, versionInput);
  if (versionOutcome.result.timedOut || versionOutcome.result.exitCode === null) {
    return skippedCheck("Semgrep version probe failed or timed out.");
  }

  const rawVersion = versionOutcome.stdout.trim();
  const majorVersion = parseSemgrepMajorVersion(rawVersion);
  const family = semgrepCommandFamilyForVersion(majorVersion);
  if (!family) {
    return skippedCheck(`Semgrep version "${rawVersion || "(unknown)"}" is not a supported version family.`);
  }

  const configArtifact = writeExternalToolArtifact(options.artifactRoot, "semgrep", "android-rules.yaml", serializeSemgrepRulePack(), "text");
  const configAbsolutePath = path.resolve(options.artifactRoot, configArtifact.relativePath);

  const args = buildSemgrepArgs(family, configAbsolutePath, targetRoot);
  const commandSummary = buildCommandSummary(discovered.basename, args, targetRoot, path.resolve(options.artifactRoot));

  const before = captureTargetSnapshot(targetRoot, true);
  const analysisOutcome = await runBoundedExternalTool(options.executor, { command: discovered.command, args, cwd: targetRoot, timeoutMs: SEMGREP_TIMEOUT_MS, env });
  const after = captureTargetSnapshot(targetRoot, true);
  const mutation = buildExternalToolMutationReport(before, after);

  const warnings: string[] = [];
  if (analysisOutcome.stdoutTruncated) warnings.push("stdout was truncated; JSON output was not parsed as complete.");
  if (analysisOutcome.stderrTruncated) warnings.push("stderr was truncated.");
  if (!mutation.comparable) warnings.push(`Target mutation evidence unavailable: ${mutation.reason ?? "unknown reason"}`);
  if (mutation.unexpectedChanges.length > 0) warnings.push(`Unexpected target change(s) observed: ${mutation.unexpectedChanges.join(", ")}`);

  if (analysisOutcome.result.timedOut) {
    return {
      id: ANDROID_SEMGREP_AUDIT_CHECK_ID,
      category: "android-semgrep",
      title: "Android Semgrep audit",
      status: "inconclusive",
      requirementLevel: "optional",
      ran: true,
      skipped: false,
      evidence: [`version=${rawVersion}`, `commandFamily=${family}`],
      findings: [],
      warnings: [...warnings, `Semgrep timed out after ${SEMGREP_TIMEOUT_MS}ms.`],
      errors: [],
      sourcePaths: [],
      confidence: "medium",
      environmentRequirements: [],
      candidateEvidence: [],
    };
  }

  if (analysisOutcome.stdoutTruncated) {
    return {
      id: ANDROID_SEMGREP_AUDIT_CHECK_ID,
      category: "android-semgrep",
      title: "Android Semgrep audit",
      status: "inconclusive",
      requirementLevel: "optional",
      ran: true,
      skipped: false,
      evidence: [`version=${rawVersion}`, `commandFamily=${family}`],
      findings: [],
      warnings,
      errors: [],
      sourcePaths: [],
      confidence: "low",
      environmentRequirements: [],
      candidateEvidence: [],
    };
  }

  const parsed = parseSemgrepJson(analysisOutcome.stdout, targetRoot, configArtifact.sha256);
  const isFindingsExitCode = analysisOutcome.result.exitCode === 0 || analysisOutcome.result.exitCode === 1;

  if (parsed.malformed) {
    return {
      id: ANDROID_SEMGREP_AUDIT_CHECK_ID,
      category: "android-semgrep",
      title: "Android Semgrep audit",
      status: isFindingsExitCode ? "inconclusive" : "failed",
      requirementLevel: "optional",
      ran: true,
      skipped: false,
      evidence: [`version=${rawVersion}`, `commandFamily=${family}`, `exitCode=${analysisOutcome.result.exitCode}`],
      findings: [],
      warnings,
      errors: isFindingsExitCode ? [] : ["Semgrep exited with a non-findings error and produced no parseable JSON report."],
      sourcePaths: [],
      confidence: "low",
      environmentRequirements: [],
      candidateEvidence: [],
    };
  }

  for (const parserError of parsed.parserErrors) {
    warnings.push(`Semgrep reported a parser error: ${parserError}`);
  }
  if (parsed.truncated) warnings.push(`Finding count exceeded the bounded limit; results were truncated.`);

  const findingsById = new Map(parsed.findings.map((f) => [f.id, f]));
  const candidatesById = new Map(parsed.candidates.map((c) => [c.id, c]));
  const findings = [...findingsById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const candidateEvidence = sortCandidateEvidence([...candidatesById.values()]);

  // A findings exit code (0 or 1) with valid JSON is never treated as a
  // process crash — Semgrep uses 1 to mean "findings were reported", not
  // "the tool failed" (agents.txt Batch 7 section 10.11).
  const status: AndroidCheckStatus = findings.length > 0 ? "failed" : isFindingsExitCode ? "passed" : "error";

  return {
    id: ANDROID_SEMGREP_AUDIT_CHECK_ID,
    category: "android-semgrep",
    title: "Android Semgrep audit",
    status,
    requirementLevel: "optional",
    ran: true,
    skipped: false,
    evidence: [`version=${rawVersion}`, `commandFamily=${family}`, `scanned=${parsed.scannedCount}`, `command=${commandSummary}`],
    findings,
    warnings,
    errors: status === "error" ? ["Semgrep exited with a non-findings error."] : [],
    sourcePaths: [],
    confidence: parsed.parserErrors.length > 0 ? "medium" : "high",
    environmentRequirements: [],
    candidateEvidence,
  };
}
