import type { SecurityFinding } from "../types.js";

export type NpmLsParseResult = {
  ok: boolean;
  missingCount: number;
  invalidCount: number;
  findings: SecurityFinding[];
  parseError?: string;
};

// Parse npm ls --all --json stdout for missing or invalid dependencies.
// npm ls exits non-zero when there are problems; that is expected and handled here.
export function parseNpmLs(stdout: string, checkId: string): NpmLsParseResult {
  if (!stdout.trim()) {
    return { ok: true, missingCount: 0, invalidCount: 0, findings: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    return {
      ok: false,
      missingCount: 0,
      invalidCount: 0,
      findings: [],
      parseError: `Failed to parse npm ls JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const findings: SecurityFinding[] = [];
  let missingCount = 0;
  let invalidCount = 0;

  function walkDeps(node: unknown, depth: number): void {
    if (depth > 20 || typeof node !== "object" || node === null) return;
    const n = node as Record<string, unknown>;

    if (n["missing"] === true) {
      missingCount++;
      const name = typeof n["name"] === "string" ? n["name"] : "unknown";
      findings.push({
        id: `${checkId}-missing-${name}-${missingCount}`,
        title: `Missing dependency: ${name}`,
        severity: "major",
        category: "dependency-audit",
        description: `Dependency '${name}' is declared but not installed`,
        evidence: `npm ls reported missing: ${name}`,
        affectedFiles: ["package.json"],
        recommendation: "Run npm install or npm ci to restore the missing dependency",
        releaseImpact: "Major: missing dependency may cause build or runtime failures",
      });
    }

    if (n["invalid"] === true) {
      invalidCount++;
      const name = typeof n["name"] === "string" ? n["name"] : "unknown";
      findings.push({
        id: `${checkId}-invalid-${name}-${invalidCount}`,
        title: `Invalid dependency: ${name}`,
        severity: "minor",
        category: "dependency-audit",
        description: `Dependency '${name}' version does not satisfy the declared range`,
        evidence: `npm ls reported invalid: ${name}`,
        affectedFiles: ["package.json"],
        recommendation: "Run npm install to resolve version mismatches",
        releaseImpact: "Minor: version mismatch; review before release",
      });
    }

    const deps = n["dependencies"];
    if (typeof deps === "object" && deps !== null) {
      for (const child of Object.values(deps)) {
        walkDeps(child, depth + 1);
      }
    }
  }

  walkDeps(parsed, 0);

  return {
    ok: missingCount === 0 && invalidCount === 0,
    missingCount,
    invalidCount,
    findings,
  };
}
