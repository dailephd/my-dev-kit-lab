// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — fixed Semgrep command planning.
//
// Exactly two supported command families, selected only by parsed major
// version — never by trial-and-error after a failed attempt. No caller-
// provided flags, config identifiers, or excludes are ever accepted.
// ---------------------------------------------------------------------------

export const SEMGREP_FIXED_EXCLUDES = [".git", "node_modules", "build", "dist", "out", "coverage", ".gradle", "reports", "lab-output", ".my-dev-kit", "*.apk", "*.aab"];

export type SemgrepCommandFamily = "modern" | "legacy";

export function semgrepCommandFamilyForVersion(majorVersion: number | undefined): SemgrepCommandFamily | undefined {
  if (majorVersion === undefined) return undefined;
  if (majorVersion >= 1) return "modern";
  if (majorVersion === 0) return "legacy";
  return undefined;
}

export function parseSemgrepMajorVersion(rawVersion: string): number | undefined {
  const match = /(\d+)\.\d+\.\d+/.exec(rawVersion);
  if (!match) return undefined;
  return Number.parseInt(match[1], 10);
}

export function buildSemgrepArgs(family: SemgrepCommandFamily, configPath: string, targetRoot: string): string[] {
  const excludeArgs = SEMGREP_FIXED_EXCLUDES.flatMap((pattern) => ["--exclude", pattern]);
  const base = ["--config", configPath, "--json", "--metrics=off", "--disable-version-check", ...excludeArgs, targetRoot];
  return family === "modern" ? ["scan", ...base] : base;
}
