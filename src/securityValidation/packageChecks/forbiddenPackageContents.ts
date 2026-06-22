import type { SecurityFinding } from "../types.js";

export type ForbiddenContentMatch = {
  file: string;
  pattern: string;
};

// Normalize a tarball path for pattern matching.
// npm pack prefixes files with "package/", which we strip.
function normalizeTarballPath(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  return normalized.startsWith("package/") ? normalized.slice("package/".length) : normalized;
}

// Check whether a file path matches a forbidden pattern.
// Patterns ending with "/" match directory prefixes.
// Patterns starting with "*" are suffix matches.
// Exact string matches are also supported.
function matchesForbiddenPattern(normalizedPath: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  const f = normalizedPath.toLowerCase();

  if (p.endsWith("/")) {
    return f.startsWith(p) || f === p.slice(0, -1);
  }
  if (p.startsWith("*.")) {
    return f.endsWith(p.slice(1));
  }
  if (p.includes("*")) {
    // Simple glob: split on * and check prefix/suffix
    const parts = p.split("*").filter(Boolean);
    if (parts.length === 1) return f.includes(parts[0]);
    return f.startsWith(parts[0]) && f.endsWith(parts[parts.length - 1]);
  }
  return f === p || f.startsWith(p + "/");
}

// Detect files in the tarball file list that match forbidden patterns.
export function detectForbiddenContents(options: {
  files: string[];
  forbiddenPatterns: string[];
  allowedExceptions: string[];
  checkId: string;
}): { matches: ForbiddenContentMatch[]; findings: SecurityFinding[] } {
  const matches: ForbiddenContentMatch[] = [];

  for (const rawFile of options.files) {
    const normalized = normalizeTarballPath(rawFile);

    const isException = options.allowedExceptions.some((ex) =>
      matchesForbiddenPattern(normalized, ex)
    );
    if (isException) continue;

    for (const pattern of options.forbiddenPatterns) {
      if (matchesForbiddenPattern(normalized, pattern)) {
        matches.push({ file: normalized, pattern });
        break;
      }
    }
  }

  const findings: SecurityFinding[] = matches.map((m, i) => ({
    id: `${options.checkId}-forbidden-${i}`,
    title: `Forbidden file in npm tarball: ${m.file}`,
    severity: isCriticalForbidden(m.file) ? "blocker" : "major",
    category: "package-content" as const,
    description: `The file '${m.file}' matches the forbidden pattern '${m.pattern}' and must not be included in the published package`,
    evidence: `File: ${m.file}, Matched pattern: ${m.pattern}`,
    affectedFiles: [m.file],
    recommendation: `Add '${m.file}' to the .npmignore file or remove it from the 'files' field in package.json`,
    releaseImpact: isCriticalForbidden(m.file)
      ? "Blocker: this file must not be published"
      : "Major: this file should not be in the published package",
  }));

  return { matches, findings };
}

function isCriticalForbidden(file: string): boolean {
  const f = file.toLowerCase();
  return (
    f.includes(".env") ||
    f.endsWith(".pem") ||
    f.endsWith(".key") ||
    f.endsWith(".p12") ||
    f.startsWith("lab-output/") ||
    f.startsWith(".my-dev-kit/")
  );
}
