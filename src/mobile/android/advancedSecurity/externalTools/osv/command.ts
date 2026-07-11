// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — fixed OSV-Scanner command planning.
//
// Exactly two supported command families, selected only by parsed major
// version. No caller-provided subcommands, endpoints, or scan paths beyond
// the validated target are ever accepted.
// ---------------------------------------------------------------------------

export type OsvCommandFamily = "modern" | "legacy";

export function osvCommandFamilyForVersion(majorVersion: number | undefined): OsvCommandFamily | undefined {
  if (majorVersion === undefined) return undefined;
  if (majorVersion >= 2) return "modern";
  if (majorVersion === 1) return "legacy";
  return undefined;
}

export function parseOsvMajorVersion(rawVersion: string): number | undefined {
  const match = /(\d+)\.\d+\.\d+/.exec(rawVersion);
  if (!match) return undefined;
  return Number.parseInt(match[1], 10);
}

export function buildOsvArgs(family: OsvCommandFamily, targetRoot: string): string[] {
  return family === "modern" ? ["scan", "source", "--recursive", "--format", "json", targetRoot] : ["--recursive", "--format", "json", targetRoot];
}
