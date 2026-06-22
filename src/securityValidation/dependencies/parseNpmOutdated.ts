import type { SecurityFinding } from "../types.js";

export type NpmOutdatedParseResult = {
  outdatedCount: number;
  findings: SecurityFinding[];
  parseError?: string;
};

// Parse npm outdated --json stdout.
// npm outdated exits 1 when packages are outdated; that is expected.
export function parseNpmOutdated(stdout: string, checkId: string): NpmOutdatedParseResult {
  if (!stdout.trim()) {
    return { outdatedCount: 0, findings: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    return {
      outdatedCount: 0,
      findings: [],
      parseError: `Failed to parse npm outdated JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { outdatedCount: 0, findings: [] };
  }

  const outdatedMap = parsed as Record<string, unknown>;
  const entries = Object.entries(outdatedMap);
  const findings: SecurityFinding[] = entries.map(([pkgName, info]) => {
    const pkg = info !== null && typeof info === "object" ? (info as Record<string, unknown>) : {};
    return {
      id: `${checkId}-outdated-${pkgName}`,
      title: `Outdated dependency: ${pkgName}`,
      severity: "informational" as const,
      category: "dependency-audit" as const,
      description: `${pkgName} has a newer version available`,
      evidence: `Current: ${pkg["current"] ?? "unknown"}, Wanted: ${pkg["wanted"] ?? "unknown"}, Latest: ${pkg["latest"] ?? "unknown"}`,
      affectedFiles: ["package.json"],
      recommendation: `Run npm install ${pkgName}@latest to update`,
      releaseImpact: "Informational: no direct release impact; consider updating before major releases",
    };
  });

  return {
    outdatedCount: entries.length,
    findings,
  };
}
