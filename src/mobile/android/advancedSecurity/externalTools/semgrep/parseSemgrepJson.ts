import path from "node:path";
import type { SecurityFinding } from "../../../../../securityValidation/types.js";
import { makeAndroidFinding } from "../../../audit/androidFinding.js";
import { makeCandidateEvidence, type CandidateEvidence } from "../../candidateEvidence.js";
import { buildAndroidSourceLocation } from "../../sourceLocation.js";
import { safeJsonParse, DEFAULT_MAX_MESSAGE_LENGTH } from "../boundedOutput.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — bounded Semgrep JSON normalization.
//
// Only the one Batch 1 Semgrep rule id (android-optional-tool-semgrep-
// evidence) is used internally; the external Semgrep rule id is preserved
// separately as `externalRuleId`. Full source snippets (extra.lines) and
// complete metavariable values are never retained.
// ---------------------------------------------------------------------------

const MAX_RESULTS = 5_000;
const MAX_SKIPPED_PATHS = 200;

export type ParseSemgrepResult = {
  malformed: boolean;
  toolVersion?: string;
  findings: SecurityFinding[];
  candidates: CandidateEvidence[];
  scannedCount: number;
  skippedPaths: string[];
  parserErrors: string[];
  truncated: boolean;
};

function severityToProjectSeverity(severity: string | undefined): "major" | "minor" | "informational" {
  switch (severity) {
    case "ERROR":
      return "major";
    case "WARNING":
      return "minor";
    default:
      return "informational";
  }
}

function boundedMessage(message: unknown): string {
  const text = typeof message === "string" ? message : "";
  return text.length > DEFAULT_MAX_MESSAGE_LENGTH ? `${text.slice(0, DEFAULT_MAX_MESSAGE_LENGTH)}...` : text;
}

export function parseSemgrepJson(rawStdout: string, targetRoot: string, configFingerprint: string): ParseSemgrepResult {
  const parsed = safeJsonParse<Record<string, unknown>>(rawStdout);
  if (!parsed.ok) {
    return { malformed: true, findings: [], candidates: [], scannedCount: 0, skippedPaths: [], parserErrors: [], truncated: parsed.truncated };
  }

  const doc = parsed.value;
  const toolVersion = typeof doc.version === "string" ? doc.version : undefined;
  const results = Array.isArray(doc.results) ? doc.results : [];
  const errors = Array.isArray(doc.errors) ? doc.errors : [];
  const pathsSection = doc.paths as Record<string, unknown> | undefined;
  const scanned = Array.isArray(pathsSection?.scanned) ? (pathsSection!.scanned as unknown[]) : [];
  const skipped = Array.isArray(pathsSection?.skipped) ? (pathsSection!.skipped as unknown[]) : [];

  const findings: SecurityFinding[] = [];
  const candidates: CandidateEvidence[] = [];
  let truncated = false;

  for (const rawResult of results.slice(0, MAX_RESULTS)) {
    if (results.length > MAX_RESULTS) truncated = true;
    const result = rawResult as Record<string, unknown>;
    const checkId = typeof result.check_id === "string" ? result.check_id : "(unknown-rule)";
    const relativePath = typeof result.path === "string" ? result.path : undefined;
    const start = result.start as Record<string, unknown> | undefined;
    const line = typeof start?.line === "number" ? start.line : undefined;
    const extra = (result.extra as Record<string, unknown>) ?? {};
    const severity = typeof extra.severity === "string" ? extra.severity : undefined;
    const message = boundedMessage(extra.message);
    const projectSeverity = severityToProjectSeverity(severity);

    if (!relativePath) {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-optional-tool-semgrep-evidence",
          category: "android-semgrep",
          confidence: "low",
          location: { path: "(unknown)" },
          summary: `Semgrep result "${checkId}" had no reportable path`,
          rawValue: undefined,
          resolutionState: "unresolved",
          staticAnalysisLimitations: ["Semgrep static analysis only; does not prove runtime exploitability."],
        })
      );
      continue;
    }

    const absolutePath = path.resolve(targetRoot, relativePath);
    let location;
    try {
      location = buildAndroidSourceLocation(targetRoot, absolutePath, { line });
    } catch {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-optional-tool-semgrep-evidence",
          category: "android-semgrep",
          confidence: "low",
          location: { path: relativePath },
          summary: `Semgrep result "${checkId}" reported a path outside the target`,
          rawValue: relativePath,
          resolutionState: "unresolved",
          staticAnalysisLimitations: ["Semgrep static analysis only; does not prove runtime exploitability."],
        })
      );
      continue;
    }

    if (projectSeverity === "informational" || severity === undefined) {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-optional-tool-semgrep-evidence",
          category: "android-semgrep",
          confidence: "medium",
          location,
          summary: `Semgrep ${severity ?? "unknown-severity"} result: ${checkId} — ${message}`,
          rawValue: message,
          resolutionState: "resolved",
          staticAnalysisLimitations: [`External rule: ${checkId}`, "Semgrep static analysis only; does not prove runtime exploitability."],
        })
      );
      continue;
    }

    findings.push(
      makeAndroidFinding({
        ruleId: "android-optional-tool-semgrep-evidence",
        title: `Semgrep finding: ${checkId}`,
        severity: projectSeverity,
        confidence: "medium",
        description: message || "Semgrep reported a finding for this rule.",
        manifestPath: relativePath,
        identity: `semgrep:${checkId}:${configFingerprint.slice(0, 16)}`,
        location: { line },
        evidenceDetails: [`externalRuleId=${checkId}`, `toolSeverity=${severity}`],
        recommendation: "Review the Semgrep rule pack entry and remediate the matched pattern.",
      })
    );
  }

  for (const rawSkip of skipped.slice(0, MAX_SKIPPED_PATHS)) {
    const skip = rawSkip as Record<string, unknown> | string;
    const skippedPath = typeof skip === "string" ? skip : typeof skip.path === "string" ? skip.path : undefined;
    if (skippedPath) {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-optional-tool-semgrep-evidence",
          category: "android-semgrep",
          confidence: "low",
          location: { path: skippedPath },
          summary: "Semgrep skipped this path during the scan",
          rawValue: undefined,
          resolutionState: "not-applicable",
          staticAnalysisLimitations: ["Semgrep static analysis only."],
        })
      );
    }
  }

  const parserErrors = errors.slice(0, 50).map((e) => (typeof e === "object" && e !== null && "message" in e ? boundedMessage((e as Record<string, unknown>).message) : "Semgrep reported an error."));

  return {
    malformed: false,
    toolVersion,
    findings,
    candidates,
    scannedCount: scanned.length,
    skippedPaths: skipped.map((s) => (typeof s === "string" ? s : typeof (s as Record<string, unknown>)?.path === "string" ? ((s as Record<string, unknown>).path as string) : "")).filter(Boolean),
    parserErrors,
    truncated,
  };
}
