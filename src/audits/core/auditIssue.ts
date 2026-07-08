import type { AuditConfidence, AuditFalsePositiveRisk, AuditSeverity, AuditType } from "./auditTypes.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 1 — audit evidence and issue schema.
//
// Mirrors the shape/spirit of src/securityValidation/attackScenarios/
// exploitEvidence.ts (small, JSON-serializable, deterministic, no raw
// secrets, no huge file contents) but is an independent type — audit issues
// are not security findings and must not be conflated with SecurityCheckResult.
// ---------------------------------------------------------------------------

export type AuditEvidenceKind = "file" | "command" | "diff" | "reference" | "observation";

export const AUDIT_EVIDENCE_KINDS: readonly AuditEvidenceKind[] = [
  "file",
  "command",
  "diff",
  "reference",
  "observation",
];

export type AuditEvidence = {
  kind: AuditEvidenceKind;
  message: string;
  filePath?: string;
  line?: number;
  excerpt?: string;
  command?: string;
  expected?: string;
  observed?: string;
  source: string;
  confidence: AuditConfidence;
};

const MAX_EXCERPT_LENGTH = 400;

// Bounds an excerpt to a safe preview length so evidence never embeds huge
// file contents. Does not attempt secret redaction here — detectors that
// scan for secret-shaped content are responsible for redacting before this
// point, same division of responsibility documented in exploitEvidence.ts.
export function boundExcerpt(raw: string, maxLength: number = MAX_EXCERPT_LENGTH): string {
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength)}... [truncated, ${raw.length} chars total]`;
}

export function makeAuditEvidence(evidence: AuditEvidence): AuditEvidence {
  return evidence.excerpt !== undefined ? { ...evidence, excerpt: boundExcerpt(evidence.excerpt) } : evidence;
}

export type AuditIssue = {
  id: string;
  auditType: AuditType;
  detectorId: string;
  title: string;
  description: string;
  severity: AuditSeverity;
  confidence: AuditConfidence;
  falsePositiveRisk: AuditFalsePositiveRisk;
  category: string;
  evidence: AuditEvidence[];
  affectedFiles: string[];
  recommendedAction: string;
  suggestedFixStrategy: string;
  validationCommands: string[];
  releaseBlocking: boolean;
  implementationBlocking: boolean;
  // Metadata only in Batch 1 — no auto-fix behavior is implemented, and none
  // of the current (zero) detectors set this to true.
  autoFixEligible: boolean;
};
