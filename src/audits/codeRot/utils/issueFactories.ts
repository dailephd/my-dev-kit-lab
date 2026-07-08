import type { AuditIssue } from "../../core/auditIssue.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 3 — shared code-rot issue construction helpers.
//
// Issue ids are content-addressed (detectorId + a stable, relative-path-only
// cue) rather than counter-based, so the same underlying problem always
// produces the same id across runs -- this is what makes de-duplication and
// "stable issue ids" (Batch 3 spec 3.8) trivial: two candidate issues with
// the same id are the same issue.
// ---------------------------------------------------------------------------

// Builds a deterministic id from a detector id and one or more relative-path
// or short-string cues. Never embeds an absolute path -- callers must pass
// already-relative paths (e.g. from InventoryFileEntry.relativePath).
export function makeIssueId(detectorId: string, ...cues: string[]): string {
  const sanitizedCues = cues.map((cue) => cue.replace(/\\/g, "/"));
  return [detectorId, ...sanitizedCues].join(":");
}

export type CodeRotIssueInput = Omit<AuditIssue, "id" | "evidence" | "affectedFiles"> & {
  idCues: string[];
  evidence?: AuditIssue["evidence"];
  affectedFiles?: string[];
};

export function makeCodeRotIssue(input: CodeRotIssueInput): AuditIssue {
  const { idCues, evidence, affectedFiles, ...rest } = input;
  return {
    ...rest,
    id: makeIssueId(rest.detectorId, ...idCues),
    evidence: evidence ?? [],
    affectedFiles: affectedFiles ?? [],
  };
}

// Deduplicates a list of already-built issues by id, keeping the first
// occurrence and preserving overall array order (stable de-duplication).
export function deduplicateIssuesById(issues: AuditIssue[]): AuditIssue[] {
  const seen = new Set<string>();
  const result: AuditIssue[] = [];
  for (const issue of issues) {
    if (seen.has(issue.id)) continue;
    seen.add(issue.id);
    result.push(issue);
  }
  return result;
}
