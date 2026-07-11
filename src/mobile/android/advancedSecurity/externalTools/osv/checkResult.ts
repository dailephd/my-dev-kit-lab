import path from "node:path";
import type { AndroidCheckResult, AndroidCheckStatus } from "../../../validation/checkResult.js";
import { sortCandidateEvidence } from "../../ordering.js";
import { discoverAllowlistedExecutable, type DiscoveredExecutable } from "../discoverExecutable.js";
import { buildMinimalEnvironment } from "../minimalEnvironment.js";
import { runBoundedExternalTool, buildCommandSummary, VERSION_PROBE_TIMEOUT_MS } from "../runBoundedExternalTool.js";
import type { AndroidExternalToolNetworkPolicy, ExternalToolExecutor } from "../types.js";
import { buildOsvArgs, osvCommandFamilyForVersion, parseOsvMajorVersion } from "./command.js";
import { parseOsvJson } from "./parseOsvJson.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — standalone Android OSV-Scanner check. Not called from
// validateAndroidTarget or any active orchestration; not rendered in
// reports; no CLI effect. Batch 8 integrates.
//
// OSV is the one Batch 7 tool that may legitimately need network access
// (its vulnerability database service). Network is denied by default —
// running OSV against the network requires both an explicit request for
// "osv" AND networkPolicy "allow-for-requested-tool"; anything else skips.
// ---------------------------------------------------------------------------

export const ANDROID_OSV_AUDIT_CHECK_ID = "android-osv-audit";
const OSV_CANDIDATES = ["osv-scanner", "osv-scanner.exe"];
const OSV_TIMEOUT_MS = 5 * 60_000;

export type AndroidOsvCheckOptions = {
  targetRoot: string;
  executor: ExternalToolExecutor;
  networkPolicy: AndroidExternalToolNetworkPolicy;
  discover?: () => DiscoveredExecutable;
};

function skippedCheck(reason: string, environmentRequirements: string[] = []): AndroidCheckResult {
  return {
    id: ANDROID_OSV_AUDIT_CHECK_ID,
    category: "android-osv",
    title: "Android OSV-Scanner audit",
    status: "skipped",
    requirementLevel: "optional",
    ran: false,
    skipped: true,
    skipInfo: {
      checkId: ANDROID_OSV_AUDIT_CHECK_ID,
      reason,
      requirementLevel: "optional",
      missingCapability: "osv-scanner-executable-or-network",
      verdictImpact: "does not apply until Batch 8 integration",
      recommendedNextAction: "Install osv-scanner locally and/or authorize network access, or run again after Batch 8 wires optional-tool selection into the CLI.",
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

export async function auditAndroidOsv(options: AndroidOsvCheckOptions): Promise<AndroidCheckResult> {
  const targetRoot = path.resolve(options.targetRoot);

  if (options.networkPolicy !== "allow-for-requested-tool") {
    return skippedCheck("Network access was not authorized for OSV-Scanner (networkPolicy=deny), and no supported offline/local database mode was used.");
  }

  const discovered = (options.discover ?? (() => discoverAllowlistedExecutable(OSV_CANDIDATES, targetRoot)))();
  if (!discovered.available) {
    return skippedCheck("osv-scanner executable was not found on PATH.", ["Requires an osv-scanner executable on PATH."]);
  }

  const env = buildMinimalEnvironment();
  const versionOutcome = await runBoundedExternalTool(options.executor, { command: discovered.command, args: ["--version"], cwd: targetRoot, timeoutMs: VERSION_PROBE_TIMEOUT_MS, env });
  if (versionOutcome.result.timedOut || versionOutcome.result.exitCode === null) {
    return skippedCheck("osv-scanner version probe failed or timed out.");
  }

  const rawVersion = versionOutcome.stdout.trim();
  const majorVersion = parseOsvMajorVersion(rawVersion);
  const family = osvCommandFamilyForVersion(majorVersion);
  if (!family) {
    return skippedCheck(`osv-scanner version "${rawVersion || "(unknown)"}" is not a supported version family.`);
  }

  const args = buildOsvArgs(family, targetRoot);
  const commandSummary = buildCommandSummary(discovered.basename, args, targetRoot);
  const analysisOutcome = await runBoundedExternalTool(options.executor, { command: discovered.command, args, cwd: targetRoot, timeoutMs: OSV_TIMEOUT_MS, env });

  const warnings: string[] = [];
  if (analysisOutcome.stdoutTruncated) warnings.push("stdout was truncated; JSON output was not parsed as complete.");
  if (analysisOutcome.stderrTruncated) warnings.push("stderr was truncated.");

  if (analysisOutcome.result.timedOut) {
    return {
      id: ANDROID_OSV_AUDIT_CHECK_ID,
      category: "android-osv",
      title: "Android OSV-Scanner audit",
      status: "inconclusive",
      requirementLevel: "optional",
      ran: true,
      skipped: false,
      evidence: [`version=${rawVersion}`, `commandFamily=${family}`],
      findings: [],
      warnings: [...warnings, `osv-scanner timed out after ${OSV_TIMEOUT_MS}ms.`],
      errors: [],
      sourcePaths: [],
      confidence: "medium",
      environmentRequirements: [],
      candidateEvidence: [],
    };
  }

  if (analysisOutcome.stdoutTruncated) {
    return {
      id: ANDROID_OSV_AUDIT_CHECK_ID,
      category: "android-osv",
      title: "Android OSV-Scanner audit",
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

  const parsed = parseOsvJson(analysisOutcome.stdout, targetRoot);
  // osv-scanner exits 1 when vulnerabilities are found — a service/network
  // failure exits with a different code and typically no valid JSON.
  const isFindingsExitCode = analysisOutcome.result.exitCode === 0 || analysisOutcome.result.exitCode === 1;

  if (parsed.malformed) {
    return {
      id: ANDROID_OSV_AUDIT_CHECK_ID,
      category: "android-osv",
      title: "Android OSV-Scanner audit",
      status: isFindingsExitCode ? "inconclusive" : "failed",
      requirementLevel: "optional",
      ran: true,
      skipped: false,
      evidence: [`version=${rawVersion}`, `commandFamily=${family}`, `exitCode=${analysisOutcome.result.exitCode}`],
      findings: [],
      warnings,
      errors: isFindingsExitCode ? [] : ["osv-scanner exited with a non-findings error and produced no parseable JSON report."],
      sourcePaths: [],
      confidence: "low",
      environmentRequirements: [],
      candidateEvidence: [],
    };
  }

  if (parsed.truncated) warnings.push("Vulnerability count exceeded the bounded limit; results were truncated.");

  const findingsById = new Map(parsed.findings.map((f) => [f.id, f]));
  const candidatesById = new Map(parsed.candidates.map((c) => [c.id, c]));
  const findings = [...findingsById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const candidateEvidence = sortCandidateEvidence([...candidatesById.values()]);

  const status: AndroidCheckStatus = findings.length > 0 ? "failed" : isFindingsExitCode ? "passed" : "error";

  return {
    id: ANDROID_OSV_AUDIT_CHECK_ID,
    category: "android-osv",
    title: "Android OSV-Scanner audit",
    status,
    requirementLevel: "optional",
    ran: true,
    skipped: false,
    evidence: [`version=${rawVersion}`, `commandFamily=${family}`, `vulnerabilities=${parsed.vulnerabilityCount}`, `command=${commandSummary}`, "networkPolicy=allow-for-requested-tool"],
    findings,
    warnings,
    errors: status === "error" ? ["osv-scanner exited with a non-findings error."] : [],
    sourcePaths: [],
    confidence: "high",
    environmentRequirements: [],
    candidateEvidence,
  };
}
