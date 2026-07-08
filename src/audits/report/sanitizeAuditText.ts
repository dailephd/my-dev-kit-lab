// ---------------------------------------------------------------------------
// v0.3.0 Batch 5 — audit text-report sanitization.
//
// Same technique as src/securityValidation/attackScenarios/exploitEvidence.ts's
// stripUnsafeControlChars()/sanitizeForTextReport() (strip ANSI CSI escapes
// and other unsafe control bytes before printing hostile-sourced text into a
// terminal-readable report). Deliberately NOT imported from
// src/securityValidation/ -- audit and security-validation are kept as
// independent frameworks throughout this codebase (see the header comment in
// src/audits/core/auditIssue.ts), and this is a small, self-contained,
// dependency-free function, so a 10-line local copy is cheaper than adding a
// cross-framework import for one helper.
//
// JSON output does not need this: JSON.stringify already escapes control
// characters (including ESC, 0x1b) into safe \u00XX sequences by
// specification, so hostile control bytes can never corrupt JSON structure.
// This sanitizer is used only by renderAuditTextReport.ts.
// ---------------------------------------------------------------------------

// ANSI CSI (Control Sequence Introducer) escape sequences, e.g. "\x1b[31m".
const ANSI_CSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

// Other C0 control characters except common whitespace (tab \t, newline \n,
// carriage return \r), plus the DEL character (0x7f).
// eslint-disable-next-line no-control-regex
const OTHER_CONTROL_CHARS_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export function stripUnsafeControlChars(raw: string): string {
  return raw.replace(ANSI_CSI_PATTERN, "").replace(OTHER_CONTROL_CHARS_PATTERN, "");
}

const DEFAULT_MAX_TEXT_EXCERPT_LENGTH = 300;

// Bounds+sanitizes a string for inclusion in the text report: strips unsafe
// control bytes first (so a payload cannot hide behind control characters),
// then re-bounds length defensively even though callers (e.g. AuditEvidence
// excerpts) are usually already bounded upstream by boundExcerpt() in
// auditIssue.ts.
export function sanitizeAuditText(raw: string, maxLength: number = DEFAULT_MAX_TEXT_EXCERPT_LENGTH): string {
  const stripped = stripUnsafeControlChars(raw);
  if (stripped.length <= maxLength) return stripped;
  return `${stripped.slice(0, maxLength)}... [truncated, ${stripped.length} chars total]`;
}
