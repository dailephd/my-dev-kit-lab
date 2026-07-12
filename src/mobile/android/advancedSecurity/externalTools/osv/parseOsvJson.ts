import path from "node:path";
import type { SecurityFinding } from "../../../../../securityValidation/types.js";
import { makeAndroidFinding } from "../../../audit/androidFinding.js";
import { makeCandidateEvidence, type CandidateEvidence } from "../../candidateEvidence.js";
import { buildAndroidSourceLocation } from "../../sourceLocation.js";
import { safeJsonParse, DEFAULT_MAX_MESSAGE_LENGTH } from "../boundedOutput.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — bounded OSV-Scanner JSON normalization.
//
// Only the one Batch 1 OSV rule id (android-optional-tool-osv-evidence) is
// used internally; the OSV vulnerability id and its aliases (CVE/GHSA) are
// preserved as public identifiers, never redacted or fingerprinted (they
// are not secrets). Complete advisory details and unbounded affected ranges
// are never retained.
// ---------------------------------------------------------------------------

const MAX_RESULTS = 5_000;

export type ParseOsvResult = {
  malformed: boolean;
  findings: SecurityFinding[];
  candidates: CandidateEvidence[];
  vulnerabilityCount: number;
  truncated: boolean;
};

function severityFromDatabaseSpecific(value: unknown): "major" | "minor" | "informational" | undefined {
  if (typeof value !== "string") return undefined;
  const upper = value.toUpperCase();
  if (upper === "CRITICAL" || upper === "HIGH") return "major";
  if (upper === "MODERATE" || upper === "MEDIUM") return "minor";
  if (upper === "LOW") return "informational";
  return undefined;
}

function severityFromCvssScore(severityEntries: unknown): "major" | "minor" | "informational" | undefined {
  if (!Array.isArray(severityEntries)) return undefined;
  for (const entry of severityEntries) {
    const record = entry as Record<string, unknown>;
    const score = typeof record.score === "string" ? Number.parseFloat(record.score) : undefined;
    if (score !== undefined && !Number.isNaN(score)) {
      if (score >= 7) return "major";
      if (score >= 4) return "minor";
      return "informational";
    }
  }
  return undefined;
}

function boundedText(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  return text.length > DEFAULT_MAX_MESSAGE_LENGTH ? `${text.slice(0, DEFAULT_MAX_MESSAGE_LENGTH)}...` : text;
}

export function parseOsvJson(rawStdout: string, targetRoot: string): ParseOsvResult {
  const parsed = safeJsonParse<Record<string, unknown>>(rawStdout);
  if (!parsed.ok) {
    return { malformed: true, findings: [], candidates: [], vulnerabilityCount: 0, truncated: parsed.truncated };
  }

  const results = Array.isArray(parsed.value.results) ? parsed.value.results : [];
  const findings: SecurityFinding[] = [];
  const candidates: CandidateEvidence[] = [];
  let vulnerabilityCount = 0;
  let truncated = false;

  for (const rawResult of results) {
    const result = rawResult as Record<string, unknown>;
    const source = result.source as Record<string, unknown> | undefined;
    const sourcePath = typeof source?.path === "string" ? source.path : undefined;
    const packages = Array.isArray(result.packages) ? result.packages : [];

    for (const rawPackage of packages) {
      const packageEntry = rawPackage as Record<string, unknown>;
      const pkg = packageEntry.package as Record<string, unknown> | undefined;
      const packageName = typeof pkg?.name === "string" ? pkg.name : "(unknown-package)";
      const ecosystem = typeof pkg?.ecosystem === "string" ? pkg.ecosystem : "(unknown-ecosystem)";
      const packageVersion = typeof pkg?.version === "string" ? pkg.version : undefined;
      const vulnerabilities = Array.isArray(packageEntry.vulnerabilities) ? packageEntry.vulnerabilities : [];

      let location;
      let relativePath: string | undefined;
      if (sourcePath) {
        try {
          const absolutePath = path.resolve(targetRoot, sourcePath);
          location = buildAndroidSourceLocation(targetRoot, absolutePath);
          relativePath = location.path;
        } catch {
          location = undefined;
        }
      }

      for (const rawVuln of vulnerabilities) {
        if (vulnerabilityCount >= MAX_RESULTS) {
          truncated = true;
          break;
        }
        vulnerabilityCount += 1;
        const vuln = rawVuln as Record<string, unknown>;
        const vulnId = typeof vuln.id === "string" ? vuln.id : "(unknown-id)";
        const aliases = Array.isArray(vuln.aliases) ? vuln.aliases.filter((a): a is string => typeof a === "string") : [];
        const summary = boundedText(vuln.summary ?? vuln.details);
        const severity = severityFromDatabaseSpecific((vuln.database_specific as Record<string, unknown> | undefined)?.severity) ?? severityFromCvssScore(vuln.severity);

        const identity = `osv:${vulnId}:${ecosystem}:${packageName}:${packageVersion ?? "(unknown-version)"}`;

        if (!relativePath) {
          candidates.push(
            makeCandidateEvidence({
              ruleId: "android-optional-tool-osv-evidence",
              category: "android-osv",
              confidence: "low",
              location: { path: "(unknown)" },
              summary: `OSV vulnerability ${vulnId} found for ${packageName}@${packageVersion ?? "?"} but no target-contained manifest path was reported`,
              rawValue: undefined,
              resolutionState: "unresolved",
              staticAnalysisLimitations: ["OSV-Scanner evidence only; does not prove dependency reachability or exploitability."],
            })
          );
          continue;
        }

        if (severity === undefined) {
          candidates.push(
            makeCandidateEvidence({
              ruleId: "android-optional-tool-osv-evidence",
              category: "android-osv",
              confidence: "medium",
              location: location!,
              summary: `OSV vulnerability ${vulnId} (unknown severity) affects ${packageName}@${packageVersion ?? "?"}`,
              rawValue: summary,
              resolutionState: "resolved",
              staticAnalysisLimitations: [`aliases=${aliases.join(",")}`, "OSV-Scanner evidence only; does not prove dependency reachability or exploitability."],
              relatedFindingIds: undefined,
            })
          );
          continue;
        }

        findings.push(
          makeAndroidFinding({
            ruleId: "android-optional-tool-osv-evidence",
            title: `OSV vulnerability ${vulnId} in ${packageName}${packageVersion ? `@${packageVersion}` : ""}`,
            severity,
            confidence: "medium",
            description: summary || `OSV reported a vulnerability for this dependency (ecosystem=${ecosystem}).`,
            manifestPath: relativePath,
            identity,
            evidenceDetails: [`ecosystem=${ecosystem}`, `package=${packageName}`, `version=${packageVersion ?? "(unknown)"}`, `aliases=${aliases.join(",") || "(none)"}`],
            recommendation: "Upgrade the affected dependency to a patched version.",
          })
        );
      }
    }
  }

  return { malformed: false, findings, candidates, vulnerabilityCount, truncated };
}
