import path from "node:path";
import type { SecurityFinding } from "../../../../../securityValidation/types.js";
import { makeAndroidFinding } from "../../../audit/androidFinding.js";
import { makeCandidateEvidence, type CandidateEvidence } from "../../candidateEvidence.js";
import { buildAndroidSourceLocation } from "../../sourceLocation.js";
import { safeJsonParse, DEFAULT_MAX_MESSAGE_LENGTH } from "../boundedOutput.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — bounded OWASP Dependency-Check JSON normalization.
//
// Only the one Batch 1 Dependency-Check rule id
// (android-optional-tool-dependency-check-evidence) is used internally; the
// vulnerability id (CVE/GHSA/etc.) is preserved as a public identifier.
// External cache paths (dependencies resolved from ~/.gradle, ~/.m2, etc.)
// are never used as a source location — only target-contained paths are.
// ---------------------------------------------------------------------------

const MAX_DEPENDENCIES = 5_000;

export type ParseDependencyCheckResult = {
  malformed: boolean;
  findings: SecurityFinding[];
  candidates: CandidateEvidence[];
  dependencyCount: number;
  truncated: boolean;
};

function boundedText(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  return text.length > DEFAULT_MAX_MESSAGE_LENGTH ? `${text.slice(0, DEFAULT_MAX_MESSAGE_LENGTH)}...` : text;
}

function severityFromCvss(vuln: Record<string, unknown>): { severity: "major" | "minor" | "informational" | undefined; cvssVersion?: string; score?: number } {
  const cvssv3 = vuln.cvssv3 as Record<string, unknown> | undefined;
  const cvssv2 = vuln.cvssv2 as Record<string, unknown> | undefined;
  const v3Score = typeof cvssv3?.baseScore === "number" ? cvssv3.baseScore : undefined;
  if (v3Score !== undefined) {
    return { severity: v3Score >= 7 ? "major" : v3Score >= 4 ? "minor" : v3Score > 0 ? "informational" : undefined, cvssVersion: "3", score: v3Score };
  }
  const v2Score = typeof cvssv2?.score === "number" ? cvssv2.score : undefined;
  if (v2Score !== undefined) {
    return { severity: v2Score >= 7 ? "major" : v2Score >= 4 ? "minor" : v2Score > 0 ? "informational" : undefined, cvssVersion: "2", score: v2Score };
  }
  const toolSeverity = typeof vuln.severity === "string" ? vuln.severity.toUpperCase() : undefined;
  if (toolSeverity === "CRITICAL" || toolSeverity === "HIGH") return { severity: "major" };
  if (toolSeverity === "MEDIUM") return { severity: "minor" };
  if (toolSeverity === "LOW") return { severity: "informational" };
  return { severity: undefined };
}

function normalizeDependencyPath(targetRoot: string, filePath: string | undefined): { relativePath?: string; isExternal: boolean } {
  if (!filePath) return { isExternal: true };
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(targetRoot, filePath);
  const normalizedRoot = path.resolve(targetRoot).replace(/\\/g, "/");
  const normalizedAbsolute = absolute.replace(/\\/g, "/");
  if (normalizedAbsolute.startsWith(`${normalizedRoot}/`)) {
    try {
      return { relativePath: buildAndroidSourceLocation(targetRoot, absolute).path, isExternal: false };
    } catch {
      return { isExternal: true };
    }
  }
  return { isExternal: true };
}

export function parseDependencyCheckJson(rawJson: string, targetRoot: string): ParseDependencyCheckResult {
  const parsed = safeJsonParse<Record<string, unknown>>(rawJson);
  if (!parsed.ok) return { malformed: true, findings: [], candidates: [], dependencyCount: 0, truncated: parsed.truncated };

  const dependencies = Array.isArray(parsed.value.dependencies) ? parsed.value.dependencies : [];
  const findings: SecurityFinding[] = [];
  const candidates: CandidateEvidence[] = [];
  let truncated = dependencies.length > MAX_DEPENDENCIES;

  for (const rawDependency of dependencies.slice(0, MAX_DEPENDENCIES)) {
    const dependency = rawDependency as Record<string, unknown>;
    const fileName = typeof dependency.fileName === "string" ? dependency.fileName : "(unknown-dependency)";
    const filePath = typeof dependency.filePath === "string" ? dependency.filePath : undefined;
    const { relativePath, isExternal } = normalizeDependencyPath(targetRoot, filePath);
    const vulnerabilities = Array.isArray(dependency.vulnerabilities) ? dependency.vulnerabilities : [];
    const suppressed = Array.isArray(dependency.suppressedVulnerabilities) ? dependency.suppressedVulnerabilities : [];
    const suppressedNames = new Set(suppressed.map((v) => (typeof (v as Record<string, unknown>)?.name === "string" ? ((v as Record<string, unknown>).name as string) : undefined)).filter(Boolean));

    for (const rawVuln of vulnerabilities) {
      const vuln = rawVuln as Record<string, unknown>;
      const vulnName = typeof vuln.name === "string" ? vuln.name : "(unknown-vulnerability)";
      const cwes = Array.isArray(vuln.cwes) ? vuln.cwes.filter((c): c is string => typeof c === "string") : [];
      const description = boundedText(vuln.description);
      const { severity, cvssVersion, score } = severityFromCvss(vuln);
      const identity = `dependency-check:${vulnName}:${fileName}:${relativePath ?? "(external)"}`;
      const sourcePath = relativePath ?? `(external-cache) ${fileName}`;

      if (suppressedNames.has(vulnName)) {
        candidates.push(
          makeCandidateEvidence({
            ruleId: "android-optional-tool-dependency-check-evidence",
            category: "android-dependency-check",
            confidence: "low",
            location: relativePath ? buildAndroidSourceLocation(targetRoot, path.resolve(targetRoot, relativePath)) : { path: sourcePath },
            summary: `Dependency-Check reports ${vulnName} as suppressed for ${fileName} (tool-reported; not independently verified)`,
            rawValue: undefined,
            resolutionState: "not-applicable",
            staticAnalysisLimitations: ["Suppression is tool-reported only; this analysis does not verify the suppression is justified."],
          })
        );
        continue;
      }

      if (isExternal) {
        candidates.push(
          makeCandidateEvidence({
            ruleId: "android-optional-tool-dependency-check-evidence",
            category: "android-dependency-check",
            confidence: "low",
            location: { path: sourcePath },
            summary: `Dependency-Check vulnerability ${vulnName} affects ${fileName} (resolved from an external cache, not a target-contained path)`,
            rawValue: undefined,
            resolutionState: "unresolved",
            staticAnalysisLimitations: ["Dependency resolved outside the target; not used as a target source location."],
          })
        );
        continue;
      }

      if (severity === undefined) {
        candidates.push(
          makeCandidateEvidence({
            ruleId: "android-optional-tool-dependency-check-evidence",
            category: "android-dependency-check",
            confidence: "medium",
            location: buildAndroidSourceLocation(targetRoot, path.resolve(targetRoot, relativePath!)),
            summary: `Dependency-Check vulnerability ${vulnName} (unknown severity) affects ${fileName}`,
            rawValue: description,
            resolutionState: "resolved",
            staticAnalysisLimitations: [`cwes=${cwes.join(",")}`, "Dependency-Check evidence only; does not prove the dependency is packaged into the final APK."],
          })
        );
        continue;
      }

      findings.push(
        makeAndroidFinding({
          ruleId: "android-optional-tool-dependency-check-evidence",
          title: `Dependency-Check vulnerability ${vulnName} in ${fileName}`,
          severity,
          confidence: "medium",
          description: description || `Dependency-Check reported a vulnerability for this dependency.`,
          manifestPath: relativePath!,
          identity,
          evidenceDetails: [`cwes=${cwes.join(",") || "(none)"}`, cvssVersion ? `cvssV${cvssVersion}=${score}` : undefined].filter((v): v is string => Boolean(v)),
          recommendation: "Upgrade the affected dependency to a patched version.",
        })
      );
    }
  }

  return { malformed: false, findings, candidates, dependencyCount: dependencies.length, truncated };
}
