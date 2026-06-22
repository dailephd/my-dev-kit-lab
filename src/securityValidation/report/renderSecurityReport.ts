import type { SecurityCheckResult, SecurityFinding } from "../types.js";
import type { SecurityReport, SecurityReportSection } from "./securityReportTypes.js";
import { verdictToHumanLabel } from "../validate/verdict.js";

// ---------------------------------------------------------------------------
// Human-readable text report
// ---------------------------------------------------------------------------

function pad(label: string, width = 36): string {
  return label.padEnd(width, " ");
}

function statusIcon(status: string): string {
  switch (status) {
    case "passed": return "PASS";
    case "failed": return "FAIL";
    case "warning": return "WARN";
    case "skipped": return "SKIP";
    default: return "    ";
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function divider(char = "-", width = 72): string {
  return char.repeat(width);
}

export function renderTextReport(report: SecurityReport): string {
  const lines: string[] = [];
  const { metadata, allChecks, allFindings, verdict, recommendedNextStep } = report;

  lines.push(divider("="));
  lines.push("SECURITY VALIDATION REPORT");
  lines.push(divider("="));
  if (!metadata.isSelf) {
    lines.push(`Tool       : ${metadata.toolPackageName}@${metadata.toolPackageVersion}`);
    lines.push(`Tool root  : ${metadata.toolRoot}`);
    lines.push(`Target     : ${metadata.packageName}@${metadata.packageVersion}`);
    lines.push(`Target root: ${metadata.targetRoot}`);
  } else {
    lines.push(`Package    : ${metadata.packageName}@${metadata.packageVersion}`);
  }
  lines.push(`Branch     : ${metadata.branch}`);
  lines.push(`Commit     : ${metadata.commit}`);
  lines.push(`Generated  : ${metadata.generatedAt}`);
  lines.push(`Duration   : ${formatDuration(metadata.totalDurationMs)}`);
  lines.push("");

  // --- 1. Executive Summary ---
  lines.push(divider());
  lines.push("1. EXECUTIVE SUMMARY");
  lines.push(divider());
  lines.push(`Verdict    : ${verdictToHumanLabel(verdict).toUpperCase()}`);
  lines.push(`Checks run : ${allChecks.length}`);
  lines.push(`  Passed   : ${allChecks.filter((c) => c.status === "passed").length}`);
  lines.push(`  Warned   : ${allChecks.filter((c) => c.status === "warning").length}`);
  lines.push(`  Failed   : ${allChecks.filter((c) => c.status === "failed").length}`);
  lines.push(`  Skipped  : ${allChecks.filter((c) => c.status === "skipped").length}`);
  lines.push(`Findings   : ${allFindings.length}`);
  if (allFindings.length > 0) {
    for (const sev of ["blocker", "major", "minor", "informational"] as const) {
      const count = allFindings.filter((f) => f.severity === sev).length;
      if (count > 0) lines.push(`  ${sev.padEnd(16)} : ${count}`);
    }
  }
  lines.push(`Next step  : ${recommendedNextStep}`);
  lines.push("");

  // --- Check sections ---
  const sectionDefs = [
    { num: 2, title: "Branch and Commit", ids: [] as string[], alwaysShow: true },
    { num: 3, title: "Package Name and Version", ids: [], alwaysShow: true },
    { num: 4, title: "Security Model", ids: [], alwaysShow: true },
    { num: 5, title: "CodeQL Result", ids: ["codeql-scan"] },
    { num: 6, title: "Semgrep Result", ids: ["semgrep-scan"] },
    { num: 7, title: "npm audit Result", ids: ["npm-audit-full", "npm-audit-runtime"] },
    { num: 8, title: "OSV-Scanner Result", ids: ["osv-scanner"] },
    { num: 9, title: "Package Tarball Inspection", ids: ["npm-pack-dry-run"] },
    { num: 10, title: "File-System / Path Traversal Tests", ids: ["path-traversal-root", "path-traversal-out", "path-traversal-index", "absolute-path-escape", "path-harness-escape-detection"] },
    { num: 11, title: "Source Read-Only Boundary Tests", ids: ["source-files-not-modified", "writes-limited-to-output", "index-write-containment", "artifact-cleanup-safe"] },
    { num: 12, title: "Graphviz / Subprocess Safety Tests", ids: ["graphviz-label-escaping", "subprocess-no-shell-interpolation"] },
    { num: 13, title: "JSON stdout/stderr Safety Tests", ids: ["json-mode-parseable-output", "stderr-not-in-stdout", "json-failure-error-object", "progress-not-in-json-stdout"] },
    { num: 14, title: "Network Boundary Check", ids: [] },
    { num: 15, title: "Secret Leakage Check", ids: [] },
    { num: 16, title: "Artifact Content Safety Check", ids: ["artifact-cleanup-safe"] },
    { num: 17, title: "Symlink / Ignored-Folder Behavior", ids: [] },
    { num: 18, title: "Invalid Input / Error-Message Behavior", ids: ["malformed-manifest-all-cases", "malformed-code-graph", "unsupported-schema-version", "missing-index-directory"] },
    { num: 19, title: "Fuzz Smoke Result", ids: ["fuzz-smoke"] },
  ];

  for (const def of sectionDefs) {
    lines.push(divider());
    lines.push(`${def.num}. ${def.title.toUpperCase()}`);
    lines.push(divider());

    if (def.num === 2) {
      lines.push(`Branch : ${metadata.branch}`);
      lines.push(`Commit : ${metadata.commit}`);
      lines.push("");
      continue;
    }
    if (def.num === 3) {
      lines.push(`Name    : ${metadata.packageName}`);
      lines.push(`Version : ${metadata.packageVersion}`);
      lines.push("");
      continue;
    }
    if (def.num === 4) {
      lines.push("my-dev-kit is a local CLI package. The security model covers:");
      lines.push("  - local-first: no cloud/network calls during normal operation");
      lines.push("  - deterministic: reproducible outputs from same inputs");
      lines.push("  - read-only: does not modify user source files");
      lines.push("  - network-free: normal CLI operation requires no network");
      lines.push("  - LLM-free: no LLM calls");
      lines.push("  - database-free: no external databases");
      lines.push("This is CLI/package adversarial testing, not web-app pentesting.");
      lines.push("");
      continue;
    }
    if (def.num === 14) {
      lines.push("Normal my-dev-kit CLI operation does not require network access.");
      lines.push("Network access is only expected for npm lifecycle commands.");
      lines.push("Status: INFORMATIONAL (architectural guarantee, not tested dynamically)");
      lines.push("");
      continue;
    }
    if (def.num === 15) {
      lines.push("Artifact content is validated by the package tarball inspection check.");
      lines.push("Environment variables are not serialized into generated artifacts.");
      lines.push("Status: INFORMATIONAL (covered by package content checks)");
      lines.push("");
      continue;
    }
    if (def.num === 17) {
      lines.push("Symlink/junction escape tests are environment-dependent (require OS support).");
      lines.push("Status: SKIPPED-ENVIRONMENT (marked in test matrix)");
      lines.push("");
      continue;
    }

    if (def.ids.length === 0) {
      lines.push("(No dedicated checks for this section in this run.)");
      lines.push("");
      continue;
    }

    const sectionChecks = allChecks.filter((c) => def.ids.includes(c.id));
    if (sectionChecks.length === 0) {
      lines.push("(Checks not included in this run.)");
      lines.push("");
      continue;
    }

    for (const check of sectionChecks) {
      lines.push(
        `[${statusIcon(check.status)}] ${pad(check.name)} ${formatDuration(check.durationMs)}`
      );
      if (check.status === "skipped" && check.skippedReason) {
        lines.push(`       Reason: ${check.skippedReason}`);
      }
      if (check.findings.length > 0) {
        for (const f of check.findings) {
          lines.push(`       [${f.severity.toUpperCase()}] ${f.title}`);
          if (f.description) lines.push(`              ${f.description.slice(0, 120)}`);
        }
      }
    }
    lines.push("");
  }

  // --- 20. Findings by Severity ---
  lines.push(divider());
  lines.push("20. FINDINGS BY SEVERITY");
  lines.push(divider());
  if (allFindings.length === 0) {
    lines.push("No findings.");
  } else {
    for (const sev of ["blocker", "major", "minor", "informational"] as const) {
      const sevFindings = allFindings.filter((f) => f.severity === sev);
      if (sevFindings.length === 0) continue;
      lines.push(`${sev.toUpperCase()} (${sevFindings.length}):`);
      for (const f of sevFindings) {
        lines.push(`  [${f.id}] ${f.title}`);
        if (f.description) lines.push(`    ${f.description.slice(0, 120)}`);
        if (f.recommendation) lines.push(`    Recommendation: ${f.recommendation}`);
      }
    }
  }
  lines.push("");

  // --- 21. Release Verdict ---
  lines.push(divider("="));
  lines.push("21. RELEASE VERDICT");
  lines.push(divider("="));
  lines.push(verdictToHumanLabel(verdict).toUpperCase());
  lines.push("");

  // --- 22. Recommended Next Step ---
  lines.push(divider());
  lines.push("22. RECOMMENDED NEXT STEP");
  lines.push(divider());
  lines.push(recommendedNextStep);
  lines.push("");
  lines.push(divider("="));

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JSON report
// ---------------------------------------------------------------------------

export function renderJsonReport(report: SecurityReport): string {
  const { metadata, allChecks, allFindings, verdict, recommendedNextStep } = report;

  const sanitizedChecks = allChecks.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    status: c.status,
    severity: c.severity,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    durationMs: c.durationMs,
    findingCount: c.findings.length,
    skippedReason: c.skippedReason ?? null,
    command: c.command ?? null,
  }));

  const sanitizedFindings = allFindings.map((f) => ({
      id: f.id,
      title: f.title,
      severity: f.severity,
      category: f.category,
      description: f.description,
      evidence: f.evidence ? f.evidence.slice(0, 500) : undefined,
      affectedFiles: f.affectedFiles ?? [],
      recommendation: f.recommendation ?? undefined,
      releaseImpact: f.releaseImpact,
    }));

  const output = {
    schemaVersion: 1,
    metadata,
    summary: {
      totalChecks: allChecks.length,
      passed: allChecks.filter((c) => c.status === "passed").length,
      warned: allChecks.filter((c) => c.status === "warning").length,
      failed: allChecks.filter((c) => c.status === "failed").length,
      skipped: allChecks.filter((c) => c.status === "skipped").length,
      totalFindings: allFindings.length,
      blockerFindings: allFindings.filter((f) => f.severity === "blocker").length,
      majorFindings: allFindings.filter((f) => f.severity === "major").length,
      minorFindings: allFindings.filter((f) => f.severity === "minor").length,
    },
    verdict,
    verdictLabel: verdictToHumanLabel(verdict),
    recommendedNextStep,
    checks: sanitizedChecks,
    findings: sanitizedFindings,
  };

  return JSON.stringify(output, null, 2);
}
