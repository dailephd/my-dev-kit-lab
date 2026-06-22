import type { SecurityFinding, SecuritySeverity } from "../types.js";

export type NpmAuditSeverityCounts = {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
  total: number;
};

export type NpmAuditParseResult = {
  ok: boolean;
  severityCounts: NpmAuditSeverityCounts;
  findings: SecurityFinding[];
  parseError?: string;
};

const EMPTY_COUNTS: NpmAuditSeverityCounts = {
  critical: 0,
  high: 0,
  moderate: 0,
  low: 0,
  info: 0,
  total: 0,
};

function npmSeverityToInternal(npmSeverity: string): SecuritySeverity {
  switch (npmSeverity.toLowerCase()) {
    case "critical":
    case "high":
      return "blocker";
    case "moderate":
      return "major";
    case "low":
      return "minor";
    default:
      return "informational";
  }
}

// Parse npm audit --json stdout into structured findings.
// npm audit exits with code 1 when vulnerabilities are found; that is not an
// error here — the exit code is checked separately by the runner.
export function parseNpmAudit(stdout: string, checkId: string): NpmAuditParseResult {
  if (!stdout.trim()) {
    return {
      ok: true,
      severityCounts: { ...EMPTY_COUNTS },
      findings: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    return {
      ok: false,
      severityCounts: { ...EMPTY_COUNTS },
      findings: [],
      parseError: `Failed to parse npm audit JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      severityCounts: { ...EMPTY_COUNTS },
      findings: [],
      parseError: "npm audit JSON is not an object",
    };
  }

  const auditData = parsed as Record<string, unknown>;
  const metadata = auditData["metadata"] as Record<string, unknown> | undefined;
  const vulnerabilities = metadata?.["vulnerabilities"] as Record<string, unknown> | undefined;

  const counts: NpmAuditSeverityCounts = {
    critical: Number(vulnerabilities?.["critical"] ?? 0),
    high: Number(vulnerabilities?.["high"] ?? 0),
    moderate: Number(vulnerabilities?.["moderate"] ?? 0),
    low: Number(vulnerabilities?.["low"] ?? 0),
    info: Number(vulnerabilities?.["info"] ?? 0),
    total: Number(vulnerabilities?.["total"] ?? 0),
  };

  const findings: SecurityFinding[] = [];

  const vulnsMap = auditData["vulnerabilities"] as Record<string, unknown> | undefined;
  if (vulnsMap) {
    for (const [pkgName, vulnData] of Object.entries(vulnsMap)) {
      const vuln = vulnData as Record<string, unknown>;
      const severity = typeof vuln["severity"] === "string" ? vuln["severity"] : "moderate";
      const via = vuln["via"];
      const advisories = Array.isArray(via)
        ? via.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null && "title" in v)
        : [];

      if (advisories.length > 0) {
        for (const advisory of advisories) {
          findings.push({
            id: `${checkId}-${pkgName}-${String(advisory["source"] ?? advisory["title"] ?? "vuln")}`,
            title: `Vulnerability in ${pkgName}: ${String(advisory["title"] ?? "unknown")}`,
            severity: npmSeverityToInternal(severity),
            category: "dependency-audit",
            description: String(advisory["title"] ?? "No description available"),
            evidence: `Package: ${pkgName}, Severity: ${severity}, Range: ${String(vuln["range"] ?? "unknown")}`,
            affectedFiles: [],
            recommendation: `Update ${pkgName} to a fixed version. See: ${String(advisory["url"] ?? "npm audit for details")}`,
            releaseImpact:
              severity === "critical" || severity === "high"
                ? "Blocker: must fix before release"
                : severity === "moderate"
                  ? "Major: should fix before release"
                  : "Minor: can fix in patch release",
          });
        }
      } else {
        findings.push({
          id: `${checkId}-${pkgName}-${severity}`,
          title: `Vulnerability in ${pkgName}`,
          severity: npmSeverityToInternal(severity),
          category: "dependency-audit",
          description: `${pkgName} has a ${severity} severity vulnerability`,
          evidence: `Package: ${pkgName}, Severity: ${severity}`,
          affectedFiles: [],
          recommendation: `Update ${pkgName} to a patched version`,
          releaseImpact:
            severity === "critical" || severity === "high"
              ? "Blocker: must fix before release"
              : "Minor: review before release",
        });
      }
    }
  }

  return {
    ok: counts.total === 0,
    severityCounts: counts,
    findings,
  };
}
